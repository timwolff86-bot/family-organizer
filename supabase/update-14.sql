-- Update 14: Läden für den Einkauf (Lidl als Standard)
create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.shops (name, is_default) values ('Lidl', true) on conflict (name) do nothing;

-- Bisher stand alles automatisch auf "Rewe": auf Lidl umstellen
alter table public.shopping_items alter column shop set default 'Lidl';
update public.shopping_items set shop = 'Lidl' where shop = 'Rewe';

alter table public.shops enable row level security;
drop policy if exists "familie" on public.shops;
create policy "familie" on public.shops for all to authenticated using (true) with check (true);
do $$
begin
  alter publication supabase_realtime add table public.shops;
exception when duplicate_object then null;
end $$;
