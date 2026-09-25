-- 19_fonte_campanha.sql — fonte e campanha do RD Station nas negociações (25/09/2026)
--
-- A sincronização (sync-rd-station) passou a gravar:
--   deals.origin   = fonte da negociação no RD (deal.deal_source.name)
--   deals.campaign = campanha da negociação no RD (deal.campaign.name)
-- Usadas na aba Marketing (origem dos leads por canal e por campanha).
--
-- Já executado em produção em 25/09/2026. Pode rodar de novo sem problema.
alter table public.deals add column if not exists campaign text;
create index if not exists deals_origin_idx on public.deals(origin);
create index if not exists deals_campaign_idx on public.deals(campaign);

-- Depois de criar a coluna, para preencher as negociações antigas rode uma
-- sincronização COMPLETA (POST na função com o corpo {"full": true}).
