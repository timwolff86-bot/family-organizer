-- Update 19: alle Tabellen für die Live-Aktualisierung freischalten
-- (falls eine bei früheren Updates nicht dabei war). Doppelt ausführen schadet nicht.
do $$
declare t text;
begin
  foreach t in array array['members','events','event_occurrences','tasks','task_completions','meals','shopping_items','products','recipes','birthdays','push_subscriptions','shops','notes','waste_pickups','app_settings','activities'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_table then null;
    end;
  end loop;
end $$;

-- Kontrolle: diese Tabellen werden live übertragen
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename;
