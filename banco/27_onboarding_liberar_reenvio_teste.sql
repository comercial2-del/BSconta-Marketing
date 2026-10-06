-- 27_onboarding_liberar_reenvio_teste.sql (06/10/2026)
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
--
-- Problema: Bruno Farias e Giovana Tostes tiveram o e-mail de Handoff enviado em
-- 01/10/2026, no teste da versão anterior. Com o fluxo novo (SQL 26) a etapa 01
-- voltou para vermelho/bloqueado e, ao marcar verde de novo, o gatilho NÃO manda
-- outro e-mail: UNIQUE (deal_id, etapa_anterior) já tem a linha de 01/10.
--
-- Solução (uma vez): renomear a etapa_anterior dessas 2 linhas de teste.
-- Nada é apagado (o log de 01/10 continua) e a próxima marcação verde dispara o e-mail.
-- Para incluir outra venda, acrescente o nome do cliente na lista.

update public.onboarding_transferencias
   set etapa_anterior = '1ª etapa (teste 01/10)',
       email_atualizado_em = now()
 where cliente in ('Bruno Farias', 'Giovana Tostes')
   and etapa_anterior = '1ª etapa'
   and transferido_em < '2026-10-02'
returning cliente, etapa_anterior, email_status;

-- Depois: no Onboarding, marcar a 01 · Handoff dos dois como VERDE.
-- Conferência:
--   select cliente, etapa_anterior, email_status, email_enviado_em
--     from public.onboarding_transferencias order by transferido_em desc limit 10;
