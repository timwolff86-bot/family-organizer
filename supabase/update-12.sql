-- Update 12: Push-Benachrichtigungen
-- Ein Eintrag pro Handy: wohin die Nachricht geht und was die Person auf diesem Gerät bekommen möchte.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  reminders boolean not null default true,
  events boolean not null default true,
  tasks boolean not null default true,
  lead int not null default 30,          -- Termine: Minuten vorher, -2 = am Vortag 18 Uhr
  daily_time time not null default '07:00', -- Aufgaben-Übersicht und Erinnerungen ohne Uhrzeit
  device text,
  created_at timestamptz not null default now()
);

-- Pro Termin: null = wie eingestellt, -1 = nicht erinnern, -2 = am Vortag, sonst Minuten vorher
alter table public.events add column if not exists remind int;

-- Was schon verschickt wurde (damit nichts doppelt kommt). Nur die Versand-Funktion liest das.
create table if not exists public.push_log (
  key text primary key,
  created_at timestamptz not null default now()
);
alter table public.push_log enable row level security;

alter table public.push_subscriptions enable row level security;
drop policy if exists "familie" on public.push_subscriptions;
create policy "familie" on public.push_subscriptions for all to authenticated using (true) with check (true);
