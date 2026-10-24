-- Link pelacak NADI: nagaraku.id/l/<kode> → catat klik → teruskan ke brief / WA / halaman nagaraku.id dengan UTM.
-- Atribusi: project_briefs (utm_*, link_kode), crm_leads.sumber_data (kode dari pesan WA "ref: XXXXXX").
-- Laporan: tab "Sumber klien" (menu Konten & Marketing) → hub_sumber() / hub_sumber_aksi().
-- Privasi (UU PDP): IP tidak disimpan. Yang disimpan hanya hash harian (sha256 IP + user agent + tanggal + salt rahasia),
-- negara & kota dari header Vercel, jenis perangkat, dan host perujuk.
-- Aditif & aman diulang.

-- ───────────────────────────────────────────── Tabel
create table if not exists mkt_rahasia (kunci text primary key, nilai text not null);
alter table mkt_rahasia enable row level security;   -- tanpa policy: hanya service_role / fungsi security definer
insert into mkt_rahasia (kunci, nilai) values ('link_salt', encode(extensions.gen_random_bytes(32), 'hex')) on conflict do nothing;

create table if not exists mkt_link (
  id bigserial primary key,
  kode text not null unique check (kode ~ '^[a-z0-9]{4,12}$'),
  label text not null,
  kanal text not null check (kanal in ('ig_fb', 'tiktok', 'linkedin', 'meta_ads', 'blog', 'wa_outreach', 'email', 'lainnya')),
  tujuan text not null check (tujuan in ('brief', 'wa', 'web')),
  path text,                                             -- untuk tujuan web: path di nagaraku.id (mis. /#services)
  utm_source text not null, utm_medium text not null, utm_campaign text, utm_content text,
  konten_id uuid references mkt_konten(id) on delete set null,
  iklan_id text, analisis_id uuid,
  aktif boolean not null default true, uji boolean not null default false,
  dibuat_oleh text not null default 'imam',
  created_at timestamptz not null default now());
create unique index if not exists mkt_link_unik on mkt_link (kanal, tujuan, coalesce(utm_campaign, ''), coalesce(utm_content, ''), coalesce(path, '')) where not uji;
create index if not exists mkt_link_konten on mkt_link (konten_id);

create table if not exists mkt_klik (
  id bigserial primary key,
  link_id bigint not null references mkt_link(id) on delete cascade,
  waktu timestamptz not null default now(),
  hari date not null default (now() at time zone 'Asia/Jakarta')::date,
  pengunjung text,                                       -- hash harian, tidak bisa dibalik ke IP
  negara text, kota text, perangkat text, perujuk text,
  bot boolean not null default false);
create index if not exists mkt_klik_link on mkt_klik (link_id, waktu);

create table if not exists mkt_wa_ref (                -- kode yang muncul di WA dari nomor yang belum jadi lead
  wa text primary key, link_id bigint not null references mkt_link(id) on delete cascade, waktu timestamptz not null default now());

alter table mkt_link enable row level security;
alter table mkt_klik enable row level security;
alter table mkt_wa_ref enable row level security;
do $$ begin
  create policy owner_all on mkt_link for all using (office_is_owner()) with check (office_is_owner());
  create policy owner_all on mkt_klik for all using (office_is_owner()) with check (office_is_owner());
  create policy owner_all on mkt_wa_ref for all using (office_is_owner()) with check (office_is_owner());
exception when duplicate_object then null; end $$;

-- Kolom atribusi di brief (form publik boleh mengisinya; divalidasi trigger)
alter table project_briefs add column if not exists utm_source text;
alter table project_briefs add column if not exists utm_medium text;
alter table project_briefs add column if not exists utm_campaign text;
alter table project_briefs add column if not exists utm_content text;
alter table project_briefs add column if not exists link_kode text;
alter table project_briefs add column if not exists link_id bigint references mkt_link(id) on delete set null;
grant insert (utm_source, utm_medium, utm_campaign, utm_content, link_kode) on project_briefs to anon;

-- Pengaturan
update nadi_config set cfg = jsonb_set(cfg, '{tim,marketing,link}', coalesce(cfg->'tim'->'marketing'->'link', '{}'::jsonb) || jsonb_build_object(
    'base', coalesce(cfg->'tim'->'marketing'->'link'->>'base', 'https://nagaraku.id/l/'),
    'brief_url', coalesce(cfg->'tim'->'marketing'->'link'->>'brief_url', 'https://nagaraku.id/brief/'),
    'web_url', coalesce(cfg->'tim'->'marketing'->'link'->>'web_url', 'https://nagaraku.id'),
    'wa_nomor', coalesce(cfg->'tim'->'marketing'->'link'->>'wa_nomor', '6285887779036'),
    'wa_teks', coalesce(cfg->'tim'->'marketing'->'link'->>'wa_teks', 'Halo NADI, saya mau tanya soal website/sistem untuk usaha saya.')))
 where id = 1;

-- ───────────────────────────────────────────── Fungsi dasar
create or replace function mkt_urlenc(p text) returns text language plpgsql immutable as $$
declare r text := ''; b bytea; i int; c int;
begin
  if p is null then return null; end if;
  b := convert_to(p, 'UTF8');
  for i in 0 .. length(b) - 1 loop
    c := get_byte(b, i);
    if (c between 48 and 57) or (c between 65 and 90) or (c between 97 and 122) or c in (45, 46, 95, 126) then r := r || chr(c);
    else r := r || '%' || upper(lpad(to_hex(c), 2, '0')); end if;
  end loop;
  return r;
end $$;

create or replace function mkt_link_kode_baru() returns text language plpgsql volatile as $$
declare abc text := 'abcdefghjkmnpqrstuvwxyz23456789'; k text; n int := 0;
begin
  loop
    k := '';
    for i in 1 .. 6 loop k := k || substr(abc, 1 + floor(random() * length(abc))::int, 1); end loop;
    exit when not exists (select 1 from mkt_link where kode = k);
    n := n + 1; if n > 20 then raise exception 'kode link penuh'; end if;
  end loop;
  return k;
end $$;

create or replace function mkt_link_url(l mkt_link) returns text language sql stable security definer set search_path = public as $$
  select (tim_cfg()->'marketing'->'link'->>'base') || l.kode $$;

-- URL tujuan lengkap (dengan UTM & ref) — dipakai saat link dibuka
create or replace function mkt_link_tujuan(l mkt_link) returns text language plpgsql stable security definer set search_path = public as $$
declare c jsonb := tim_cfg()->'marketing'->'link'; q text; dasar text;
begin
  if l.tujuan = 'wa' then
    return 'https://wa.me/' || (c->>'wa_nomor') || '?text=' || mkt_urlenc((c->>'wa_teks') || ' (ref: ' || upper(l.kode) || ')');
  end if;
  q := 'utm_source=' || mkt_urlenc(l.utm_source) || '&utm_medium=' || mkt_urlenc(l.utm_medium)
    || coalesce('&utm_campaign=' || mkt_urlenc(l.utm_campaign), '') || coalesce('&utm_content=' || mkt_urlenc(l.utm_content), '')
    || '&ref=' || l.kode;
  if l.tujuan = 'brief' then dasar := c->>'brief_url';
  else dasar := rtrim(c->>'web_url', '/') || coalesce(nullif(l.path, ''), '/'); end if;
  -- sisipkan query sebelum #anchor
  if position('#' in dasar) > 0 then
    return split_part(dasar, '#', 1) || case when position('?' in split_part(dasar, '#', 1)) > 0 then '&' else '?' end || q || '#' || split_part(dasar, '#', 2);
  end if;
  return dasar || case when position('?' in dasar) > 0 then '&' else '?' end || q;
end $$;

create or replace function mkt_link_utm(p_kanal text) returns text[] language sql immutable as $$
  select case p_kanal
    when 'ig_fb' then array['meta', 'social'] when 'tiktok' then array['tiktok', 'social'] when 'linkedin' then array['linkedin', 'social']
    when 'meta_ads' then array['facebook', 'paid'] when 'blog' then array['nagaraku_blog', 'organic'] when 'wa_outreach' then array['whatsapp', 'outreach']
    when 'email' then array['email', 'email'] else array['lainnya', 'referral'] end $$;

-- Ambil-atau-buat link (dipakai agen & form Command Center)
create or replace function mkt_link_pastikan(p_kanal text, p_tujuan text, p_label text, p_campaign text default null, p_content text default null,
  p_path text default null, p_konten uuid default null, p_iklan text default null, p_analisis uuid default null, p_oleh text default 'sistem') returns mkt_link
language plpgsql security definer set search_path = public as $$
declare l mkt_link; u text[] := mkt_link_utm(p_kanal);
begin
  select * into l from mkt_link where kanal = p_kanal and tujuan = p_tujuan and coalesce(utm_campaign, '') = coalesce(p_campaign, '')
     and coalesce(utm_content, '') = coalesce(p_content, '') and coalesce(path, '') = coalesce(p_path, '') and not uji limit 1;
  if found then return l; end if;
  insert into mkt_link (kode, label, kanal, tujuan, path, utm_source, utm_medium, utm_campaign, utm_content, konten_id, iklan_id, analisis_id, dibuat_oleh)
  values (mkt_link_kode_baru(), left(p_label, 160), p_kanal, p_tujuan, nullif(p_path, ''), u[1], u[2], nullif(p_campaign, ''), nullif(p_content, ''),
          p_konten, p_iklan, p_analisis, p_oleh)
  on conflict do nothing returning * into l;
  if l.id is null then   -- balapan: ambil yang sudah dibuat
    select * into l from mkt_link where kanal = p_kanal and tujuan = p_tujuan and coalesce(utm_campaign, '') = coalesce(p_campaign, '')
       and coalesce(utm_content, '') = coalesce(p_content, '') and coalesce(path, '') = coalesce(p_path, '') and not uji limit 1;
  end if;
  return l;
end $$;

-- ───────────────────────────────────────────── Dipanggil middleware nagaraku.id (anon): catat klik, kembalikan URL tujuan
create or replace function mkt_link_buka(p_kode text, p_ip text default null, p_ua text default null, p_negara text default null,
  p_kota text default null, p_ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l mkt_link; v_hari date := (now() at time zone 'Asia/Jakarta')::date; v_ua text := left(coalesce(p_ua, ''), 400);
        v_bot boolean; v_host text;
begin
  select * into l from mkt_link where kode = lower(left(coalesce(p_kode, ''), 12));
  if not found or not l.aktif then return jsonb_build_object('url', tim_cfg()->'marketing'->'link'->>'web_url'); end if;
  v_bot := v_ua = '' or v_ua ~* '(bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|curl|wget|python|headless|lighthouse)';
  v_host := nullif(lower(substring(coalesce(p_ref, '') from '^[a-z]+://([^/:?#]+)')), '');
  insert into mkt_klik (link_id, hari, pengunjung, negara, kota, perangkat, perujuk, bot)
  values (l.id, v_hari,
          case when nullif(p_ip, '') is null then null else encode(extensions.digest(p_ip || '|' || v_ua || '|' || v_hari || '|' ||
                 (select nilai from mkt_rahasia where kunci = 'link_salt'), 'sha256'), 'hex') end,
          left(nullif(p_negara, ''), 2), left(nullif(p_kota, ''), 60),
          case when v_ua ~* '(ipad|tablet)' then 'tablet' when v_ua ~* '(mobi|android|iphone)' then 'hp' when v_ua = '' then null else 'desktop' end,
          left(v_host, 80), v_bot);
  return jsonb_build_object('url', mkt_link_tujuan(l));
end $$;
revoke all on function mkt_link_buka(text, text, text, text, text, text) from public;
grant execute on function mkt_link_buka(text, text, text, text, text, text) to anon, service_role;

-- ───────────────────────────────────────────── Atribusi
-- Brief: validasi kode/UTM dari form; bila tanpa kode, warisi dari lead / kode WA
create or replace function mkt_brief_atribusi() returns trigger
language plpgsql security definer set search_path = public as $$
declare l mkt_link; v_kode text;
begin
  new.utm_source := left(nullif(trim(new.utm_source), ''), 80);
  new.utm_medium := left(nullif(trim(new.utm_medium), ''), 80);
  new.utm_campaign := left(nullif(trim(new.utm_campaign), ''), 120);
  new.utm_content := left(nullif(trim(new.utm_content), ''), 120);
  v_kode := lower(left(nullif(trim(new.link_kode), ''), 12));
  new.link_id := null; new.link_kode := null;
  if v_kode is not null then select * into l from mkt_link where kode = v_kode; end if;
  if l.id is null and new.no_wa is not null then          -- datang dari chat WA berkode?
    select k.* into l from mkt_wa_ref w join mkt_link k on k.id = w.link_id where w.wa = new.no_wa;
    if l.id is null then
      select k.* into l from crm_leads c join mkt_link k on k.id = (c.sumber_data->>'link_id')::bigint
       where (c.id = new.lead_id or c.wa = new.no_wa) and c.sumber_data ? 'link_id' order by c.id = new.lead_id desc limit 1;
    end if;
  end if;
  if l.id is not null then
    new.link_id := l.id; new.link_kode := l.kode;
    new.utm_source := coalesce(new.utm_source, l.utm_source); new.utm_medium := coalesce(new.utm_medium, l.utm_medium);
    new.utm_campaign := coalesce(new.utm_campaign, l.utm_campaign); new.utm_content := coalesce(new.utm_content, l.utm_content);
  end if;
  return new;
end $$;
create or replace trigger trg_mkt_brief_atribusi before insert on project_briefs for each row execute function mkt_brief_atribusi();

-- WA masuk berisi "ref: XXXXXX" → kaitkan ke lead (sentuhan pertama dipertahankan)
create or replace function mkt_wa_atribusi() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_kode text; l mkt_link;
begin
  if new.direction <> 'in' or new.body is null then return new; end if;
  v_kode := lower((regexp_match(new.body, '\mref\s*[:#]?\s*([A-Za-z0-9]{6})\M', 'i'))[1]);
  if v_kode is null then return new; end if;
  select * into l from mkt_link where kode = v_kode;
  if l.id is null then return new; end if;
  if new.lead_id is not null then
    update crm_leads set sumber_data = coalesce(sumber_data, '{}'::jsonb) || jsonb_build_object('link_id', l.id, 'link_kode', l.kode,
             'kanal', l.kanal, 'utm_source', l.utm_source, 'utm_medium', l.utm_medium, 'utm_campaign', l.utm_campaign,
             'utm_content', l.utm_content, 'link_waktu', now())
     where id = new.lead_id and not (coalesce(sumber_data, '{}'::jsonb) ? 'link_id');
  end if;
  if new.wa is not null then
    insert into mkt_wa_ref (wa, link_id) values (new.wa, l.id) on conflict (wa) do nothing;
  end if;
  return new;
exception when others then return new;   -- jangan pernah menggagalkan penyimpanan pesan
end $$;
create or replace trigger trg_mkt_wa_atribusi after insert on crm_messages for each row execute function mkt_wa_atribusi();

-- ───────────────────────────────────────────── Funnel per brief (kohort tanggal brief)
create or replace view mkt_v_brief_funnel with (security_invoker = true) as
select b.id, b.created_at, (b.created_at at time zone 'Asia/Jakarta')::date tgl, b.link_id,
       coalesce(k.kanal, 'tanpa_link') kanal, k.label, k.utm_campaign, k.utm_content, k.konten_id, k.iklan_id,
       (b.meeting_mulai is not null or b.status in ('Zoom Dijadwalkan', 'Penawaran Terkirim', 'Negosiasi', 'Deal')
         or exists (select 1 from meeting_bookings m where m.brief_id = b.id and m.status not in ('dibatalkan', 'batal'))) meeting,
       (b.status in ('Penawaran Terkirim', 'Negosiasi', 'Deal') or exists (select 1 from sales_quotes q where q.brief_id = b.id and q.sent_at is not null)) penawaran,
       b.status = 'Deal' deal,
       case when b.status = 'Deal' then coalesce(b.harga_deal, b.harga_penawaran, 0) else 0 end nilai,
       coalesce(k.uji, false) or b.nama_usaha ~* '^UJI\M' uji
from project_briefs b left join mkt_link k on k.id = b.link_id;

create or replace function mkt_label_kanal(p text) returns text language sql immutable as $$
  select case p when 'ig_fb' then 'Instagram & Facebook' when 'tiktok' then 'TikTok' when 'linkedin' then 'LinkedIn'
    when 'meta_ads' then 'Iklan Meta' when 'blog' then 'Blog / SEO' when 'wa_outreach' then 'Outreach WA' when 'email' then 'Email'
    when 'lainnya' then 'Lainnya' when 'tanpa_link' then 'Langsung / tidak terlacak' else p end $$;

-- ───────────────────────────────────────────── Laporan Command Center
create or replace function hub_sumber(p_dari date default null, p_sampai date default null, p_uji boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d1 date := coalesce(p_sampai, (now() at time zone 'Asia/Jakarta')::date);
        d0 date := coalesce(p_dari, date_trunc('month', (now() at time zone 'Asia/Jakarta'))::date);
begin
  return jsonb_build_object('generated_at', now(), 'dari', d0, 'sampai', d1,
    'link_base', tim_cfg()->'marketing'->'link'->>'base',
    'kanal', (
      with kl as (select k.kanal, count(*) filter (where not c.bot) klik, count(distinct c.pengunjung) filter (where not c.bot) unik
                  from mkt_klik c join mkt_link k on k.id = c.link_id
                  where c.hari between d0 and d1 and (p_uji or not k.uji) group by k.kanal),
           wa as (select k.kanal, count(*) chat from crm_leads l join mkt_link k on k.id = (l.sumber_data->>'link_id')::bigint
                  where (l.sumber_data->>'link_waktu')::timestamptz between d0 and d1 + 1 and (p_uji or not k.uji) group by k.kanal),
           br as (select kanal, count(*) brief, count(*) filter (where meeting) meeting, count(*) filter (where penawaran) penawaran,
                         count(*) filter (where deal) deal, sum(nilai) nilai
                  from mkt_v_brief_funnel where tgl between d0 and d1 and (p_uji or not uji) group by kanal),
           semua as (select kanal from kl union select kanal from wa union select kanal from br)
      select coalesce(jsonb_agg(jsonb_build_object('kanal', s.kanal, 'label', mkt_label_kanal(s.kanal),
               'klik', coalesce(kl.klik, 0), 'pengunjung', coalesce(kl.unik, 0), 'chat_wa', coalesce(wa.chat, 0),
               'brief', coalesce(br.brief, 0), 'meeting', coalesce(br.meeting, 0), 'penawaran', coalesce(br.penawaran, 0),
               'deal', coalesce(br.deal, 0), 'nilai', coalesce(br.nilai, 0))
             order by coalesce(br.deal, 0) desc, coalesce(br.brief, 0) desc, coalesce(kl.klik, 0) desc), '[]')
      from semua s left join kl on kl.kanal = s.kanal left join wa on wa.kanal = s.kanal left join br on br.kanal = s.kanal),
    'link', (
      select coalesce(jsonb_agg(x order by (x->>'deal')::int desc, (x->>'brief')::int desc, (x->>'klik')::int desc, x->>'dibuat' desc), '[]') from (
        select jsonb_build_object('id', k.id, 'kode', k.kode, 'url', mkt_link_url(k), 'label', k.label, 'kanal', k.kanal, 'kanal_label', mkt_label_kanal(k.kanal),
          'tujuan', k.tujuan, 'utm_campaign', k.utm_campaign, 'utm_content', k.utm_content, 'aktif', k.aktif, 'uji', k.uji, 'dibuat', k.created_at,
          'dibuat_oleh', k.dibuat_oleh, 'konten', (select jsonb_build_object('kode', m.kode, 'judul', m.judul, 'status', m.status) from mkt_konten m where m.id = k.konten_id),
          'klik', (select count(*) from mkt_klik c where c.link_id = k.id and not c.bot and c.hari between d0 and d1),
          'pengunjung', (select count(distinct pengunjung) from mkt_klik c where c.link_id = k.id and not c.bot and c.hari between d0 and d1),
          'chat_wa', (select count(*) from crm_leads l where (l.sumber_data->>'link_id')::bigint = k.id and (l.sumber_data->>'link_waktu')::timestamptz between d0 and d1 + 1),
          'brief', (select count(*) from mkt_v_brief_funnel f where f.link_id = k.id and f.tgl between d0 and d1),
          'meeting', (select count(*) from mkt_v_brief_funnel f where f.link_id = k.id and f.tgl between d0 and d1 and f.meeting),
          'penawaran', (select count(*) from mkt_v_brief_funnel f where f.link_id = k.id and f.tgl between d0 and d1 and f.penawaran),
          'deal', (select count(*) from mkt_v_brief_funnel f where f.link_id = k.id and f.tgl between d0 and d1 and f.deal),
          'nilai', (select coalesce(sum(nilai), 0) from mkt_v_brief_funnel f where f.link_id = k.id and f.tgl between d0 and d1),
          'klik_total', (select count(*) from mkt_klik c where c.link_id = k.id and not c.bot)) x
        from mkt_link k where (p_uji or not k.uji)) z),
    'bulanan', (
      with b as (select generate_series(date_trunc('month', d1 - interval '5 months'), date_trunc('month', d1::timestamp), interval '1 month')::date bulan)
      select coalesce(jsonb_agg(jsonb_build_object('bulan', b.bulan,
        'klik', (select count(*) from mkt_klik c join mkt_link k on k.id = c.link_id where not c.bot and (p_uji or not k.uji) and date_trunc('month', c.hari) = b.bulan),
        'brief', (select count(*) from mkt_v_brief_funnel f where (p_uji or not f.uji) and date_trunc('month', f.tgl) = b.bulan),
        'brief_terlacak', (select count(*) from mkt_v_brief_funnel f where (p_uji or not f.uji) and f.link_id is not null and date_trunc('month', f.tgl) = b.bulan),
        'meeting', (select count(*) from mkt_v_brief_funnel f where (p_uji or not f.uji) and f.meeting and date_trunc('month', f.tgl) = b.bulan),
        'penawaran', (select count(*) from mkt_v_brief_funnel f where (p_uji or not f.uji) and f.penawaran and date_trunc('month', f.tgl) = b.bulan),
        'deal', (select count(*) from mkt_v_brief_funnel f where (p_uji or not f.uji) and f.deal and date_trunc('month', f.tgl) = b.bulan),
        'nilai', (select coalesce(sum(nilai), 0) from mkt_v_brief_funnel f where (p_uji or not f.uji) and date_trunc('month', f.tgl) = b.bulan),
        'per_kanal', (select coalesce(jsonb_object_agg(kanal, jsonb_build_object('brief', n, 'deal', d, 'nilai', v)), '{}') from (
            select kanal, count(*) n, count(*) filter (where deal) d, sum(nilai) v from mkt_v_brief_funnel f
             where (p_uji or not f.uji) and date_trunc('month', f.tgl) = b.bulan group by kanal) q))
        order by b.bulan), '[]') from b),
    'brief_terbaru', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'waktu', b.created_at, 'usaha', b.nama_usaha, 'status', b.status,
          'kanal', mkt_label_kanal(coalesce(k.kanal, 'tanpa_link')), 'link', k.label, 'kode', b.link_kode, 'utm_source', b.utm_source,
          'utm_campaign', b.utm_campaign, 'utm_content', b.utm_content) order by b.created_at desc), '[]')
      from (select * from project_briefs order by created_at desc limit 15) b left join mkt_link k on k.id = b.link_id
      where p_uji or not (coalesce(k.uji, false) or b.nama_usaha ~* '^UJI\M')));
end $$;

create or replace function hub_sumber_aksi(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare op text := p->>'op'; l mkt_link; v_kanal text := p->>'kanal'; v_tujuan text := p->>'tujuan'; v_path text;
begin
  if op = 'buat' then
    if v_kanal not in ('ig_fb', 'tiktok', 'linkedin', 'meta_ads', 'blog', 'wa_outreach', 'email', 'lainnya') then return jsonb_build_object('ok', false, 'info', 'Kanal tidak dikenal'); end if;
    if v_tujuan not in ('brief', 'wa', 'web') then return jsonb_build_object('ok', false, 'info', 'Tujuan tidak dikenal'); end if;
    if length(trim(coalesce(p->>'label', ''))) < 3 then return jsonb_build_object('ok', false, 'info', 'Isi nama link (min. 3 huruf)'); end if;
    v_path := nullif(trim(coalesce(p->>'path', '')), '');
    if v_tujuan = 'web' and v_path is not null and v_path !~ '^/[A-Za-z0-9/_\-\.#]*$' then return jsonb_build_object('ok', false, 'info', 'Path harus diawali / , contoh /#services'); end if;
    l := mkt_link_pastikan(v_kanal, v_tujuan, trim(p->>'label'), nullif(trim(coalesce(p->>'campaign', '')), ''),
           nullif(trim(coalesce(p->>'content', '')), ''), case when v_tujuan = 'web' then coalesce(v_path, '/') end, null, null, null, 'imam');
    return jsonb_build_object('ok', true, 'info', 'Link siap: ' || mkt_link_url(l), 'url', mkt_link_url(l), 'id', l.id);
  elsif op in ('nonaktif', 'aktif') then
    update mkt_link set aktif = (op = 'aktif') where id = nullif(p->>'id', '')::bigint returning * into l;
    if l.id is null then return jsonb_build_object('ok', false, 'info', 'Link tidak ditemukan'); end if;
    return jsonb_build_object('ok', true, 'info', case when op = 'aktif' then 'Link aktif lagi.' else 'Link dinonaktifkan (klik diteruskan ke nagaraku.id).' end);
  end if;
  return jsonb_build_object('ok', false, 'info', 'Aksi tidak dikenal');
end $$;

-- ───────────────────────────────────────────── Agen memakai link pelacak
-- Link CTA per konten (brief + WA), dibuat otomatis
create or replace function mkt_link_konten(p_konten uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k mkt_konten; r mkt_rencana; v_kanal text; v_camp text; lb mkt_link; lw mkt_link;
begin
  select * into k from mkt_konten where id = p_konten;
  if not found then return null; end if;
  select * into r from mkt_rencana where id = k.rencana_id;
  v_kanal := case when k.kanal in ('ig_fb', 'tiktok', 'linkedin', 'blog') then k.kanal when k.kanal = 'ads' then 'meta_ads' else 'lainnya' end;
  v_camp := 'konten-' || to_char(coalesce(r.minggu, k.created_at::date), 'IYYY-"w"IW');
  lb := mkt_link_pastikan(v_kanal, 'brief', k.kode || ' · ' || left(coalesce(k.judul, ''), 80) || ' (brief)', v_camp, k.kode, null, k.id);
  lw := mkt_link_pastikan(v_kanal, 'wa', k.kode || ' · ' || left(coalesce(k.judul, ''), 80) || ' (WA)', v_camp, k.kode, null, k.id);
  return jsonb_build_object('brief', mkt_link_url(lb), 'wa', mkt_link_url(lw));
end $$;

-- Ganti link polos (brief.nagaraku.id / wa.me NADI / nagaraku.id/brief) di semua teks hasil agen dengan link pelacak
create or replace function mkt_link_ganti(p jsonb, p_brief text, p_wa text) returns jsonb
language plpgsql immutable as $$
declare t text;
begin
  if p is null or p_brief is null then return p; end if;
  t := p::text;
  t := regexp_replace(t, '(https?://)?(www\.)?brief\.nagaraku\.id[^\s"\\)\]]*', p_brief, 'gi');
  t := regexp_replace(t, '(https?://)?(www\.)?nagaraku\.id/brief/?[^\s"\\)\]]*', p_brief, 'gi');
  t := regexp_replace(t, '(https?://)?(api\.)?wa\.me/(62|0)?85887779036[^\s"\\)\]]*', p_wa, 'gi');
  return t::jsonb;
exception when others then return p;
end $$;

do $$
declare d text;
begin
  -- Konteks penulis: brief_url = link pelacak konten itu + link WA
  d := pg_get_functiondef('tim_konteks(office_tasks)'::regprocedure);
  if position('mkt_link_konten' in d) = 0 then
    if position($q$'portofolio', m->'portofolio', 'layanan', m->'layanan', 'brief_url', c->>'brief_url',$q$ in d) = 0 then raise exception 'pola tim_konteks (konten) tidak ditemukan'; end if;
    d := replace(d, $q$'portofolio', m->'portofolio', 'layanan', m->'layanan', 'brief_url', c->>'brief_url',$q$,
      $q$'portofolio', m->'portofolio', 'layanan', m->'layanan',
      'brief_url', coalesce(mkt_link_konten(k.id)->>'brief', c->>'brief_url'),
      'link_cta', mkt_link_konten(k.id) || jsonb_build_object('aturan', 'WAJIB pakai link ini di ajakan (CTA): brief = isi brief, wa = chat WhatsApp NADI. Jangan menulis brief.nagaraku.id atau wa.me secara langsung.'),$q$);
    execute d;
  end if;
  -- Hasil penulis: link polos diganti otomatis sebelum disimpan
  d := pg_get_functiondef('mkt_terapkan_konten(office_tasks,jsonb)'::regprocedure);
  if position('mkt_link_ganti' in d) = 0 then
    if position($q$  v_cek := tim_cek_teks(mkt_teks_publik(h), false);$q$ in d) = 0 then raise exception 'pola mkt_terapkan_konten tidak ditemukan'; end if;
    d := replace(d, $q$  v_cek := tim_cek_teks(mkt_teks_publik(h), false);$q$,
      $q$  h := mkt_link_ganti(h, mkt_link_konten(k.id)->>'brief', mkt_link_konten(k.id)->>'wa');
  v_cek := tim_cek_teks(mkt_teks_publik(h), false);$q$);
    execute d;
  end if;
  -- Analis Meta Ads: tiap variasi iklan dapat link pelacak (kanal meta_ads, content IKL-n)
  d := pg_get_functiondef('mkt_iklan_terapkan(office_tasks,jsonb)'::regprocedure);
  if position('mkt_link_pastikan' in d) = 0 then
    if position($q$  v_cek := tim_cek_teks($q$ in d) = 0 then raise exception 'pola mkt_iklan_terapkan tidak ditemukan'; end if;
    d := replace(d, $q$  v_cek := tim_cek_teks($q$, $q$  select coalesce(jsonb_agg(e || jsonb_build_object(
           'link_brief', mkt_link_url(mkt_link_pastikan('meta_ads', 'brief', 'Iklan IKL-' || n || ' ' || to_char(an.periode_selesai, 'DD Mon') || ' (brief)',
              'iklan-' || to_char(an.periode_selesai, 'YYYY-MM-DD'), 'IKL-' || n, null, null, null, an.id, 'mkt-ads')),
           'link_wa', mkt_link_url(mkt_link_pastikan('meta_ads', 'wa', 'Iklan IKL-' || n || ' ' || to_char(an.periode_selesai, 'DD Mon') || ' (WA)',
              'iklan-' || to_char(an.periode_selesai, 'YYYY-MM-DD'), 'IKL-' || n, null, null, null, an.id, 'mkt-ads'))) order by n), '[]')
    into v_var from jsonb_array_elements(v_var) with ordinality x(e, n);
  v_cek := tim_cek_teks($q$);
    execute d;
  end if;
end $$;

-- Konteks analis: beri tahu bahwa link CTA dibuat sistem
update office_agents set system_prompt = replace(system_prompt,
  '- CTA yang boleh: chat WhatsApp NADI, DM, atau isi brief di brief.nagaraku.id (sekitar 5 menit, tidak mengikat).',
  '- CTA yang boleh: chat WhatsApp NADI, DM, atau isi brief (sekitar 5 menit, tidak mengikat). Jangan menulis URL; sistem menambahkan link pelacak (link_brief, link_wa) ke tiap variasi.')
 where desk_key = 'mkt-ads';

-- Hak akses
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('mkt_link_kode_baru', 'mkt_link_url', 'mkt_link_tujuan', 'mkt_link_pastikan',
              'mkt_brief_atribusi', 'mkt_wa_atribusi', 'hub_sumber', 'hub_sumber_aksi', 'mkt_link_konten', 'tim_konteks', 'mkt_terapkan_konten', 'mkt_iklan_terapkan')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
revoke all on mkt_v_brief_funnel from anon, authenticated;
