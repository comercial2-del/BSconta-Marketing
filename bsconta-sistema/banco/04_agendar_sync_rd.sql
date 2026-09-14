-- SGCMP — BSconta — Agendamento automático da sincronização com o RD Station
--
-- Este arquivo é OPCIONAL e AVANÇADO. Só rode se você já tiver:
--   1) Feito o deploy da Edge Function "sync-rd-station" (veja o GUIA.md).
--   2) Cadastrado o secret RD_STATION_TOKEN no projeto.
--
-- Existem duas formas de agendar a sincronização para rodar sozinha de
-- tempos em tempos. A forma mais simples é pelo painel do Supabase:
--
--   Painel > Integrations > Cron > "Create a new Cron Job"
--     - Type: Supabase Edge Function
--     - Function: sync-rd-station
--     - Schedule: por exemplo "0 * * * *" (a cada hora)
--
-- Se preferir fazer isso via SQL (mais controle, mas mais avançado), use o
-- script abaixo. ATENÇÃO: ele grava a service_role key dentro de uma função
-- no banco de dados — qualquer pessoa com acesso de administrador ao banco
-- consegue ler essa chave. Se isso for uma preocupação, use o caminho pelo
-- painel (acima) em vez deste script.

-- Extensões necessárias para chamar uma URL (a Edge Function) a partir do Postgres.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Substitua os dois valores abaixo antes de rodar:
--   SUA_SERVICE_ROLE_KEY -> Project Settings > API > service_role key (secreta!)
-- A URL já está preenchida com o projeto zqhuhaqothpxusnaijog.
select cron.schedule(
  'sync-rd-station-hourly',   -- nome do job (para conseguir remover depois, se quiser)
  '0 * * * *',                -- a cada hora, no minuto 0 — ajuste como preferir
  $$
  select net.http_post(
    url := 'https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/sync-rd-station',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SUA_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Para ver os jobs agendados:
-- select * from cron.job;

-- Para remover este agendamento no futuro:
-- select cron.unschedule('sync-rd-station-hourly');
