-- ---------------------------------------------------------------------------
-- DESFAZER a migração 18 (lançamento manual de ligações)
--
-- QUANDO USAR
-- Se o lançamento manual der problema e você quiser o banco exatamente como
-- estava antes de 14/09/2026.
--
-- POR QUE ISTO BASTA COMO "VOLTA"
-- A migração 18 só CRIA coisa nova: uma tabela, uma função e as permissões
-- delas. Ela não altera nenhuma tabela que já existia, nenhum dado, nenhuma
-- política antiga. Então desfazer é remover o que foi criado — e o que havia
-- antes continua intacto porque nunca foi tocado.
--
-- O AVISO do Supabase ("This query includes destructive operations") aparece
-- por causa dos `drop policy if exists` da migração. Eles apagam e recriam as
-- políticas DA TABELA NOVA, na mesma execução. Nenhuma política de activities,
-- deals, sales ou goals é tocada.
--
-- ATENÇÃO: isto APAGA os lançamentos manuais já feitos. Se houver lançamento
-- que você queira guardar, rode antes a consulta do fim deste arquivo e
-- guarde o resultado.
-- ---------------------------------------------------------------------------

-- 1) Veja o que será perdido ANTES de apagar
select seller_id, entry_date, sales_calls, scheduling_calls, scheduled, updated_by_name
  from public.call_entries
 order by entry_date desc, seller_id;

-- 2) Remova (descomente as três linhas abaixo para executar de fato)
-- drop trigger if exists on_call_entry_updated on public.call_entries;
-- drop table if exists public.call_entries;          -- leva junto as políticas e os índices
-- drop function if exists public.pode_editar_ligacoes();
-- drop function if exists public.tg_call_entry_touch();

-- 3) Confira que sumiu
-- select to_regclass('public.call_entries') as tabela,
--        (select count(*) from pg_proc where proname = 'pode_editar_ligacoes') as funcao;
