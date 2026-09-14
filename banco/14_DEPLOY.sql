-- ===========================================================================
-- SGCMP — BSconta — 14: DEPLOY (rodar TUDO de uma vez)
--
-- Este arquivo junta, na ordem certa, o que precisa ir para o banco:
--   PARTE 1 — índice único que faltava em sales  (obrigatório: sem ele as
--             VENDAS nunca importam)
--   PARTE 2 — upsert que não perde mais o vínculo da atividade com a
--             negociação (obrigatório: sem ele "Ligações de vendas" cai sozinho)
--   PARTE 3 — reclassificar ligações que estão gravadas como reunião
--             (opcional: a tela já mostra certo sem isto)
--   PARTE 4 — acelerar o agendamento: RD 5 min, Agenda 1 min
--             (precisa que você cole a sua SERVICE_ROLE_KEY)
--
-- NADA É APAGADO em nenhuma das partes.
--
-- Como rodar: Supabase > SQL Editor > New query > cole tudo > Run.
-- Testado contra PostgreSQL 16 antes de ser entregue.
-- ===========================================================================


-- ===========================================================================
-- PARTE 1 — O índice único que faltava em sales   ⚠️ OBRIGATÓRIO
--
-- A Edge Function grava vendas com upsert(..., { onConflict: "deal_id" }),
-- e isso exige um índice único em sales(deal_id). Sem o índice, o Postgres
-- devolve o erro 42P10 e — no código antigo — a sincronização INTEIRA era
-- abortada: negociações, ligações e reuniões paravam junto. É a causa de
-- "marquei a venda no RD e não veio".
-- ===========================================================================
create unique index if not exists sales_deal_id_uidx on public.sales (deal_id);


-- ===========================================================================
-- PARTE 2 — Não perder o vínculo da atividade com a negociação   ⚠️ OBRIGATÓRIO
--
-- O deal_id de cada tarefa vinha de um cache que só tem as negociações
-- processadas na execução atual. Numa sincronização incremental esse cache
-- vem quase vazio, e o upsert gravava deal_id = NULL por cima do vínculo que
-- já existia — rebaixando SALES_CALL para GENERIC_CALL e derrubando o KPI
-- "Ligações de vendas" sozinho, sem ninguém mexer em nada.
-- ===========================================================================
create or replace function upsert_rd_activities(p_rows jsonb)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.activities (
    type, subtype, source, external_id, deal_id, seller_id, title,
    scheduled_at, status, has_note, notes, updated_at
  )
  select
    r->>'type',
    r->>'subtype',
    r->>'source',
    r->>'external_id',
    nullif(r->>'deal_id', '')::uuid,
    nullif(r->>'seller_id', '')::uuid,
    r->>'title',
    (r->>'scheduled_at')::timestamptz,
    r->>'status',
    coalesce((r->>'has_note')::boolean, false),
    r->>'notes',
    coalesce((r->>'updated_at')::timestamptz, now())
  from jsonb_array_elements(p_rows) as r
  on conflict (external_id) where source = 'RD_STATION'
  do update set
    type = excluded.type,
    -- Não rebaixa uma ligação de vendas já identificada.
    subtype = case
      when excluded.deal_id is null
       and activities.subtype = 'SALES_CALL'
       and excluded.subtype = 'GENERIC_CALL'
        then activities.subtype
      else excluded.subtype
    end,
    -- Mantém o vínculo existente quando a sincronização vier sem deal_id.
    deal_id = coalesce(excluded.deal_id, activities.deal_id),
    seller_id = coalesce(excluded.seller_id, activities.seller_id),
    title = excluded.title,
    scheduled_at = excluded.scheduled_at,
    status = excluded.status,
    has_note = excluded.has_note,
    notes = excluded.notes,
    updated_at = excluded.updated_at;
end;
$$;

grant execute on function upsert_rd_activities(jsonb) to service_role;


-- ===========================================================================
-- PARTE 3 — Reclassificar ligações gravadas como reunião   (opcional)
--
-- A versão antiga da sync-calendar gravava TODO evento importado da Agenda
-- como type = 'MEETING', inclusive os chamados "Ligação – Follow-up". A tela
-- já corrige isso na exibição (js/calc.js classifica pelo título), então esta
-- parte é só para deixar o BANCO coerente com a tela.
--
-- Só o type/subtype muda. Nenhuma linha é apagada.
-- ===========================================================================

-- Remove acentos sem depender da extensão unaccent.
create or replace function public.sgcmp_sem_acento(txt text)
returns text
language sql
immutable
as $$
  select translate(
    coalesce(txt, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  );
$$;

create or replace function public.sgcmp_norm(txt text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(public.sgcmp_sem_acento(coalesce(txt, ''))), '\s+', ' ', 'g');
$$;

-- 'CALL' | 'MEETING' | 'OTHER' — mesma regra do js/calc.js (activityKind).
create or replace function public.sgcmp_tipo_pelo_titulo(txt text)
returns text
language sql
immutable
as $$
  select case
    when public.sgcmp_norm(txt) ~ '(ligacao|ligacoes|ligar |chamada|telefonema|telefonico|\mcalls?\M)' then 'CALL'
    when public.sgcmp_norm(txt) ~ '(ia/gabriel|reuniao ia)' then 'OTHER'
    when public.sgcmp_norm(txt) like 'reuniao%' or public.sgcmp_norm(txt) like '%bsconta x%' then 'MEETING'
    else 'OTHER'
  end;
$$;

-- 3a) CONFERÊNCIA — o resultado aparece na aba de resultados do SQL Editor.
select
  public.sgcmp_tipo_pelo_titulo(title) as classificacao_correta,
  type                                  as type_gravado,
  count(*)                              as qtd,
  (array_agg(title order by scheduled_at desc))[1:4] as exemplos
from public.activities
where source = 'CALENDAR'
group by 1, 2
order by 1, 2;

-- 3b) Ligações que estavam gravadas como reunião -> viram CALL.
update public.activities
   set type = 'CALL',
       subtype = case when public.sgcmp_norm(title) like '%venda%' then 'SALES_CALL' else 'GENERIC_CALL' end,
       updated_at = now()
 where source = 'CALENDAR'
   and type <> 'CALL'
   and public.sgcmp_tipo_pelo_titulo(title) = 'CALL';

-- 3c) Compromissos internos (ex.: "Reunião IA/Gabriel") saem dos indicadores,
--     mas continuam guardados.
update public.activities
   set type = 'OTHER',
       updated_at = now()
 where source = 'CALENDAR'
   and type = 'MEETING'
   and public.sgcmp_tipo_pelo_titulo(title) = 'OTHER';


-- ===========================================================================
-- PARTE 4 — Acelerar o agendamento: RD 5 min | Agenda 1 min
--
-- ⚠️  DUAS COISAS ANTES DE RODAR ESTA PARTE:
--     1) Publique as duas Edge Functions primeiro. Elas ganharam uma trava
--        anti-sobreposição; sem ela, acelerar faz duas execuções gravarem as
--        mesmas linhas ao mesmo tempo.
--     2) Troque os dois SUA_SERVICE_ROLE_KEY abaixo pela sua chave
--        (Supabase > Project Settings > API > service_role).
--
-- Se preferir deixar o agendamento como está por enquanto, basta não rodar
-- esta parte — o resto acima já funciona.
-- ===========================================================================
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Remove os agendamentos antigos, se existirem (o do_block evita erro quando
-- o job não existe).
do $$
begin
  perform cron.unschedule('sync-rd-station-hourly');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('sync_calendar_30min');
exception when others then null;
end $$;

select cron.schedule(
  'sync-rd-station-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/sync-rd-station',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SUA_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'sync_calendar_1min',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/sync-calendar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SUA_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);


-- ===========================================================================
-- CONFERÊNCIA FINAL — rode estas três consultas depois
-- ===========================================================================
-- 1) O índice das vendas existe?
select indexname from pg_indexes where tablename = 'sales' and indexname = 'sales_deal_id_uidx';

-- 2) Os agendamentos estão ativos?
-- select jobname, schedule, active from cron.job order by jobname;

-- 3) As sincronizações estão rodando? (espere alguns minutos)
-- select source, status, started_at, finished_at, records_synced, error
--   from public.sync_logs order by started_at desc limit 20;
