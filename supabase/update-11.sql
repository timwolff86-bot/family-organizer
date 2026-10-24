-- Update 11: einzelne Termine einer Serie ändern (Ausnahmen)
-- Eine Ausnahme ist ein eigener Termin, der auf die Serie verweist und deren Termin an series_date ersetzt.
alter table public.events add column if not exists series_id uuid references public.events (id) on delete cascade;
alter table public.events add column if not exists series_date date;
