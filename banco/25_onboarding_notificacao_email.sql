-- 25_onboarding_notificacao_email.sql (01/10/2026)
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
--
-- E-mail automático quando o processo sai da 1ª etapa (Handoff, do Uriel)
-- e vai para o Gustavo (etapa 02 em diante).
--
-- Como funciona:
--   1) O sistema grava as etapas em public.onboarding_etapas (dados.stages[0] = 1ª etapa).
--   2) O gatilho abaixo percebe quando a 1ª etapa passa a "done" e o novo
--      responsável é o Gustavo, e grava a transferência em
--      public.onboarding_transferencias (log + fila do e-mail).
--      UNIQUE (deal_id, etapa_anterior): uma transferência por venda, sem e-mail duplicado.
--   3) Em seguida chama a Edge Function notificar-transferencia (pg_net, assíncrono:
--      se a chamada falhar, a etapa e o log continuam gravados).
--   4) A função envia pelo Gmail do remetente (comercial@bsconta.com.br) e grava
--      o status do envio. Falhou? O cron de 10 em 10 min tenta de novo (até 5x),
--      e o card tem o botão "Tentar de novo".
--
-- O token do Gmail fica em public.email_remetente_gmail, que NENHUM usuário do
-- sistema lê (RLS sem política; só a Edge Function, com a service role).

-- ---------------------------------------------------------------------------
-- 1) Log / fila das transferências
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_transferencias (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  cliente text not null,
  responsavel_anterior text not null,
  novo_responsavel text not null,
  etapa_anterior text not null,
  nova_etapa text not null,
  transferido_em timestamptz not null default now(),
  transferido_por uuid,
  email_status text not null default 'pendente' check (email_status in ('pendente','enviando','enviado','erro')),
  email_destinatarios text[],
  email_tentativas int not null default 0,
  email_erro text,
  email_enviado_em timestamptz,
  email_mensagem_id text,
  email_atualizado_em timestamptz not null default now(),
  constraint onboarding_transferencias_unica unique (deal_id, etapa_anterior)
);
create index if not exists onboarding_transferencias_status_idx on public.onboarding_transferencias(email_status);

alter table public.onboarding_transferencias enable row level security;
drop policy if exists "transferencias_ver" on public.onboarding_transferencias;
create policy "transferencias_ver" on public.onboarding_transferencias for select to authenticated using (true);
revoke all on public.onboarding_transferencias from anon;
grant select on public.onboarding_transferencias to authenticated;
-- (sem insert/update para os usuários: quem grava é o gatilho e a Edge Function)

-- ---------------------------------------------------------------------------
-- 2) Token do Gmail do remetente (só a Edge Function acessa)
-- ---------------------------------------------------------------------------
create table if not exists public.email_remetente_gmail (
  email text primary key,
  refresh_token text not null,
  scope text,
  conectado_em timestamptz not null default now()
);
alter table public.email_remetente_gmail enable row level security;
revoke all on public.email_remetente_gmail from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Gatilho: 1ª etapa concluída -> Gustavo
-- ---------------------------------------------------------------------------
create or replace function public.onb_detectar_transferencia() returns trigger
language plpgsql security definer set search_path = public as $f$
declare
  st_novo text := new.dados->'stages'->0->>'status';
  st_velho text := case when tg_op = 'UPDATE' then old.dados->'stages'->0->>'status' end;
  concluida timestamptz;
  prox jsonb;
  prox_n int;
  v_novo text;
  v_anterior text;
  v_cliente text;
  v_id uuid;
begin
  -- Só quando a 1ª etapa ACABOU de ser concluída (não em qualquer gravação).
  if st_novo is distinct from 'done' or st_velho is not distinct from 'done' then
    return new;
  end if;
  -- Ignora dados antigos/migrados: a conclusão tem que ser recente.
  begin
    concluida := (new.dados->'stages'->0->>'completedAt')::timestamptz;
  exception when others then
    concluida := null;
  end;
  if concluida is null or concluida < now() - interval '2 hours' then
    return new;
  end if;

  -- Próxima etapa não concluída e o responsável dela (vazio = Gustavo).
  select e.value, e.n::int into prox, prox_n
    from jsonb_array_elements(new.dados->'stages') with ordinality as e(value, n)
   where e.n > 1 and coalesce(e.value->>'status', '') <> 'done'
   order by e.n limit 1;
  v_novo := coalesce(nullif(trim(prox->>'responsible'), ''), 'Gustavo');
  if v_novo not ilike 'gustavo%' then
    return new; -- foi para outra pessoa: não é a transferência Uriel -> Gustavo
  end if;

  select coalesce(nullif(trim(d.company_name), ''), nullif(trim(d.client_name), ''), 'Cliente'),
         split_part(coalesce(nullif(trim(s.name), ''), 'Uriel'), ' ', 1)
    into v_cliente, v_anterior
    from public.deals d left join public.sellers s on s.id = d.seller_id
   where d.id = new.deal_id;

  insert into public.onboarding_transferencias
    (deal_id, cliente, responsavel_anterior, novo_responsavel, etapa_anterior, nova_etapa, transferido_em, transferido_por)
  values
    (new.deal_id, coalesce(v_cliente, 'Cliente'), coalesce(v_anterior, 'Uriel'), 'Gustavo', '1ª etapa',
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
  -- Qualquer erro aqui não pode impedir o salvamento das etapas.
  raise warning 'onb_detectar_transferencia: %', sqlerrm;
  return new;
end
$f$;

drop trigger if exists onb_transferencia_trg on public.onboarding_etapas;
create trigger onb_transferencia_trg
  after insert or update of dados on public.onboarding_etapas
  for each row execute function public.onb_detectar_transferencia();

-- ---------------------------------------------------------------------------
-- 4) Nova tentativa automática a cada 10 min (só se houver pendente/erro)
-- ---------------------------------------------------------------------------
do $$ begin
  perform cron.unschedule('onboarding-email-reenvio');
exception when others then null; end $$;

select cron.schedule(
  'onboarding-email-reenvio',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/notificar-transferencia',
    body := '{"reprocessar": true}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (select 1 from public.onboarding_transferencias
                 where email_status in ('pendente', 'erro') and email_tentativas < 5);
  $$
);

-- Conferência
select 'tabela onboarding_transferencias' as item, case when to_regclass('public.onboarding_transferencias') is not null then 'OK' else 'FALTA' end as status
union all select 'tabela email_remetente_gmail', case when to_regclass('public.email_remetente_gmail') is not null then 'OK' else 'FALTA' end
union all select 'gatilho onb_transferencia_trg', case when exists (select 1 from pg_trigger where tgname = 'onb_transferencia_trg') then 'OK' else 'FALTA' end
union all select 'cron onboarding-email-reenvio', case when exists (select 1 from cron.job where jobname = 'onboarding-email-reenvio') then 'OK' else 'FALTA' end;
