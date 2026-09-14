-- ---------------------------------------------------------------------------
-- 16 — Esconder as ligações de demonstração (06/09/2026)
--
-- O QUE ERAM
-- O arquivo 02_seed_dados_reais.sql, usado para montar o sistema, inseriu 467
-- ligações inventadas em activities. Elas se reconhecem por três marcas:
--   * external_id começando com 'seed_call_'
--   * title nulo (não têm nome nenhum)
--   * nenhum vínculo com negociação
-- Foram todas criadas no mesmo instante (27/08/2026 16:25:58) e espalhadas de
-- 28/06 a 28/10/2026 — inclusive no FUTURO, uma por dia às 16:25.
--
-- O ESTRAGO QUE FAZIAM
--   * 129 contavam como "ligação de vendas realizada";
--   * 80 apareciam como agendadas ainda por acontecer — 7 das 12 "Agendadas"
--     que o Marlon via na semana de 14 a 20/09 eram essas;
--   * como estão gravadas com source = 'RD_STATION', a conferência de
--     exclusões da sincronização tentava (com razão) escondê-las: eram 467 das
--     "468 ligações sumidas" que a trava de segurança nº 4 vinha segurando
--     desde 05/09. O RD devolve 803 tarefas; o sistema tinha 1.271 — a conta
--     fecha: 803 reais + 467 inventadas + 1 tarefa que o RD deixou de devolver.
--
-- O QUE ESTE SCRIPT FAZ
-- Marca deleted_at nelas. NÃO apaga nada: é o mesmo mecanismo de exclusão
-- suave do 15_sincronizar_exclusoes.sql. A sincronização nunca vai trazê-las
-- de volta, porque nenhum external_id 'seed_%' existe no RD ou na Agenda.
--
-- Executado na produção em 06/09/2026 — 467 linhas escondidas.
-- ---------------------------------------------------------------------------

update public.activities
   set deleted_at = now()
 where external_id like 'seed\_%'
   and deleted_at is null;

-- Confere: seeds_ativos tem de dar 0.
select count(*) filter (where external_id like 'seed\_%' and deleted_at is null) as seeds_ativos,
       count(*) filter (where deleted_at is null)                                as total_ativos
  from public.activities;


-- ---------------------------------------------------------------------------
-- DESFAZER (se algum dia quiser os dados de demonstração de volta)
-- ---------------------------------------------------------------------------
-- update public.activities
--    set deleted_at = null
--  where external_id like 'seed\_%';
