begin;

create policy fisqs_products_employee_read
on public.fisqs_products for select to anon
using (true);

create policy fisqs_revisions_employee_read
on public.fisqs_revisions for select to anon
using (true);

create policy fisqs_storage_employee_read
on storage.objects for select to anon
using (bucket_id = 'fisqs' and exists (
  select 1 from public.fisqs_revisions r where r.object_path = name
));

commit;
