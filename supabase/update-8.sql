-- Update 8: weitere Wiederholungs-Rhythmen für Erinnerungen und Aufgaben
-- repeat: 'weekly' | 'biweekly' | 'monthly' | 'yearly', repeat_from: erstes Datum
alter table public.tasks add column if not exists repeat text;
alter table public.tasks add column if not exists repeat_from date;
