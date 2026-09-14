-- ---------------------------------------------------------------------------
-- SGCMP — BSconta — 10: separar LIGAÇÕES de REUNIÕES nos dados já gravados
--
-- Regra (03/09/2026): ligação NUNCA é reunião.
--   "Ligação", "Chamada", "Call", "Telefonema", "Contato telefônico"  -> CALL
--   "Reunião", "Reunião x ...", "BSconta x <cliente>"                 -> MEETING
--   "Reunião IA/Gabriel" e demais compromissos internos               -> OTHER
--
-- Por que isso é necessário: a versão anterior da Edge Function
-- sync-calendar gravava TODO evento importado da Agenda como
-- type = 'MEETING', inclusive os que se chamam "Ligação – Follow-up". Com
-- isso, ligações apareciam e eram contadas como reunião.
--
-- A tela já mostra o número certo mesmo sem rodar este script (js/calc.js
-- reclassifica pelo título na hora de exibir). Rodar aqui deixa o BANCO
-- coerente com a tela — recomendado, mas não obrigatório.
--
-- NADA É APAGADO: só o `type`/`subtype` das atividades muda.
--
-- Como usar (Supabase > SQL Editor):
--   1) rode o bloco "CONFERÊNCIA" e veja o que seria alterado;
--   2) se estiver de acordo, rode o bloco "APLICAR".
-- ---------------------------------------------------------------------------

-- Normaliza título: minúsculo e sem acento ("Ligação" -> "ligacao").
create or replace function public.sgcmp_norm(txt text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(unaccent_bsconta(coalesce(txt, ''))), '\s+', ' ', 'g');
$$;

-- unaccent pode não estar instalado; esta versão resolve os acentos do PT-BR
-- sem depender da extensão.
create or replace function public.unaccent_bsconta(txt text)
returns text
language sql
immutable
as $$
  select translate(
    coalesce(txt, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  );
$$;

-- Classificação a partir do título: 'CALL', 'MEETING' ou 'OTHER'.
create or replace function public.sgcmp_kind_from_title(txt text)
returns text
language sql
immutable
as $$
  with n as (select public.sgcmp_norm(txt) as t)
  select case
    when (select t from n) ~ '(ligacao|ligacoes|ligar |chamada|telefonema|telefonico|\mcalls?\M)' then 'CALL'
    when (select t from n) ~ '(ia/gabriel|reuniao ia)' then 'OTHER'
    when (select t from n) like 'reuniao%' or (select t from n) like '%bsconta x%' then 'MEETING'
    else 'OTHER'
  end;
$$;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA — rode primeiro e confira o resultado.
-- ---------------------------------------------------------------------------
select
  public.sgcmp_kind_from_title(title) as classificacao_nova,
  type                                 as type_atual,
  count(*)                             as qtd,
  min(scheduled_at)::date              as de,
  max(scheduled_at)::date              as ate,
  (array_agg(title order by scheduled_at desc))[1:5] as exemplos
from public.activities
where source = 'CALENDAR'
group by 1, 2
order by 1, 2;

-- ---------------------------------------------------------------------------
-- APLICAR — só depois de conferir acima.
-- ---------------------------------------------------------------------------
-- 1) Eventos de LIGAÇÃO que estavam gravados como reunião:
-- update public.activities
--    set type = 'CALL',
--        subtype = case when public.sgcmp_norm(title) like '%venda%' then 'SALES_CALL' else 'GENERIC_CALL' end,
--        updated_at = now()
--  where source = 'CALENDAR'
--    and type <> 'CALL'
--    and public.sgcmp_kind_from_title(title) = 'CALL';

-- 2) Compromissos internos/irrelevantes que estavam como reunião
--    (ex.: "Reunião IA/Gabriel", treinamentos, blocos de agenda).
--    Ficam guardados, mas com type 'OTHER' — fora dos indicadores.
-- update public.activities
--    set type = 'OTHER',
--        updated_at = now()
--  where source = 'CALENDAR'
--    and type = 'MEETING'
--    and public.sgcmp_kind_from_title(title) = 'OTHER';

-- 3) Conferência final:
-- select type, count(*) from public.activities where source = 'CALENDAR' group by 1 order by 1;
