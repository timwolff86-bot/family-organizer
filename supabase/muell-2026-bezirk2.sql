-- Müllabfuhr Steinhagen, Bezirk 2, 23.10.–31.12.2026
-- Erinnerung jeweils am Vortag der Abholung, für Tim und Jenny.
-- Läuft nur, wenn beide Personen gefunden werden; doppelt ausführen legt nichts doppelt an.
with p as (
  select
    (select id from public.members where name ilike 'tim%' order by sort limit 1) as tim,
    (select id from public.members where name ilike 'jenny%' order by sort limit 1) as jenny
)
insert into public.tasks (kind, title, notes, due_date, assignees, assignee, created_by)
select 'erinnerung', v.title, v.notes, v.d::date, array[p.tim, p.jenny], p.tim, p.tim
from p,
  (values
    ('2026-10-26', 'Biotonne morgen', 'Abholung Di 27.10. – bis 6 Uhr rausstellen'),
    ('2026-11-02', 'Restmüll + Papiertonne morgen', 'Abholung Di 03.11. – bis 6 Uhr rausstellen'),
    ('2026-11-09', 'Biotonne + Gelbe Tonne morgen', 'Abholung Di 10.11. – bis 6 Uhr rausstellen'),
    ('2026-11-16', 'Restmüll morgen', 'Abholung Di 17.11. – bis 6 Uhr rausstellen'),
    ('2026-11-23', 'Biotonne morgen', 'Abholung Di 24.11. – bis 6 Uhr rausstellen'),
    ('2026-11-30', 'Restmüll + Papiertonne morgen', 'Abholung Di 01.12. – bis 6 Uhr rausstellen'),
    ('2026-12-07', 'Biotonne + Gelbe Tonne morgen', 'Abholung Di 08.12. – bis 6 Uhr rausstellen'),
    ('2026-12-14', 'Restmüll morgen', 'Abholung Di 15.12. – bis 6 Uhr rausstellen'),
    ('2026-12-20', 'Biotonne morgen (vorgezogen!)', 'Vorgezogene Abholung schon Mo 21.12. – bis 6 Uhr rausstellen'),
    ('2026-12-28', 'Restmüll + Papiertonne morgen', 'Abholung Di 29.12. – bis 6 Uhr rausstellen')
  ) as v(d, title, notes)
where p.tim is not null and p.jenny is not null
  and not exists (
    select 1 from public.tasks t
    where t.kind = 'erinnerung' and t.title = v.title and t.due_date = v.d::date
  );
