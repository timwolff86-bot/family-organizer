-- Update 16: Abfallkalender (Abholtage) und gemeinsame Einstellungen
create table if not exists public.waste_pickups (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  bins text[] not null default '{}',     -- rest, bio, papier, gelb, sonst
  note text,
  put_out_at timestamptz,                -- am Vortag rausgestellt (abgehakt)
  put_out_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Einstellungen für die ganze Familie, z. B. key = 'waste' → { "on": true, "time": "19:00", "people": [...] }
create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}',
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['waste_pickups','app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "familie" on public.%I', t);
    execute format('create policy "familie" on public.%I for all to authenticated using (true) with check (true)', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Familie Wolff: Abfuhrtermine Steinhagen Bezirk 2 (bis Ende 2026)
-- übernehmen und die bisherigen einzelnen Müll-Erinnerungen löschen.
-- Doppelt ausführen schadet nicht.
insert into public.waste_pickups (date, bins, note)
values
  ('2026-10-27', '{bio}', null),
  ('2026-11-03', '{rest,papier}', null),
  ('2026-11-10', '{bio,gelb}', null),
  ('2026-11-17', '{rest}', null),
  ('2026-11-24', '{bio}', null),
  ('2026-12-01', '{rest,papier}', null),
  ('2026-12-08', '{bio,gelb}', null),
  ('2026-12-15', '{rest}', null),
  ('2026-12-21', '{bio}', 'vorgezogen – schon Montag'),
  ('2026-12-29', '{rest,papier}', null)
on conflict (date) do nothing;

-- Erinnerung am Vortag um 19:00 für Tim und Jenny
insert into public.app_settings (key, value)
select 'waste', jsonb_build_object(
  'on', true,
  'time', '19:00',
  'people', coalesce((select jsonb_agg(id) from public.members where name ilike 'tim%' or name ilike 'jenny%'), '[]'::jsonb)
)
on conflict (key) do nothing;

-- Alte Müll-Erinnerungen (aus muell-2026-bezirk2.sql) entfernen
delete from public.tasks
where kind = 'erinnerung' and notes ilike '%rausstellen%';
