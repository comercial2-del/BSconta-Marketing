-- SGCMP — BSconta — Correção: eventos compartilhados da Agenda "roubando" vendedor
-- Já executado em produção em 02/09/2026. Mantido aqui para documentação e para
-- poder reaplicar em caso de restauração do banco.
--
-- PROBLEMA ENCONTRADO:
-- O Google Calendar usa o MESMO id de evento tanto na agenda do organizador
-- quanto na de cada convidado. Como o Marlon (SDR) agenda praticamente toda
-- reunião "Reunião BSconta x (Cliente)" e convida o Uriel (quem de fato
-- realiza a reunião), o mesmo evento aparecia na agenda dos dois — só que
-- com o MESMO external_id.
--
-- A tabela `activities` tinha uma constraint UNIQUE global só em
-- `external_id` (activities_external_id_key), e a Edge Function
-- `sync-calendar` fazia upsert com onConflict: "external_id". Resultado:
-- cada vez que o sync rodava, o vendedor processado por último "roubava"
-- para si o registro do evento, sobrescrevendo o seller_id de quem tinha
-- sido processado antes. Isso fazia o Marlon (processado primeiro, ou em
-- execuções anteriores) aparecer com pouquíssimas reuniões reais na tabela,
-- mesmo tendo dezenas de reuniões marcadas na Agenda de verdade.
--
-- CORREÇÃO (duas partes):
-- 1) Trocar a constraint para ser por (seller_id, external_id) — cada
--    vendedor passa a manter sua própria cópia do mesmo evento.
-- 2) Adicionar a coluna organizer_email, para sabermos quem de fato
--    organizou/agendou cada reunião (não só em qual agenda ela aparece).
--    A Edge Function sync-calendar foi atualizada para gravar esse campo e
--    fazer upsert com onConflict: "seller_id,external_id".
--
-- Resultado após reprocessar: Marlon passou de 3 para 45 reuniões reais na
-- tabela (42 como organizador + 3 como convidado); Uriel tinha 74 (19 como
-- organizador + 55 como convidado nas reuniões marcadas pelo Marlon).

alter table activities drop constraint activities_external_id_key;
alter table activities add constraint activities_seller_external_id_key unique (seller_id, external_id);
alter table activities add column if not exists organizer_email text;

-- Para conferir depois de rodar:
--   select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'activities'::regclass;
--   select column_name from information_schema.columns where table_name = 'activities' and column_name = 'organizer_email';
