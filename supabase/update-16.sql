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
