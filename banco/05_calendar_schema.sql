-- SGCMP — BSconta — Integração Google Calendar (verificação de reuniões)
-- Cole este arquivo no Supabase: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema (usa "if not exists" / "or replace").

-- ---------------------------------------------------------------------------
-- Tokens OAuth do Google Calendar, um por vendedor.
-- NUNCA é exposto ao navegador: não existe policy de select/insert/update
-- para o papel "authenticated", então só as Edge Functions (que usam a
-- service_role key) conseguem ler/gravar aqui.
-- ---------------------------------------------------------------------------
create table if not exists calendar_tokens (
  seller_id uuid primary key references sellers(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table calendar_tokens enable row level security;
-- Sem policies = ninguém autenticado via anon/authenticated consegue
-- acessar. Isso é intencional (contém segredos).

-- ---------------------------------------------------------------------------
-- View: reuniões do RD Station sem evento correspondente na Agenda Google
-- do vendedor (mesmo vendedor, horário dentro de uma janela de 30 min).
-- É a base da "verificação de reuniões" pedida.
-- ---------------------------------------------------------------------------
create or replace view meeting_divergences as
select
  rd.id as rd_activity_id,
  rd.seller_id,
  s.name as seller_name,
  rd.title as rd_title,
  rd.scheduled_at as rd_scheduled_at,
  rd.status as rd_status,
  cal.id as calendar_activity_id,
  cal.title as calendar_title,
  cal.scheduled_at as calendar_scheduled_at,
  case when cal.id is null then 'SEM_EVENTO_NA_AGENDA' else 'OK' end as divergence
from activities rd
join sellers s on s.id = rd.seller_id
left join activities cal
  on cal.seller_id = rd.seller_id
  and cal.source = 'CALENDAR'
  and cal.type = 'MEETING'
  and cal.scheduled_at between rd.scheduled_at - interval '30 minutes'
                            and rd.scheduled_at + interval '30 minutes'
where rd.source = 'RD_STATION'
  and rd.type = 'MEETING'
  and rd.status not in ('CANCELED', 'DECLINED');

-- A view herda a segurança das tabelas que consulta (activities/sellers já
-- têm RLS "read all para autenticados"), então qualquer usuário logado no
-- sistema pode consultá-la normalmente.

-- ---------------------------------------------------------------------------
-- sync_logs já aceita source = 'CALENDAR' desde o schema original
-- (01_schema.sql), então nenhuma alteração é necessária ali.
-- ---------------------------------------------------------------------------
