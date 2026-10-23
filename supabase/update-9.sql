-- Update 9: "Ganztägig" als eigenes Merkmal (statt "keine Uhrzeit")
alter table public.events add column if not exists all_day boolean not null default false;
