-- Update 3: Profilbilder für Personen (als kleines Bild direkt in der Tabelle)
alter table public.members add column if not exists avatar text;
