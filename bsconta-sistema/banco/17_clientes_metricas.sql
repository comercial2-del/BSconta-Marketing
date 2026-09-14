-- ---------------------------------------------------------------------------
-- 17 — Métricas e Histórico do Cliente (11/09/2026)
--
-- O sistema até aqui só enxergava o cliente ATÉ a venda: funil, ligações,
-- reuniões, fechamento. Depois do "ganhou", o cliente sumia. Este bloco cria
-- a outra metade — o que acontece DEPOIS que ele vira cliente.
--
-- TRÊS TABELAS
--   clients        — a carteira. Uma linha por cliente.
--   client_events  — a linha do tempo. Entrada, contato, entrega, feedback,
--                    problema, solução, oportunidade... em ordem de data.
--   client_issues  — problemas e reclamações, com o que foi feito para
--                    resolver. Separado da linha do tempo de propósito: é o
--                    que responde "quantos clientes estão com problema AGORA".
--
-- DE ONDE VÊM OS CLIENTES
-- Toda negociação que vira WON no RD entra sozinha como cliente (gatilho
-- abaixo + carga inicial no fim do arquivo). Ninguém redigita nada. Também dá
-- para cadastrar na mão quem entrou antes do RD ou veio por indicação — é só
-- deixar deal_id nulo.
--
-- O QUE É AUTOMÁTICO E O QUE É DA EQUIPE
--   Automático: existir na lista, nome, empresa, responsável, data de entrada,
--               valor (espelha o RD enquanto ninguém editar aqui), e o
--               registro de toda mudança de situação/valor/status na linha do
--               tempo.
--   Da equipe:  a situação (🟢🟡🔴🔵), os acontecimentos, os problemas e as
--               soluções, as observações.
--
-- Pode rodar mais de uma vez sem problema.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- clients — a carteira
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),

  -- Negociação de origem. Nulo = cliente cadastrado à mão.
  deal_id uuid unique references public.deals(id),

  name text not null,
  company_name text,
  seller_id uuid references public.sellers(id),
  email text,
  phone text,

  -- Valor contratado. Começa espelhando o valor do card no RD; assim que
  -- alguém edita aqui, contract_value_manual vira true e o RD para de
  -- sobrescrever (reajuste feito na mão não é desfeito pela sincronização).
  contract_value numeric not null default 0,
  contract_value_manual boolean not null default false,
  is_recurring boolean not null default false,

  -- Serviços/produtos contratados — texto livre, um por linha.
  services text,

  started_at timestamptz not null default now(),

  -- Status do contrato.
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'ONBOARDING', 'PAUSED', 'CHURNED')),

  -- Situação do atendimento (os quatro indicadores pedidos).
  -- UNSET = ninguém avaliou ainda. É o padrão de propósito: dar "verde" a
  -- quem nunca foi avaliado seria inventar uma satisfação que não existe.
  health text not null default 'UNSET'
    check (health in ('UNSET', 'GREEN', 'YELLOW', 'RED', 'BLUE')),
  health_note text,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  deleted_at timestamptz
);

create index if not exists clients_seller_idx  on public.clients(seller_id);
create index if not exists clients_health_idx  on public.clients(health) where deleted_at is null;
create index if not exists clients_status_idx  on public.clients(status)  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- client_events — a linha do tempo
-- ---------------------------------------------------------------------------
create table if not exists public.client_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,

  kind text not null default 'OBSERVACAO' check (kind in (
    'ENTRADA',      -- entrou na BSconta
    'CONTATO',      -- primeiro contato / contato de relacionamento
    'ENTREGA',      -- entrega feita
    'FEEDBACK',     -- retorno do cliente
    'PROBLEMA',     -- problema identificado
    'SOLUCAO',      -- solução realizada
    'SATISFEITO',   -- cliente satisfeito
    'OPORTUNIDADE', -- oportunidade de crescimento
    'REAJUSTE',     -- mudança de valor contratado
    'SAIDA',        -- encerramento
    'OBSERVACAO'    -- anotação da equipe
  )),

  title text not null,
  description text,
  happened_at timestamptz not null default now(),

  -- Quando o acontecimento mudou a situação do cliente, fica registrado qual
  -- passou a ser — é isso que permite desenhar a evolução da satisfação.
  health_after text check (health_after in ('GREEN', 'YELLOW', 'RED', 'BLUE')),

  -- Preenchido automaticamente por gatilho (mudança de situação/valor/status).
  automatic boolean not null default false,

  author_id uuid references public.profiles(id),
  author_name text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists client_events_client_idx on public.client_events(client_id, happened_at desc);

-- ---------------------------------------------------------------------------
-- client_issues — problemas e soluções
-- ---------------------------------------------------------------------------
create table if not exists public.client_issues (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,

  title text not null,
  description text,
  category text,
  severity text not null default 'MEDIUM' check (severity in ('LOW', 'MEDIUM', 'HIGH')),

  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,

  author_id uuid references public.profiles(id),
  author_name text,
  resolved_by_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists client_issues_client_idx on public.client_issues(client_id, opened_at desc);
create index if not exists client_issues_abertos_idx on public.client_issues(client_id) where resolved_at is null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------

-- Rótulo legível da situação, usado nos textos gravados na linha do tempo.
create or replace function public.client_health_label(p text)
returns text language sql immutable as $$
  select case p
    when 'GREEN'  then 'Cliente satisfeito'
    when 'YELLOW' then 'Precisa de atenção'
    when 'RED'    then 'Cliente com problema'
    when 'BLUE'   then 'Oportunidade de crescimento'
    else 'Sem avaliação'
  end;
$$;

create or replace function public.client_status_label(p text)
returns text language sql immutable as $$
  select case p
    when 'ACTIVE'     then 'Ativo'
    when 'ONBOARDING' then 'Em implantação'
    when 'PAUSED'     then 'Pausado'
    when 'CHURNED'    then 'Encerrado'
    else p
  end;
$$;

-- Todo cliente novo começa a linha do tempo com a própria entrada. Sem isto a
-- página do cliente nasceria vazia e ninguém entenderia para que serve.
create or replace function public.tg_client_entrada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.client_events (client_id, kind, title, happened_at, automatic, author_id, author_name)
  values (new.id, 'ENTRADA', 'Entrada do cliente na BSconta', new.started_at, true, auth.uid(),
          (select p.name from public.profiles p where p.id = auth.uid()));
  return new;
end; $$;

drop trigger if exists on_client_created on public.clients;
create trigger on_client_created after insert on public.clients
  for each row execute procedure public.tg_client_entrada();

-- Mudou a situação, o valor ou o status? Fica registrado na linha do tempo,
-- com quem mudou e quando. É daqui que sai a "evolução da satisfação": cada
-- mudança de cor vira um ponto datado, sem ninguém ter de anotar à mão.
create or replace function public.tg_client_log_mudancas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  select p.name into v_nome from public.profiles p where p.id = auth.uid();

  if new.health is distinct from old.health then
    insert into public.client_events (client_id, kind, title, description, happened_at, health_after, automatic, author_id, author_name)
    values (new.id,
            case new.health when 'RED' then 'PROBLEMA' when 'GREEN' then 'SATISFEITO'
                            when 'BLUE' then 'OPORTUNIDADE' else 'FEEDBACK' end,
            'Situação: ' || public.client_health_label(new.health),
            nullif(new.health_note, ''), now(),
            nullif(new.health, 'UNSET'), true, auth.uid(), v_nome);
  end if;

  if new.contract_value is distinct from old.contract_value then
    insert into public.client_events (client_id, kind, title, description, happened_at, automatic, author_id, author_name)
    values (new.id, 'REAJUSTE', 'Valor contratado alterado',
            'De R$ '   || translate(trim(to_char(old.contract_value, 'FM999,999,990.00')), '.,', ',.') ||
            ' para R$ ' || translate(trim(to_char(new.contract_value, 'FM999,999,990.00')), '.,', ',.'),
            now(), true, auth.uid(), v_nome);
  end if;

  if new.status is distinct from old.status then
    insert into public.client_events (client_id, kind, title, happened_at, automatic, author_id, author_name)
    values (new.id, case new.status when 'CHURNED' then 'SAIDA' else 'OBSERVACAO' end,
            'Status: ' || public.client_status_label(new.status), now(), true, auth.uid(), v_nome);
  end if;

  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists on_client_updated on public.clients;
create trigger on_client_updated before update on public.clients
  for each row execute procedure public.tg_client_log_mudancas();

-- Negociação virou WON no RD -> vira cliente sozinha.
-- E enquanto ninguém tiver editado o valor aqui, ele continua espelhando o RD.
create or replace function public.tg_deal_won_vira_cliente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'WON' and new.deleted_at is null then
    insert into public.clients (deal_id, name, company_name, seller_id, contract_value, is_recurring, started_at)
    values (new.id, new.client_name, new.company_name, new.seller_id, new.value, new.is_recurring,
            coalesce(new.closed_at, new.updated_at, now()))
    on conflict (deal_id) do nothing;

    update public.clients
       set contract_value = new.value,
           company_name   = coalesce(new.company_name, company_name),
           seller_id      = coalesce(new.seller_id, seller_id)
     where deal_id = new.id
       and contract_value_manual = false
       and contract_value is distinct from new.value;
  end if;
  return new;
end; $$;

drop trigger if exists on_deal_won on public.deals;
create trigger on_deal_won after insert or update on public.deals
  for each row execute procedure public.tg_deal_won_vira_cliente();

-- updated_at dos problemas
create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists on_client_issue_updated on public.client_issues;
create trigger on_client_issue_updated before update on public.client_issues
  for each row execute procedure public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Segurança
--
-- Ler: qualquer pessoa logada.
-- Escrever: qualquer pessoa logada — histórico só fica atualizado se for fácil
--           de alimentar, e cada registro guarda quem escreveu e quando.
-- Apagar: só Administrador. Vale tanto para o DELETE de verdade quanto para o
--         "esconder" (deleted_at) — a cláusula `with check` abaixo impede um
--         Visualizador de marcar qualquer linha como apagada.
-- ---------------------------------------------------------------------------
alter table public.clients       enable row level security;
alter table public.client_events enable row level security;
alter table public.client_issues enable row level security;

grant select, insert, update on public.clients       to authenticated;
grant select, insert, update on public.client_events to authenticated;
grant select, insert, update on public.client_issues to authenticated;
grant delete on public.clients, public.client_events, public.client_issues to authenticated;

do $$
declare t text;
begin
  foreach t in array array['clients', 'client_events', 'client_issues'] loop
    execute format('drop policy if exists "ler - %1$s" on public.%1$I', t);
    execute format('create policy "ler - %1$s" on public.%1$I for select to authenticated using (true)', t);

    execute format('drop policy if exists "criar - %1$s" on public.%1$I', t);
    execute format('create policy "criar - %1$s" on public.%1$I for insert to authenticated with check (true)', t);

    execute format('drop policy if exists "editar - %1$s" on public.%1$I', t);
    execute format('create policy "editar - %1$s" on public.%1$I for update to authenticated using (true) with check (deleted_at is null or public.is_admin())', t);

    execute format('drop policy if exists "apagar - %1$s" on public.%1$I', t);
    execute format('create policy "apagar - %1$s" on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Carga inicial — traz para a carteira todas as negociações já ganhas
-- ---------------------------------------------------------------------------
insert into public.clients (deal_id, name, company_name, seller_id, contract_value, is_recurring, started_at)
select d.id, d.client_name, d.company_name, d.seller_id, d.value, d.is_recurring,
       coalesce(d.closed_at, d.updated_at, d.created_at, now())
  from public.deals d
 where d.status = 'WON'
   and d.deleted_at is null
   and not exists (select 1 from public.clients c where c.deal_id = d.id)
on conflict (deal_id) do nothing;

-- Confere: quantos clientes entraram e quantos têm linha do tempo.
select (select count(*) from public.clients where deleted_at is null)       as clientes,
       (select count(*) from public.client_events)                          as eventos,
       (select coalesce(sum(contract_value), 0) from public.clients
         where deleted_at is null and status <> 'CHURNED')                  as valor_carteira;
