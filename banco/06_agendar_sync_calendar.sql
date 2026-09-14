-- SGCMP — BSconta — Agendamento automático do sync-calendar
-- Cole este arquivo no Supabase: SQL Editor > New query > Run.
-- Já foi executado em produção em 02/09/2026 (job "sync_calendar_30min", a cada 30 min).
-- Mantido aqui para documentação e para poder recriar o job caso seja removido.

select cron.schedule(
  'sync_calendar_30min',
  '*/30 * * * *',
  $$
  select net.http_post(
    url:='https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/sync-calendar',
    headers:='{"Authorization":"Bearer <SUPABASE_ANON_KEY>"}'::jsonb,
    timeout_milliseconds:='30000'
  );
  $$
);

-- Para conferir se está rodando:
--   select jobname, schedule from cron.job where jobname = 'sync_calendar_30min';
--   select * from sync_logs where source = 'CALENDAR' order by started_at desc limit 5;

-- Para remover (se precisar recriar com outro intervalo):
--   select cron.unschedule('sync_calendar_30min');
