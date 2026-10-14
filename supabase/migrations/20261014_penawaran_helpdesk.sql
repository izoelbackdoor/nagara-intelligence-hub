-- Nagara Command Center — Penawaran (kalkulator NADI) & Helpdesk
-- Jalankan sekali di Supabase → project nagara-command-center → SQL Editor → Run.
-- Aditif & aman diulang: hanya MENAMBAH tabel baru, tidak mengubah/menghapus tabel lama.

create table if not exists public.sales_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_quotes (
  id bigserial primary key,
  number text unique,
  share_token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  lead_id bigint references public.crm_leads(id) on delete set null,
  product text not null default 'nadi',
  client_name text not null,
  client_contact text,
  client_wa text,
  client_email text,
  project_title text,
  status text not null default 'draf' check (status in ('draf','menunggu_kirim','terkirim','diterima','ditolak','kedaluwarsa')),
  revisions int not null default 2,
  valid_until date,
  inputs jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  cost_base numeric not null default 0,
  price_final numeric not null default 0,
  tier text,
  offer_price numeric not null default 0,
  yearly_recurring numeric not null default 0,
  notes text,
  sent_at timestamptz,
  decided_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_quotes_lead_idx on public.sales_quotes(lead_id);
create index if not exists sales_quotes_status_idx on public.sales_quotes(status, updated_at desc);

create or replace function private.sales_quote_number() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.number is null then
    new.number := 'Q-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYY') || '-' || lpad(new.id::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists sales_quotes_number on public.sales_quotes;
create trigger sales_quotes_number before insert on public.sales_quotes
  for each row execute function private.sales_quote_number();

create table if not exists public.hd_tickets (
  id bigserial primary key,
  number text unique,
  lead_id bigint references public.crm_leads(id) on delete set null,
  quote_id bigint references public.sales_quotes(id) on delete set null,
  client_name text not null,
  wa text,
  email text,
  channel text not null default 'wa' check (channel in ('wa','email','manual','web')),
  subject text not null,
  category text not null default 'pertanyaan' check (category in ('teknis','tagihan','permintaan_fitur','pertanyaan','keluhan','lainnya')),
  priority text not null default 'normal' check (priority in ('rendah','normal','tinggi','urgent')),
  status text not null default 'baru' check (status in ('baru','dibuka','menunggu_klien','selesai','ditutup')),
  summary text,
  ai_draft text,
  sla_due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hd_tickets_status_idx on public.hd_tickets(status, sla_due_at);
create index if not exists hd_tickets_wa_idx on public.hd_tickets(wa);

create or replace function private.hd_ticket_number() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.number is null then
    new.number := 'T-' || to_char(now() at time zone 'Asia/Jakarta', 'YYMM') || '-' || lpad(new.id::text, 4, '0');
  end if;
  return new;
end $$;
drop trigger if exists hd_tickets_number on public.hd_tickets;
create trigger hd_tickets_number before insert on public.hd_tickets
  for each row execute function private.hd_ticket_number();

create table if not exists public.hd_messages (
  id bigserial primary key,
  ticket_id bigint not null references public.hd_tickets(id) on delete cascade,
  direction text not null check (direction in ('in','out','note')),
  channel text not null default 'wa' check (channel in ('wa','email','manual','web','sistem')),
  body text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists hd_messages_ticket_idx on public.hd_messages(ticket_id, created_at);

-- RLS sama seperti tabel kantor lain: hanya pemilik (server memakai service role).
alter table public.sales_settings enable row level security;
alter table public.sales_quotes enable row level security;
alter table public.hd_tickets enable row level security;
alter table public.hd_messages enable row level security;
do $$ declare t text; begin
  foreach t in array array['sales_settings','sales_quotes','hd_tickets','hd_messages'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated using ((select private.office_is_owner())) with check ((select private.office_is_owner()))', t);
  end loop;
end $$;

-- Meja Rawat (sudah ada di denah Studio NADI) dipakai untuk agen helpdesk.
update public.office_desks
   set jobdesc = jobdesc || jsonb_build_object('helpdesk', 'Klasifikasi tiket helpdesk & draf balasan dari knowledge base. Tidak mengirim apa pun tanpa persetujuan pemilik.')
 where key = 'rawat';
