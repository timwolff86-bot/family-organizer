-- Update 18: Neuigkeiten (wer hat was angelegt, geändert, erledigt, gelöscht)
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  actor uuid references public.members (id) on delete set null, -- wer (Person auf dem Gerät)
  action text not null,         -- create, update, delete, done, cancel, uncancel, add, bought, plan, out
  entity text not null,         -- event, task, reminder, shop, meal, recipe, note, birthday, member, waste
  entity_id text,
  title text,
  detail text,
  people uuid[] not null default '{}',   -- betroffene Personen ("Betrifft mich")
  private boolean not null default false, -- private Erinnerung: nur für Betroffene und Ersteller
  created_at timestamptz not null default now()
);
create index if not exists activities_created_at on public.activities (created_at desc);
alter table public.activities enable row level security;
drop policy if exists "familie" on public.activities;
create policy "familie" on public.activities for all to authenticated using (true) with check (true);
do $$
begin
  alter publication supabase_realtime add table public.activities;
exception when duplicate_object then null;
end $$;
-- Ältere Einträge als 30 Tage aufräumen (läuft bei jedem Ausführen dieses Updates)
delete from public.activities where created_at < now() - interval '30 days';
