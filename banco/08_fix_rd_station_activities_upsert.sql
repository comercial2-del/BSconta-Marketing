-- SGCMP — BSconta — Correção: sincronização do RD Station quebrada desde a
-- correção do calendário (02/09/2026, ~23:15).
--
-- CAUSA: ao corrigir o bug do calendário (07_fix_calendar_seller_uniqueness.sql),
-- trocamos a trava única global UNIQUE(external_id) por UNIQUE(seller_id, external_id)
-- — necessário porque o mesmo evento do Google Calendar aparece na agenda de
-- dois vendedores. Só que a função sync-rd-station também grava em
-- `activities` (ligações e reuniões vindas do RD Station) usando
-- onConflict: "external_id" (sem seller_id). Sem uma trava só em
-- external_id, esse upsert passou a falhar com:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- Isso trava a sincronização do RD Station logo na primeira página de
-- atividades — desde então, toda execução termina em ERRO (a cada 15 min).
--
-- CORREÇÃO: ao contrário do Google Calendar, uma tarefa do RD Station
-- (external_id = rd_task_<id>) NUNCA se repete em mais de um vendedor — o id
-- da tarefa já é globalmente único. Por isso criamos uma trava única parcial,
-- só para linhas source = 'RD_STATION', e uma função no banco para fazer o
-- upsert respeitando essa trava (o cliente supabase-js não consegue mandar
-- upsert com "ON CONFLICT ... WHERE ..." diretamente).

create unique index if not exists activities_external_id_rd_uidx
  on activities (external_id)
  where source = 'RD_STATION';

create or replace function upsert_rd_activities(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into activities (
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
    subtype = excluded.subtype,
    deal_id = excluded.deal_id,
    seller_id = excluded.seller_id,
    title = excluded.title,
    scheduled_at = excluded.scheduled_at,
    status = excluded.status,
    has_note = excluded.has_note,
    notes = excluded.notes,
    updated_at = excluded.updated_at;
end;
$$;

grant execute on function upsert_rd_activities(jsonb) to service_role;

-- Para conferir depois de rodar:
--   select indexname from pg_indexes where tablename = 'activities';
--   select proname from pg_proc where proname = 'upsert_rd_activities';
