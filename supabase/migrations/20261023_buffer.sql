-- Buffer (buffer.com) sebagai lapisan posting media sosial tim Konten NADI.
-- Konten yang sudah disetujui Imam (status siap_terbit) dijadwalkan ke channel Buffer sesuai kanalnya:
--   ig_fb → Instagram + Facebook · tiktok → TikTok + YouTube (Shorts) · linkedin → LinkedIn
-- Buffer yang memublikasikan pada jadwalnya (Buffer sudah lolos audit TikTok/YouTube/Meta/LinkedIn).
-- Panggilan API dilakukan workflow n8n "NADI 7c - Buffer" (token di credential n8n, tidak di database).
-- Konten yang tidak bisa lewat Buffer (mis. TikTok tanpa video, blog) tetap dikirim sebagai paket manual.
-- Aditif & aman diulang.

-- ── Tabel ────────────────────────────────────────────────────────
create table if not exists mkt_buffer_channel (
  id text primary key,                       -- Buffer channelId
  org_id text,
  service text not null,                     -- instagram | facebook | tiktok | youtube | linkedin | twitter | threads | ...
  nama text,
  avatar text,
  kanal text check (kanal in ('ig_fb', 'tiktok', 'linkedin')),  -- kanal konten NADI yang dikirim ke channel ini; null = tidak dipakai
  aktif boolean not null default true,
  terhubung boolean not null default true,   -- false bila channel hilang dari akun Buffer
  updated_at timestamptz not null default now()
);

create table if not exists mkt_buffer_post (
  id bigserial primary key,
  konten_id uuid not null references mkt_konten(id) on delete cascade,
  channel_id text not null references mkt_buffer_channel(id) on delete cascade,
  service text not null,
  status text not null default 'antre' check (status in ('antre', 'dikirim', 'terjadwal', 'terbit', 'gagal', 'batal')),
  input jsonb not null,                      -- CreatePostInput untuk Buffer
  buffer_id text,
  due_at timestamptz,
  link text,
  error text,
  percobaan int not null default 0,
  sinkron int not null default 0,
  klaim_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (konten_id, channel_id)
);
create index if not exists mkt_buffer_post_status_idx on mkt_buffer_post (status, due_at);

alter table mkt_buffer_channel enable row level security;
alter table mkt_buffer_post enable row level security;
do $$ begin
  if to_regprocedure('private.office_is_owner()') is not null then
    if not exists (select 1 from pg_policies where tablename = 'mkt_buffer_channel') then
      create policy pemilik on mkt_buffer_channel for all to authenticated using (private.office_is_owner()) with check (private.office_is_owner());
    end if;
    if not exists (select 1 from pg_policies where tablename = 'mkt_buffer_post') then
      create policy pemilik on mkt_buffer_post for all to authenticated using (private.office_is_owner()) with check (private.office_is_owner());
    end if;
  end if;
end $$;

-- Pengaturan default (tidak menimpa yang sudah ada)
update nadi_config set cfg = jsonb_set(cfg, '{tim,marketing,buffer}',
  jsonb_build_object('aktif', false, 'youtube_kategori', '22', 'label_ai_video', true, 'jeda_menit', 10)
  || coalesce(cfg->'tim'->'marketing'->'buffer', '{}'), true)
where id = 1;

-- ── Helper ───────────────────────────────────────────────────────
create or replace function buffer_cfg()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(cfg->'tim'->'marketing'->'buffer', '{}') from nadi_config where id = 1 $$;

create or replace function buffer_kanal_default(p_service text)
returns text language sql immutable as $$
  select case p_service when 'instagram' then 'ig_fb' when 'facebook' then 'ig_fb'
                        when 'tiktok' then 'tiktok' when 'youtube' then 'tiktok'
                        when 'linkedin' then 'linkedin' end $$;

create or replace function buffer_waktu(p timestamptz)
returns text language sql immutable as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"') $$;

-- Susun CreatePostInput untuk satu konten + channel; null bila konten tidak memenuhi syarat channel itu.
create or replace function buffer_input(k mkt_konten, ch mkt_buffer_channel)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb := buffer_cfg(); v_teks text; v_tags text; v_img jsonb; v_vid text; v_assets jsonb := '[]'; v_meta jsonb := null;
  v_due timestamptz := greatest(k.jadwal, now() + make_interval(mins => coalesce((c->>'jeda_menit')::int, 10)));
  v_label boolean := coalesce((c->>'label_ai_video')::boolean, true);
begin
  if k.isi is null then return null; end if;
  v_tags := case when jsonb_typeof(k.isi->'hashtag') = 'array'
                 then (select string_agg(x, ' ') from jsonb_array_elements_text(k.isi->'hashtag') x) end;
  v_teks := coalesce(nullif(k.isi->>'caption', ''), nullif(k.isi->>'post', ''), '')
            || case when v_tags is not null and v_tags <> '' then chr(10) || chr(10) || v_tags else '' end;
  select coalesce(jsonb_agg(jsonb_build_object('image', jsonb_build_object('url', e->>'url')) order by e->>'judul'), '[]')
    into v_img
    from (select e from jsonb_array_elements(k.aset) e
           where e->>'jenis' in ('image', 'gambar') and coalesce(e->>'url', '') ~ '^https://' limit 10) z;
  v_vid := (select e->>'url' from jsonb_array_elements(k.aset) e
             where e->>'jenis' = 'video' and coalesce(e->>'url', '') ~ '^https://' limit 1);

  if ch.service = 'instagram' then
    if v_vid is not null and jsonb_array_length(v_img) = 0 then
      v_assets := jsonb_build_array(jsonb_build_object('video', jsonb_build_object('url', v_vid, 'metadata', jsonb_build_object('thumbnailOffset', 1000))));
      v_meta := jsonb_build_object('instagram', jsonb_build_object('type', 'reel', 'shouldShareToFeed', true, 'isAiGenerated', v_label));
    elsif jsonb_array_length(v_img) > 0 then
      v_assets := v_img;
      v_meta := jsonb_build_object('instagram', jsonb_build_object('type', 'post', 'shouldShareToFeed', true));
    else return null; end if;
  elsif ch.service = 'facebook' then
    if jsonb_array_length(v_img) > 0 then v_assets := v_img;
    elsif v_vid is not null then v_assets := jsonb_build_array(jsonb_build_object('video', jsonb_build_object('url', v_vid)));
    end if;
    v_meta := jsonb_build_object('facebook', jsonb_build_object('type', case when v_vid is not null and jsonb_array_length(v_img) = 0 then 'reel' else 'post' end));
  elsif ch.service = 'tiktok' then
    if v_vid is null then return null; end if;
    v_assets := jsonb_build_array(jsonb_build_object('video', jsonb_build_object('url', v_vid, 'metadata', jsonb_build_object('thumbnailOffset', 1000))));
    v_meta := jsonb_build_object('tiktok', jsonb_build_object('isAiGenerated', v_label));
  elsif ch.service = 'youtube' then
    if v_vid is null then return null; end if;
    v_assets := jsonb_build_array(jsonb_build_object('video', jsonb_build_object('url', v_vid)));
    v_meta := jsonb_build_object('youtube', jsonb_build_object('title', left(coalesce(k.isi->>'judul', k.judul, k.kode), 100),
      'categoryId', coalesce(c->>'youtube_kategori', '22'), 'isAiGenerated', v_label));
  elsif ch.service = 'linkedin' then
    if jsonb_array_length(v_img) > 0 then v_assets := v_img; end if;
  else
    if jsonb_array_length(v_img) > 0 then v_assets := v_img; end if;
  end if;
  if v_teks = '' and jsonb_array_length(v_assets) = 0 then return null; end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'channelId', ch.id, 'text', left(v_teks, 2200), 'schedulingType', 'automatic', 'mode', 'customScheduled',
    'dueAt', buffer_waktu(v_due), 'assets', v_assets, 'metadata', v_meta, 'aiAssisted', false));
end $$;

-- Buat baris antre untuk konten siap_terbit yang belum punya baris Buffer.
create or replace function buffer_siapkan()
returns int language plpgsql security definer set search_path = public as $$
declare k mkt_konten; ch mkt_buffer_channel; v_in jsonb; n int := 0;
begin
  if not coalesce((buffer_cfg()->>'aktif')::boolean, false) then return 0; end if;
  for k in select * from mkt_konten
            where status = 'siap_terbit' and terbit_at is null and not (terbit ? 'manual_at')
              and jadwal > now() - interval '2 days' and jadwal < now() + interval '30 days'
              and not exists (select 1 from mkt_buffer_post b where b.konten_id = mkt_konten.id) loop
    for ch in select * from mkt_buffer_channel where aktif and terhubung and kanal = k.kanal order by service loop
      v_in := buffer_input(k, ch);
      continue when v_in is null;
      insert into mkt_buffer_post (konten_id, channel_id, service, input, due_at)
      values (k.id, ch.id, ch.service, v_in, (v_in->>'dueAt')::timestamptz)
      on conflict (konten_id, channel_id) do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- ── Dipanggil n8n ────────────────────────────────────────────────
-- 1. Antrean kirim: [{id, kode, service, input}]
create or replace function buffer_antrian(p_limit int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare hasil jsonb;
begin
  if not coalesce((buffer_cfg()->>'aktif')::boolean, false) then return '[]'::jsonb; end if;
  update mkt_buffer_post set status = 'antre', klaim_at = null, updated_at = now()
   where status = 'dikirim' and klaim_at < now() - interval '10 minutes' and percobaan < 3;
  update mkt_buffer_post set status = 'gagal', error = coalesce(error, 'Tidak ada jawaban dari Buffer 3x'), updated_at = now()
   where status = 'dikirim' and klaim_at < now() - interval '10 minutes' and percobaan >= 3;
  perform buffer_siapkan();
  with c as (select id from mkt_buffer_post where status = 'antre' order by due_at limit greatest(1, least(p_limit, 20)) for update skip locked),
       u as (update mkt_buffer_post b set status = 'dikirim', klaim_at = now(), percobaan = b.percobaan + 1, updated_at = now()
               from c where b.id = c.id returning b.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'service', u.service, 'kode', k.kode, 'input', u.input)), '[]')
    into hasil from u join mkt_konten k on k.id = u.konten_id;
  return hasil;
end $$;

create or replace function buffer_gagal(b mkt_buffer_post, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare k mkt_konten;
begin
  update mkt_buffer_post set status = 'gagal', error = left(p_error, 1000), klaim_at = null, updated_at = now() where id = b.id;
  select * into k from mkt_konten where id = b.konten_id;
  update mkt_konten set terbit = terbit || jsonb_build_object('error_buffer_' || b.service, left(p_error, 300)), updated_at = now() where id = k.id;
  insert into office_events (unit_key, desk_key, level, message, meta)
  values ('marketing', 'mkt-meta', 'peringatan', 'Buffer gagal ' || k.kode || ' (' || b.service || '): ' || left(p_error, 200), jsonb_build_object('buffer_post', b.id));
  perform tim_tg('⚠️ Buffer gagal menjadwalkan/memposting ' || k.kode || ' ke ' || b.service || ':' || chr(10) || left(coalesce(p_error, '-'), 300)
    || chr(10) || 'Konten ini akan dikirim sebagai paket posting manual saat jadwalnya tiba. Cek: ' || hub_link('konten'));
end $$;

-- 2. Hasil createPost (p_res = respons GraphQL utuh)
create or replace function buffer_hasil(p_id bigint, p_res jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b mkt_buffer_post; v_post jsonb := p_res->'data'->'createPost'->'post'; v_err text;
begin
  select * into b from mkt_buffer_post where id = p_id for update;
  if not found or b.status <> 'dikirim' then return jsonb_build_object('ok', false); end if;
  if v_post ? 'id' then
    update mkt_buffer_post set status = 'terjadwal', buffer_id = v_post->>'id',
           due_at = coalesce((v_post->>'dueAt')::timestamptz, due_at), error = null, klaim_at = null, updated_at = now()
     where id = b.id;
    return jsonb_build_object('ok', true);
  end if;
  v_err := coalesce(p_res->'data'->'createPost'->>'message', p_res->'errors'->0->>'message', p_res->>'message', left(p_res::text, 500));
  if p_res->'data'->'createPost' ? 'message' or b.percobaan >= 3 then
    perform buffer_gagal(b, v_err);                     -- ditolak Buffer (validasi) atau sudah 3x
  else
    update mkt_buffer_post set status = 'antre', klaim_at = null, error = left(v_err, 1000), updated_at = now() where id = b.id;
  end if;
  return jsonb_build_object('ok', false, 'error', v_err);
end $$;

-- 3. Cek status posting yang sudah lewat jadwal: [{id, buffer_id}]
create or replace function buffer_sinkron_antrian(p_limit int default 15)
returns jsonb language plpgsql security definer set search_path = public as $$
declare hasil jsonb;
begin
  with c as (select id from mkt_buffer_post
              where status = 'terjadwal' and buffer_id is not null and due_at < now() - interval '3 minutes'
                and updated_at < now() - interval '9 minutes'
              order by due_at limit greatest(1, least(p_limit, 30)) for update skip locked),
       u as (update mkt_buffer_post b set updated_at = now() from c where b.id = c.id returning b.id, b.buffer_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'buffer_id', buffer_id)), '[]') into hasil from u;
  return hasil;
end $$;

-- 4. Hasil cek status (p_res = respons GraphQL query post)
create or replace function buffer_sinkron_hasil(p_id bigint, p_res jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b mkt_buffer_post; p jsonb := p_res->'data'->'post'; k mkt_konten; v_status text := p_res->'data'->'post'->>'status';
begin
  select * into b from mkt_buffer_post where id = p_id for update;
  if not found or b.status <> 'terjadwal' then return jsonb_build_object('ok', false); end if;
  if v_status = 'sent' then
    update mkt_buffer_post set status = 'terbit', link = nullif(p->>'externalLink', ''), error = null, updated_at = now() where id = b.id;
    update mkt_konten set terbit = terbit || jsonb_build_object(b.service, jsonb_build_object('ref', b.buffer_id, 'url', nullif(p->>'externalLink', ''),
             'at', coalesce(p->>'sentAt', now()::text), 'via', 'buffer')),
           url_terbit = coalesce(url_terbit, nullif(p->>'externalLink', '')), updated_at = now()
     where id = b.konten_id returning * into k;
    if not exists (select 1 from mkt_buffer_post where konten_id = k.id and status in ('antre', 'dikirim', 'terjadwal'))
       and k.status = 'siap_terbit' then
      update mkt_konten set status = 'terbit', terbit_at = now(), terbit_klaim_at = null where id = k.id;
      insert into office_events (unit_key, desk_key, message, meta)
      values ('marketing', 'mkt-meta', k.kode || ' terbit via Buffer', jsonb_build_object('konten', k.id));
    end if;
  elsif v_status = 'error' then
    perform buffer_gagal(b, coalesce(p->'error'->>'message', 'Buffer gagal memublikasikan'));
  elsif v_status is null then
    update mkt_buffer_post set sinkron = sinkron + 1, error = left(coalesce(p_res->'errors'->0->>'message', p_res::text), 500), updated_at = now() where id = b.id;
    if b.sinkron + 1 >= 6 then perform buffer_gagal(b, 'Posting tidak ditemukan di Buffer: ' || coalesce(p_res->'errors'->0->>'message', '-')); end if;
  else
    update mkt_buffer_post set sinkron = sinkron + 1, updated_at = now() where id = b.id;  -- scheduled/sending: cek lagi nanti
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- 5. Simpan daftar channel dari akun Buffer: p = {org_id, channels:[{id,name,service,avatar}]}
create or replace function buffer_simpan_channel(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if jsonb_typeof(p->'channels') <> 'array' then return jsonb_build_object('ok', false, 'info', 'Format channel tidak valid'); end if;
  for e in select value from jsonb_array_elements(p->'channels') loop
    continue when coalesce(e->>'id', '') = '' or coalesce(e->>'service', '') = '';
    insert into mkt_buffer_channel (id, org_id, service, nama, avatar, kanal)
    values (e->>'id', p->>'org_id', e->>'service', e->>'name', e->>'avatar', buffer_kanal_default(e->>'service'))
    on conflict (id) do update set org_id = excluded.org_id, service = excluded.service, nama = excluded.nama,
           avatar = excluded.avatar, terhubung = true, updated_at = now();
    n := n + 1;
  end loop;
  update mkt_buffer_channel set terhubung = false, updated_at = now()
   where terhubung and id not in (select value->>'id' from jsonb_array_elements(p->'channels'));
  return jsonb_build_object('ok', true, 'channel', n);
end $$;

-- ── Jangan kirim paket manual / posting Meta langsung untuk konten yang sedang diurus Buffer ──
do $patch$
declare d text; d2 text;
begin
  d := pg_get_functiondef('mkt_terbit_antrian'::regproc);
  if d not like '%buffer_siapkan%' then
    d2 := replace(d, 'begin
  for k in select * from mkt_konten where status = ''siap_terbit''',
      'begin
  perform buffer_siapkan();
  for k in select * from mkt_konten where status = ''siap_terbit''');
    d2 := replace(d2, 'and not (terbit ? ''manual_at'')',
      'and not (terbit ? ''manual_at'')
            and not (exists (select 1 from mkt_buffer_post b where b.konten_id = mkt_konten.id)
                     and not exists (select 1 from mkt_buffer_post b where b.konten_id = mkt_konten.id and b.status = ''gagal''))');
    if d2 = d or d2 not like '%perform buffer_siapkan();%' or d2 not like '%mkt_buffer_post b where b.konten_id = mkt_konten.id and b.status%' then
      raise exception 'tambal mkt_terbit_antrian gagal';
    end if;
    execute d2;
  end if;
end $patch$;

-- Tandai "sudah diposting" manual: batalkan antrean Buffer yang belum terkirim
create or replace function buffer_batal_konten()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('terbit', 'ditolak', 'gagal') and old.status is distinct from new.status then
    update mkt_buffer_post set status = 'batal', updated_at = now()
     where konten_id = new.id and status in ('antre', 'dikirim');
  end if;
  return new;
end $$;
drop trigger if exists mkt_konten_buffer_batal on mkt_konten;
create trigger mkt_konten_buffer_batal after update of status on mkt_konten for each row execute function buffer_batal_konten();

revoke all on function buffer_cfg(), buffer_kanal_default(text), buffer_waktu(timestamptz), buffer_input(mkt_konten, mkt_buffer_channel),
  buffer_siapkan(), buffer_antrian(int), buffer_gagal(mkt_buffer_post, text), buffer_hasil(bigint, jsonb),
  buffer_sinkron_antrian(int), buffer_sinkron_hasil(bigint, jsonb), buffer_simpan_channel(jsonb) from public, anon, authenticated;
grant execute on function buffer_antrian(int), buffer_hasil(bigint, jsonb), buffer_sinkron_antrian(int),
  buffer_sinkron_hasil(bigint, jsonb), buffer_simpan_channel(jsonb) to service_role;

-- ── Menu Konten NADI: status Buffer per konten, daftar channel, pengaturan ──
do $patch$
declare d text; d2 text;
begin
  d := pg_get_functiondef('hub_konten'::regproc);
  if d not like '%mkt_buffer_post%' then
    d2 := replace(d, $p$'putaran', k.putaran, 'catatan_imam', k.catatan_imam, 'url_terbit', k.url_terbit)$p$,
      $p$'putaran', k.putaran, 'catatan_imam', k.catatan_imam, 'url_terbit', k.url_terbit,
      'buffer', (select coalesce(jsonb_agg(jsonb_build_object('service', b.service, 'status', b.status, 'link', b.link,
                   'error', b.error, 'due_at', b.due_at) order by b.service), '[]') from mkt_buffer_post b where b.konten_id = k.id))$p$);
    d2 := replace(d2, $p$'batch', batch, 'konten', konten);$p$,
      $p$'batch', batch, 'konten', konten,
    'buffer', jsonb_build_object('aktif', coalesce((buffer_cfg()->>'aktif')::boolean, false),
      'label_ai_video', coalesce((buffer_cfg()->>'label_ai_video')::boolean, true),
      'channel', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'service', service, 'nama', nama, 'avatar', avatar,
                   'kanal', kanal, 'aktif', aktif, 'terhubung', terhubung, 'diperbarui', updated_at) order by service, nama), '[]') from mkt_buffer_channel),
      'terjadwal', (select count(*) from mkt_buffer_post where status in ('antre', 'dikirim', 'terjadwal')),
      'terbit_7h', (select count(*) from mkt_buffer_post where status = 'terbit' and updated_at > now() - interval '7 days'),
      'gagal_7h', (select count(*) from mkt_buffer_post where status = 'gagal' and updated_at > now() - interval '7 days')));$p$);
    if d2 not like '%''buffer'', (select coalesce%' or d2 not like '%''terbit_7h''%' then raise exception 'tambal hub_konten gagal'; end if;
    execute d2;
  end if;

  d := pg_get_functiondef('hub_konten_aksi'::regproc);
  if d not like '%buffer_channel%' then
    d2 := replace(d, $p$  elsif op = 'arahan' then$p$,
      $p$  elsif op = 'buffer' then
    update nadi_config set cfg = jsonb_set(jsonb_set(cfg, '{tim,marketing,buffer,aktif}', to_jsonb(coalesce((p->>'aktif')::boolean, false)), true),
             '{tim,marketing,buffer,label_ai_video}', to_jsonb(coalesce((p->>'label_ai_video')::boolean, coalesce((buffer_cfg()->>'label_ai_video')::boolean, true))), true)
     where id = 1;
    if coalesce((p->>'aktif')::boolean, false) and not exists (select 1 from mkt_buffer_channel where aktif and terhubung and kanal is not null) then
      return jsonb_build_object('ok', true, 'info', 'Buffer diaktifkan, tapi belum ada channel. Jalankan workflow NADI 7c (Sinkron channel) setelah menghubungkan akun di Buffer.');
    end if;
    return jsonb_build_object('ok', true, 'info', case when (p->>'aktif')::boolean then 'Buffer aktif: konten yang disetujui dijadwalkan otomatis ke channel Buffer.' else 'Buffer dimatikan: posting kembali lewat paket manual.' end);

  elsif op = 'buffer_channel' then
    if coalesce(p->>'kanal', '') not in ('', 'ig_fb', 'tiktok', 'linkedin') then return jsonb_build_object('ok', false, 'info', 'Kanal tidak dikenal'); end if;
    update mkt_buffer_channel set aktif = coalesce((p->>'aktif')::boolean, aktif), kanal = nullif(p->>'kanal', ''), updated_at = now()
     where id = p->>'id';
    if not found then return jsonb_build_object('ok', false, 'info', 'Channel tidak ditemukan'); end if;
    return jsonb_build_object('ok', true, 'info', 'Pengaturan channel disimpan.');

  elsif op = 'arahan' then$p$);
    d2 := replace(d2, $p$    perform tim_aksi(jsonb_build_object('j', 'paket',$p$,
      $p$    if exists (select 1 from mkt_buffer_post b where b.konten_id = k.id and b.status = 'terjadwal') then
      return jsonb_build_object('ok', false, 'info', k.kode || ' sudah dijadwalkan di Buffer dan akan terbit otomatis. Hapus dulu di Buffer bila ingin posting manual.');
    end if;
    perform tim_aksi(jsonb_build_object('j', 'paket',$p$);
    if d2 not like '%op = ''buffer_channel''%' or d2 not like '%sudah dijadwalkan di Buffer%' then raise exception 'tambal hub_konten_aksi gagal'; end if;
    execute d2;
  end if;
end $patch$;
