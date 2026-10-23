-- Update 1: Auswahl "nicht nötig" beim Fahrer (Hin/Zurück)
-- Einmal im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach laufen.
alter table public.events add column if not exists skip_to boolean not null default false;
alter table public.events add column if not exists skip_back boolean not null default false;
alter table public.event_occurrences add column if not exists skip_to boolean not null default false;
alter table public.event_occurrences add column if not exists skip_back boolean not null default false;
