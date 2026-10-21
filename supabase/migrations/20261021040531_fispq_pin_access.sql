begin;

-- FISPQ uses an in-memory anonymous Auth session. The four-digit PIN is checked
-- server-side against the existing bcrypt hash and never becomes a browser token.
alter table public.fisqs_members
  add column if not exists employee_id uuid references public.usuario(id);
create index if not exists fisqs_members_employee_id on public.fisqs_members(employee_id);

create or replace function public.fisqs_pin_login(p_employee_name text, p_pin text)
returns table(role text, employee_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  employee_id uuid;
  employee_group text;
  pin_hash text;
  failed_attempts integer;
  locked_until timestamptz;
begin
  if current_user_id is null
     or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Start a temporary FISPQ session before entering a PIN' using errcode = '42501';
  end if;

  select u.id, u.grupo, u.pin
    into employee_id, employee_group, pin_hash
  from public.usuario u
  where u.full_name = trim(p_employee_name) and u.status = 'active';

  if employee_id is null or pin_hash is null then
    raise exception 'PIN inválido' using errcode = '28000';
  end if;

  select l.failed_attempts, l.locked_until
    into failed_attempts, locked_until
  from public.pin_lockout l
  where l.employee_name = trim(p_employee_name);

  if locked_until is not null and locked_until > now() then
    raise exception 'PIN bloqueado temporariamente' using errcode = '28000';
  end if;

  if pin_hash <> extensions.crypt(p_pin, pin_hash) then
    insert into public.pin_lockout(employee_name, failed_attempts, locked_until)
    values (trim(p_employee_name), 1, null)
    on conflict (employee_name) do update
      set failed_attempts = public.pin_lockout.failed_attempts + 1,
          locked_until = case
            when public.pin_lockout.failed_attempts + 1 >= 3 then now() + interval '5 minutes'
            else null
          end;
    raise exception 'PIN inválido' using errcode = '28000';
  end if;

  delete from public.pin_lockout where employee_name = trim(p_employee_name);

  insert into public.fisqs_members(user_id, role, employee_id)
  values (current_user_id,
          case when employee_group = 'supervisor' then 'supervisor' else 'reader' end,
          employee_id)
  on conflict (user_id) do update
    set role = excluded.role,
        employee_id = excluded.employee_id;

  return query select
    case when employee_group = 'supervisor' then 'supervisor' else 'reader' end,
    trim(p_employee_name);
end;
$$;
revoke all on function public.fisqs_pin_login(text, text) from public, anon;
grant execute on function public.fisqs_pin_login(text, text) to authenticated;

commit;
