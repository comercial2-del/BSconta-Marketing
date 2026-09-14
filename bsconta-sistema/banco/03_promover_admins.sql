-- Rode isto DEPOIS de criar as contas em Authentication > Users (veja o
-- passo-a-passo). Ajusta o nome e o papel (ADMIN/VIEWER) de cada conta.
-- Pode rodar de novo sem problema se precisar ajustar depois.

-- Administrador principal
update profiles set role = 'ADMIN', name = 'Administrador BSconta'
where id = (select id from auth.users where email = 'admin@bsconta.com.br');

-- Gestor (só visualização)
update profiles set role = 'VIEWER', name = 'Gestor BSconta'
where id = (select id from auth.users where email = 'gestor@bsconta.com.br');

-- Marlon — administrador, ligado ao vendedor "Marlon" já cadastrado
update profiles set role = 'ADMIN', name = 'Marlon', seller_id = (select id from sellers where email = 'comercial2@bsconta.com.br')
where id = (select id from auth.users where email = 'comercial2@bsconta.com.br');

-- Conferir o resultado:
select p.name, u.email, p.role, s.name as vendedor_ligado
from profiles p
join auth.users u on u.id = p.id
left join sellers s on s.id = p.seller_id;
