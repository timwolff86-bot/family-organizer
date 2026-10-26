-- Update 17: Push "Neu für dich" – wenn jemand anderes dir etwas einträgt
-- Wer hat den Termin angelegt? (bei Aufgaben/Erinnerungen gibt es das schon)
alter table public.events add column if not exists created_by uuid references public.members (id) on delete set null;
-- Schalter pro Gerät (Standard: an)
alter table public.push_subscriptions add column if not exists assigned boolean not null default true;
