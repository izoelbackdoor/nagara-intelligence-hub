-- Pengukuran konversi Meta NADI (Pixel di nagaraku.id & brief.nagaraku.id + Conversions API dari n8n).
-- Browser (setelah pengunjung setuju cookie): PageView, ViewContent, Lead, Schedule, Contact — skrip assets/nadi-ukur.js di repo nadi-international.
-- Server (Conversions API, workflow n8n "NADI 7d - Konversi Meta"): Lead, Schedule, Purchase (brief → Deal, nilai = harga deal).
-- Deduplikasi: event_id yang sama di browser dan server (Lead = meta_event_id brief, Schedule = 'sch-' + meta_event_id).
-- Data pribadi di-hash SHA-256 di database sebelum keluar (email, nomor WA, nama, kota, negara, external_id); IP tidak dikirim/disimpan.
-- Hanya brief dengan persetujuan cookie (meta_izin = true) yang dikirim ke Meta. Token Meta hanya di credential n8n "Meta CAPI NADI".
-- Aditif & aman diulang.

alter table project_briefs add column if not exists meta_event_id text;
alter table project_briefs add column if not exists meta_izin boolean not null default false;
alter table project_briefs add column if not exists meta_fbp text;
alter table project_briefs add column if not exists meta_fbc text;
alter table project_briefs add column if not exists meta_ua text;
alter table project_briefs add column if not exists meta_url text;
grant insert (meta_event_id, meta_izin, meta_fbp, meta_fbc, meta_ua, meta_url) on project_briefs to anon;

create table if not exists mkt_konversi (
  id bigserial primary key,
  event_name text not null check (event_name in ('Lead', 'Schedule', 'Purchase')),
  event_id text not null unique,
  event_time timestamptz not null default now(),
  brief_id uuid references project_briefs(id) on delete cascade,
  nilai numeric, sumber_aksi text not null default 'website',
  user_data jsonb not null default '{}',               -- sudah di-hash
  status text not null default 'antre' check (status in ('antre', 'dikirim', 'terkirim', 'gagal', 'dilewati')),
  percobaan int not null default 0, respons jsonb, error text, uji boolean not null default false,
  dibuat timestamptz not null default now(), dikirim_at timestamptz);
create index if not exists mkt_konversi_status on mkt_konversi (status, dibuat);

create table if not exists mkt_pixel_status (
  id int primary key default 1 check (id = 1), data jsonb, error text, diperbarui timestamptz not null default now());

alter table mkt_konversi enable row level security;
alter table mkt_pixel_status enable row level security;
do $$ begin
  create policy owner_all on mkt_konversi for all using (office_is_owner()) with check (office_is_owner());
  create policy owner_all on mkt_pixel_status for all using (office_is_owner()) with check (office_is_owner());
exception when duplicate_object then null; end $$;

update nadi_config set cfg = jsonb_set(cfg, '{tim,marketing,pixel}', jsonb_build_object(
    'pixel_id', coalesce(cfg->'tim'->'marketing'->'pixel'->>'pixel_id', ''),
    'test_event_code', coalesce(cfg->'tim'->'marketing'->'pixel'->>'test_event_code', ''),
    'capi_aktif', coalesce((cfg->'tim'->'marketing'->'pixel'->>'capi_aktif')::boolean, true)))
 where id = 1;

-- ───────────────────────────────────────────── Konfigurasi publik situs (anon): hanya pixel id
create or replace function nadi_situs_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pixel_id', nullif(tim_cfg()->'marketing'->'pixel'->>'pixel_id', '')) $$;
revoke all on function nadi_situs_cfg() from public;
grant execute on function nadi_situs_cfg() to anon, service_role;

-- ───────────────────────────────────────────── Hash sesuai aturan Meta (normalisasi lalu SHA-256 hex)
create or replace function mkt_h(p text) returns text language sql immutable as $$
  select case when nullif(trim(coalesce(p, '')), '') is null then null
              else encode(extensions.digest(lower(trim(p)), 'sha256'), 'hex') end $$;

create or replace function mkt_user_data(b project_briefs) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_wa text := regexp_replace(coalesce(b.no_wa, ''), '\D', '', 'g'); v_nama text[]; v_kota text;
begin
  if v_wa like '0%' then v_wa := '62' || substr(v_wa, 2); end if;
  v_nama := regexp_split_to_array(lower(trim(regexp_replace(coalesce(b.nama_pic, ''), '[^[:alpha:] ]', '', 'g'))), '\s+');
  v_kota := lower(regexp_replace(coalesce(b.kota, ''), '[^[:alpha:]]', '', 'g'));
  return jsonb_strip_nulls(jsonb_build_object(
    'em', case when b.email ~ '@' then jsonb_build_array(mkt_h(b.email)) end,
    'ph', case when length(v_wa) >= 9 then jsonb_build_array(mkt_h(v_wa)) end,
    'fn', mkt_h(v_nama[1]),
    'ln', case when cardinality(v_nama) > 1 then mkt_h(v_nama[cardinality(v_nama)]) end,
    'ct', mkt_h(nullif(v_kota, '')),
    'country', mkt_h('id'),
    'external_id', jsonb_build_array(mkt_h(b.id::text)),
    'fbp', nullif(b.meta_fbp, ''), 'fbc', nullif(b.meta_fbc, ''),
    'client_user_agent', nullif(b.meta_ua, '')));
end $$;

create or replace function mkt_konversi_antre(b project_briefs, p_event text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id text; v_uji boolean := b.nama_usaha ~* '^UJI\M';
begin
  if not b.meta_izin then return; end if;
  v_id := case p_event when 'Lead' then coalesce(nullif(b.meta_event_id, ''), 'lead-' || b.id)
                       when 'Schedule' then 'sch-' || coalesce(nullif(b.meta_event_id, ''), b.id::text)
                       else 'deal-' || b.id end;
  insert into mkt_konversi (event_name, event_id, brief_id, nilai, sumber_aksi, user_data, uji)
  values (p_event, v_id, b.id,
          case when p_event = 'Purchase' then coalesce(b.harga_deal, b.harga_penawaran) end,
          case when p_event = 'Purchase' then 'system_generated' else 'website' end,
          mkt_user_data(b), v_uji)
  on conflict (event_id) do nothing;
end $$;

-- Pemicu: brief masuk (Lead, + Schedule bila memilih jadwal), meeting dibuat kemudian (Schedule), status Deal (Purchase)
create or replace function mkt_konversi_brief() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.meta_event_id := left(nullif(regexp_replace(coalesce(new.meta_event_id, ''), '[^A-Za-z0-9_-]', '', 'g'), ''), 64);
  new.meta_fbp := left(nullif(new.meta_fbp, ''), 120); new.meta_fbc := left(nullif(new.meta_fbc, ''), 300);
  new.meta_ua := left(nullif(new.meta_ua, ''), 400); new.meta_url := left(nullif(new.meta_url, ''), 400);
  new.meta_izin := coalesce(new.meta_izin, false);
  return new;
end $$;
create or replace trigger trg_mkt_konversi_brief_isi before insert on project_briefs for each row execute function mkt_konversi_brief();

create or replace function mkt_konversi_brief_setelah() returns trigger
language plpgsql security definer set search_path = public as $$
declare b project_briefs;
begin
  select * into b from project_briefs where id = new.id;
  if tg_op = 'INSERT' then
    perform mkt_konversi_antre(b, 'Lead');
    if b.meeting_mulai is not null then perform mkt_konversi_antre(b, 'Schedule'); end if;
  elsif new.status = 'Deal' and old.status is distinct from 'Deal' then
    perform mkt_konversi_antre(b, 'Purchase');
  end if;
  return null;
exception when others then return null;   -- pengukuran tidak boleh mengganggu brief
end $$;
create or replace trigger trg_mkt_konversi_brief after insert or update of status on project_briefs for each row execute function mkt_konversi_brief_setelah();

create or replace function mkt_konversi_meeting() returns trigger
language plpgsql security definer set search_path = public as $$
declare b project_briefs;
begin
  if new.brief_id is null then return null; end if;
  select * into b from project_briefs where id = new.brief_id;
  if found then perform mkt_konversi_antre(b, 'Schedule'); end if;
  return null;
exception when others then return null;
end $$;
create or replace trigger trg_mkt_konversi_meeting after insert on meeting_bookings for each row execute function mkt_konversi_meeting();

-- ───────────────────────────────────────────── Untuk n8n
create or replace function mkt_konversi_ambil(p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := tim_cfg()->'marketing'->'pixel'; v_ids bigint[]; v_data jsonb;
begin
  if nullif(c->>'pixel_id', '') is null or not coalesce((c->>'capi_aktif')::boolean, true) then
    return jsonb_build_object('go', false, 'pesan', 'pixel_id belum diisi / CAPI nonaktif');
  end if;
  update mkt_konversi set status = 'antre' where status = 'dikirim' and dikirim_at < now() - interval '15 minutes';
  update mkt_konversi set status = 'dilewati', error = 'lebih dari 7 hari (batas Meta)' where status = 'antre' and event_time < now() - interval '6 days 20 hours';
  with x as (select id from mkt_konversi where status = 'antre' and percobaan < 5 order by id limit greatest(1, least(p_limit, 500)) for update skip locked),
       u as (update mkt_konversi k set status = 'dikirim', dikirim_at = now(), percobaan = percobaan + 1 from x where k.id = x.id returning k.id)
  select array_agg(id) into v_ids from u;
  if v_ids is null then return jsonb_build_object('go', false, 'pesan', 'tidak ada event'); end if;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'event_name', k.event_name, 'event_time', extract(epoch from k.event_time)::bigint, 'event_id', k.event_id,
      'action_source', k.sumber_aksi,
      'event_source_url', case when k.sumber_aksi = 'website' then coalesce(b.meta_url, tim_cfg()->>'brief_url') end,
      'user_data', k.user_data,
      'custom_data', case when k.event_name = 'Purchase' then jsonb_build_object('currency', 'IDR', 'value', k.nilai, 'content_name', coalesce(b.jenis_proyek, 'Proyek NADI'))
                          else jsonb_build_object('content_name', case k.event_name when 'Lead' then 'Brief proyek' else 'Meeting brief' end) end)) order by k.id)
    into v_data from mkt_konversi k left join project_briefs b on b.id = k.brief_id where k.id = any(v_ids);
  return jsonb_build_object('go', true, 'pixel_id', c->>'pixel_id', 'ids', to_jsonb(v_ids),
    'body', jsonb_strip_nulls(jsonb_build_object('data', v_data, 'test_event_code', nullif(c->>'test_event_code', ''))));
end $$;

create or replace function mkt_konversi_hasil(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids bigint[]; v_ok boolean; v_err text;
begin
  select array_agg(x::bigint) into v_ids from jsonb_array_elements_text(coalesce(p->'ids', '[]')) x;
  v_ok := (p->'respons'->>'events_received') is not null and p->'respons'->'error' is null;
  v_err := case when not v_ok then left(coalesce(p->'respons'->'error'->>'message', p->>'error', (p->'respons')::text, 'gagal'), 500) end;
  update mkt_konversi set status = case when v_ok then 'terkirim' when percobaan >= 5 then 'gagal' else 'antre' end,
         respons = p->'respons', error = v_err where id = any(v_ids);
  if not v_ok and coalesce((p->'respons'->'error'->>'code')::int, 0) in (190, 102) then
    perform mkt_iklan_peringatan_set('capi_token', null, 'Token Conversions API Meta tidak valid',
      'Kirim event ke Meta gagal: ' || left(v_err, 200) || '. Perbarui token di credential n8n "Meta CAPI NADI".');
  end if;
  if v_ok then
    update mkt_iklan_peringatan set status = 'selesai', selesai_at = now(), diperbarui = now() where jenis = 'capi_token' and status = 'aktif';
  end if;
  return jsonb_build_object('ok', v_ok, 'jumlah', cardinality(v_ids));
end $$;

create or replace function mkt_pixel_status_simpan(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  insert into mkt_pixel_status (id, data, error, diperbarui)
  values (1, case when p->'error' is null then p end, case when p->'error' is not null then left(coalesce(p->'error'->>'message', (p->'error')::text), 500) end, now())
  on conflict (id) do update set data = coalesce(excluded.data, mkt_pixel_status.data), error = excluded.error, diperbarui = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function mkt_pixel_info() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := tim_cfg()->'marketing'->'pixel';
begin
  if nullif(c->>'pixel_id', '') is null then return jsonb_build_object('go', false); end if;
  return jsonb_build_object('go', true, 'pixel_id', c->>'pixel_id',
    'sejak', extract(epoch from now() - interval '7 days')::bigint, 'sampai', extract(epoch from now())::bigint);
end $$;

-- ───────────────────────────────────────────── Status pixel untuk tab Iklan Meta
create or replace function hub_iklan_pixel() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pixel_id', nullif(tim_cfg()->'marketing'->'pixel'->>'pixel_id', ''),
    'test_event_code', nullif(tim_cfg()->'marketing'->'pixel'->>'test_event_code', ''),
    'capi_7h', (select coalesce(jsonb_object_agg(event_name, j), '{}') from (
        select event_name, jsonb_build_object('terkirim', count(*) filter (where status = 'terkirim'), 'antre', count(*) filter (where status in ('antre', 'dikirim')),
               'gagal', count(*) filter (where status in ('gagal', 'dilewati')), 'uji', count(*) filter (where uji)) j
        from mkt_konversi where dibuat > now() - interval '7 days' group by event_name) z),
    'error_terakhir', (select jsonb_build_object('waktu', dibuat, 'event', event_name, 'error', error) from mkt_konversi
                       where error is not null order by id desc limit 1),
    'terkirim_terakhir', (select max(dikirim_at) from mkt_konversi where status = 'terkirim'),
    'meta', (select jsonb_build_object('data', data, 'error', error, 'diperbarui', diperbarui) from mkt_pixel_status where id = 1),
    'brief_7h', (select jsonb_build_object('total', count(*), 'izin', count(*) filter (where meta_izin)) from project_briefs where created_at > now() - interval '7 days')) $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('hub_iklan()'::regprocedure);
  if position('hub_iklan_pixel' in d) = 0 then
    if position($q$'agen', (select jsonb_build_object('status', ag.status$q$ in d) = 0 then raise exception 'pola hub_iklan tidak ditemukan'; end if;
    d := replace(d, $q$'agen', (select jsonb_build_object('status', ag.status$q$, $q$'pixel', hub_iklan_pixel(),
    'agen', (select jsonb_build_object('status', ag.status$q$);
    execute d;
  end if;
  d := pg_get_functiondef('hub_iklan_aksi(jsonb)'::regprocedure);
  if position('''pixel''' in d) = 0 then
    if position($q$  elsif op = 'budget' then$q$ in d) = 0 then raise exception 'pola hub_iklan_aksi tidak ditemukan'; end if;
    d := replace(d, $q$  elsif op = 'budget' then$q$, $q$  elsif op = 'pixel' then
    if coalesce(p->>'pixel_id', '') !~ '^\d{0,20}$' then return jsonb_build_object('ok', false, 'info', 'Pixel ID harus angka.'); end if;
    if coalesce(p->>'test_event_code', '') !~ '^[A-Za-z0-9]{0,20}$' then return jsonb_build_object('ok', false, 'info', 'Kode uji hanya huruf/angka (mis. TEST12345).'); end if;
    update nadi_config set cfg = jsonb_set(jsonb_set(cfg, '{tim,marketing,pixel,pixel_id}', to_jsonb(coalesce(p->>'pixel_id', ''))),
             '{tim,marketing,pixel,test_event_code}', to_jsonb(coalesce(p->>'test_event_code', ''))) where id = 1;
    return jsonb_build_object('ok', true, 'info', case when coalesce(p->>'pixel_id', '') = '' then 'Pixel dimatikan di situs.' else 'Pixel ' || (p->>'pixel_id') || ' aktif di situs (setelah pengunjung setuju cookie)' || case when coalesce(p->>'test_event_code', '') <> '' then ' · mode uji ' || (p->>'test_event_code') else '' end || '.' end);
  elsif op = 'budget' then$q$);
    execute d;
  end if;
end $$;

do $$
declare d text;
begin
  d := pg_get_functiondef('mkt_iklan_cek_peringatan()'::regprocedure);
  if position('capi_token' in d) = 0 then
    d := replace(d, $q$where status = 'aktif' and not ((jenis$q$, $q$where status = 'aktif' and jenis <> 'capi_token' and not ((jenis$q$);
    execute d;
  end if;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('mkt_user_data', 'mkt_konversi_antre', 'mkt_konversi_brief', 'mkt_konversi_brief_setelah',
              'mkt_konversi_meeting', 'mkt_konversi_ambil', 'mkt_konversi_hasil', 'mkt_pixel_status_simpan', 'mkt_pixel_info', 'hub_iklan_pixel', 'hub_iklan', 'hub_iklan_aksi')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
