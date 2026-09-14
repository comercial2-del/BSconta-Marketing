-- SGCMP — BSconta — Supabase (Postgres) schema
-- Cole este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema (usa "if not exists" / "or replace").

-- ---------------------------------------------------------------------------
-- Extensão para gerar UUID
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Vendedores
-- ---------------------------------------------------------------------------
create table if not exists sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  rd_station_user_id text unique,
  calendar_account text,
  color_tag text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Perfis de acesso (ligado ao auth.users do Supabase)
-- role: ADMIN (Administrador/Alimentador) | VIEWER (Visualizador/Gestor)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'VIEWER' check (role in ('ADMIN', 'VIEWER')),
  seller_id uuid references sellers(id),
  created_at timestamptz not null default now()
);

-- Cria automaticamente um perfil (VIEWER) sempre que um novo usuário for
-- criado no Supabase Auth. Depois disso, promova para ADMIN manualmente
-- (veja o passo-a-passo — UPDATE profiles set role = 'ADMIN' where ...).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), 'VIEWER')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Funil / Etapas
-- ---------------------------------------------------------------------------
create table if not exists stages (
  id uuid primary key default gen_random_uuid(),
  rd_stage_id text unique,
  name text not null,
  funnel_name text not null default 'Vendas',
  "order" integer not null,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Oportunidades (deals)
-- status: OPEN | WON | LOST
-- ---------------------------------------------------------------------------
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  rd_deal_id text unique,
  client_name text not null,
  company_name text,
  seller_id uuid references sellers(id),
  stage_id uuid references stages(id),
  value numeric not null default 0,
  status text not null default 'OPEN' check (status in ('OPEN', 'WON', 'LOST')),
  probability integer,
  origin text,
  expected_close_date timestamptz,
  closed_at timestamptz,
  last_interaction_at timestamptz,
  next_activity_at timestamptz,
  loss_reason text,
  is_recurring boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_seller_idx on deals(seller_id);
create index if not exists deals_stage_idx on deals(stage_id);
create index if not exists deals_status_idx on deals(status);

-- ---------------------------------------------------------------------------
-- Atividades (ligações e reuniões)
-- ---------------------------------------------------------------------------
create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('CALL', 'MEETING')),
  subtype text not null default 'OTHER' check (subtype in (
    'SALES_CALL','GENERIC_CALL','COMMERCIAL_MEETING','SALES_MEETING',
    'PROPOSAL_MEETING','FOLLOW_UP','CONFIRMED_MEETING','TRAINING','OTHER'
  )),
  source text not null default 'CALENDAR' check (source in ('RD_STATION','CALENDAR','MANUAL')),
  external_id text unique,
  deal_id uuid references deals(id),
  seller_id uuid references sellers(id),
  calendar_account text,
  title text,
  scheduled_at timestamptz not null,
  status text not null default 'SCHEDULED' check (status in (
    'SCHEDULED','DONE','NO_SHOW','CANCELED','RESCHEDULED','DECLINED'
  )),
  has_note boolean not null default false,
  attended boolean,
  duplicate_of_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists activities_seller_idx on activities(seller_id);
create index if not exists activities_scheduled_idx on activities(scheduled_at);
create index if not exists activities_type_subtype_idx on activities(type, subtype);
create index if not exists activities_status_idx on activities(status);

-- ---------------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------------
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  seller_id uuid references sellers(id),
  value numeric not null,
  margin numeric,
  is_recurring boolean not null default false,
  closed_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sales_seller_idx on sales(seller_id);
create index if not exists sales_closed_idx on sales(closed_at);

-- ---------------------------------------------------------------------------
-- Metas
-- period: WEEK | MONTH
-- metric: CALLS | SALES_CALLS | MEETINGS | MEETINGS_HELD | PROPOSALS | SALES | REVENUE
-- ---------------------------------------------------------------------------
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  period text not null check (period in ('WEEK', 'MONTH')),
  metric text not null check (metric in (
    'CALLS','SALES_CALLS','MEETINGS','MEETINGS_HELD','PROPOSALS','SALES','REVENUE'
  )),
  seller_id uuid references sellers(id),
  target_value numeric not null,
  period_start timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists goals_seller_period_idx on goals(seller_id, period);

-- ---------------------------------------------------------------------------
-- Sincronizações (para quando RD Station / Agenda forem conectados)
-- ---------------------------------------------------------------------------
create table if not exists sync_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('RD_STATION', 'CALENDAR')),
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCESS','ERROR')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_synced integer not null default 0,
  error text
);

-- ---------------------------------------------------------------------------
-- Segurança (Row Level Security)
-- Qualquer usuário logado pode LER tudo. Só ADMIN pode escrever.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'ADMIN'
  );
$$ language sql security definer stable;

alter table sellers enable row level security;
alter table profiles enable row level security;
alter table stages enable row level security;
alter table deals enable row level security;
alter table activities enable row level security;
alter table sales enable row level security;
alter table goals enable row level security;
alter table sync_logs enable row level security;

drop policy if exists "read all - sellers" on sellers;
create policy "read all - sellers" on sellers for select using (auth.role() = 'authenticated');
drop policy if exists "admin write - sellers" on sellers;
create policy "admin write - sellers" on sellers for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read own or admin - profiles" on profiles;
create policy "read own or admin - profiles" on profiles for select using (auth.role() = 'authenticated');

drop policy if exists "read all - stages" on stages;
create policy "read all - stages" on stages for select using (auth.role() = 'authenticated');
drop policy if exists "admin write - stages" on stages;
create policy "admin write - stages" on stages for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read all - deals" on deals;
create policy "read all - deals" on deals for select using (auth.role() = 'authenticated');
drop policy if exists "admin write - deals" on deals;
create policy "admin write - deals" on deals for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read all - activities" on activities;
create policy "read all - activities" on activities for select using (auth.role() = 'authenticated');
drop policy if exists "admin write - activities" on activities;
create policy "admin write - activities" on activities for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read all - sales" on sales;
create policy "read all - sales" on sales for select using (auth.role() = 'authenticated');
drop policy if exists "admin write - sales" on sales;
create policy "admin write - sales" on sales for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read all - goals" on goals;
create policy "read all - goals" on goals for select using (auth.role() = 'authenticated');
drop policy if exists "admin write - goals" on goals;
create policy "admin write - goals" on goals for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read all - sync_logs" on sync_logs;
create policy "read all - sync_logs" on sync_logs for select using (auth.role() = 'authenticated');
drop policy if exists "admin write - sync_logs" on sync_logs;
create policy "admin write - sync_logs" on sync_logs for all using (public.is_admin()) with check (public.is_admin());
