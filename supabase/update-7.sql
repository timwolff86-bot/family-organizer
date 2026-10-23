-- Update 7: Geburtstagskalender
-- Im Supabase SQL Editor ausführen und bei der RLS-Warnung "Run without RLS" wählen
-- (die Zeilen unten schalten den Schutz selbst ein).

create table if not exists public.birthdays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  day int not null check (day between 1 and 31),
  month int not null check (month between 1 and 12),
  year int,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.birthdays enable row level security;
drop policy if exists "familie" on public.birthdays;
create policy "familie" on public.birthdays for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.birthdays;
