-- ---------------------------------------------------------------------------
-- 02 — Dados de exemplo (versão pública)
--
-- Cria os vendedores e as 8 etapas do funil — que é o mínimo para o sistema
-- abrir e funcionar — mais um punhado de negociações, vendas e atividades
-- INVENTADAS, só para as telas terem o que mostrar em quem acabou de instalar.
--
-- Nenhum número aqui é real. O arquivo com o histórico verdadeiro da BSconta
-- (faturamento, ticket, desempenho por vendedor) fica fora do repositório, no
-- computador de quem administra — ver `.gitignore`.
--
-- Na prática este arquivo quase não importa depois do primeiro dia: assim que
-- a sincronização com o RD Station e o Google Agenda roda, os dados de verdade
-- entram sozinhos e passam a mandar.
--
-- Rode DEPOIS do 01_schema.sql. Pode rodar mais de uma vez sem duplicar nada.
-- ---------------------------------------------------------------------------

-- Vendedores -----------------------------------------------------------------
-- Os e-mails precisam bater com as contas do Google Agenda para a
-- sincronização ligar cada evento ao vendedor certo.
insert into sellers (id, name, email, calendar_account, color_tag) values
  ('b9653e71-d88e-4d40-9294-e4550bd8e710', 'Vendedor 1', 'vendedor1@exemplo.com.br', 'vendedor1@exemplo.com.br', 'laranja'),
  ('4d483cc9-7b90-44fb-91a0-85cfa7d934be', 'Vendedor 2', 'vendedor2@exemplo.com.br', 'vendedor2@exemplo.com.br', 'azul')
on conflict (id) do nothing;

-- Etapas do funil ------------------------------------------------------------
-- Estas são as etapas de verdade do funil no RD Station: os nomes precisam
-- bater, porque as telas procuram as etapas PELO NOME ("Provável Fechamento",
-- "Reunião de Proposta", "Follow-Up") para montar os indicadores.
insert into stages (id, name, "order", is_won, is_lost) values
  ('655688e4-5476-4d92-b6a0-f37dc34a81d1', 'Reunião Confirmada',      1, false, false),
  ('8ad14b3c-1dff-4cb6-a07a-95668df73385', 'Reagendamento Comercial', 2, false, false),
  ('3c2b1a09-7e5d-4f18-9c6b-2d4e8f0a1b3c', 'Enviar Proposta',         3, false, false),
  ('1f183bda-58c2-4daa-8610-a50846dea001', 'Reunião de Proposta',     4, false, false),
  ('9e7d6c5b-4a39-4821-b7f6-0c1d2e3f4a5b', 'Follow-Up',               5, false, false),
  ('6b5a4938-2c1d-4e0f-8a97-b6c5d4e3f2a1', 'Provável Fechamento',     6, false, false),
  ('0a1b2c3d-4e5f-4061-9283-a4b5c6d7e8f9', 'Venda Realizada',         7, true,  false),
  ('f9e8d7c6-b5a4-4392-8170-6f5e4d3c2b1a', 'Perdido',                 8, false, true)
on conflict (id) do nothing;

-- Negociações de exemplo -----------------------------------------------------
insert into deals (id, client_name, company_name, seller_id, stage_id, value, status, is_recurring, created_at, updated_at) values
  ('aaaa0001-0000-4000-8000-000000000001', 'Cliente Exemplo A', 'Empresa A ME',   'b9653e71-d88e-4d40-9294-e4550bd8e710', '655688e4-5476-4d92-b6a0-f37dc34a81d1',  400, 'OPEN', false, now() - interval '20 days', now() - interval '2 days'),
  ('aaaa0002-0000-4000-8000-000000000002', 'Cliente Exemplo B', 'Empresa B LTDA', '4d483cc9-7b90-44fb-91a0-85cfa7d934be', '1f183bda-58c2-4daa-8610-a50846dea001',  650, 'OPEN', false, now() - interval '18 days', now() - interval '3 days'),
  ('aaaa0003-0000-4000-8000-000000000003', 'Cliente Exemplo C', 'Empresa C EPP',  'b9653e71-d88e-4d40-9294-e4550bd8e710', '9e7d6c5b-4a39-4821-b7f6-0c1d2e3f4a5b',  900, 'OPEN', true,  now() - interval '30 days', now() - interval '1 days'),
  ('aaaa0004-0000-4000-8000-000000000004', 'Cliente Exemplo D', 'Empresa D SA',   '4d483cc9-7b90-44fb-91a0-85cfa7d934be', '6b5a4938-2c1d-4e0f-8a97-b6c5d4e3f2a1', 1200, 'OPEN', false, now() - interval '45 days', now()),
  ('aaaa0005-0000-4000-8000-000000000005', 'Cliente Exemplo E', 'Empresa E ME',   'b9653e71-d88e-4d40-9294-e4550bd8e710', '0a1b2c3d-4e5f-4061-9283-a4b5c6d7e8f9',  500, 'WON',  true,  now() - interval '60 days', now() - interval '10 days'),
  ('aaaa0006-0000-4000-8000-000000000006', 'Cliente Exemplo F', 'Empresa F LTDA', '4d483cc9-7b90-44fb-91a0-85cfa7d934be', '0a1b2c3d-4e5f-4061-9283-a4b5c6d7e8f9',  750, 'WON',  false, now() - interval '50 days', now() - interval '8 days'),
  ('aaaa0007-0000-4000-8000-000000000007', 'Cliente Exemplo G', 'Empresa G ME',   'b9653e71-d88e-4d40-9294-e4550bd8e710', 'f9e8d7c6-b5a4-4392-8170-6f5e4d3c2b1a',  300, 'LOST', false, now() - interval '40 days', now() - interval '15 days')
on conflict (id) do nothing;

update deals set closed_at = now() - interval '10 days' where id = 'aaaa0005-0000-4000-8000-000000000005' and closed_at is null;
update deals set closed_at = now() - interval  '8 days' where id = 'aaaa0006-0000-4000-8000-000000000006' and closed_at is null;
update deals set closed_at = now() - interval '15 days', loss_reason = 'Preço' where id = 'aaaa0007-0000-4000-8000-000000000007' and closed_at is null;

-- Vendas de exemplo ----------------------------------------------------------
-- Uma linha em `sales` para cada negociação ganha. É daqui que saem
-- faturamento, ticket médio e margem nas telas de Vendas e Visão geral.
insert into sales (deal_id, seller_id, value, margin, is_recurring, closed_at)
select d.id, d.seller_id, d.value, round(d.value * 0.4, 2), d.is_recurring, d.closed_at
  from deals d
 where d.id in ('aaaa0005-0000-4000-8000-000000000005', 'aaaa0006-0000-4000-8000-000000000006')
   and not exists (select 1 from sales s where s.deal_id = d.id);

-- Atividades de exemplo ------------------------------------------------------
-- Duas ligações e uma reunião, para as telas de Ligações e Reuniões não
-- abrirem vazias. Repare nos títulos: eles seguem a regra de nomenclatura
-- que o js/calc.js usa — "Ligação..." é sempre ligação, "Reunião..." é
-- sempre reunião, e o título manda sobre o tipo gravado no banco.
insert into activities (type, subtype, source, external_id, deal_id, seller_id, title, scheduled_at, status) values
  ('CALL',    'SALES_CALL',         'RD_STATION', 'exemplo_call_1',    'aaaa0001-0000-4000-8000-000000000001', 'b9653e71-d88e-4d40-9294-e4550bd8e710', 'Ligação - Vendas (exemplo)',        now() - interval '3 days', 'DONE'),
  ('CALL',    'GENERIC_CALL',       'RD_STATION', 'exemplo_call_2',    'aaaa0002-0000-4000-8000-000000000002', '4d483cc9-7b90-44fb-91a0-85cfa7d934be', 'Ligação de agendamento (exemplo)',  now() - interval '2 days', 'DONE'),
  ('MEETING', 'COMMERCIAL_MEETING', 'CALENDAR',   'exemplo_meeting_1', 'aaaa0002-0000-4000-8000-000000000002', '4d483cc9-7b90-44fb-91a0-85cfa7d934be', 'Reunião BSconta x Empresa B',       now() + interval '2 days', 'SCHEDULED')
on conflict (external_id) do nothing;

-- Confere ---------------------------------------------------------------------
select (select count(*) from sellers)                    as vendedores,
       (select count(*) from stages)                     as etapas,
       (select count(*) from deals)                      as negociacoes,
       (select count(*) from sales)                      as vendas,
       (select count(*) from activities)                 as atividades;
