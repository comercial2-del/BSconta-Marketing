-- ===========================================================================
-- SGCMP — BSconta — 15: sincronizar EXCLUSÕES (RD Station + Agenda)
--
-- Problema: a sincronização só inseria e atualizava. Se você apagava uma
-- reunião da Agenda ou um card no RD, o registro ficava no sistema para
-- sempre, continuando a contar nos indicadores.
--
-- Solução: uma coluna `deleted_at`. Quando o registro desaparece da origem,
-- ele recebe a data/hora e a tela deixa de mostrá-lo — some dos contadores,
-- das listas e dos gráficos, exatamente como você pediu.
--
-- Por que MARCAR em vez de APAGAR de verdade:
--   Se alguém apagar um card no RD por engano (ou o RD/Google devolver uma
--   resposta incompleta), apagar aqui seria perda definitiva. Marcado, o
--   registro sai da tela mas continua no banco — e se voltar na origem, a
--   marca é limpa automaticamente e ele reaparece. Nada se perde.
--
-- Rodar em: Supabase > SQL Editor. Não apaga nada.
-- ===========================================================================

-- Atividades (reuniões e ligações — Agenda e RD)
alter table public.activities add column if not exists deleted_at timestamptz;
create index if not exists activities_deleted_at_idx on public.activities (deleted_at);

-- Negociações (cards do RD)
alter table public.deals add column if not exists deleted_at timestamptz;
create index if not exists deals_deleted_at_idx on public.deals (deleted_at);

comment on column public.activities.deleted_at is
  'Preenchido quando o evento deixou de existir na origem (apagado na Agenda / no RD). A tela esconde registros com este campo preenchido. Volta a nulo se o evento reaparecer na origem.';
comment on column public.deals.deleted_at is
  'Preenchido quando o card deixou de existir no RD Station. A tela esconde negociações com este campo preenchido. Volta a nulo se o card reaparecer.';

-- ---------------------------------------------------------------------------
-- Controle da varredura que detecta cards apagados no RD.
--   ultima_varredura_exclusoes_rd = quando a última varredura completa passou
--   total_negociacoes_rd          = quantas negociações o RD tinha na ocasião
-- O total é o truque que deixa isso rápido: uma chamada barata compara o
-- número de negociações; se ele não mudou, ninguém apagou nada e a varredura
-- completa (pesada) é dispensada.
-- ---------------------------------------------------------------------------
create table if not exists public.sync_state (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

comment on table public.sync_state is
  'Chave/valor de controle da sincronização. Ex.: ultima_varredura_exclusoes_rd = timestamp da última passagem completa que checou cards apagados.';

-- Permissões (as Edge Functions usam a service_role)
grant all on table public.sync_state to service_role;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select 'activities.deleted_at' as coluna,
       case when exists (select 1 from information_schema.columns
                          where table_name='activities' and column_name='deleted_at')
            then 'OK' else 'FALTANDO' end as situacao
union all
select 'deals.deleted_at',
       case when exists (select 1 from information_schema.columns
                          where table_name='deals' and column_name='deleted_at')
            then 'OK' else 'FALTANDO' end
union all
select 'tabela sync_state',
       case when exists (select 1 from information_schema.tables
                          where table_name='sync_state')
            then 'OK' else 'FALTANDO' end
union all
select 'registros já marcados como excluídos',
       (select (count(*) filter (where deleted_at is not null))::text from public.activities);
