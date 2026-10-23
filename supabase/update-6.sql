-- Update 6: Erinnerungen sind persönlich – wer hat sie angelegt?
alter table public.tasks add column if not exists created_by uuid references public.members (id) on delete set null;
