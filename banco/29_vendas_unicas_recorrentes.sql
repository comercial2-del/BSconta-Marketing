-- 29_vendas_unicas_recorrentes.sql — vendas únicas x recorrentes (09/10/2026)
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
--
-- Problema: a sincronização lia só os totais do card no RD. Uma negociação com
-- um produto MENSAL e outro de pagamento ÚNICO (ex.: Ingrid Figueira Baeta
-- Neves — R$ 290 mensal + R$ 800 único) virava UMA venda de R$ 1.090 marcada
-- inteira como "Recorrente: Sim". O valor único sumia dentro do recorrente.
--
-- O que este script cria:
--   1) deals.value_unique / deals.value_recurring  — parte única e parte
--      recorrente do card (amount_unique / amount_montly do RD).
--      deals.products_synced_at — quando os produtos do card foram lidos.
--   2) sales.value_unique / sales.value_recurring — a mesma divisão na venda.
--      A venda CONTINUA sendo uma por negociação (metas, ranking e "Vendas
--      realizadas" não mudam de contagem). value = value_unique + value_recurring.
--   3) deal_products — um registro por produto do card no RD. É daqui que a
--      Visão geral e a tela de Vendas montam uma linha por produto.
--
-- Valores nulos = ainda não lidos do RD. A sincronização preenche sozinha as
-- vendas antigas, um lote por execução (ou rode uma sincronização completa:
-- POST na função com o corpo {"full": true}).
--
-- Pode rodar mais de uma vez sem problema. NADA é apagado.

-- 1) Negociações
alter table public.deals add column if not exists value_unique numeric;
alter table public.deals add column if not exists value_recurring numeric;
alter table public.deals add column if not exists products_synced_at timestamptz;

-- 2) Vendas
alter table public.sales add column if not exists value_unique numeric;
alter table public.sales add column if not exists value_recurring numeric;

-- 3) Produtos de cada negociação
create table if not exists public.deal_products (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  rd_deal_product_id text not null,
  rd_product_id text,
  name text not null default 'Produto',
  -- Texto original do RD: 'spare' = pagamento único, 'monthly' = mensal.
  recurrence text,
  is_recurring boolean not null default false,
  quantity numeric not null default 1,
  price numeric not null default 0,
  discount numeric not null default 0,
  discount_type text,
  total numeric not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_products_unico unique (deal_id, rd_deal_product_id)
);
create index if not exists deal_products_deal_idx on public.deal_products(deal_id);

alter table public.deal_products enable row level security;
drop policy if exists "read all - deal_products" on public.deal_products;
create policy "read all - deal_products" on public.deal_products
  for select using (auth.role() = 'authenticated');
drop policy if exists "admin write - deal_products" on public.deal_products;
create policy "admin write - deal_products" on public.deal_products
  for all using (public.is_admin()) with check (public.is_admin());

-- Conferência rápida depois de rodar (e de uma sincronização):
--   select d.client_name, p.name, p.recurrence, p.total
--     from deal_products p join deals d on d.id = p.deal_id
--    where d.client_name ilike 'Ingrid Figueira%';
--   -> Serviços Contábeis | monthly | 290
--      Serviços Contábeis | spare   | 800
