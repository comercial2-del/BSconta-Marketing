-- 23_onboarding_dados_constituicao.sql (28/09/2026) — JÁ EXECUTADO no Supabase.
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
-- Processo de Constituição: um campo só com os dados que o cliente enviou,
-- editável pelo Uriel (mesmas regras de acesso da tabela onboarding_notas, SQL 22).
alter table public.onboarding_notas add column if not exists dados_cliente text;
