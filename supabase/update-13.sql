-- Update 13: Enddatum für wiederkehrende Erinnerungen und Aufgaben
alter table public.tasks add column if not exists repeat_until date;
