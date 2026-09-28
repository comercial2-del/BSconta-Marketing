-- 20_detalhes_negociacao.sql (28/09/2026) — JÁ EXECUTADO no Supabase.
-- Só o schema public (Marketing). NÃO mexe no schema rh (Ponto).
--
-- Guarda o quadro "Negociação" do RD Station de cada negociação:
-- qualificação, fonte, campanha, campos personalizados (CNPJ, Nome da
-- empresa, Serviço contratado, Data de início...) e contatos.
-- Gravado pela Edge Function sync-rd-station; usado pela tela Onboarding.
alter table public.deals add column if not exists rd_details jsonb;
comment on column public.deals.rd_details is 'Quadro "Negociação" do RD: qualificação, campos personalizados (CNPJ, serviço contratado...) e contatos. Gravado pelo sync-rd-station.';
