-- Update 22: Konto löschen
-- Löscht den eigenen Zugang. War es der letzte Zugang der Familie, wird die ganze Familie
-- mit allen Daten gelöscht. Sonst bleiben die Daten für die anderen erhalten.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  fid uuid;
  rest int;
begin
  if uid is null then raise exception 'not_logged_in'; end if;
  select family_id into fid from public.family_users where user_id = uid;
  delete from auth.users where id = uid; -- entfernt auch den Eintrag in family_users
  if fid is null then
    return jsonb_build_object('family_deleted', false);
  end if;
  select count(*) into rest from public.family_users where family_id = fid;
  if rest = 0 then
    delete from public.families where id = fid; -- alle Daten der Familie hängen daran
    return jsonb_build_object('family_deleted', true);
  end if;
  -- Es soll immer jemand die Zugänge verwalten können
  if not exists (select 1 from public.family_users where family_id = fid and role = 'owner') then
    update public.family_users set role = 'owner'
    where user_id = (select user_id from public.family_users where family_id = fid order by created_at limit 1);
  end if;
  return jsonb_build_object('family_deleted', false);
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
