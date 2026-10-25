-- Update 15: Notizen (Listen zum Abhaken oder freier Text)
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  emoji text,
  kind text not null default 'text',      -- 'text' oder 'liste'
  body text,                              -- Text-Notiz
  items jsonb not null default '[]',      -- Liste: [{ id, text, done, head }]
  pinned boolean not null default false,
  created_by uuid references public.members (id) on delete set null,
  updated_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.notes enable row level security;
drop policy if exists "familie" on public.notes;
create policy "familie" on public.notes for all to authenticated using (true) with check (true);
do $$
begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null;
end $$;
