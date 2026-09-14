-- ---------------------------------------------------------------------------
-- SGCMP — BSconta — 12: REGRA DE RETENÇÃO (proposta, ainda NÃO ativada)
--
-- ⚠️  ESTE ARQUIVO NÃO APAGA NADA SOZINHO.
--     A exclusão está comentada de propósito. Rode primeiro a CONFERÊNCIA,
--     confira o que sairia, e só então descomente o bloco APLICAR.
--     Nenhum agendamento (cron) é criado aqui.
--
-- ---------------------------------------------------------------------------
-- O QUE O SISTEMA PRECISA TER NO BANCO PARA FUNCIONAR
-- ---------------------------------------------------------------------------
-- Os filtros da tela são: Hoje, Ontem, Esta semana, Semana passada, Este mês,
-- Mês passado — mais o calendário (dia ou semana qualquer). Além disso, todo
-- indicador mostra "vs. período anterior", que lê um período ANTES do
-- selecionado. Então, quando alguém escolhe "Mês passado", o sistema também
-- precisa do mês anterior a esse para calcular a variação.
--
-- Daí a regra: o corte é o PRIMEIRO DIA DO MÊS RETRASADO.
--
--   hoje = 03/09/2026
--   ├─ mês atual .............. 01/09 → 30/09   (filtro "Este mês")
--   ├─ mês passado ............ 01/08 → 31/08   (filtro "Mês passado")  ← agosto preservado
--   └─ mês retrasado .......... 01/07 → 31/07   (base do "vs. período anterior")
--   corte = 01/07/2026 — nada antes disso é necessário para a tela.
--
-- Isso já resolve o caso que você levantou (dia 31 → dia 4): a semana de
-- 31/08 a 06/09 atravessa a virada do mês, e um corte ingênuo do tipo
-- "apagar tudo antes do mês atual" levaria embora o dia 31/08 — que faz
-- parte da SEMANA ATUAL. Com o corte no mês retrasado, essas viradas de mês
-- ficam sempre com folga de mais de 30 dias.
--
-- ---------------------------------------------------------------------------
-- O QUE **NÃO** ENTRA NA LIMPEZA (importante)
-- ---------------------------------------------------------------------------
-- A limpeza vale SOMENTE para `activities` (eventos de agenda e tarefas do
-- RD). As outras tabelas não podem ser podadas por data:
--
--   • deals  — uma oportunidade ABERTA pode ter sido criada há meses e
--              continua valendo hoje; apagá-la destrói o funil e o valor em
--              oportunidades abertas.
--   • sales  — é o histórico de faturamento; some com ele e as metas, o
--              ranking e a comparação anual ficam errados.
--   • goals / sellers / profiles — cadastro, não têm volume relevante.
--
-- Também não se apaga atividade que ainda esteja amarrada a uma negociação
-- ABERTA (`deals.status = 'OPEN'`): é o histórico daquela negociação em
-- andamento. A cláusula abaixo já protege esse caso.
--
-- ---------------------------------------------------------------------------
-- CONFERÊNCIA — rode este bloco primeiro.
-- ---------------------------------------------------------------------------

-- 1) Quanto existe hoje, por mês, e o que ficaria de fora do corte:
with corte as (
  select (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '2 months')::date as data_corte
)
select
  to_char(a.scheduled_at at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
  count(*)                                                            as atividades,
  count(*) filter (where a.type = 'MEETING')                          as reunioes,
  count(*) filter (where a.type = 'CALL')                             as ligacoes,
  case
    when (a.scheduled_at at time zone 'America/Sao_Paulo')::date >= c.data_corte then 'MANTÉM'
    else 'seria apagado'
  end                                                                 as situacao
from public.activities a
cross join corte c
group by 1, 4
order by 1 desc;

-- 2) Total exato que a limpeza removeria (deve bater com o "seria apagado"):
with corte as (
  select (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '2 months')::date as data_corte
)
select count(*) as seriam_apagadas, min(a.scheduled_at)::date as mais_antiga, max(a.scheduled_at)::date as mais_recente
from public.activities a
cross join corte c
where (a.scheduled_at at time zone 'America/Sao_Paulo')::date < c.data_corte
  and not exists (
    select 1 from public.deals d
     where d.id = a.deal_id and d.status = 'OPEN'
  );

-- 3) Confirmação de segurança — DEVE retornar 0 linhas.
--    (nada de agosto, do mês atual ou da semana que vira o mês pode aparecer)
with corte as (
  select (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '2 months')::date as data_corte
)
select count(*) as violacoes
from public.activities a
cross join corte c
where (a.scheduled_at at time zone 'America/Sao_Paulo')::date < c.data_corte
  and (a.scheduled_at at time zone 'America/Sao_Paulo')::date
      >= (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month')::date;

-- ---------------------------------------------------------------------------
-- APLICAR — descomente só depois de conferir os três blocos acima.
-- Sugestão: rode manualmente uma vez por mês. Só agende em cron depois de
-- ver o resultado de pelo menos uma execução manual.
-- ---------------------------------------------------------------------------
-- with corte as (
--   select (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '2 months')::date as data_corte
-- )
-- delete from public.activities a
-- using corte c
-- where (a.scheduled_at at time zone 'America/Sao_Paulo')::date < c.data_corte
--   and not exists (
--     select 1 from public.deals d
--      where d.id = a.deal_id and d.status = 'OPEN'
--   );

-- ---------------------------------------------------------------------------
-- Observação sobre volume: `activities` cresce na casa de dezenas/centenas de
-- linhas por mês neste uso. Isso é pequeno para o Postgres — a limpeza aqui é
-- higiene, não necessidade de espaço. Se a ideia for só "não acumular", dá
-- para deixar o corte mais folgado (6 ou 12 meses) sem custo nenhum e com
-- risco zero de perder histórico. Me diga qual prazo você prefere.
-- ---------------------------------------------------------------------------
