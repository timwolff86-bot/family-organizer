-- Update 5: Kochbuch (Rezepte) und Verknüpfung Essensplan → Rezept
-- Im Supabase SQL Editor ausführen und bei der RLS-Warnung "Run without RLS" wählen
-- (die Zeilen unten schalten den Schutz selbst ein).

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  emoji text,
  category text not null default 'sonstiges',
  minutes int,
  servings int,
  ingredients text[] not null default '{}',
  steps text,
  favorite boolean not null default false,
  own boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.meals add column if not exists recipe_id uuid references public.recipes (id) on delete set null;

alter table public.recipes enable row level security;
drop policy if exists "familie" on public.recipes;
create policy "familie" on public.recipes for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.recipes;
