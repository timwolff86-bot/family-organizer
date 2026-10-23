-- Update 4: mehrere Personen pro Termin
alter table public.events add column if not exists member_ids uuid[];
