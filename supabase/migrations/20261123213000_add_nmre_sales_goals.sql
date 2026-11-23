create table if not exists public.nmre_sales_goals (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  daily_calls_target integer not null default 15 check (daily_calls_target between 0 and 1000),
  weekly_conversations_target integer not null default 10 check (weekly_conversations_target between 0 and 1000),
  weekly_appointments_target integer not null default 3 check (weekly_appointments_target between 0 and 1000),
  weekly_valuations_target integer not null default 2 check (weekly_valuations_target between 0 and 1000),
  weekly_mandates_target integer not null default 1 check (weekly_mandates_target between 0 and 1000),
  updated_at timestamptz not null default now()
);

alter table public.nmre_sales_goals enable row level security;

drop policy if exists "Users can view their own sales goals" on public.nmre_sales_goals;
create policy "Users can view their own sales goals"
  on public.nmre_sales_goals for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can insert their own sales goals" on public.nmre_sales_goals;
create policy "Users can insert their own sales goals"
  on public.nmre_sales_goals for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update their own sales goals" on public.nmre_sales_goals;
create policy "Users can update their own sales goals"
  on public.nmre_sales_goals for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select, insert, update on public.nmre_sales_goals to authenticated;