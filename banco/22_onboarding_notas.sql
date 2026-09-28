-- 22_onboarding_notas.sql (28/09/2026) — JÁ EXECUTADO no Supabase.
-- Marketing (schema public). NÃO mexe no schema rh (Ponto).
-- Alerta do card de Onboarding (o que o cliente quer), editável só pelo Uriel
-- (mesma regra dos anexos: public.pode_anexar_onboarding(), do SQL 21).
create table if not exists public.onboarding_notas (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  alerta text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.onboarding_notas enable row level security;
drop policy if exists "notas_ver" on public.onboarding_notas;
drop policy if exists "notas_incluir" on public.onboarding_notas;
drop policy if exists "notas_alterar" on public.onboarding_notas;
create policy "notas_ver" on public.onboarding_notas for select to authenticated using (true);
create policy "notas_incluir" on public.onboarding_notas for insert to authenticated with check (public.pode_anexar_onboarding());
create policy "notas_alterar" on public.onboarding_notas for update to authenticated using (public.pode_anexar_onboarding()) with check (public.pode_anexar_onboarding());
grant select, insert, update on public.onboarding_notas to authenticated;
