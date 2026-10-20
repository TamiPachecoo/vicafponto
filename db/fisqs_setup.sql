-- Additive FISQS setup. Run once on VICAF (xuonzwvqqwbgcedidyie).
-- Does not modify time logs, payroll, employees, inventory or existing policies.
begin;

create table public.fisqs_members (
  user_id uuid primary key references auth.users(id),
  role text not null check (role in ('reader','supervisor','admin')),
  created_at timestamptz not null default now()
);
alter table public.fisqs_members enable row level security;
create policy fisqs_own_membership on public.fisqs_members for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.fisqs_members to authenticated;
revoke all on public.fisqs_members from anon;

create table public.fisqs_products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  manufacturer text not null default '' check (length(manufacturer) <= 200),
  code text not null default '' check (length(code) <= 100),
  component text not null default '' check (length(component) <= 100),
  category text not null default 'Outros' check (length(category) <= 100),
  created_at timestamptz not null default now()
);
create table public.fisqs_revisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.fisqs_products(id),
  kind text not null check (kind in ('safety','technical','certificate','other')),
  version integer not null check (version > 0),
  revision_date date,
  revision_label text not null default '' check (length(revision_label) <= 100),
  original_name text not null check (length(original_name) between 1 and 255),
  object_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  scanned boolean not null default false,
  summary text not null default '' check (length(summary) <= 10000),
  reviewed_by uuid references auth.users(id),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (product_id, kind, version),
  unique (product_id, kind, sha256)
);
create index fisqs_revisions_product on public.fisqs_revisions(product_id, kind, version desc);
alter table public.fisqs_products enable row level security;
alter table public.fisqs_revisions enable row level security;

create policy fisqs_products_read on public.fisqs_products for select to authenticated
  using (exists (select 1 from public.fisqs_members where user_id = (select auth.uid())));
create policy fisqs_products_add on public.fisqs_products for insert to authenticated
  with check (exists (select 1 from public.fisqs_members where user_id = (select auth.uid()) and role in ('supervisor','admin')));
create policy fisqs_revisions_read on public.fisqs_revisions for select to authenticated
  using (exists (select 1 from public.fisqs_members where user_id = (select auth.uid())));
create policy fisqs_revisions_add on public.fisqs_revisions for insert to authenticated
  with check (exists (select 1 from public.fisqs_members where user_id = (select auth.uid()) and role in ('supervisor','admin')));
grant select, insert on public.fisqs_products, public.fisqs_revisions to authenticated;
grant all on public.fisqs_members, public.fisqs_products, public.fisqs_revisions to service_role;
revoke all on public.fisqs_products, public.fisqs_revisions from anon;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('fisqs', 'fisqs', false, 15728640, array['application/pdf']);

create policy fisqs_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'fisqs' and exists (select 1 from public.fisqs_members where user_id = (select auth.uid()))
  and (exists (select 1 from public.fisqs_revisions where object_path = name)
    or (split_part(name, '/', 1) = (select auth.uid())::text
      and exists (select 1 from public.fisqs_members where user_id = (select auth.uid()) and role in ('supervisor','admin'))))
);
create policy fisqs_storage_add on storage.objects for insert to authenticated with check (
  bucket_id = 'fisqs' and split_part(name, '/', 1) = (select auth.uid())::text
  and lower(name) like '%.pdf'
  and exists (select 1 from public.fisqs_members where user_id = (select auth.uid()) and role in ('supervisor','admin'))
);
-- Cleanup is limited to one's own unregistered uploads. Registered revisions cannot be deleted.
create policy fisqs_storage_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'fisqs' and split_part(name, '/', 1) = (select auth.uid())::text
  and not exists (select 1 from public.fisqs_revisions where object_path = name)
  and exists (select 1 from public.fisqs_members where user_id = (select auth.uid()) and role in ('supervisor','admin'))
);

create function public.fisqs_revision_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'FISQS revisions are immutable'; end if;
  if auth.uid() is not null and split_part(new.object_path, '/', 1) <> auth.uid()::text then
    raise exception 'Invalid upload owner';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'fisqs' and name = new.object_path) then
    raise exception 'Upload the PDF before registering its revision';
  end if;
  -- Serialize numbering per product and document type, including concurrent uploads.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.product_id::text || new.kind, 0));
  select coalesce(max(version), 0) + 1 into new.version from public.fisqs_revisions
    where product_id = new.product_id and kind = new.kind;
  new.uploaded_by := auth.uid();
  new.reviewed_by := case when length(trim(new.summary)) > 0 then auth.uid() else null end;
  -- Imports have no reviewer and must not publish a summary.
  if auth.uid() is null and length(trim(new.summary)) > 0 then raise exception 'Summary requires a reviewer'; end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.fisqs_revision_guard() from public;
create trigger fisqs_revision_guard before insert or update or delete on public.fisqs_revisions
for each row execute function public.fisqs_revision_guard();

-- Metadata and revision are committed together, after Storage has accepted the file.
create function public.fisqs_register(p_product_id uuid, p_product jsonb, p_revision jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare target uuid := p_product_id; revision_id uuid;
begin
  if not exists (select 1 from public.fisqs_members where user_id = auth.uid() and role in ('supervisor','admin')) then
    raise exception 'Supervisor access required' using errcode = '42501';
  end if;
  if target is null then
    insert into public.fisqs_products(name, manufacturer, code, component, category)
    values (trim(p_product->>'name'), coalesce(p_product->>'manufacturer',''), coalesce(p_product->>'code',''),
      coalesce(p_product->>'component',''), coalesce(p_product->>'category','Outros')) returning id into target;
  end if;
  insert into public.fisqs_revisions(product_id, kind, version, revision_date, revision_label, original_name, object_path, sha256, scanned, summary)
  values (target, p_revision->>'kind', 1, nullif(p_revision->>'revision_date','')::date,
    coalesce(p_revision->>'revision_label',''), p_revision->>'original_name', p_revision->>'object_path',
    p_revision->>'sha256', coalesce((p_revision->>'scanned')::boolean,false), coalesce(p_revision->>'summary',''))
  returning id into revision_id;
  return revision_id;
end;
$$;
revoke all on function public.fisqs_register(uuid,jsonb,jsonb) from public;
grant execute on function public.fisqs_register(uuid,jsonb,jsonb) to authenticated;
commit;
