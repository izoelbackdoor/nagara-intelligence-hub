-- hub_04_desain: menu Studio Desain di Command Center (pengganti halaman review di webhook n8n untuk Imam).
-- Aditif & aman diulang. Dipanggil server Command Center (service_role) lewat /api/office/desain*.

-- 1. Data halaman: ringkasan tim (p_id null) atau detail satu job
create or replace function hub_desain(p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d0 timestamptz := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
  j design_jobs; cfg jsonb := desain_cfg();
begin
  if p_id is not null then
    select * into j from design_jobs where id = p_id;
    if not found then return null; end if;
    return jsonb_build_object(
      'job', jsonb_build_object('id', j.id, 'kode', j.kode, 'judul', j.judul, 'jenis', j.jenis, 'status', j.status,
        'usaha', j.nama_usaha, 'klien', j.nama_klien, 'wa', j.no_wa, 'permintaan', j.input,
        'revisi_ai', j.revisi_ai, 'revisi_imam', j.revisi_imam, 'catatan_imam', j.catatan_imam,
        'dibuat', j.created_at, 'diperbarui', j.updated_at, 'link_klien', desain_link(j, false)),
      'rencana', j.rencana,
      'review', j.review,
      'brief', (select jsonb_strip_nulls(jsonb_build_object('usaha', b.nama_usaha, 'pic', b.nama_pic, 'kota', b.kota,
                 'kategori', b.kategori, 'masalah', b.masalah, 'harapan', b.harapan, 'selera_desain', b.desain, 'referensi', b.referensi))
               from project_briefs b where b.id = j.brief_id),
      'aset', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'meja', a.desk_key, 'meja_nama', d.name, 'jenis', a.jenis,
                 'judul', a.judul, 'status', a.status, 'url', a.url, 'versi', a.versi, 'error', a.error,
                 'konten', case when a.jenis = 'teks' then a.konten end,
                 'prompt', a.media->'input'->>'prompt', 'rasio', a.media->'input'->>'aspect_ratio')
                 order by d.sort, (a.jenis = 'teks'), a.created_at)
               from design_assets a join office_desks d on d.key = a.desk_key
               where a.job_id = j.id and a.status <> 'arsip'), '[]'),
      'versi_lama', (select count(*) from design_assets a where a.job_id = j.id and a.status = 'arsip'),
      'tugas', coalesce((select jsonb_agg(jsonb_build_object('judul', t.title, 'meja', t.desk_key, 'tahap', t.payload->>'tahap',
                 'status', t.status, 'percobaan', t.percobaan, 'error', left(t.error, 400),
                 'instruksi', t.payload->'instruksi', 'catatan_revisi', t.payload->'catatan_revisi',
                 'dibuat', t.created_at, 'diperbarui', t.updated_at,
                 'usd', (select coalesce(sum(c.usd), 0) from office_costs c where c.task_id = t.id)) order by t.created_at)
               from office_tasks t where t.job_id = j.id), '[]'),
      'keputusan', coalesce((select jsonb_agg(jsonb_build_object('status', a.status, 'catatan', a.note, 'ringkasan', a.summary,
                 'dibuat', a.created_at, 'diputuskan', a.decided_at) order by a.created_at)
               from office_approvals a where a.payload->>'job_id' = j.id::text), '[]'),
      'biaya', desain_biaya_job(j.id));
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'pengaturan', jsonb_build_object('maks_gambar', cfg->'maks_gambar', 'maks_video', cfg->'maks_video',
       'maks_revisi_ai', cfg->'maks_revisi_ai', 'kirim_wa_klien', cfg->'kirim_wa_klien'),
    'tim', coalesce((select jsonb_agg(jsonb_build_object(
        'key', d.key, 'nama', d.name, 'peran', d.role, 'jobdesc', d.jobdesc, 'status', coalesce(a.status, d.status),
        'model', coalesce(a.model, d.model), 'budget', a.daily_budget_usd, 'tools', a.tools, 'prompt', a.system_prompt,
        'antre', (select count(*) from office_tasks t where t.desk_key = d.key and t.status = 'antre'),
        'dikerjakan', (select count(*) from office_tasks t where t.desk_key = d.key and t.status in ('dikerjakan', 'review')),
        'selesai_7h', (select count(*) from office_tasks t where t.desk_key = d.key and t.status = 'selesai' and t.updated_at > now() - interval '7 days'),
        'gagal_7h', (select count(*) from office_tasks t where t.desk_key = d.key and t.status = 'gagal' and t.updated_at > now() - interval '7 days'),
        'usd_hari_ini', (select coalesce(sum(c.usd), 0) from office_costs c where c.desk_key = d.key and c.created_at >= d0),
        'usd_7h', (select coalesce(sum(c.usd), 0) from office_costs c where c.desk_key = d.key and c.created_at > now() - interval '7 days'),
        'terakhir', (select max(t.updated_at) from office_tasks t where t.desk_key = d.key)) order by d.sort)
      from office_desks d left join office_agents a on a.desk_key = d.key where d.unit_key = 'desain'), '[]'),
    'tahap', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from design_jobs group by status) z),
    'media_proses', (select count(*) from design_assets where status in ('antre_media', 'proses_media')),
    'job', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kode', x.kode, 'judul', x.judul, 'jenis', x.jenis, 'usaha', x.nama_usaha, 'status', x.status,
        'revisi', x.revisi_ai + x.revisi_imam, 'skor', x.review->'skor',
        'gambar', (select count(*) from design_assets a where a.job_id = x.id and a.jenis = 'image' and a.status = 'siap'),
        'video', (select count(*) from design_assets a where a.job_id = x.id and a.jenis = 'video' and a.status = 'siap'),
        'halaman', (select count(*) from design_assets a where a.job_id = x.id and a.jenis = 'html' and a.status = 'siap'),
        'media_proses', (select count(*) from design_assets a where a.job_id = x.id and a.status in ('antre_media', 'proses_media')),
        'thumb', (select a.url from design_assets a where a.job_id = x.id and a.jenis = 'image' and a.status = 'siap' order by a.created_at limit 1),
        'biaya', desain_biaya_job(x.id), 'dibuat', x.created_at, 'diperbarui', x.updated_at)
        order by (x.status = 'menunggu_imam') desc, (x.status in ('disetujui', 'batal')), x.updated_at desc)
      from (select * from design_jobs order by updated_at desc limit 60) x), '[]'),
    'brief', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'label',
        coalesce(b.nama_usaha, '-') || ' · ' || coalesce(b.nama_pic, '-') || ' · ' || to_char(b.created_at at time zone 'Asia/Jakarta', 'DD Mon YYYY'))
        order by b.created_at desc) from (select * from project_briefs order by created_at desc limit 40) b), '[]'),
    'aktivitas', coalesce((select jsonb_agg(jsonb_build_object('waktu', e.created_at, 'meja', e.desk_key, 'level', e.level, 'pesan', e.message)
        order by e.created_at desc) from (select * from office_events where unit_key = 'desain' order by created_at desc limit 40) e), '[]'),
    'biaya_7h', (select coalesce(sum(c.usd), 0) from office_costs c join office_desks d on d.key = c.desk_key
                 where d.unit_key = 'desain' and c.created_at > now() - interval '7 days'));
end $$;

-- 2. Aksi dari halaman (login Imam): buat job, putuskan, coba lagi job gagal
create or replace function hub_desain_aksi(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j design_jobs; v_tahap text; n int;
begin
  if p->>'op' = 'buat' then
    return desain_buat_job(coalesce(p->'job', '{}'::jsonb));
  end if;
  select * into j from design_jobs where id = nullif(p->>'id', '')::uuid;
  if not found then return jsonb_build_object('ok', false, 'pesan', 'Job tidak ditemukan.'); end if;

  if p->>'op' = 'putuskan' then
    return desain_putuskan(j.id, j.token_imam, p->>'aksi', p->>'catatan');
  elsif p->>'op' = 'ulang' then
    if j.status <> 'gagal' then return jsonb_build_object('ok', false, 'pesan', 'Hanya job berstatus gagal yang bisa dicoba lagi.'); end if;
    select t.payload->>'tahap' into v_tahap from office_tasks t where t.job_id = j.id and t.status = 'gagal' order by t.updated_at desc limit 1;
    update office_tasks set status = 'antre', percobaan = 0, error = null, klaim_sampai = null, updated_at = now()
     where job_id = j.id and status = 'gagal';
    get diagnostics n = row_count;
    update design_jobs set status = case coalesce(v_tahap, 'rencana') when 'review' then 'review' when 'produksi' then 'produksi' else 'rencana' end,
           updated_at = now() where id = j.id;
    insert into office_events (unit_key, desk_key, message, meta)
    values ('desain', 'desain-ad', j.kode || ': dicoba lagi oleh Imam (' || n || ' tugas)', jsonb_build_object('job', j.id));
    return jsonb_build_object('ok', true, 'pesan', n || ' tugas masuk antrean lagi.');
  end if;
  return jsonb_build_object('ok', false, 'pesan', 'Aksi tidak dikenal.');
end $$;

-- 3. HTML mockup untuk iframe di hub (gambar {{img:...}} sudah diganti URL asli)
create or replace function hub_desain_aset(p_asset uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select desain_aset_html(a.id, j.token_imam)
  from design_assets a join design_jobs j on j.id = a.job_id where a.id = p_asset
$$;

-- 4. Link Telegram & daftar "Menunggu Anda" diarahkan ke hub, bukan webhook n8n
do $$
declare f text; def text;
begin
  foreach f in array array['desain_minta_approval(uuid,uuid)', 'desain_buat_job(jsonb)', 'cc_tim_nadi()'] loop
    def := pg_get_functiondef(f::regprocedure);
    if f = 'cc_tim_nadi()' then
      def := replace(def, 'desain_link(j, true)', '''#desain''');
    else
      def := replace(def, 'desain_link(j, true)', 'hub_link(''desain'')');
    end if;
    execute def;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['hub_desain(uuid)', 'hub_desain_aksi(jsonb)', 'hub_desain_aset(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
