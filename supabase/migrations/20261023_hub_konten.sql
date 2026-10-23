-- Menu "Konten NADI" di Command Center (js/konten.js).
-- 1. mkt_rencana punya jenis: 'mingguan' (rencana Kepala Marketing tiap Sabtu) atau 'permintaan'
--    (materi yang diminta Imam dari Command Center, langsung ke penulis per kanal).
-- 2. Label pesan/halaman tidak lagi selalu "minggu DD Mon" (mkt_label).
-- 3. Link Telegram & Hari Ini untuk review konten mengarah ke hub (/#konten), bukan halaman n8n.
-- 4. RPC baru (service_role saja): hub_konten(), hub_konten_detail(uuid), hub_konten_aksi(jsonb).
-- Aditif & aman diulang.

-- ── 1. Jenis rencana ─────────────────────────────────────────────
alter table mkt_rencana add column if not exists jenis text not null default 'mingguan';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mkt_rencana_jenis_check') then
    alter table mkt_rencana add constraint mkt_rencana_jenis_check check (jenis in ('mingguan', 'permintaan'));
  end if;
  if exists (select 1 from pg_constraint where conname = 'mkt_rencana_minggu_key') then
    alter table mkt_rencana drop constraint mkt_rencana_minggu_key;
  end if;
end $$;
create unique index if not exists mkt_rencana_minggu_uq on mkt_rencana (minggu) where jenis = 'mingguan';

-- ── 2. Helper ────────────────────────────────────────────────────
create or replace function mkt_label(p_jenis text, p_minggu date, p_tema text)
returns text language sql immutable as $$
  select case when p_jenis = 'permintaan' then 'permintaan "' || left(coalesce(nullif(p_tema, ''), '-'), 60) || '"'
              else 'minggu ' || to_char(p_minggu, 'DD Mon') end $$;

create or replace function hub_link(p_halaman text)
returns text language sql stable security definer set search_path = public as $$
  select rtrim(coalesce(cfg->>'hub_url', 'https://nagara-intelligence-hub.vercel.app'), '/') || '/#' || p_halaman
  from nadi_config where id = 1 $$;

-- ── 3. Tambal fungsi yang sudah ada (ganti teks persis; gagal bila pola tidak ditemukan) ──
do $patch$
declare
  f record; d text; d2 text;
  lbl_pola text := $p$minggu ' \|\| to_char\(r\.minggu, 'DD Mon(?: YYYY)?'\)$p$;
  lbl_ganti text := $p$' || mkt_label(r.jenis, r.minggu, r.tema)$p$;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in
              ('mkt_mulai_minggu', 'mkt_cek_rencana', 'mkt_terapkan_rencana', 'mkt_terapkan_konten', 'mkt_mulai_visual',
               'mkt_cek_visual', 'tim_halaman', 'tim_tick', 'cc_tim_nadi', 'tim_aksi') loop
    d := pg_get_functiondef(f.oid);
    -- tim_aksi mencatat error dengan level 'error' yang ditolak constraint office_events → pakai 'bahaya'
    d2 := replace(d, $p$('sales', 'error', 'tim_aksi: '$p$, $p$('sales', 'bahaya', 'tim_aksi: '$p$);
    d2 := regexp_replace(d2, lbl_pola, lbl_ganti, 'g');
    d2 := replace(d2, 'on conflict (minggu) do nothing', $p$on conflict (minggu) where jenis = 'mingguan' do nothing$p$);
    d2 := replace(d2, 'from mkt_rencana where minggu =', $p$from mkt_rencana where jenis = 'mingguan' and minggu =$p$);
    d2 := replace(d2, 'from mkt_rencana r order by r.minggu desc limit 1', $p$from mkt_rencana r where r.jenis = 'mingguan' order by r.minggu desc limit 1$p$);
    d2 := replace(d2, '(select id from mkt_rencana order by minggu desc limit 1)', $p$(select id from mkt_rencana where jenis = 'mingguan' order by minggu desc limit 1)$p$);
    -- link review → hub
    d2 := replace(d2, $p$r.updated_at, tim_link('mkt', r.id::text, r.token::text)$p$, $p$r.updated_at, '#konten'$p$);
    d2 := replace(d2, $p$k.jadwal, tim_link('paket', k.id::text, r.token::text)$p$, $p$k.jadwal, '#konten'$p$);
    if f.proname not in ('cc_tim_nadi', 'tim_aksi', 'tim_halaman') then  -- halaman n8n tetap saling menaut
      d2 := replace(d2, $p$tim_link('mkt', r.id::text, r.token::text)$p$, $p$hub_link('konten')$p$);
      d2 := replace(d2, $p$tim_link('mkt', k.rencana_id::text, (select token::text from mkt_rencana where id = k.rencana_id))$p$, $p$hub_link('konten')$p$);
    end if;
    if d2 <> d then execute d2; end if;
  end loop;
  -- pastikan tambalan penting benar-benar terpasang
  if pg_get_functiondef('mkt_mulai_minggu'::regproc) not like '%where jenis = ''mingguan'' do nothing%' then raise exception 'tambal mkt_mulai_minggu gagal'; end if;
  if pg_get_functiondef('tim_tick'::regproc) not like '%jenis = ''mingguan'' and minggu =%' then raise exception 'tambal tim_tick gagal'; end if;
  if pg_get_functiondef('mkt_cek_rencana'::regproc) not like '%mkt_label(r.jenis, r.minggu, r.tema)%' then raise exception 'tambal mkt_cek_rencana gagal'; end if;
  if pg_get_functiondef('cc_tim_nadi'::regproc) not like '%''#konten''%' then raise exception 'tambal cc_tim_nadi gagal'; end if;
end $patch$;

-- ── 4. Data menu Konten ──────────────────────────────────────────
create or replace function hub_konten_ringkas(k mkt_konten)
returns text language sql immutable as $$
  select left(regexp_replace(coalesce(k.isi->>'hook', k.isi->>'post', k.isi->>'meta_description', k.isi->>'caption',
                                      k.isi->>'ringkasan', k.arahan->>'angle', ''), '\s+', ' ', 'g'), 220) $$;

create or replace function hub_konten()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c jsonb := tim_cfg(); m jsonb := c->'marketing';
  d0 timestamptz := date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta';
  v_berikut date := (date_trunc('week', now() at time zone 'Asia/Jakarta') + interval '7 days')::date;
  batch jsonb; konten jsonb; tim jsonb; mesin jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', d.key, 'unit', d.unit_key, 'nama', d.name, 'peran', d.role, 'status', coalesce(a.status, d.status),
      'model', coalesce(a.model, d.model), 'budget', a.daily_budget_usd,
      'terakhir', greatest(d.last_seen_at, (select max(t.updated_at) from office_tasks t where t.desk_key = d.key and t.status <> 'antre')),
      'antre', (select count(*) from office_tasks t where t.desk_key = d.key and t.status = 'antre'),
      'dikerjakan', (select count(*) from office_tasks t where t.desk_key = d.key and t.status = 'dikerjakan'),
      'gagal_7h', (select count(*) from office_tasks t where t.desk_key = d.key and t.status = 'gagal' and t.updated_at > now() - interval '7 days'),
      'usd_hari_ini', (select coalesce(sum(o.usd), 0) from office_costs o where o.desk_key = d.key and o.created_at >= d0))
      order by d.unit_key desc, d.sort), '[]')
    into tim
    from office_desks d left join office_agents a on a.desk_key = d.key
   where d.unit_key = 'marketing' or d.key in ('desain-ad', 'desain-konten', 'desain-motion');

  select jsonb_build_object(
      'pernah_jalan', exists (select 1 from office_costs where desk_key like 'mkt-%')
                      or exists (select 1 from office_tasks where unit_key = 'marketing' and status in ('dikerjakan', 'selesai', 'gagal', 'review')),
      'tugas_antre', (select count(*) from office_tasks where unit_key = 'marketing' and status = 'antre'),
      'antre_terlama', (select min(created_at) from office_tasks where unit_key = 'marketing' and status = 'antre'))
    into mesin;

  select coalesce(jsonb_agg(x order by (x->>'dibuat') desc), '[]') into batch from (
    select jsonb_build_object(
      'id', r.id, 'jenis', r.jenis, 'label', mkt_label(r.jenis, r.minggu, r.tema), 'tema', r.tema, 'status', r.status,
      'minggu', r.minggu, 'dibuat', r.created_at, 'ringkasan', r.rencana->>'ringkasan',
      'brief', r.rencana->'permintaan'->>'brief',
      'jumlah', (select count(*) from mkt_konten k where k.rencana_id = r.id),
      'per_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from mkt_konten k where k.rencana_id = r.id group by 1) s),
      'desain', (select jsonb_build_object('kode', j.kode, 'status', j.status, 'link', desain_link(j, true)) from design_jobs j where j.id = r.design_job_id)) x
    from mkt_rencana r order by r.created_at desc limit 15) z;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'kode', k.kode, 'rencana_id', k.rencana_id, 'kanal', k.kanal, 'label_kanal', mkt_label_kanal(k.kanal),
      'format', k.format, 'judul', coalesce(k.isi->>'judul', k.judul), 'status', k.status, 'jadwal', k.jadwal,
      'ringkas', hub_konten_ringkas(k), 'cek', k.cek, 'aset', jsonb_array_length(k.aset), 'perlu_visual', k.perlu_visual,
      'putaran', k.putaran, 'catatan_imam', k.catatan_imam, 'url_terbit', k.url_terbit)
      order by k.jadwal nulls last, k.kode), '[]')
    into konten
    from mkt_konten k where k.rencana_id in (select id from mkt_rencana order by created_at desc limit 15);

  return jsonb_build_object(
    'generated_at', now(), 'aktif', coalesce((m->>'aktif')::boolean, false), 'mesin', mesin, 'tim', tim,
    'pengaturan', jsonb_build_object(
      'kuota', (select coalesce(jsonb_object_agg(key, (value->>'per_minggu')::int), '{}') from jsonb_each(coalesce(m->'kanal', '{}'))),
      'catatan_imam', coalesce(m->>'catatan_imam', ''), 'pilar', m->'pilar',
      'visual_otomatis', coalesce((m->>'visual_otomatis')::boolean, false),
      'auto_terbit', coalesce((m->'meta'->>'auto_terbit')::boolean, false),
      'hari_rencana', coalesce((m->>'hari_rencana')::int, 6)),
    'rencana_berikut', jsonb_build_object('minggu', v_berikut,
      'ada', exists (select 1 from mkt_rencana where jenis = 'mingguan' and minggu = v_berikut)),
    'batch', batch, 'konten', konten);
end $$;

create or replace function hub_konten_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare k mkt_konten; r mkt_rencana; t office_tasks;
begin
  select * into k from mkt_konten where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'info', 'Konten tidak ditemukan'); end if;
  select * into r from mkt_rencana where id = k.rencana_id;
  select * into t from office_tasks where id = k.task_id;
  return jsonb_build_object('ok', true,
    'konten', to_jsonb(k) - 'terbit_klaim_at',
    'label_kanal', mkt_label_kanal(k.kanal),
    'rencana', jsonb_build_object('id', r.id, 'label', mkt_label(r.jenis, r.minggu, r.tema), 'jenis', r.jenis, 'status', r.status),
    'tugas', case when t.id is null then null else jsonb_build_object('status', t.status, 'percobaan', t.percobaan, 'error', t.error, 'meja', t.desk_key) end);
end $$;

-- ── 5. Aksi dari menu Konten ─────────────────────────────────────
create or replace function hub_konten_aksi(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb := tim_cfg(); m jsonb := c->'marketing'; op text := p->>'op';
  r mkt_rencana; k mkt_konten; it jsonb; v_kanal text; v_format text; v_jml int; v_total int := 0; v_desk text;
  v_mulai date; v_jam text; v_i int := 0; v_task uuid; v_kode text[] := '{}'; v_judul text; v_brief text; v_res jsonb; v_status text;
  fmt_ok jsonb := '{"ig_fb":["single","carousel"],"tiktok":["video"],"linkedin":["teks","carousel"],"blog":["artikel"]}';
  jam_def jsonb := '{"ig_fb":"19:00","tiktok":"20:00","linkedin":"07:30","blog":"09:00"}';
begin
  if op = 'minta' then
    if not coalesce((m->>'aktif')::boolean, false) then return jsonb_build_object('ok', false, 'info', 'Tim Marketing sedang nonaktif.'); end if;
    v_judul := left(trim(coalesce(p->>'judul', '')), 120);
    v_brief := left(trim(coalesce(p->>'brief', '')), 2000);
    if length(v_judul) < 3 then return jsonb_build_object('ok', false, 'info', 'Isi judul permintaan.'); end if;
    if length(v_brief) < 15 then return jsonb_build_object('ok', false, 'info', 'Tulis arahan materi minimal 15 karakter: apa yang ingin disampaikan, untuk siapa.'); end if;
    if jsonb_typeof(p->'item') <> 'array' or jsonb_array_length(p->'item') = 0 then return jsonb_build_object('ok', false, 'info', 'Pilih minimal satu kanal.'); end if;
    for it in select value from jsonb_array_elements(p->'item') loop
      v_kanal := it->>'kanal'; v_format := it->>'format';
      v_jml := coalesce(nullif(it->>'jumlah', '')::int, 1);
      if not (fmt_ok ? v_kanal) then return jsonb_build_object('ok', false, 'info', 'Kanal tidak dikenal: ' || coalesce(v_kanal, '-')); end if;
      if not (fmt_ok->v_kanal ? v_format) then return jsonb_build_object('ok', false, 'info', 'Format ' || coalesce(v_format, '-') || ' tidak tersedia untuk ' || mkt_label_kanal(v_kanal)); end if;
      if v_jml < 1 or v_jml > 5 then return jsonb_build_object('ok', false, 'info', 'Jumlah per kanal 1–5.'); end if;
      if m->'kanal'->v_kanal->>'desk' is null then return jsonb_build_object('ok', false, 'info', 'Penulis untuk ' || mkt_label_kanal(v_kanal) || ' belum diatur.'); end if;
      v_total := v_total + v_jml;
    end loop;
    if v_total > 8 then return jsonb_build_object('ok', false, 'info', 'Maksimal 8 materi per permintaan.'); end if;
    v_mulai := coalesce(nullif(p->>'mulai', '')::date, (now() at time zone 'Asia/Jakarta')::date + 1);
    if v_mulai < (now() at time zone 'Asia/Jakarta')::date then return jsonb_build_object('ok', false, 'info', 'Tanggal mulai tidak boleh di masa lalu.'); end if;

    insert into mkt_rencana (jenis, minggu, tema, status, rencana)
    values ('permintaan', v_mulai, v_judul, 'menulis', jsonb_build_object('permintaan', jsonb_strip_nulls(jsonb_build_object(
      'judul', v_judul, 'brief', v_brief, 'target', nullif(left(trim(coalesce(p->>'target', '')), 200), ''),
      'cta', nullif(left(trim(coalesce(p->>'cta', '')), 200), ''), 'item', p->'item', 'diminta_at', now())),
      'ringkasan', v_brief))
    returning * into r;

    for it in select value from jsonb_array_elements(p->'item') loop
      v_kanal := it->>'kanal'; v_format := it->>'format'; v_jml := coalesce(nullif(it->>'jumlah', '')::int, 1);
      v_desk := m->'kanal'->v_kanal->>'desk';
      v_jam := jam_def->>v_kanal;
      for n in 1..v_jml loop
        insert into mkt_konten (rencana_id, kanal, format, jadwal, pilar, judul, arahan)
        values (r.id, v_kanal, v_format, ((v_mulai + v_i)::text || ' ' || v_jam)::timestamp at time zone 'Asia/Jakarta',
                'Permintaan Imam', v_judul || case when v_jml > 1 then ' (' || n || '/' || v_jml || ')' else '' end,
                jsonb_strip_nulls(jsonb_build_object(
                  'angle', v_brief,
                  'target', nullif(left(trim(coalesce(p->>'target', '')), 200), ''),
                  'cta', coalesce(nullif(left(trim(coalesce(p->>'cta', '')), 200), ''), 'Isi brief proyek di brief.nagaraku.id (tidak mengikat)'),
                  'keyword', case when v_kanal = 'blog' then nullif(left(trim(coalesce(p->>'keyword', '')), 80), '') end,
                  'permintaan_imam', true,
                  'variasi', case when v_jml > 1 then 'Ini versi ' || n || ' dari ' || v_jml || '; buat sudut pandang/hook berbeda dari versi lain.' end)))
        returning * into k;
        insert into office_tasks (unit_key, desk_key, title, jenis, payload, priority)
        values ('marketing', v_desk, k.kode || ' · ' || k.judul, 'konten', jsonb_build_object('konten_id', k.id), 1)
        returning id into v_task;
        update mkt_konten set task_id = v_task where id = k.id;
        v_kode := v_kode || k.kode; v_i := v_i + 1;
      end loop;
    end loop;
    insert into office_events (unit_key, desk_key, message, meta)
    values ('marketing', 'mkt-strategi', 'Permintaan materi dari Imam: ' || v_judul || ' (' || v_total || ' materi)', jsonb_build_object('rencana', r.id));
    perform tim_tg('🧾 Permintaan materi "' || v_judul || '": ' || v_total || ' materi sedang ditulis (' || array_to_string(v_kode, ', ') || ').'
      || chr(10) || 'Draf bisa direview di Command Center: ' || hub_link('konten'));
    return jsonb_build_object('ok', true, 'rencana_id', r.id, 'kode', to_jsonb(v_kode),
      'info', v_total || ' materi masuk antrean penulis (' || array_to_string(v_kode, ', ') || ').');

  elsif op in ('setujui', 'revisi', 'tolak') then
    select * into k from mkt_konten where id = nullif(p->>'id', '')::uuid;
    if not found then return jsonb_build_object('ok', false, 'info', 'Konten tidak ditemukan'); end if;
    if k.status <> 'menunggu_review' then return jsonb_build_object('ok', false, 'info', k.kode || ' berstatus ' || k.status || ', tidak menunggu keputusan.'); end if;
    if op = 'revisi' and length(trim(coalesce(p->>'catatan', ''))) < 5 then return jsonb_build_object('ok', false, 'info', 'Tulis catatan revisi (minimal 5 karakter).'); end if;
    select * into r from mkt_rencana where id = k.rencana_id;
    perform tim_aksi(jsonb_build_object('j', 'mkt', 'id', k.id, 't', r.token, 'aksi', op, 'catatan', left(coalesce(p->>'catatan', ''), 2000)));
    select status into v_status from mkt_konten where id = k.id;
    if v_status = 'menunggu_review' then return jsonb_build_object('ok', false, 'info', 'Keputusan tidak tersimpan. Cek log kejadian.'); end if;
    return jsonb_build_object('ok', true, 'info', k.kode || case op when 'setujui' then ' disetujui.' when 'revisi' then ' dikirim untuk revisi.' else ' ditolak.' end);

  elsif op = 'setujui_semua' then
    select * into r from mkt_rencana where id = nullif(p->>'rencana_id', '')::uuid;
    if not found then return jsonb_build_object('ok', false, 'info', 'Batch tidak ditemukan'); end if;
    select count(*) into v_total from mkt_konten where rencana_id = r.id and status = 'menunggu_review';
    if v_total = 0 then return jsonb_build_object('ok', false, 'info', 'Tidak ada konten yang menunggu review.'); end if;
    perform tim_aksi(jsonb_build_object('j', 'mkt-semua', 'id', r.id, 't', r.token));
    return jsonb_build_object('ok', true, 'info', v_total || ' konten disetujui.');

  elsif op = 'terbit' then
    select * into k from mkt_konten where id = nullif(p->>'id', '')::uuid;
    if not found or k.status <> 'siap_terbit' then return jsonb_build_object('ok', false, 'info', 'Konten belum siap terbit.'); end if;
    if coalesce(p->>'url', '') <> '' and p->>'url' !~ '^https://\S+$' then return jsonb_build_object('ok', false, 'info', 'Link posting harus diawali https://'); end if;
    select * into r from mkt_rencana where id = k.rencana_id;
    perform tim_aksi(jsonb_build_object('j', 'paket', 'id', k.id, 't', r.token, 'aksi', 'terbit', 'url', p->>'url'));
    return jsonb_build_object('ok', true, 'info', k.kode || ' ditandai sudah diposting.');

  elsif op = 'mulai_minggu' then
    v_res := mkt_mulai_minggu(null);
    return jsonb_build_object('ok', coalesce((v_res->>'ok')::boolean, false),
      'info', case when (v_res->>'ok')::boolean then 'Kepala Marketing mulai menyusun rencana minggu ' || to_char((v_res->>'minggu')::date, 'DD Mon') || '.'
                   else coalesce(v_res->>'pesan', 'Gagal') end);

  elsif op = 'arahan' then
    update nadi_config set cfg = jsonb_set(cfg, '{tim,marketing,catatan_imam}', to_jsonb(left(trim(coalesce(p->>'catatan', '')), 1500)), true) where id = 1;
    return jsonb_build_object('ok', true, 'info', 'Arahan untuk Kepala Marketing disimpan; dipakai saat menyusun rencana berikutnya.');
  end if;
  return jsonb_build_object('ok', false, 'info', 'Aksi tidak dikenal');
end $$;

revoke all on function mkt_label(text, date, text), hub_link(text), hub_konten_ringkas(mkt_konten), hub_konten(), hub_konten_detail(uuid), hub_konten_aksi(jsonb) from public, anon, authenticated;
grant execute on function mkt_label(text, date, text), hub_link(text), hub_konten_ringkas(mkt_konten), hub_konten(), hub_konten_detail(uuid), hub_konten_aksi(jsonb) to service_role;
