-- ---------------------------------------------------------------------------
-- SGCMP — BSconta — 11: não perder o vínculo da atividade com a negociação
--
-- Problema (auditoria de 03/09/2026):
-- No sync do RD Station, o `deal_id` de cada tarefa é resolvido por um cache
-- em memória que só contém as negociações processadas NAQUELA execução. Numa
-- sincronização incremental (a maioria delas), esse cache vem quase vazio, e
-- o upsert gravava `deal_id = excluded.deal_id` — ou seja, NULL.
--
-- Consequência prática: a cada sincronização, atividades que já estavam
-- ligadas a uma negociação perdiam o vínculo, e o subtype caía de
-- 'SALES_CALL' para 'GENERIC_CALL'. Na prática o KPI "Ligações de vendas"
-- ia baixando sozinho, sem ninguém mexer em nada.
--
-- Correção: no conflito, só sobrescreve o vínculo quando a nova linha traz um
-- deal_id de verdade; se vier NULL, mantém o que já estava gravado. Mesma
-- ideia para o subtype (não rebaixa SALES_CALL para GENERIC_CALL).
--
-- NADA É APAGADO. Rode no Supabase > SQL Editor.
-- ---------------------------------------------------------------------------

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
      when excluded.deal_id is null and activities.subtype = 'SALES_CALL' and excluded.subtype = 'GENERIC_CALL'
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

-- ---------------------------------------------------------------------------
-- Trava que faltava em `sales`: a Edge Function faz
-- upsert(..., { onConflict: "deal_id" }), o que exige um índice único em
-- deal_id. Sem ele, o Postgres devolve erro 42P10 e a sincronização inteira
-- (inclusive as atividades) é abortada. `if not exists` deixa seguro rodar
-- mesmo que a trava já tenha sido criada manualmente em produção.
-- ---------------------------------------------------------------------------
create unique index if not exists sales_deal_id_uidx on public.sales (deal_id);

-- Conferência:
--   select indexname from pg_indexes where tablename = 'sales';
