-- FISQS tab: technical / safety data sheets uploaded and managed from the app.
--
-- Files live in the public `fisqs` storage bucket; `public.fisqs` holds the
-- list shown in the tab. Anyone can read. Every write goes through the
-- fisqs_* RPCs below, which check the admin password server-side against a
-- bcrypt hash, so the password never ships in the page and the anon key alone
-- cannot add, rename or delete documents.
--
-- Storage writes are gated the same way: fisqs_begin_upload (password
-- checked) creates an unguessable path, and the storage insert policy only
-- accepts uploads to a path issued that way in the last 15 minutes.
-- fisqs_delete (password checked) queues the path, and the storage delete
-- policy only allows deleting queued paths.
--
-- After applying, set the admin password once (SQL editor):
--   select private.fisqs_set_admin_password('<senha do administrador>');

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table if not exists private.fisqs_settings (
  id boolean primary key default true check (id),
  admin_password_hash text not null
);

create table if not exists private.fisqs_pending_deletes (
  path text primary key,
  created_at timestamptz not null default now()
);

create table public.fisqs (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 1 and 200),
  arquivo_path text not null unique,
  tipo text not null,
  tamanho bigint not null check (tamanho > 0),
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fisqs enable row level security;

-- Read-only for the app; writes happen only inside the fisqs_* RPCs.
revoke all on public.fisqs from anon, authenticated;
grant select on public.fisqs to anon, authenticated;

create policy "allow_anon_select_ready" on public.fisqs
  for select to anon, authenticated using (ready);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fisqs', 'fisqs', true, 52428800,
  array['application/pdf', 'image/jpeg', 'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

-- ── Helpers (private schema is not exposed through the API) ──

create or replace function private.fisqs_set_admin_password(p_senha text)
returns void language sql security definer set search_path = '' as $$
  insert into private.fisqs_settings (id, admin_password_hash)
  values (true, extensions.crypt(p_senha, extensions.gen_salt('bf')))
  on conflict (id) do update set admin_password_hash = excluded.admin_password_hash;
$$;
revoke all on function private.fisqs_set_admin_password(text) from public, anon, authenticated;

create or replace function private.fisqs_assert_admin(p_senha text)
returns void language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  select admin_password_hash into h from private.fisqs_settings where id;
  if h is null or p_senha is null or extensions.crypt(p_senha, h) <> h then
    raise exception 'senha_incorreta' using errcode = '28P01';
  end if;
end $$;
revoke all on function private.fisqs_assert_admin(text) from public, anon, authenticated;

create or replace function private.fisqs_can_upload(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.fisqs
    where arquivo_path = p_name and not ready
      and created_at > now() - interval '15 minutes'
  );
$$;

create or replace function private.fisqs_can_delete(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.fisqs_pending_deletes where path = p_name);
$$;

grant usage on schema private to anon, authenticated;
revoke all on function private.fisqs_can_upload(text), private.fisqs_can_delete(text) from public;
grant execute on function private.fisqs_can_upload(text), private.fisqs_can_delete(text) to anon, authenticated;

create policy "fisqs_anon_select" on storage.objects
  for select to anon, authenticated using (bucket_id = 'fisqs');

create policy "fisqs_anon_insert_issued_path" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'fisqs' and private.fisqs_can_upload(name));

create policy "fisqs_anon_delete_queued_path" on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'fisqs' and private.fisqs_can_delete(name));

-- ── Public RPCs ──

create or replace function public.fisqs_check_admin(p_senha text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.fisqs_assert_admin(p_senha);
  return true;
exception when sqlstate '28P01' then
  return false;
end $$;

create or replace function public.fisqs_begin_upload(
  p_senha text, p_nome text, p_ext text, p_tipo text, p_tamanho bigint
) returns table (id uuid, arquivo_path text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_ext text := lower(p_ext);
begin
  perform private.fisqs_assert_admin(p_senha);
  if v_ext not in ('pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx') then
    raise exception 'tipo_nao_permitido';
  end if;
  -- Drop abandoned uploads (row created, file never confirmed).
  delete from public.fisqs f where not f.ready and f.created_at < now() - interval '1 day';
  insert into public.fisqs (id, nome, arquivo_path, tipo, tamanho)
  values (v_id, btrim(p_nome), v_id::text || '.' || v_ext, upper(v_ext), p_tamanho);
  return query select v_id, v_id::text || '.' || v_ext;
end $$;

create or replace function public.fisqs_finish_upload(p_senha text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.fisqs_assert_admin(p_senha);
  update public.fisqs f set ready = true, updated_at = now()
  where f.id = p_id and exists (
    select 1 from storage.objects o where o.bucket_id = 'fisqs' and o.name = f.arquivo_path
  );
  if not found then raise exception 'arquivo_nao_encontrado'; end if;
end $$;

create or replace function public.fisqs_rename(p_senha text, p_id uuid, p_nome text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.fisqs_assert_admin(p_senha);
  update public.fisqs set nome = btrim(p_nome), updated_at = now() where id = p_id;
  if not found then raise exception 'documento_nao_encontrado'; end if;
end $$;

-- Removes the document from the list and returns its file path; the page then
-- deletes the file from storage (allowed only for queued paths).
create or replace function public.fisqs_delete(p_senha text, p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  perform private.fisqs_assert_admin(p_senha);
  delete from public.fisqs where id = p_id returning arquivo_path into v_path;
  if v_path is null then raise exception 'documento_nao_encontrado'; end if;
  insert into private.fisqs_pending_deletes (path) values (v_path) on conflict do nothing;
  return v_path;
end $$;

revoke all on function
  public.fisqs_check_admin(text),
  public.fisqs_begin_upload(text, text, text, text, bigint),
  public.fisqs_finish_upload(text, uuid),
  public.fisqs_rename(text, uuid, text),
  public.fisqs_delete(text, uuid)
from public;
grant execute on function
  public.fisqs_check_admin(text),
  public.fisqs_begin_upload(text, text, text, text, bigint),
  public.fisqs_finish_upload(text, uuid),
  public.fisqs_rename(text, uuid, text),
  public.fisqs_delete(text, uuid)
to anon, authenticated;
