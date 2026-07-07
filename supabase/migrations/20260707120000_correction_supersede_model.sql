-- Correction/time-log fix: supersede model + structured correction audit trail.
--
-- Context: corrections were previously applied by inserting a brand-new time_logs
-- row alongside the original (possibly mislabeled) one. The hour-pairing logic
-- assumes punches strictly alternate clock_in/clock_out, so the leftover
-- duplicate/mislabeled punch broke totals for every corrected day. Going
-- forward, a correction marks the old punch `superseded` (never deleted, kept
-- for audit) and inserts the corrected punch; `correction_log` records what
-- changed and why for the transparency report.

alter table public.time_logs
  add column if not exists superseded boolean not null default false;

-- time_logs previously only had anon INSERT/SELECT policies. Any attempt to
-- edit or void an existing punch in place (the "Edit Day" PATCH path) was
-- silently discarded by RLS with no error surfaced to the UI. The supersede
-- model requires being able to flip `superseded` on an existing row.
create policy "allow_anon_update" on public.time_logs
  for update to anon using (true) with check (true);

create table public.correction_log (
  id uuid primary key default gen_random_uuid(),
  employee text not null,
  date date not null,
  old_time_log_id uuid references public.time_logs(id),
  old_type text,
  old_time timestamptz,
  new_time_log_id uuid references public.time_logs(id),
  new_type text,
  new_time timestamptz,
  reasoning text,
  approved_by text,
  request_id uuid references public.solicitacao_correcao_ponto(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.correction_log enable row level security;

create policy "allow_anon_select" on public.correction_log
  for select to anon using (true);

create policy "allow_anon_insert" on public.correction_log
  for insert to anon with check (true);
