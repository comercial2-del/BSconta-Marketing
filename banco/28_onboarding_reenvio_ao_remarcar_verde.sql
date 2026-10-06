-- 28_onboarding_reenvio_ao_remarcar_verde.sql (06/10/2026)
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
--
-- Problema: a 01 · Handoff marcada verde enviava o e-mail; voltando para
-- vermelho/bloqueado e marcando verde de novo, NÃO enviava mais. Motivo: a
-- restrição UNIQUE (deal_id, etapa_anterior) do SQL 25 + "on conflict do nothing"
-- no gatilho só permitiam UM e-mail por venda.
--
-- Regra nova: TODA vez que a 01 passar de bloqueado (vermelho) para verde, o
-- e-mail é enviado de novo, mesmo que já tenha sido enviado antes.
--
-- Continua sem duplicidade: o gatilho só dispara no momento da troca
-- (antes != verde e agora = verde). Gravações repetidas com a 01 já verde não
-- disparam nada. Cada envio fica no log public.onboarding_transferencias
-- (o card mostra sempre o mais recente). Nada é apagado.

-- 1) Remove a trava de "um e-mail por venda"
alter table public.onboarding_transferencias
  drop constraint if exists onboarding_transferencias_unica;
create index if not exists onboarding_transferencias_deal_idx
  on public.onboarding_transferencias(deal_id, transferido_em desc);

-- 2) Gatilho igual ao do SQL 26, sem a trava de conflito
create or replace function public.onb_detectar_transferencia() returns trigger
language plpgsql security definer set search_path = public as $f$
declare
  st_novo text := new.dados->'stages'->0->>'status';
  st_velho text := case when tg_op = 'UPDATE' then old.dados->'stages'->0->>'status' end;
  concluida timestamptz;
  prox jsonb;
  prox_n int;
  v_cfg text;
  v_novo text;
  v_anterior text;
  v_cliente text;
  v_id uuid;
begin
  -- Regra de segurança: vermelho/bloqueado (ou qualquer coisa que não seja verde) nunca dispara.
  if st_novo is distinct from 'done' then
    return new;
  end if;
  -- Só no momento em que ACABOU de ficar verde (não em qualquer gravação).
  if st_velho is not distinct from 'done' then
    return new;
  end if;
  -- Ignora dados antigos/migrados: a liberação tem que ser recente.
  begin
    concluida := (new.dados->'stages'->0->>'completedAt')::timestamptz;
  exception when others then
    concluida := null;
  end;
  if concluida is null or concluida < now() - interval '2 hours' then
    return new;
  end if;

  -- Responsável configurado para a etapa seguinte (hoje: Gustavo).
  select nullif(trim(valor #>> '{}'), '') into v_cfg
    from public.onboarding_config where chave = 'responsavel_proxima_etapa';
  v_cfg := coalesce(v_cfg, 'Gustavo');

  -- Próxima etapa não concluída e o responsável dela (vazio = responsável configurado).
  select e.value, e.n::int into prox, prox_n
    from jsonb_array_elements(new.dados->'stages') with ordinality as e(value, n)
   where e.n > 1 and coalesce(e.value->>'status', '') <> 'done'
   order by e.n limit 1;
  v_novo := coalesce(nullif(trim(prox->>'responsible'), ''), v_cfg);
  if split_part(lower(v_novo), ' ', 1) is distinct from split_part(lower(v_cfg), ' ', 1) then
    return new; -- foi para outra pessoa que não a do fluxo configurado
  end if;

  select coalesce(nullif(trim(d.company_name), ''), nullif(trim(d.client_name), ''), 'Cliente'),
         split_part(coalesce(nullif(trim(s.name), ''), 'Uriel'), ' ', 1)
    into v_cliente, v_anterior
    from public.deals d left join public.sellers s on s.id = d.seller_id
   where d.id = new.deal_id;

  insert into public.onboarding_transferencias
    (deal_id, cliente, responsavel_anterior, novo_responsavel, etapa_anterior, nova_etapa, transferido_em, transferido_por)
  values
    (new.deal_id, coalesce(v_cliente, 'Cliente'), coalesce(v_anterior, 'Uriel'), v_novo, '1ª etapa',
     coalesce(prox_n || 'ª etapa — ' || (prox->>'title'), '2ª etapa'), now(), new.atualizado_por)
  returning id into v_id;
  -- (SQL 28) Cada vez que a 01 volta a ficar verde, entra uma linha nova = um novo e-mail.

  if v_id is not null then
    begin
      perform net.http_post(
        url := 'https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/notificar-transferencia',
        body := jsonb_build_object('id', v_id),
        headers := '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds := 20000
      );
    exception when others then
      null; -- o cron reenvia; a etapa nunca é perdida por causa do e-mail
    end;
  end if;
  return new;
exception when others then
  raise warning 'onb_detectar_transferencia: %', sqlerrm;
  return new;
end
$f$;

-- (o gatilho onb_transferencia_trg do SQL 25 já aponta para esta função)

-- Conferência
select 'trava UNIQUE removida' as item,
       case when exists (select 1 from pg_constraint where conname = 'onboarding_transferencias_unica') then 'AINDA EXISTE' else 'OK' end as status
union all select 'gatilho sem trava de conflito',
       case when position('conflict' in pg_get_functiondef('public.onb_detectar_transferencia'::regproc)) = 0 then 'OK' else 'FALTA' end
union all select 'gatilho onb_transferencia_trg', case when exists (select 1 from pg_trigger where tgname = 'onb_transferencia_trg') then 'OK' else 'FALTA' end;
