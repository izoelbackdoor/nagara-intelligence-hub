-- desain_render_video: video final Motion Designer dirender Remotion di GitHub Actions (gratis), disimpan di Storage.
-- Alur: Motion Designer mengeluarkan "edit" → aset video 'Video Final' (media.endpoint = 'remotion') menunggu klip/keyframe
-- selesai → desain_media_antrian() mengirim props → n8n membuat signed upload URL + memicu workflow GitHub →
-- GitHub merender, mengunggah, lalu memanggil desain_render_hasil() (anon, dicek token per render).
-- Aditif & aman diulang.

-- 1. Bucket publik untuk hasil render (maks 50 MB, hanya MP4)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('desain', 'desain', true, 52428800, array['video/mp4'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 2. Konfigurasi render (anon key = kunci publik, aman disimpan di sini)
update nadi_config set cfg = jsonb_set(cfg, '{design,render}', jsonb_build_object(
  'aktif', true,
  'repo', 'izoelbackdoor/nagara-intelligence-hub',
  'workflow', 'render-video.yml',
  'ref', 'main',
  'supabase_url', 'https://uaozmljwwigwhuofbwet.supabase.co',
  'bucket', 'desain',
  'anon_key', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhb3ptbGp3d2lnd2h1b2Zid2V0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzMjMwNjgsImV4cCI6MjEwNjg5OTA2OH0.OWC9aAEh8lGTXO94vyZycsPFy1KncMTY7Efy5QwNbLc'
), true) where id = 1;

-- 3. Prompt Motion Designer: keluarkan rencana edit, sistem yang merender video final
update office_agents set system_prompt = replace(replace(replace(system_prompt,
  'buat media image keyframe (rasio 9:16, tanpa teks kecil, judul "Keyframe 1", dst)',
  'buat media image keyframe (rasio 9:16, TANPA teks apa pun karena teks ditambahkan saat render, judul "Keyframe 1", dst)'),
  'Overlay teks dan penggabungan klip dikerjakan saat editing.',
  'Sistem merender VIDEO FINAL otomatis dari field "edit": klip/keyframe berurutan, teks besar per adegan, subtitle, transisi, dan kartu penutup (CTA) dengan palet & font arah kreatif. Jadi wajib isi "edit":
  - adegan: 3-6 item urut, tiap item {"sumber":"<judul media persis, mis. Klip 1 atau Keyframe 3>","durasi":<detik 2-6>,"teks":"<maks 6 kata, opsional>","subtitle":"<1 kalimat narasi, opsional>"}. Klip video maksimal sepanjang durasi klipnya.
  - penutup: {"teks":"<ajakan, maks 5 kata>","sub":"<cara pesan/kontak singkat, tanpa harga>"}.
  - Total 15-30 detik. Hook di adegan pertama.'),
  '{"tipe":"video","judul":"Klip 1","sumber":"Keyframe 1","prompt":"...","durasi":5}]}',
  '{"tipe":"video","judul":"Klip 1","sumber":"Keyframe 1","prompt":"...","durasi":5}],"edit":{"adegan":[{"sumber":"Klip 1","durasi":4,"teks":"...","subtitle":"..."},{"sumber":"Keyframe 2","durasi":3,"teks":"..."}],"penutup":{"teks":"...","sub":"..."}}}')
where desk_key = 'desain-motion' and system_prompt not like '%VIDEO FINAL%';

-- 4. Jatah video tidak menghitung video final hasil render
create or replace function desain_sisa_media(p_job uuid, p_desk text, p_jenis text) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0,
    coalesce((desain_cfg()->>case when p_jenis = 'image' then 'maks_gambar' else 'maks_video' end)::int, 0)
    - (select count(*) from design_assets a where a.job_id = p_job and a.jenis = p_jenis
         and a.status not in ('arsip','gagal') and a.desk_key is distinct from p_desk
         and coalesce(a.media->>'endpoint', '') <> 'remotion'))::int
$$;

-- 5. Simpan hasil: buat aset 'Video Final' dari field edit (hanya desk motion)
do $$
declare def text;
begin
  def := pg_get_functiondef('desain_simpan_hasil(uuid,boolean,jsonb,text,integer,integer,text)'::regprocedure);
  if position('remotion' in def) = 0 then
    def := replace(def,
'  if exists (select 1 from design_assets where task_id = t.id and status = ''antre_media'') then',
'  if t.desk_key = ''desain-motion'' and jsonb_typeof(p_output->''edit''->''adegan'') = ''array''
     and jsonb_array_length(p_output->''edit''->''adegan'') > 0 and coalesce((cfg->''render''->>''aktif'')::boolean, false) then
    insert into design_assets (job_id, task_id, desk_key, versi, jenis, judul, status, media)
    values (j.id, t.id, t.desk_key, v_versi, ''video'', ''Video Final'', ''antre_media'',
            jsonb_build_object(''endpoint'', ''remotion'', ''percobaan'', 0, ''edit'', p_output->''edit''));
  end if;

  if exists (select 1 from design_assets where task_id = t.id and status = ''antre_media'') then');
    if position('Video Final' in def) = 0 then raise exception 'patch desain_simpan_hasil gagal'; end if;
    execute def;
  end if;
end $$;

-- 6. Susun props render dari aset job (judul → URL; klip gagal → keyframe sumbernya)
create or replace function desain_render_props(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a design_assets; j design_jobs; ak jsonb; e jsonb; it jsonb; v_url text; v_jenis text; adegan jsonb := '[]';
        pal jsonb; dasar text; aksen text; tinta text;
begin
  select * into a from design_assets where id = p_asset;
  select * into j from design_jobs where id = a.job_id;
  ak := coalesce(j.rencana->'arah_kreatif', '{}');
  e := a.media->'edit';
  for it in select * from jsonb_array_elements(coalesce(e->'adegan', '[]')) loop
    v_url := null; v_jenis := null;
    select s.url, s.jenis into v_url, v_jenis from design_assets s
     where s.job_id = a.job_id and s.task_id = a.task_id and s.jenis in ('image', 'video') and s.status = 'siap' and s.url is not null
       and lower(s.judul) = lower(trim(it->>'sumber')) and s.id <> a.id
     order by s.created_at desc limit 1;
    if v_url is null then -- klip gagal → pakai keyframe sumbernya
      select k.url, k.jenis into v_url, v_jenis from design_assets v join design_assets k
        on k.job_id = v.job_id and k.task_id = v.task_id and lower(k.judul) = lower(v.media->>'sumber') and k.status = 'siap' and k.url is not null
       where v.job_id = a.job_id and v.task_id = a.task_id and lower(v.judul) = lower(trim(it->>'sumber'))
       limit 1;
    end if;
    if v_url is not null then
      adegan := adegan || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('sumber', v_url, 'jenis', v_jenis,
        'durasi', least(15, greatest(1.5, coalesce(nullif(it->>'durasi', '')::numeric, 4))),
        'teks', nullif(left(it->>'teks', 80), ''), 'subtitle', nullif(left(it->>'subtitle', 160), ''))));
    end if;
  end loop;

  -- palet: cari peran dari "pakai_untuk", jika tidak ada pakai urutan
  pal := coalesce(ak->'palet', '[]');
  select x->>'hex' into dasar from jsonb_array_elements(pal) x where (x->>'pakai_untuk') ~* '(dasar|latar|background)' limit 1;
  select x->>'hex' into aksen from jsonb_array_elements(pal) x where (x->>'pakai_untuk') ~* '(aksen|tombol|cta|highlight)' limit 1;
  select x->>'hex' into tinta from jsonb_array_elements(pal) x where (x->>'pakai_untuk') ~* '(teks|tinta|text)' and x->>'hex' is distinct from dasar limit 1;
  dasar := coalesce(dasar, pal->0->>'hex', '#241E1A');
  aksen := coalesce(aksen, (select x->>'hex' from jsonb_array_elements(pal) x where x->>'hex' is distinct from dasar limit 1), '#FF7A2E');
  tinta := coalesce(tinta, '#FFFFFF');

  return jsonb_build_object(
    'judul', j.judul,
    'palet', jsonb_build_object('dasar', dasar, 'tinta', tinta, 'aksen', aksen),
    'font_judul', coalesce(ak->>'font_judul', 'Inter'), 'font_isi', coalesce(ak->>'font_isi', 'Inter'),
    'adegan', adegan,
    'penutup', jsonb_build_object('teks', coalesce(nullif(e->'penutup'->>'teks', ''), j.nama_usaha, j.judul),
                                  'sub', nullif(e->'penutup'->>'sub', ''), 'durasi', 3));
end $$;

-- 7. Antrean media: video final dikirim setelah semua media lain di tugas yang sama tuntas
do $$
declare def text;
begin
  def := pg_get_functiondef('desain_media_antrian(integer)'::regprocedure);
  if position('remotion' in def) = 0 then
    -- (a) kandidat kirim: aset biasa ATAU video final yang media saudaranya sudah tuntas
    def := replace(def,
'      and (a.jenis = ''image'' or exists (select 1 from design_assets s where s.job_id = a.job_id and s.jenis = ''image''
             and s.judul = a.media->>''sumber'' and s.status = ''siap'' and s.url is not null))',
'      and ((a.media->>''endpoint'' = ''remotion''
             and not exists (select 1 from design_assets s where s.task_id = a.task_id and s.id <> a.id
                             and s.status in (''antre_media'', ''proses_media'')))
        or (coalesce(a.media->>''endpoint'', '''') <> ''remotion''
            and (a.jenis = ''image'' or exists (select 1 from design_assets s where s.job_id = a.job_id and s.jenis = ''image''
             and s.judul = a.media->>''sumber'' and s.status = ''siap'' and s.url is not null))))');
    -- (b) video Higgsfield yang keyframe-nya hilang → gagal (jangan sentuh video final)
    def := replace(def,
'    where v.jenis = ''video'' and v.status = ''antre_media''',
'    where v.jenis = ''video'' and v.status = ''antre_media'' and coalesce(v.media->>''endpoint'', '''') <> ''remotion''');
    -- (c) item kirim untuk render: token baru per percobaan + props + tujuan upload/callback
    def := replace(def,
'    v_url := null;
    if r.jenis = ''video'' then',
'    if r.media->>''endpoint'' = ''remotion'' then
      declare v_props jsonb := desain_render_props(r.id); v_tok text := replace(gen_random_uuid()::text, ''-'', ''''); c jsonb := desain_cfg()->''render'';
      begin
        if jsonb_array_length(coalesce(v_props->''adegan'', ''[]'')) = 0 then
          update design_assets set status = ''gagal'', error = ''Tidak ada klip/keyframe yang berhasil untuk dirender'', updated_at = now() where id = r.id;
          perform desain_cek_job(r.job_id);
          continue;
        end if;
        update design_assets set status = ''proses_media'', updated_at = now(),
          media = media || jsonb_build_object(''klaim'', now(), ''render_token'', v_tok, ''props'', v_props,
                   ''path'', r.job_id || ''/'' || r.id || ''-'' || (coalesce((media->>''percobaan'')::int, 0) + 1) || ''.mp4'',
                   ''percobaan'', coalesce((media->>''percobaan'')::int, 0) + 1)
         where id = r.id;
        v_kirim := v_kirim || jsonb_build_array(jsonb_build_object(''id'', r.id, ''jenis'', ''video'', ''endpoint'', ''remotion'',
          ''repo'', c->>''repo'', ''workflow'', c->>''workflow'', ''ref'', c->>''ref'', ''bucket'', c->>''bucket'',
          ''path'', r.job_id || ''/'' || r.id || ''-'' || (coalesce((r.media->>''percobaan'')::int, 0) + 1) || ''.mp4'',
          ''payload'', jsonb_build_object(''id'', r.id, ''token'', v_tok, ''props'', v_props, ''anon_key'', c->>''anon_key'',
                     ''callback_url'', (c->>''supabase_url'') || ''/rest/v1/rpc/desain_render_hasil'')));
        continue;
      end;
    end if;
    v_url := null;
    if r.jenis = ''video'' then');
    -- (d) status_url Higgsfield tidak berlaku untuk render
    def := replace(def,
'    where a.status = ''proses_media'' and a.media->>''status_url'' is not null',
'    where a.status = ''proses_media'' and a.media->>''status_url'' is not null and coalesce(a.media->>''endpoint'', '''') <> ''remotion''');
    if position('s.task_id = a.task_id and s.id <> a.id' in def) = 0 or position('v.media->>''endpoint''' in def) = 0
       or position('desain_render_props(r.id)' in def) = 0 or position('''status_url'' is not null and coalesce' in def) = 0 then
      raise exception 'patch desain_media_antrian gagal';
    end if;
    execute def;
  end if;
end $$;

-- 8. Update media: render tidak punya status_url; batas waktu render 30 menit
do $$
declare def text;
begin
  def := pg_get_functiondef('desain_media_update(uuid,text,text,text,text,text)'::regprocedure);
  if position('remotion' in def) = 0 then
    def := replace(def,
'coalesce(nullif(p_status_url, ''''), ''https://api.higgsfield.ai/requests/'' || p_request_id || ''/status'')',
'case when a.media->>''endpoint'' = ''remotion'' then null else coalesce(nullif(p_status_url, ''''), ''https://api.higgsfield.ai/requests/'' || p_request_id || ''/status'') end');
    def := replace(def, 'media = (media - ''request_id'' - ''status_url'' - ''dikirim'' - ''cek'')',
                        'media = (media - ''request_id'' - ''status_url'' - ''dikirim'' - ''cek'' - ''render_token'')');
    if position('''remotion'' then null' in def) = 0 or position('render_token' in def) = 0 then raise exception 'patch desain_media_update gagal'; end if;
    execute def;
  end if;
end $$;

-- 9. Laporan dari GitHub Actions (dipanggil dengan anon key; aman karena wajib token render)
create or replace function desain_render_hasil(p_id uuid, p_token text, p_ok boolean, p_error text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a design_assets; c jsonb := desain_cfg()->'render';
begin
  select * into a from design_assets where id = p_id;
  if not found or a.media->>'endpoint' is distinct from 'remotion' or a.status <> 'proses_media'
     or coalesce(p_token, '') = '' or p_token is distinct from a.media->>'render_token' then
    return jsonb_build_object('ok', false);
  end if;
  if coalesce(p_ok, false) then
    return desain_media_update(p_id, 'selesai', null, null,
      (c->>'supabase_url') || '/storage/v1/object/public/' || (c->>'bucket') || '/' || (a.media->>'path'), null);
  end if;
  return desain_media_update(p_id, 'gagal', null, null, null, left(coalesce(p_error, 'Render gagal'), 400));
end $$;

revoke all on function desain_render_props(uuid) from public, anon, authenticated;
grant execute on function desain_render_props(uuid) to service_role;
revoke all on function desain_render_hasil(uuid, text, boolean, text) from public;
grant execute on function desain_render_hasil(uuid, text, boolean, text) to anon, service_role;
