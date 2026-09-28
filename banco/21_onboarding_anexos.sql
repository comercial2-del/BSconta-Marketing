-- 21_onboarding_anexos.sql (28/09/2026) — JÁ EXECUTADO no Supabase.
-- Marketing (schema public + Storage). NÃO mexe no schema rh (Ponto).
-- Anexos do card de Onboarding: documentos do cliente, vídeo e anotações da reunião.
-- Só o Uriel Coelho (auth uid e99d1c7f-749e-4348-b34a-4fb0631ba371) pode anexar e apagar;
-- todos os usuários logados podem ver. Limite de arquivo = limite global do Storage (50 MB).
create or replace function public.pode_anexar_onboarding() returns boolean
language sql stable as $f$ select auth.uid() = 'e99d1c7f-749e-4348-b34a-4fb0631ba371'::uuid $f$;

create table if not exists public.onboarding_anexos (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  categoria text not null check (categoria in ('documento','video','anotacao')),
  nome text not null,
  caminho text not null unique,   -- caminho no bucket, ou URL (link de vídeo)
  tamanho bigint,
  tipo text,
  enviado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists onboarding_anexos_deal_idx on public.onboarding_anexos(deal_id);
alter table public.onboarding_anexos enable row level security;
drop policy if exists "anexos_ver" on public.onboarding_anexos;
drop policy if exists "anexos_incluir" on public.onboarding_anexos;
drop policy if exists "anexos_apagar" on public.onboarding_anexos;
create policy "anexos_ver" on public.onboarding_anexos for select to authenticated using (true);
create policy "anexos_incluir" on public.onboarding_anexos for insert to authenticated with check (public.pode_anexar_onboarding());
create policy "anexos_apagar" on public.onboarding_anexos for delete to authenticated using (public.pode_anexar_onboarding());
grant select, insert, delete on public.onboarding_anexos to authenticated;

insert into storage.buckets (id, name, public) values ('onboarding-anexos', 'onboarding-anexos', false)
on conflict (id) do nothing;
drop policy if exists "onb_anexos_ver" on storage.objects;
drop policy if exists "onb_anexos_incluir" on storage.objects;
drop policy if exists "onb_anexos_apagar" on storage.objects;
create policy "onb_anexos_ver" on storage.objects for select to authenticated using (bucket_id = 'onboarding-anexos');
create policy "onb_anexos_incluir" on storage.objects for insert to authenticated with check (bucket_id = 'onboarding-anexos' and public.pode_anexar_onboarding());
create policy "onb_anexos_apagar" on storage.objects for delete to authenticated using (bucket_id = 'onboarding-anexos' and public.pode_anexar_onboarding());
