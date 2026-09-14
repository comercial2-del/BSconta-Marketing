-- ---------------------------------------------------------------------------
-- 18 — Lançamento manual de ligações (14/09/2026)
--
-- POR QUE EXISTE
-- Os números de ligações vinham só do RD Station, e o RD não tem tudo: quem
-- liga sem registrar a tarefa some da conta. Na prática a tela mostrava
-- Dayane e Gabriel zerados e o Marlon com 5, o que não é a realidade.
--
-- A partir daqui o Marlon lança à mão, DIA A DIA, e o que ele lança MANDA
-- sobre o que veio do RD naquele dia.
--
-- COMO A SUBSTITUIÇÃO FUNCIONA
-- Uma linha por vendedor e por dia. No período que a tela mostra:
--   - os dias QUE TÊM lançamento usam o número lançado;
--   - os dias SEM lançamento continuam usando o que o RD/Agenda trouxe.
-- Somando os dois, sai o número do período. Semana e mês são a soma dos dias,
-- então o histórico fica consultável para trás, por qualquer recorte.
--
-- QUEM PODE ESCREVER
-- Só o Marlon (comercial2@bsconta.com.br). E a trava é no BANCO, não só na
-- tela: esconder o botão não impede ninguém de chamar a API direto. Aqui,
-- quem não for ele leva erro do Postgres.
-- ---------------------------------------------------------------------------

create table if not exists public.call_entries (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  entry_date date not null,

  sales_calls      integer not null default 0 check (sales_calls >= 0),      -- ligações de vendas
  scheduling_calls integer not null default 0 check (scheduling_calls >= 0), -- ligações de agendamento
  scheduled        integer not null default 0 check (scheduled >= 0),        -- agendamentos gerados

  -- "Total de ligações" NÃO é gravado: é sempre vendas + agendamento. Guardar
  -- um total digitado à parte abriria a porta para a soma não bater com as
  -- partes, e aí ninguém saberia qual dos três está certo.

  note text,
  updated_by uuid references public.profiles(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (seller_id, entry_date)
);

create index if not exists call_entries_data_idx on public.call_entries(entry_date);

-- Data em que o lançamento manual passou a valer. Antes disso, só o RD.
comment on table public.call_entries is
  'Lançamento manual de ligações, por vendedor e por dia, a partir de 14/09/2026. Substitui o número do RD Station nos dias lançados.';

-- ---------------------------------------------------------------------------
-- Quem pode editar
-- ---------------------------------------------------------------------------
create or replace function public.pode_editar_ligacoes()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
     where u.id = auth.uid()
       and lower(u.email) = 'comercial2@bsconta.com.br'
  );
$$;

comment on function public.pode_editar_ligacoes is
  'Só o Marlon lança ligações à mão. Para liberar outra pessoa, acrescente o e-mail dela aqui.';

grant execute on function public.pode_editar_ligacoes() to authenticated;

-- ---------------------------------------------------------------------------
-- Segurança: todos leem, só o Marlon escreve
-- ---------------------------------------------------------------------------
alter table public.call_entries enable row level security;
grant select, insert, update, delete on public.call_entries to authenticated;

drop policy if exists "ler - call_entries" on public.call_entries;
create policy "ler - call_entries" on public.call_entries
  for select to authenticated using (true);

drop policy if exists "criar - call_entries" on public.call_entries;
create policy "criar - call_entries" on public.call_entries
  for insert to authenticated with check (public.pode_editar_ligacoes());

drop policy if exists "editar - call_entries" on public.call_entries;
create policy "editar - call_entries" on public.call_entries
  for update to authenticated using (public.pode_editar_ligacoes()) with check (public.pode_editar_ligacoes());

drop policy if exists "apagar - call_entries" on public.call_entries;
create policy "apagar - call_entries" on public.call_entries
  for delete to authenticated using (public.pode_editar_ligacoes());

-- updated_at sozinho
create or replace function public.tg_call_entry_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

drop trigger if exists on_call_entry_updated on public.call_entries;
create trigger on_call_entry_updated before update on public.call_entries
  for each row execute procedure public.tg_call_entry_touch();

-- Confere
select count(*) as lancamentos,
       (select count(*) from pg_policies where tablename = 'call_entries') as politicas
  from public.call_entries;
