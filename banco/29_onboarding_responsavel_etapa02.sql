-- 29_onboarding_responsavel_etapa02.sql (22/10/2026)
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
--
-- Novo fluxo de responsáveis do onboarding:
--   01 · Handoff  -> vendedor (Uriel), bloqueado até ficar VERDE
--   02            -> Isadora  (nova chave 'responsavel_etapa_02')
--   03 a 10       -> Gustavo  (chave existente 'responsavel_proxima_etapa')
--
-- O que este SQL faz:
--   1) Cria a configuração 'responsavel_etapa_02' = "Isadora".
--   2) Atualiza o gatilho do SQL 28: quando a 01 passa a verde, a transferência
--      (e o e-mail de Handoff) vai para o responsável da etapa 02 (Isadora).
--   Todo o resto do SQL 28 (reenvio ao remarcar verde, log, cron) continua igual.
--
-- Para trocar no futuro:
--   update public.onboarding_config set valor = '"Fulano"' where chave = 'responsavel_etapa_02';

-- 1) Configuração
insert into public.onboarding_config (chave, valor)
values ('responsavel_etapa_02', '"Isadora"'::jsonb)
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();

-- 2) Gatilho (igual ao SQL 28, trocando a configuração usada para a etapa 02)
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

  -- Responsável configurado para a etapa 02 (hoje: Isadora).
  select nullif(trim(valor #>> '{}'), '') into v_cfg
    from public.onboarding_config where chave = 'responsavel_etapa_02';
  v_cfg := coalesce(v_cfg, 'Isadora');

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

-- Conferência
select chave, valor #>> '{}' as responsavel
  from public.onboarding_config
 where chave in ('responsavel_etapa_02', 'responsavel_proxima_etapa')
 order by chave;
