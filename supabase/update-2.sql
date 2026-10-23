-- Update 2: Einkaufs-Kategorien mit Produktkatalog + Erinnerungen
-- Einmal im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach laufen.

-- Produktkatalog (die App füllt ihn beim ersten Start und lernt dazu)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  category text not null default 'sonstiges',
  uses int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.shopping_items add column if not exists category text;

-- Erinnerungen sind Aufgaben mit kind = 'erinnerung', Datum und optionaler Uhrzeit.
-- assignees: eine oder mehrere Personen, done_by: wer abgehakt hat.
alter table public.tasks add column if not exists kind text not null default 'aufgabe';
alter table public.tasks add column if not exists due_time time;
alter table public.tasks add column if not exists assignees uuid[];
alter table public.tasks add column if not exists done_by uuid references public.members (id) on delete set null;

alter table public.products enable row level security;
drop policy if exists "familie" on public.products;
create policy "familie" on public.products for all to authenticated using (true) with check (true);
do $$
begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null;
end $$;
