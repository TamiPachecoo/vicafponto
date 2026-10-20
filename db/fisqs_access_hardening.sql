-- Explicit grants override Supabase's project-level default privileges.
begin;
revoke all on public.fisqs_members from anon, authenticated;
grant select on public.fisqs_members to authenticated;
revoke all on public.fisqs_products, public.fisqs_revisions from anon, authenticated;
grant select, insert on public.fisqs_products, public.fisqs_revisions to authenticated;
revoke all on function public.fisqs_register(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.fisqs_register(uuid,jsonb,jsonb) to authenticated;
revoke all on function public.fisqs_revision_guard() from public, anon, authenticated;
create index if not exists fisqs_revisions_reviewed_by on public.fisqs_revisions(reviewed_by);
create index if not exists fisqs_revisions_uploaded_by on public.fisqs_revisions(uploaded_by);
commit;
