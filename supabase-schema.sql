-- PrintFlow POS schema for Supabase/PostgreSQL.
-- Before deployment, replace the seeded owner@example.com value below with the
-- dedicated shop-owner email. Enable email confirmations in Supabase Auth.

create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.app_role as enum ('super_admin', 'admin', 'staff');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.service_category as enum ('printout', 'photocopy', 'other');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.paper_size as enum ('A4', 'A5', 'none');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.side_type as enum ('single', 'double');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.bill_status as enum ('completed', 'cancellation_pending', 'voided');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.stock_request_status as enum ('pending_approval', 'approved', 'rejected');
exception when duplicate_object then null;
end $$;

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
create table if not exists public.pin_verification_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts integer not null default 0,
  blocked_until timestamptz
);
insert into public.app_settings(key, value)
values ('super_admin_email', 'owner@example.com')
on conflict (key) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text not null default '',
  pin_hash text not null,
  role public.app_role not null default 'staff',
  approval_status public.approval_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category public.service_category not null,
  paper_size public.paper_size not null default 'none',
  side_type public.side_type not null default 'single',
  unit_price numeric(12,2) not null check (unit_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(name, category)
);

create table if not exists public.inventory (
  paper_size public.paper_size primary key check (paper_size in ('A4', 'A5')),
  sheet_count bigint not null default 0 check (sheet_count >= 0),
  updated_at timestamptz not null default now()
);
insert into public.inventory(paper_size, sheet_count)
values ('A4', 0), ('A5', 0)
on conflict (paper_size) do nothing;

create table if not exists public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references auth.users(id) on delete set null,
  paper_size public.paper_size not null check (paper_size in ('A4', 'A5')),
  sheets bigint not null check (sheets > 0),
  note text,
  status public.stock_request_status not null default 'pending_approval',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code varchar(32) not null unique,
  name text not null,
  phone text,
  balance numeric(10,2) not null default 0.00,
  created_at timestamptz not null default now()
);
create sequence if not exists public.customer_code_seq start with 1001;

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  bill_number text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  billed_by uuid,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null default 'Walk-in',
  previous_balance numeric(10,2) not null default 0.00,
  amount_paid numeric(10,2) not null default 0.00,
  new_balance numeric(10,2) not null default 0.00,
  total numeric(12,2) not null check (total >= 0),
  status public.bill_status not null default 'completed',
  cancellation_reason text,
  cancellation_requested_by uuid references auth.users(id) on delete set null,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.bills add column if not exists billed_by uuid;
alter table public.bills add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.bills add column if not exists customer_name text not null default 'Walk-in';
alter table public.bills add column if not exists previous_balance numeric(10,2) not null default 0.00;
alter table public.bills add column if not exists amount_paid numeric(10,2) not null default 0.00;
alter table public.bills add column if not exists new_balance numeric(10,2) not null default 0.00;
alter table public.bills drop constraint if exists bills_customer_id_fkey;
alter table public.bills add constraint bills_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete set null;
alter table public.stock_requests add column if not exists requested_by uuid;
alter table public.stock_requests drop constraint if exists fk_stock_requests_profiles;
alter table public.stock_requests add constraint fk_stock_requests_profiles
  foreign key (requested_by) references public.profiles(id) on delete set null;
alter table public.bills drop constraint if exists fk_bills_profiles;
alter table public.bills add constraint fk_bills_profiles
  foreign key (billed_by) references public.profiles(id) on delete set null;
update public.bills b set billed_by = b.created_by
where b.billed_by is null and exists (select 1 from public.profiles p where p.id = b.created_by);

create table if not exists public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name text not null,
  category public.service_category not null,
  paper_size public.paper_size not null,
  side_type public.side_type not null,
  pages integer not null check (pages > 0),
  copies integer not null check (copies > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  sheets_used bigint not null check (sheets_used >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid()) and approval_status = 'approved'
$$;

create or replace function public.is_approved_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and approval_status = 'approved'
  )
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.current_role() in ('admin', 'super_admin'), false)
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_super_email text;
  v_pin text;
begin
  v_super_email := lower(coalesce(
    (select value from public.app_settings where key = 'super_admin_email'),
    'owner@example.com'
  ));
  v_pin := coalesce(new.raw_user_meta_data ->> 'quick_pin', '');
  if v_pin !~ '^[0-9]{4}$' then
    raise exception 'A valid four-digit quick PIN is required';
  end if;
  insert into public.profiles(id, full_name, email, phone, pin_hash, role, approval_status)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    extensions.crypt(v_pin, extensions.gen_salt('bf')),
    case when lower(new.email) = v_super_email then 'super_admin'::public.app_role else 'staff'::public.app_role end,
    case when lower(new.email) = v_super_email then 'approved'::public.approval_status else 'pending'::public.approval_status end
  );
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'quick_pin' where id = new.id;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

insert into public.services(name, category, paper_size, side_type, unit_price)
values
  ('A4 Printout B/W · Single sided', 'printout', 'A4', 'single', 2.00),
  ('A4 Printout B/W · Double sided', 'printout', 'A4', 'double', 3.00),
  ('A4 Printout Color · Single sided', 'printout', 'A4', 'single', 10.00),
  ('A4 Printout Color · Double sided', 'printout', 'A4', 'double', 18.00),
  ('A5 Printout B/W · Single sided', 'printout', 'A5', 'single', 1.50),
  ('A5 Printout B/W · Double sided', 'printout', 'A5', 'double', 2.50),
  ('A5 Printout Color · Single sided', 'printout', 'A5', 'single', 7.00),
  ('A5 Printout Color · Double sided', 'printout', 'A5', 'double', 12.00),
  ('A4 Photocopy B/W · Single sided', 'photocopy', 'A4', 'single', 1.00),
  ('A4 Photocopy B/W · Double sided', 'photocopy', 'A4', 'double', 1.50),
  ('A4 Photocopy Color · Single sided', 'photocopy', 'A4', 'single', 8.00),
  ('A4 Photocopy Color · Double sided', 'photocopy', 'A4', 'double', 14.00),
  ('A5 Photocopy B/W · Single sided', 'photocopy', 'A5', 'single', 0.75),
  ('A5 Photocopy B/W · Double sided', 'photocopy', 'A5', 'double', 1.25),
  ('A5 Photocopy Color · Single sided', 'photocopy', 'A5', 'single', 6.00),
  ('A5 Photocopy Color · Double sided', 'photocopy', 'A5', 'double', 10.00),
  ('Typesetting', 'other', 'none', 'single', 0.00)
on conflict (name, category) do nothing;

create or replace function public.verify_pos_pin(p_pin text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_attempt public.pin_verification_limits%rowtype;
  v_valid boolean;
begin
  if auth.uid() is null or coalesce(p_pin, '') !~ '^[0-9]{4}$' or not public.is_approved_user() then
    return false;
  end if;
  insert into public.pin_verification_limits(user_id) values (auth.uid())
  on conflict (user_id) do nothing;
  select * into v_attempt from public.pin_verification_limits where user_id = auth.uid() for update;
  if v_attempt.blocked_until is not null and v_attempt.blocked_until > now() then
    return false;
  end if;
  select exists (
    select 1 from public.profiles p
    where p.approval_status = 'approved'
      and (p.id = auth.uid() or p.role in ('admin', 'super_admin'))
      and p.pin_hash = extensions.crypt(p_pin, p.pin_hash)
  ) into v_valid;
  if v_valid then
    delete from public.pin_verification_limits where user_id = auth.uid();
    return true;
  end if;
  update public.pin_verification_limits
  set failed_attempts = failed_attempts + 1,
      blocked_until = case when failed_attempts + 1 >= 10 then now() + interval '15 minutes' else blocked_until end
  where user_id = auth.uid();
  return false;
end
$$;

drop function if exists public.create_bill(jsonb);
create or replace function public.create_bill(
  p_items jsonb,
  p_customer_id uuid default null,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_amount_paid numeric default 0,
  p_save_credit boolean default false,
  p_pin text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_service public.services%rowtype;
  v_customer public.customers%rowtype;
  v_bill_id uuid := gen_random_uuid();
  v_bill_number text;
  v_total numeric(12,2) := 0;
  v_unit_price numeric(12,2);
  v_previous_balance numeric(10,2) := 0;
  v_amount_applied numeric(10,2);
  v_new_balance numeric(10,2) := 0;
  v_has_custom_print_price boolean := false;
  v_pages integer;
  v_copies integer;
  v_line_total numeric(12,2);
  v_sheets bigint;
  v_size public.paper_size;
  v_result_items jsonb := '[]'::jsonb;
begin
  if not public.is_approved_user() then raise exception 'Approved account required'; end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;
  if p_amount_paid is null or p_amount_paid < 0 or p_amount_paid > 99999999 then
    raise exception 'Enter a valid amount paid';
  end if;
  if p_save_credit is null then raise exception 'Choose how to handle overpayment'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Bill items must be a JSON array';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'Bill must contain between 1 and 100 items';
  end if;

  if p_customer_id is not null then
    select * into v_customer from public.customers where id = p_customer_id for update;
    if not found then raise exception 'Selected customer no longer exists'; end if;
    if lower(trim(p_customer_name)) <> lower(v_customer.name) then
      raise exception 'The selected customer name does not match the ledger account';
    end if;
    v_previous_balance := v_customer.balance;
  elsif nullif(trim(p_customer_phone), '') is not null
     and lower(trim(p_customer_name)) not in ('walk-in', 'cash customer') then
    insert into public.customers(customer_code, name, phone)
    values ('CUST-' || nextval('public.customer_code_seq')::text, trim(p_customer_name), trim(p_customer_phone))
    returning * into v_customer;
    p_customer_id := v_customer.id;
  end if;

  v_bill_number := 'PF-' || to_char(clock_timestamp(), 'YYMMDD') || '-' || upper(substr(replace(v_bill_id::text, '-', ''), 1, 8));
  insert into public.bills(id, bill_number, created_by, billed_by, customer_id, customer_name,
    previous_balance, amount_paid, new_balance, total, status)
  values (v_bill_id, v_bill_number, auth.uid(), auth.uid(), p_customer_id, trim(p_customer_name),
    v_previous_balance, p_amount_paid, v_previous_balance, 0, 'completed')
  returning id into v_bill_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item ->> 'service_id', '') !~* '^[0-9a-f-]{36}$'
       or coalesce(v_item ->> 'pages', '') !~ '^[1-9][0-9]{0,6}$'
       or coalesce(v_item ->> 'copies', '') !~ '^[1-9][0-9]{0,5}$' then
      raise exception 'Each item needs a valid service, positive page count, and positive copies';
    end if;
    select * into v_service from public.services
    where id = (v_item ->> 'service_id')::uuid and active;
    if not found then raise exception 'A selected service is no longer available'; end if;
    v_pages := (v_item ->> 'pages')::integer;
    v_copies := (v_item ->> 'copies')::integer;
    if v_pages::bigint * v_copies::bigint > 10000000 then raise exception 'Page/copy quantity is too large'; end if;
    v_unit_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, v_service.unit_price);
    if v_unit_price < 0 or v_unit_price > 999999 then raise exception 'Invalid service price'; end if;
    if v_service.category = 'photocopy' and v_unit_price <> v_service.unit_price then
      raise exception 'Photocopy prices are fixed by the service price configuration';
    end if;
    if v_service.category = 'printout' and v_unit_price <> v_service.unit_price then
      v_has_custom_print_price := true;
    end if;
    v_line_total := v_unit_price * v_pages * v_copies;
    v_total := v_total + v_line_total;
    v_sheets := case
      when v_service.paper_size = 'none' then 0
      when v_service.side_type = 'double' then ceil(v_pages::numeric / 2)::bigint * v_copies
      else v_pages::bigint * v_copies
    end;
    if v_service.paper_size in ('A4', 'A5') then
      insert into public.bill_items(bill_id, service_id, service_name, category, paper_size, side_type, pages, copies, unit_price, line_total, sheets_used)
      values (v_bill_id, v_service.id, v_service.name, v_service.category, v_service.paper_size, v_service.side_type, v_pages, v_copies, v_unit_price, v_line_total, v_sheets);
    else
      insert into public.bill_items(bill_id, service_id, service_name, category, paper_size, side_type, pages, copies, unit_price, line_total, sheets_used)
      values (v_bill_id, v_service.id, v_service.name, v_service.category, v_service.paper_size, v_service.side_type, v_pages, v_copies, v_unit_price, v_line_total, 0);
    end if;
    v_result_items := v_result_items || jsonb_build_array(jsonb_build_object('service', v_service.name, 'pages', v_pages, 'copies', v_copies, 'total', v_line_total, 'sheets', v_sheets));
  end loop;
  if v_has_custom_print_price and not public.verify_pos_pin(p_pin) then
    raise exception 'A valid staff PIN is required for a custom printout price';
  end if;

  for v_size in select paper from (values ('A4'::public.paper_size), ('A5'::public.paper_size)) as sizes(paper) order by paper
  loop
    select coalesce(sum(bi.sheets_used), 0) into v_sheets
    from public.bill_items bi where bi.bill_id = v_bill_id and bi.paper_size = v_size;
    if v_sheets > 0 then
      update public.inventory set sheet_count = sheet_count - v_sheets, updated_at = now()
      where paper_size = v_size and sheet_count >= v_sheets;
      if not found then raise exception 'Insufficient % paper stock', v_size; end if;
    end if;
  end loop;

  v_amount_applied := case
    when p_save_credit then p_amount_paid
    else least(p_amount_paid, greatest(0, v_total + v_previous_balance))
  end;
  v_new_balance := v_previous_balance + v_total - v_amount_applied;
  if p_customer_id is not null then
    update public.customers set balance = v_new_balance where id = p_customer_id;
  end if;
  update public.bills set total = v_total, amount_paid = v_amount_applied, new_balance = v_new_balance
  where id = v_bill_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'bill_created', 'bill', v_bill_id::text, jsonb_build_object('total', v_total, 'items', v_result_items));
  return jsonb_build_object('id', v_bill_id, 'bill_number', v_bill_number, 'total', v_total,
    'previous_balance', v_previous_balance, 'amount_paid', v_amount_applied, 'new_balance', v_new_balance);
end
$$;

create or replace function public.add_paper_stock(p_paper_size public.paper_size, p_sheets bigint, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_status public.stock_request_status;
begin
  if not public.is_approved_user() then raise exception 'Approved account required'; end if;
  if p_paper_size not in ('A4', 'A5') or p_sheets is null or p_sheets < 1 or p_sheets > 10000000 then
    raise exception 'Choose A4 or A5 and enter a valid sheet quantity';
  end if;
  if public.is_admin() then
    update public.inventory set sheet_count = sheet_count + p_sheets, updated_at = now() where paper_size = p_paper_size;
    insert into public.audit_logs(actor_id, action, entity_type, reason, details)
    values (auth.uid(), 'stock_added_directly', 'inventory', p_note, jsonb_build_object('paper_size', p_paper_size, 'sheets', p_sheets));
    v_status := 'approved';
  else
    insert into public.stock_requests(requested_by, paper_size, sheets, note)
    values (auth.uid(), p_paper_size, p_sheets, nullif(trim(p_note), ''))
    returning id into v_request_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'stock_requested', 'stock_request', v_request_id::text, jsonb_build_object('paper_size', p_paper_size, 'sheets', p_sheets));
    v_status := 'pending_approval';
  end if;
  return jsonb_build_object('status', v_status, 'request_id', v_request_id);
end
$$;

create or replace function public.resolve_stock_request(p_request_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_request public.stock_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_approve is null or (not p_approve and nullif(trim(p_reason), '') is null) then
    raise exception 'A reason is required when rejecting a stock request';
  end if;
  select * into v_request from public.stock_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending_approval' then raise exception 'Stock request is no longer pending'; end if;
  update public.stock_requests set status = case when p_approve then 'approved'::public.stock_request_status else 'rejected'::public.stock_request_status end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_reason = nullif(trim(p_reason), '')
  where id = p_request_id;
  if p_approve then
    update public.inventory set sheet_count = sheet_count + v_request.sheets, updated_at = now() where paper_size = v_request.paper_size;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, details)
  values (auth.uid(), case when p_approve then 'stock_request_approved' else 'stock_request_rejected' end, 'stock_request', p_request_id::text, p_reason,
    jsonb_build_object('paper_size', v_request.paper_size, 'sheets', v_request.sheets));
end
$$;

create or replace function public.request_bill_cancellation(p_bill_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_bill public.bills%rowtype;
begin
  if not public.is_approved_user() then raise exception 'Approved account required'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A cancellation reason is required'; end if;
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found or v_bill.created_by <> auth.uid() or v_bill.status <> 'completed' then
    raise exception 'Only your completed bills can be submitted for cancellation';
  end if;
  update public.bills set status = 'cancellation_pending', cancellation_reason = trim(p_reason), cancellation_requested_by = auth.uid()
  where id = p_bill_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason)
  values (auth.uid(), 'bill_cancellation_requested', 'bill', p_bill_id::text, trim(p_reason));
end
$$;

drop function if exists public.search_customers(text);
create or replace function public.search_customers(p_query text)
returns table(id uuid, customer_code varchar, name text, phone text)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_approved_user() then raise exception 'Approved account required'; end if;
  if nullif(trim(p_query), '') is null then return; end if;
  return query
  select c.id, c.customer_code, c.name, c.phone
  from public.customers c
  where c.customer_code ilike '%' || trim(p_query) || '%'
     or c.name ilike '%' || trim(p_query) || '%'
     or coalesce(c.phone, '') ilike '%' || trim(p_query) || '%'
  order by c.name
  limit 20;
end
$$;

create or replace function public.get_customer_balance(p_customer_id uuid)
returns numeric
language plpgsql security definer
set search_path = ''
as $$
declare v_balance numeric(10,2);
begin
  if not public.is_approved_user() then raise exception 'Approved account required'; end if;
  select balance into v_balance from public.customers where id = p_customer_id;
  if not found then raise exception 'Customer no longer exists'; end if;
  return v_balance;
end
$$;

create or replace function public.admin_reset_pin(p_user_id uuid, p_new_pin text, p_admin_pin text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_target public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if coalesce(p_new_pin, '') !~ '^[0-9]{4}$' or not public.verify_pos_pin(p_admin_pin) then
    raise exception 'Enter a valid new four-digit PIN and administrator PIN';
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found or v_target.role = 'super_admin' or v_target.id = auth.uid()
     or (public.current_role() <> 'super_admin' and v_target.role <> 'staff') then
    raise exception 'This account PIN cannot be reset by your role';
  end if;
  update public.profiles set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')) where id = p_user_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'user_pin_reset', 'profile', p_user_id::text, jsonb_build_object('email', v_target.email));
end
$$;

create or replace function public.rollback_bill_stock(p_bill_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_size public.paper_size; v_sheets bigint;
begin
  update public.customers c set balance = c.balance - (b.total - b.amount_paid)
  from public.bills b
  where b.id = p_bill_id and b.customer_id = c.id;
  for v_size in select paper from (values ('A4'::public.paper_size), ('A5'::public.paper_size)) as sizes(paper) order by paper
  loop
    select coalesce(sum(sheets_used), 0) into v_sheets from public.bill_items
    where bill_id = p_bill_id and paper_size = v_size;
    if v_sheets > 0 then
      update public.inventory set sheet_count = sheet_count + v_sheets, updated_at = now() where paper_size = v_size;
    end if;
  end loop;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason)
  values (p_actor, 'bill_voided_stock_rolled_back', 'bill', p_bill_id::text, p_reason);
end
$$;

create or replace function public.void_bill(p_bill_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_bill public.bills%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'A cancellation reason is required'; end if;
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found or v_bill.status not in ('completed', 'cancellation_pending') then raise exception 'Bill cannot be voided in its current status'; end if;
  update public.bills set status = 'voided', cancellation_reason = trim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
  where id = p_bill_id;
  perform public.rollback_bill_stock(p_bill_id, trim(p_reason), auth.uid());
end
$$;

create or replace function public.resolve_bill_cancellation(p_bill_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_bill public.bills%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_approve is null or (not p_approve and nullif(trim(p_reason), '') is null) then
    raise exception 'A reason is required when rejecting a cancellation';
  end if;
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found or v_bill.status <> 'cancellation_pending' then raise exception 'Cancellation request is no longer pending'; end if;
  if p_approve then
    update public.bills set status = 'voided', cancelled_by = auth.uid(), cancelled_at = now()
    where id = p_bill_id;
    perform public.rollback_bill_stock(p_bill_id, v_bill.cancellation_reason, auth.uid());
  else
    update public.bills set status = 'completed', cancellation_reason = null, cancellation_requested_by = null
    where id = p_bill_id;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason)
    values (auth.uid(), 'bill_cancellation_rejected', 'bill', p_bill_id::text, trim(p_reason));
  end if;
end
$$;

create or replace function public.admin_review_account(p_user_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_target public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_approve is null or (not p_approve and nullif(trim(p_reason), '') is null) then
    raise exception 'A reason is required when rejecting an account';
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found or v_target.role = 'super_admin' or v_target.approval_status <> 'pending' then
    raise exception 'Account is not eligible for review';
  end if;
  update public.profiles
  set approval_status = case when p_approve then 'approved'::public.approval_status else 'rejected'::public.approval_status end
  where id = p_user_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, details)
  values (
    auth.uid(),
    case when p_approve then 'account_approved' else 'account_rejected' end,
    'profile',
    p_user_id::text,
    nullif(trim(p_reason), ''),
    jsonb_build_object('email', v_target.email)
  );
end
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_pin text, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_target public.profiles%rowtype;
begin
  if public.current_role() <> 'super_admin' then raise exception 'Super administrator access required'; end if;
  if p_role not in ('admin', 'staff') or not public.verify_pos_pin(p_pin) or nullif(trim(p_reason), '') is null then
    raise exception 'Choose a valid role and provide a valid PIN and reason';
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found or v_target.role = 'super_admin' or v_target.id = auth.uid() then
    raise exception 'The super administrator cannot be modified';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, details)
  values (auth.uid(), 'user_role_changed', 'profile', p_user_id::text, trim(p_reason), jsonb_build_object('old_role', v_target.role, 'new_role', p_role));
end
$$;

create or replace function public.admin_delete_user(p_user_id uuid, p_pin text, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_target public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if not public.verify_pos_pin(p_pin) or nullif(trim(p_reason), '') is null then raise exception 'Valid administrator PIN and deletion reason are required'; end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found or v_target.role = 'super_admin' or v_target.id = auth.uid()
     or (public.current_role() <> 'super_admin' and v_target.role <> 'staff') then
    raise exception 'This account cannot be deleted by your role';
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, reason, details)
  values (auth.uid(), 'user_deleted', 'profile', p_user_id::text, trim(p_reason), jsonb_build_object('email', v_target.email, 'role', v_target.role));
  delete from auth.users where id = p_user_id;
end
$$;

alter table public.app_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.inventory enable row level security;
alter table public.stock_requests enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.audit_logs enable row level security;
alter table public.pin_verification_limits enable row level security;
alter table public.customers enable row level security;

drop policy if exists profiles_read_approved on public.profiles;
create policy profiles_read_approved on public.profiles for select to authenticated
using (public.is_approved_user() and (id = auth.uid() or public.is_admin()));
drop policy if exists profiles_admin_approval on public.profiles;
revoke update on public.profiles from authenticated;

drop policy if exists services_read_approved on public.services;
create policy services_read_approved on public.services for select to authenticated
using (public.is_approved_user());
drop policy if exists services_manage_admin on public.services;
create policy services_manage_admin on public.services for update to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists services_insert_admin on public.services;
create policy services_insert_admin on public.services for insert to authenticated
with check (public.is_admin() and category = 'other' and paper_size = 'none');

drop policy if exists inventory_read_approved on public.inventory;
create policy inventory_read_approved on public.inventory for select to authenticated
using (public.is_approved_user());

drop policy if exists stock_requests_read on public.stock_requests;
create policy stock_requests_read on public.stock_requests for select to authenticated
using (public.is_approved_user() and (requested_by = auth.uid() or public.is_admin()));

drop policy if exists bills_read_authorized on public.bills;
create policy bills_read_authorized on public.bills for select to authenticated
using (public.is_approved_user() and (created_by = auth.uid() or public.is_admin()));

drop policy if exists customers_admin_read on public.customers;
create policy customers_admin_read on public.customers for select to authenticated
using (public.is_admin());

drop policy if exists bill_items_read_authorized on public.bill_items;
create policy bill_items_read_authorized on public.bill_items for select to authenticated
using (exists (
  select 1 from public.bills b where b.id = bill_id
  and (b.created_by = auth.uid() or public.is_admin())
));

drop policy if exists audit_logs_read_admin on public.audit_logs;
create policy audit_logs_read_admin on public.audit_logs for select to authenticated
using (public.is_admin());

revoke all on public.app_settings, public.audit_logs, public.pin_verification_limits from anon, authenticated;
revoke select on public.profiles from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.inventory, public.stock_requests, public.bills, public.bill_items, public.customers from anon, authenticated;
revoke insert, update, delete on public.services from anon, authenticated;
revoke select on public.customers from anon, authenticated;
grant select (id, full_name, email, phone, role, approval_status, created_at, updated_at) on public.profiles to authenticated;
grant select on public.services, public.inventory, public.stock_requests, public.bills, public.bill_items to authenticated;
grant update (unit_price, active, name, category, paper_size, side_type) on public.services to authenticated;
grant insert (name, category, paper_size, side_type, unit_price, active) on public.services to authenticated;
grant select on public.customers to authenticated;
grant select on public.audit_logs to authenticated;

revoke all on function public.current_role() from public, anon;
revoke all on function public.is_approved_user() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.verify_pos_pin(text) from public, anon;
revoke all on function public.create_bill(jsonb, uuid, text, text, numeric, boolean, text) from public, anon;
revoke all on function public.add_paper_stock(public.paper_size, bigint, text) from public, anon;
revoke all on function public.resolve_stock_request(uuid, boolean, text) from public, anon;
revoke all on function public.request_bill_cancellation(uuid, text) from public, anon;
revoke all on function public.rollback_bill_stock(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.void_bill(uuid, text) from public, anon;
revoke all on function public.resolve_bill_cancellation(uuid, boolean, text) from public, anon;
revoke all on function public.admin_review_account(uuid, boolean, text) from public, anon;
revoke all on function public.admin_set_role(uuid, public.app_role, text, text) from public, anon;
revoke all on function public.admin_delete_user(uuid, text, text) from public, anon;
revoke all on function public.search_customers(text) from public, anon;
revoke all on function public.get_customer_balance(uuid) from public, anon;
revoke all on function public.admin_reset_pin(uuid, text, text) from public, anon;
grant execute on function public.current_role() to authenticated;
grant execute on function public.is_approved_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.verify_pos_pin(text) to authenticated;
grant execute on function public.create_bill(jsonb, uuid, text, text, numeric, boolean, text) to authenticated;
grant execute on function public.add_paper_stock(public.paper_size, bigint, text) to authenticated;
grant execute on function public.resolve_stock_request(uuid, boolean, text) to authenticated;
grant execute on function public.request_bill_cancellation(uuid, text) to authenticated;
grant execute on function public.void_bill(uuid, text) to authenticated;
grant execute on function public.resolve_bill_cancellation(uuid, boolean, text) to authenticated;
grant execute on function public.admin_review_account(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role, text, text) to authenticated;
grant execute on function public.admin_delete_user(uuid, text, text) to authenticated;
grant execute on function public.search_customers(text) to authenticated;
grant execute on function public.get_customer_balance(uuid) to authenticated;
grant execute on function public.admin_reset_pin(uuid, text, text) to authenticated;

-- Setup after running this file:
-- 1. Replace app_settings.super_admin_email with the owner's exact email.
-- 2. Set Authentication > URL Configuration > Site URL and redirect URLs.
-- 3. Enable email confirmations and configure SMTP in Supabase Auth.
-- 4. Put the project URL and anon/public key into app.js. Never use a service-role key in the browser.

NOTIFY pgrst, 'reload schema';
