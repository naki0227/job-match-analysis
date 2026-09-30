-- Manual rollback for Issue #39. Removes every share link, live or revoked.
begin;

drop function public.read_public_share(text);
drop function public.revoke_match_share(uuid, uuid);
drop function public.read_active_match_share(uuid, uuid);
drop function public.create_match_share(uuid, uuid, text, jsonb);
drop table public.match_shares;

commit;
