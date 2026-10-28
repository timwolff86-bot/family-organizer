-- Update 21: Familienkonten
-- Jede Familie sieht nur noch ihre eigenen Daten. Eure bisherigen Daten gehören danach
-- zur „Familie Wolff“, alle bisherigen Zugänge (Tim, Jenny) ebenfalls.
-- Kann gefahrlos mehrfach ausgeführt werden. Ältere Updates (1–20) danach nicht mehr ausführen.

-- 1. Familien, Zugänge und Einladungscodes
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  can_invite_families boolean not null default false, -- darf neue Familien einladen
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Ein Zugang (Login) gehört zu genau einer Familie
create table if not exists public.family_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  role text not null default 'member', -- 'owner' = hat die Familie angelegt
  email text,
  created_at timestamptz not null default now()
);
create index if not exists family_users_family on public.family_users (family_id);

-- kind 'family': neue Familie anlegen; kind 'join': einer bestehenden Familie beitreten
create table if not exists public.invites (
  code text primary key,
  kind text not null check (kind in ('family', 'join')),
  family_id uuid not null references public.families (id) on delete cascade,
  note text,
  created_by uuid,
  uses_left int not null default 1,
  expires_at timestamptz not null default now() + interval '30 days',
  used_by uuid,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Familie des angemeldeten Nutzers (für die Zugriffsregeln)
create or replace function public.current_family() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.family_users where user_id = auth.uid()
$$;

-- Neue Einträge bekommen automatisch die Familie des Nutzers
create or replace function public.set_family_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.family_id is null then
    new.family_id := public.current_family();
  end if;
  return new;
end $$;

-- 2. Eure Familie anlegen und alle bisherigen Daten und Zugänge zuordnen
do $$
declare
  fid uuid;
  t text;
begin
  if not exists (select 1 from public.families) then
    insert into public.families (name, can_invite_families) values ('Familie Wolff', true) returning id into fid;
  end if;
  select id into fid from public.families where can_invite_families order by created_at limit 1;

  insert into public.family_users (user_id, family_id, role, email)
  select u.id, fid, 'owner', u.email from auth.users u
  where not exists (select 1 from public.family_users x where x.user_id = u.id)
    and not exists (select 1 from public.families f where f.id <> fid); -- nur beim ersten Mal

  foreach t in array array['members','events','event_occurrences','tasks','task_completions','meals','shopping_items','products','recipes','birthdays','push_subscriptions','shops','notes','waste_pickups','app_settings','activities'] loop
    execute format('alter table public.%I add column if not exists family_id uuid references public.families (id) on delete cascade', t);
    execute format('update public.%I set family_id = %L where family_id is null', t, fid);
    execute format('alter table public.%I alter column family_id set not null', t);
    execute format('create index if not exists %I on public.%I (family_id)', t || '_family', t);
    execute format('drop trigger if exists set_family_id on public.%I', t);
    execute format('create trigger set_family_id before insert on public.%I for each row execute function public.set_family_id()', t);
    -- Zugriff: nur die eigene Familie
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "familie" on public.%I', t);
    execute format('create policy "familie" on public.%I for all to authenticated using (family_id = (select public.current_family())) with check (family_id = (select public.current_family()))', t);
  end loop;
end $$;

-- 3. Was bisher nur einmal vorkommen durfte, gilt jetzt je Familie
alter table public.meals drop constraint if exists meals_date_key;
create unique index if not exists meals_family_date on public.meals (family_id, date);
alter table public.products drop constraint if exists products_key_key;
create unique index if not exists products_family_key on public.products (family_id, key);
alter table public.shops drop constraint if exists shops_name_key;
create unique index if not exists shops_family_name on public.shops (family_id, name);
alter table public.waste_pickups drop constraint if exists waste_pickups_date_key;
create unique index if not exists waste_pickups_family_date on public.waste_pickups (family_id, date);
alter table public.app_settings drop constraint if exists app_settings_key_key;
create unique index if not exists app_settings_family_key on public.app_settings (family_id, key);

-- 4. Zugriff auf die neuen Tabellen: nur lesen, Änderungen nur über die Funktionen unten
alter table public.families enable row level security;
alter table public.family_users enable row level security;
alter table public.invites enable row level security;
drop policy if exists "eigene" on public.families;
create policy "eigene" on public.families for select to authenticated using (id = (select public.current_family()));
drop policy if exists "eigene" on public.family_users;
create policy "eigene" on public.family_users for select to authenticated using (family_id = (select public.current_family()));
drop policy if exists "eigene" on public.invites;
create policy "eigene" on public.invites for select to authenticated using (family_id = (select public.current_family()));
drop policy if exists "zurueckziehen" on public.invites;
create policy "zurueckziehen" on public.invites for delete to authenticated using (family_id = (select public.current_family()));

-- 5. Funktionen für die App
-- Code vereinheitlichen: "abcd-2345" → "ABCD2345"
create or replace function public.norm_code(p text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Prüfen, wofür ein Code gilt (geht auch vor dem Registrieren)
create or replace function public.invite_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  i public.invites;
  fname text;
begin
  select * into i from public.invites where code = public.norm_code(p_code);
  if i.code is null or i.uses_left < 1 or i.expires_at < now() then
    return jsonb_build_object('ok', false);
  end if;
  if i.kind = 'join' then
    select name into fname from public.families where id = i.family_id;
  end if;
  return jsonb_build_object('ok', true, 'kind', i.kind, 'family', fname);
end $$;

-- Mit Code eine neue Familie anlegen
create or replace function public.create_family(p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
  fid uuid;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  if exists (select 1 from public.family_users where user_id = auth.uid()) then raise exception 'already_in_family'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_missing'; end if;
  select * into i from public.invites where code = public.norm_code(p_code) for update;
  if i.code is null or i.kind <> 'family' or i.uses_left < 1 or i.expires_at < now() then raise exception 'invalid_code'; end if;
  insert into public.families (name, created_by) values (left(trim(p_name), 60), auth.uid()) returning id into fid;
  insert into public.family_users (user_id, family_id, role, email) values (auth.uid(), fid, 'owner', auth.jwt() ->> 'email');
  update public.invites set uses_left = uses_left - 1, used_by = auth.uid(), used_at = now() where code = i.code;
  insert into public.shops (family_id, name, is_default, sort) values (fid, 'Lidl', true, 0);
  return fid;
end $$;

-- Mit Code einer bestehenden Familie beitreten
create or replace function public.join_family(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  i public.invites;
begin
  if auth.uid() is null then raise exception 'not_logged_in'; end if;
  if exists (select 1 from public.family_users where user_id = auth.uid()) then raise exception 'already_in_family'; end if;
  select * into i from public.invites where code = public.norm_code(p_code) for update;
  if i.code is null or i.kind <> 'join' or i.uses_left < 1 or i.expires_at < now() then raise exception 'invalid_code'; end if;
  insert into public.family_users (user_id, family_id, role, email) values (auth.uid(), i.family_id, 'member', auth.jwt() ->> 'email');
  update public.invites set uses_left = uses_left - 1, used_by = auth.uid(), used_at = now() where code = i.code;
  return i.family_id;
end $$;

-- Einladungscode erzeugen: 'join' (Partner) darf jede Familie, 'family' nur Familien mit Freigabe
create or replace function public.create_invite(p_kind text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  fid uuid := public.current_family();
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- ohne 0/O, 1/I
  b bytea;
  c text;
begin
  if fid is null then raise exception 'no_family'; end if;
  if p_kind not in ('family', 'join') then raise exception 'invalid_kind'; end if;
  if p_kind = 'family' and not (select can_invite_families from public.families where id = fid) then raise exception 'not_allowed'; end if;
  loop
    b := uuid_send(gen_random_uuid());
    c := '';
    for k in 0..7 loop
      c := c || substr(alphabet, (get_byte(b, case when k < 6 then k else k + 4 end) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.invites where code = c);
  end loop;
  insert into public.invites (code, kind, family_id, note, created_by, expires_at)
  values (c, p_kind, fid, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
          now() + case when p_kind = 'join' then interval '14 days' else interval '30 days' end);
  return c;
end $$;

-- Familie umbenennen
create or replace function public.rename_family(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'name_missing'; end if;
  update public.families set name = left(trim(p_name), 60) where id = public.current_family();
end $$;

-- Zugang entfernen (nur wer die Familie angelegt hat, nicht sich selbst)
create or replace function public.remove_family_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.family_users where user_id = auth.uid() and role = 'owner') then raise exception 'not_allowed'; end if;
  if p_user = auth.uid() then raise exception 'not_self'; end if;
  delete from public.family_users where user_id = p_user and family_id = public.current_family();
end $$;

revoke all on function public.create_family(text, text), public.join_family(text), public.create_invite(text, text),
  public.rename_family(text), public.remove_family_user(uuid) from public, anon;
grant execute on function public.create_family(text, text), public.join_family(text), public.create_invite(text, text),
  public.rename_family(text), public.remove_family_user(uuid) to authenticated;
grant execute on function public.invite_info(text) to anon, authenticated;
