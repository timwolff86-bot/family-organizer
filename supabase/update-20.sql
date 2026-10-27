-- Update 20: einzelne Tage einer wiederkehrenden Erinnerung/Aufgabe auslassen
alter table public.task_completions add column if not exists skipped boolean not null default false;
