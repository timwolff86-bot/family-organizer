-- Update 10: Menge und Notiz für Einkaufsartikel
alter table public.shopping_items add column if not exists amount text;
alter table public.shopping_items add column if not exists note text;
