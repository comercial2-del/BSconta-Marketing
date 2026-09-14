-- SGCMP — BSconta — Confirmação manual de reunião (Sim/Não)
--
-- Pedido do usuário: além do status que vem automaticamente da Agenda/RD
-- Station (Agendada, Realizada, Cancelada...), o Marlon, o Uriel e o admin
-- precisam poder marcar manualmente, reunião por reunião, se ela realmente
-- aconteceu ("Reunião: Sim ou Não"). Essa marcação fica salva e passa a
-- valer para o cálculo de "Reuniões realizadas" nos relatórios.
--
-- A tabela `activities` só permite escrita para ADMIN (policy
-- "admin write - activities", ver 01_schema.sql) — Uriel e Gabriel têm perfil
-- VIEWER e não conseguiriam gravar direto. Em vez de abrir a tabela toda para
-- escrita (o que deixaria qualquer VIEWER editar qualquer campo de qualquer
-- atividade, inclusive de outro vendedor), criamos uma função com
-- security definer que só permite:
--   - confirmar reuniões (type = 'MEETING'), nunca ligações/outras atividades;
--   - o próprio vendedor confirmar as reuniões DELE (seller_id bate com o
--     seller_id do perfil logado) — ou o admin confirmar qualquer uma.

alter table activities
  add column if not exists meeting_confirmed boolean,
  add column if not exists meeting_confirmed_by uuid references profiles(id),
  add column if not exists meeting_confirmed_at timestamptz;

comment on column activities.meeting_confirmed is
  'Confirmação manual (Sim/Não) feita pelo vendedor ou admin de que a reunião realmente aconteceu. NULL = ainda não confirmada manualmente.';

create or replace function set_meeting_confirmation(p_activity_id uuid, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles;
  v_activity activities;
begin
  select * into v_profile from profiles where id = auth.uid();
  if v_profile.id is null then
    raise exception 'Perfil não encontrado para o usuário autenticado';
  end if;

  select * into v_activity from activities where id = p_activity_id;
  if v_activity.id is null then
    raise exception 'Atividade não encontrada';
  end if;

  if v_activity.type <> 'MEETING' then
    raise exception 'Só é possível confirmar reuniões';
  end if;

  if v_profile.role <> 'ADMIN' and v_activity.seller_id is distinct from v_profile.seller_id then
    raise exception 'Sem permissão para confirmar reunião de outro vendedor';
  end if;

  update activities
  set meeting_confirmed = p_confirmed,
      meeting_confirmed_by = auth.uid(),
      meeting_confirmed_at = now()
  where id = p_activity_id;
end;
$$;

grant execute on function set_meeting_confirmation(uuid, boolean) to authenticated;

-- Para conferir depois de rodar:
--   select column_name from information_schema.columns where table_name = 'activities' and column_name like 'meeting_confirmed%';
--   select proname from pg_proc where proname = 'set_meeting_confirmation';
