-- 24_onboarding_etapas.sql (30/09/2026)
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
--
-- Andamento da timeline de 10 etapas do Onboarding, compartilhado entre todos
-- os usuários. Antes ficava só no localStorage de cada navegador
-- ('bsconta_onboarding_timeline_v1'): quem marcava "Concluído" via a mudança,
-- o resto da equipe (ex.: Gustavo) continuava vendo 0/10.
--
-- dados = { stages:[...10 etapas...], nextStep, auditHistory:[...] }
-- Todos os usuários logados podem ver e alterar (mesmo comportamento de antes).
create table if not exists public.onboarding_etapas (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  dados jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

alter table public.onboarding_etapas enable row level security;

drop policy if exists "etapas_ver" on public.onboarding_etapas;
drop policy if exists "etapas_incluir" on public.onboarding_etapas;
drop policy if exists "etapas_alterar" on public.onboarding_etapas;
create policy "etapas_ver" on public.onboarding_etapas for select to authenticated using (true);
create policy "etapas_incluir" on public.onboarding_etapas for insert to authenticated with check (true);
create policy "etapas_alterar" on public.onboarding_etapas for update to authenticated using (true) with check (true);

grant select, insert, update on public.onboarding_etapas to authenticated;
