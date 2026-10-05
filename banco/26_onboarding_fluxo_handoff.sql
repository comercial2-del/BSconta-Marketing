-- 26_onboarding_fluxo_handoff.sql (05/10/2026) — FASE DE TESTE
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
--
-- Fluxo do Handoff:
--   VENDIDA → 01 · Handoff VERMELHO/BLOQUEADO → marcada VERDE → liberada →
--   e-mail de Handoff → etapa 02 com o responsável configurado (CINZA, aguardando)
--   → responsável inicia (AZUL, em andamento).
--
-- O que este SQL faz:
--   1) Cria public.onboarding_config: o responsável da etapa seguinte ao Handoff
--      vira CONFIGURAÇÃO (hoje 'Gustavo'), e não regra fixa. Para trocar no futuro:
--        update public.onboarding_config set valor = '"Fulano"' where chave = 'responsavel_proxima_etapa';
--   2) Atualiza o gatilho do SQL 25 para:
--      - NUNCA registrar/disparar o e-mail se a 01 não estiver "done" (verde);
--      - usar o responsável da configuração no lugar do 'Gustavo' fixo.
--   Tudo o mais do SQL 25 (log, sem duplicidade, cron de reenvio) continua igual.

-- ---------------------------------------------------------------------------
-- 1) Configuração do fluxo
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_config (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.onboarding_config enable row level security;
drop policy if exists "config_ver" on public.onboarding_config;
create policy "config_ver" on public.onboarding_config for select to authenticated using (true);
revoke all on public.onboarding_config from anon;
grant select on public.onboarding_config to authenticated;
-- (alteração só pelo SQL Editor / service role)

insert into public.onboarding_config (chave, valor)
values ('responsavel_proxima_etapa', '"Gustavo"'::jsonb)
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Gatilho: só dispara quando a 01 passa a VERDE ("done")
-- ---------------------------------------------------------------------------
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
  on conflict on constraint onboarding_transferencias_unica do nothing
  returning id into v_id;

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
select 'tabela onboarding_config' as item, case when to_regclass('public.onboarding_config') is not null then 'OK' else 'FALTA' end as status
union all select 'responsável configurado', coalesce((select valor #>> '{}' from public.onboarding_config where chave = 'responsavel_proxima_etapa'), 'FALTA')
union all select 'gatilho onb_transferencia_trg', case when exists (select 1 from pg_trigger where tgname = 'onb_transferencia_trg') then 'OK' else 'FALTA' end;
