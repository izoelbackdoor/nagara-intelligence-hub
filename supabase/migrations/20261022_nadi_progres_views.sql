-- Halaman "Outreach & Brief NADI" (api/office/state.js?action=nadi-progress → lib/nadi-progress.js).
-- View hanya-baca di atas crm_leads, crm_messages, project_briefs, nadi_outreach_state (diisi workflow n8n NADI 2/3/4
-- dan form brief.nagaraku.id). security_invoker + revoke: anon/authenticated tidak bisa membaca; dashboard memakai service role.
-- Aman diulang.

create or replace view public.nadi_v_progres with (security_invoker = true) as
select l.id, coalesce(nullif(l.business,''), l.name) as nama, l.category as kategori, l.city as kota,
  case l.status when 'dihubungi' then '1. Dihubungi' when 'membalas' then '2. Membalas' when 'tertarik' then '3. Tertarik'
    when 'deal' then '5. Deal' when 'tolak' then 'x. Menolak' else l.status end as tahap,
  case when l.bot_aktif then 'Bot' else 'Imam' end as dipegang,
  to_char(l.last_contacted_at at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') as dihubungi_wib,
  (select left(m.body, 120) from crm_messages m where m.lead_id = l.id and m.direction = 'in' order by m.id desc limit 1) as pesan_terakhir_klien,
  (select to_char(m.created_at at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') from crm_messages m where m.lead_id = l.id and m.direction = 'in' order by m.id desc limit 1) as balas_terakhir_wib,
  l.bot_summary as ringkasan_bot, 'https://wa.me/' || nadi_norm_wa(l.wa) as wa_link
from crm_leads l
where l.product = 'nadi' and (l.last_contacted_at is not null or l.status <> 'baru')
order by coalesce((select max(m.created_at) from crm_messages m where m.lead_id = l.id), l.last_contacted_at) desc nulls last;

drop view if exists public.nadi_v_ringkasan;
drop view if exists public.nadi_v_penawaran;
create view public.nadi_v_penawaran with (security_invoker = true) as
select x.*,
  case when x.versi_dikirim = 'hemat' then (x.rekomendasi->>'harga_penawaran')::numeric else x.harga_penawaran end as penawaran_aktif,
  case when x.versi_dikirim = 'hemat' then (x.rekomendasi->>'harga_bottom')::numeric else x.harga_bottom end as bottom_aktif
from (
  select b.id, to_char(b.created_at at time zone 'Asia/Jakarta', 'DD Mon HH24:MI') as masuk_wib, b.nama_usaha, b.nama_pic, b.kota,
    b.jenis_proyek, b.status, b.harga_penawaran, b.harga_bottom, b.harga_standar, b.anggaran, b.anggaran_angka,
    b.rekomendasi, b.rekomendasi->>'status' as rekomendasi_status,
    b.server_per_bulan, b.maintenance_per_bulan, b.lanjut_via,
    case when b.lanjut_via = 'zoom' then coalesce(b.jadwal_zoom::text, nullif(concat_ws(' ', b.zoom_hari, nadi_jam_zoom(b.zoom_jam)), '')) end as jadwal_zoom,
    b.harga_deal, b.rekomendasi_teks, 'https://wa.me/' || nadi_norm_wa(b.no_wa) as wa_link, b.lead_id, b.created_at,
    (select replace(m.meta->>'jenis', 'brief_', '') from crm_messages m
      where m.lead_id = b.lead_id and m.meta->>'jenis' in ('brief_ideal','brief_hemat') and m.created_at >= b.created_at
      order by m.id desc limit 1) as versi_dikirim
  from project_briefs b
) x order by x.created_at desc;

create view public.nadi_v_ringkasan with (security_invoker = true) as
select
  (select count(*) from crm_leads where product='nadi' and last_contacted_at is not null) as total_dihubungi,
  (select count(*) from crm_leads where product='nadi' and last_contacted_at >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta') as dihubungi_hari_ini,
  (select count(distinct lead_id) from crm_messages m join crm_leads l on l.id=m.lead_id where l.product='nadi' and m.direction='in') as membalas,
  (select count(*) from project_briefs) as brief_masuk,
  (select count(*) from project_briefs where status in ('Penawaran Terkirim','Zoom Dijadwalkan','Negosiasi')) as penawaran_berjalan,
  (select count(*) from project_briefs where status = 'Deal') as deal,
  (select coalesce(sum(coalesce(harga_deal, penawaran_aktif)),0) from nadi_v_penawaran where status not in ('Batal','Ditolak')) as nilai_pipeline,
  (select count(*) from crm_leads where product='nadi' and status='baru' and last_contacted_at is null and coalesce(wa_valid,'')<>'invalid') as sisa_antrean,
  (select to_char(next_send_at at time zone 'Asia/Jakarta','DD Mon HH24:MI') from nadi_outreach_state where id=1) as kirim_berikutnya_wib;

revoke all on public.nadi_v_progres, public.nadi_v_penawaran, public.nadi_v_ringkasan from anon, authenticated;
grant select on public.nadi_v_progres, public.nadi_v_penawaran, public.nadi_v_ringkasan to service_role;
