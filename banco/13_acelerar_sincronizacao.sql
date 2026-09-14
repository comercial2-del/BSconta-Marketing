-- ---------------------------------------------------------------------------
-- SGCMP — BSconta — 13: acelerar a sincronização (RD Station + Agenda)
--
-- Antes:  RD a cada 60 min | Agenda a cada 30 min
-- Agora:  RD a cada  5 min | Agenda a cada  1 min
--
-- Além disso, cada página do sistema dispara uma sincronização ao ser
-- carregada (js/sync.js): abrir a tela ou apertar Ctrl+R já pede dados
-- novos, sem esperar o próximo ciclo do agendamento.
--
-- ⚠️  PRÉ-REQUISITO: faça o deploy das duas Edge Functions ANTES de rodar
--     este script. Elas ganharam uma TRAVA ANTI-SOBREPOSIÇÃO: se uma
--     sincronização ainda estiver rodando, a próxima sai na hora em vez de
--     rodar em paralelo. Sem essa trava, acelerar o agendamento faz duas
--     execuções gravarem as mesmas linhas ao mesmo tempo e baterem em dobro
--     nas APIs do RD e do Google.
--
-- Por que o RD fica em 5 min e a Agenda em 1 min:
--   A função do RD tem orçamento de até 100 SEGUNDOS por execução (ela
--   pagina negociações e tarefas). De 1 em 1 minuto, a maioria das
--   execuções cairia em cima de uma ainda rodando e sairia sem fazer nada
--   (a trava impede o estrago, mas é invocação gasta à toa). 5 minutos é o
--   menor intervalo em que cada execução termina com folga.
--   A da Agenda é bem mais leve (só renova token e lê eventos), então roda
--   de 1 em 1 minuto tranquilamente.
--   Para quem quer ver na hora, o disparo ao carregar a página já cobre.
--
-- Como usar: Supabase > SQL Editor. Troque as chaves onde indicado.
-- ---------------------------------------------------------------------------

-- Remove os agendamentos antigos (ignora erro se algum não existir).
select cron.unschedule('sync-rd-station-hourly');
select cron.unschedule('sync_calendar_30min');

-- RD Station: a cada 5 minutos
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

-- Agenda Google: a cada 1 minuto
select cron.schedule(
  'sync_calendar_1min',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/sync-calendar',
    headers := '{"Authorization":"Bearer SUA_SERVICE_ROLE_KEY"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
-- Agendamentos ativos:
select jobname, schedule, active from cron.job order by jobname;

-- Últimas execuções (veja se aparecem SUCCESS a cada poucos minutos; linhas
-- puladas pela trava nem chegam a criar registro aqui):
-- select source, status, started_at, finished_at, records_synced, error
--   from public.sync_logs order by started_at desc limit 20;

-- ---------------------------------------------------------------------------
-- Para deixar o RD também de 1 em 1 minuto, troque '*/5 * * * *' por
-- '* * * * *' acima. Com a trava no lugar não quebra nada — as execuções que
-- caírem em cima de uma sincronização em andamento saem sem fazer nada.
-- O que observar depois de um dia: se aparecerem erros de excesso de
-- chamadas da API do RD Station em sync_logs, volte para 5 minutos.
-- ---------------------------------------------------------------------------
