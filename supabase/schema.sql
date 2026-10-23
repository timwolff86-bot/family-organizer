-- Familienplaner – Datenbank-Schema für Supabase
-- Einmal komplett im Supabase SQL Editor ausführen (SQL Editor → New query → Run).

create extension if not exists pgcrypto;

-- Familienmitglieder und Helfer (z. B. Oma, Nachbarn)
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#4f7cff',
  role text not null default 'kind' check (role in ('erwachsen', 'kind', 'helfer')),
  drives boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Termine: einmalig (date) oder wöchentlich (weekdays, 1 = Mo … 7 = So)
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  member_id uuid references public.members (id) on delete set null,
  date date,
  weekdays int[],
  end_date date,
  start_time time,
  end_time time,
  location text,
  needs_driver boolean not null default true,
  driver_to uuid references public.members (id) on delete set null,
  driver_back uuid references public.members (id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- Abweichungen an einem bestimmten Tag (anderer Fahrer, fällt aus)
create table if not exists public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  date date not null,
  driver_to uuid references public.members (id) on delete set null,
  driver_back uuid references public.members (id) on delete set null,
  cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (event_id, date)
);

-- Aufgaben: ohne Datum, an einem Tag (due_date) oder wöchentlich (weekdays)
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  assignee uuid references public.members (id) on delete set null,
  due_date date,
  weekdays int[],
  sofa boolean not null default false,
  notes text,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

-- Erledigt-Haken für wiederkehrende Aufgaben (pro Tag)
create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  unique (task_id, date)
);

-- Essensplan: ein Eintrag pro Tag
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  text text,
  created_at timestamptz not null default now()
);

-- Einkaufsliste
create table if not exists public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shop text not null default 'Rewe',
  done boolean not null default false,
  created_at timestamptz not null default now()
);

-- "Fahrt nicht nötig" für Hin- bzw. Rückweg (Update 1)
alter table public.events add column if not exists skip_to boolean not null default false;
alter table public.events add column if not exists skip_back boolean not null default false;
alter table public.event_occurrences add column if not exists skip_to boolean not null default false;
alter table public.event_occurrences add column if not exists skip_back boolean not null default false;

-- Produktkatalog + Erinnerungen (Update 2)
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  category text not null default 'sonstiges',
  uses int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.shopping_items add column if not exists category text;
alter table public.tasks add column if not exists kind text not null default 'aufgabe';
alter table public.tasks add column if not exists due_time time;
alter table public.tasks add column if not exists assignees uuid[];
alter table public.tasks add column if not exists done_by uuid references public.members (id) on delete set null;

-- Profilbilder (Update 3)
alter table public.members add column if not exists avatar text;

-- Mehrere Personen pro Termin (Update 4)
alter table public.events add column if not exists member_ids uuid[];

-- Kochbuch (Update 5)
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

-- Persönliche Erinnerungen (Update 6)
alter table public.tasks add column if not exists created_by uuid references public.members (id) on delete set null;

-- Geburtstagskalender (Update 7)
create table if not exists public.birthdays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  day int not null check (day between 1 and 31),
  month int not null check (month between 1 and 12),
  year int,
  notes text,
  created_at timestamptz not null default now()
);

-- Wiederholungs-Rhythmen (Update 8)
alter table public.tasks add column if not exists repeat text;
alter table public.tasks add column if not exists repeat_from date;

-- Ganztägig als eigenes Merkmal (Update 9)
alter table public.events add column if not exists all_day boolean not null default false;

-- Zugriff: nur angemeldete Nutzer. Neue Registrierungen in Supabase abschalten,
-- dann kommen nur die Konten rein, die ihr selbst anlegt.
do $$
declare t text;
begin
  foreach t in array array['members','events','event_occurrences','tasks','task_completions','meals','shopping_items','products','recipes','birthdays'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "familie" on public.%I', t);
    execute format('create policy "familie" on public.%I for all to authenticated using (true) with check (true)', t);
    -- Live-Aktualisierung zwischen den Handys
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
