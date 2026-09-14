# SGCMP — BSconta (versão HTML/CSS/JS + Supabase)

Esta é a versão em HTML, CSS e JavaScript puro do sistema, usando o **Supabase** como banco de dados. Diferente da versão anterior (Next.js), esta não precisa de Node.js rodando no seu computador — é só um conjunto de páginas que qualquer hospedagem de site estático (Netlify, por exemplo) coloca no ar com um link fixo, 24 horas por dia, sem depender do seu computador ligado.

Siga os passos na ordem. Leva uns 20-30 minutos na primeira vez.

## Passo 1 — Criar o projeto no Supabase (grátis)

1. Acesse **https://supabase.com** e clique em **Start your project** (pode entrar com GitHub ou e-mail).
2. Clique em **New project**.
3. Dê um nome (ex: `bsconta-sgcmp`), crie uma senha para o banco (guarde essa senha em lugar seguro, mas você não vai precisar dela no dia a dia) e escolha a região mais próxima (ex: South America - São Paulo).
4. Clique em **Create new project** e espere uns 2 minutos enquanto ele é criado.

## Passo 2 — Rodar os scripts SQL (cria as tabelas e carrega os dados)

1. No painel do seu projeto Supabase, clique em **SQL Editor** no menu da esquerda.
2. Clique em **New query**.
3. Abra o arquivo **`01_schema.sql`** (que te enviei), copie todo o conteúdo, cole na caixa de texto do SQL Editor, e clique em **Run** (ou Ctrl+Enter). Deve aparecer "Success".
4. Clique em **New query** de novo. Abra o arquivo **`banco/02_seed_exemplo.sql`**, copie tudo, cole, e clique em **Run**. Esse arquivo é grande (carrega os vendedores, as etapas do funil e alguns registros de exemplo, só para as telas não abrirem vazias) — pode levar alguns segundos.

## Passo 3 — Criar as contas de acesso

1. No menu da esquerda, clique em **Authentication** > **Users**.
2. Clique em **Add user** > **Create new user**.
3. Crie estas 3 contas (uma de cada vez), marcando a opção **Auto Confirm User** (ou "Email Confirm") em cada uma, para não precisar confirmar e-mail:

| E-mail | Senha (troque depois) |
|---|---|
| admin@bsconta.com.br | escolha uma senha forte |
| gestor@bsconta.com.br | escolha uma senha forte |
| comercial2@bsconta.com.br | escolha uma senha forte |

## Passo 4 — Definir quem é Administrador e quem é Visualizador

1. Volte no **SQL Editor** > **New query**.
2. Abra o arquivo **`03_promover_admins.sql`**, copie, cole, e clique em **Run**.
3. Isso deixa `admin@bsconta.com.br` e `comercial2@bsconta.com.br` (Marlon) como **Administrador** (podem editar tudo), e `gestor@bsconta.com.br` como **Visualizador** (só consulta). A última linha do script mostra uma tabela confirmando isso — confira se bateu.

## Passo 5 — Ligar as páginas ao seu projeto

1. No painel do Supabase, vá em **Project Settings** (ícone de engrenagem) > **API**.
2. Copie o valor de **Project URL**.
3. Copie o valor de **anon public** (a chave pública — NÃO a `service_role`, essa é secreta e não deve ser usada aqui).
4. Abra o arquivo **`js/config.js`** (na pasta que te enviei) em qualquer editor de texto (o Bloco de Notas serve) e troque:
   - `COLE_AQUI_A_PROJECT_URL` pela Project URL
   - `COLE_AQUI_A_ANON_KEY` pela anon public key
5. Salve o arquivo.

## Passo 6 — Testar antes de publicar

Dê duplo clique no arquivo **`login.html`** para abrir no navegador. Entre com um dos e-mails/senhas do Passo 3. Se tudo estiver certo, deve cair no painel com os números reais já carregados. Se der erro, me manda um print que eu ajudo a resolver.

## Passo 7 — Publicar no ar (link fixo, 24h)

A forma mais simples é o **Netlify**:

1. Acesse **https://app.netlify.com/drop**.
2. Arraste a pasta inteira (a que contém `login.html`, `dashboard.html`, etc.) para a área indicada na página.
3. Em segundos, o Netlify te dá um link (algo como `nome-aleatorio.netlify.app`) — esse já é o sistema no ar, acessível de qualquer lugar.
4. (Opcional) Crie uma conta gratuita no Netlify para poder editar o nome do link e atualizar o site depois sem perder o link.

Para atualizar o site depois de alguma mudança: entre no Netlify, no seu site, e arraste a pasta atualizada de novo (ou, com conta criada, use "Deploys" > arrastar a nova versão).

## Passo 8 — Conectar a sincronização automática com o RD Station CRM

Os arquivos dessa integração já estão prontos na pasta `supabase/functions/sync-rd-station/`. Ela roda no próprio Supabase (uma "Edge Function"), busca as negociações e atividades no RD Station e atualiza o banco sozinha — sem precisar de servidor próprio nem expor nenhuma chave secreta no navegador.

### 8.1 — Instalar a ferramenta de linha de comando do Supabase (uma vez só)

No computador onde você vai rodar os comandos (Windows: pode usar o PowerShell), instale a **Supabase CLI**. A forma mais simples no Windows é com o [Scoop](https://scoop.sh):

```
scoop install supabase
```

(Se preferir outra forma, veja as opções oficiais em `https://supabase.com/docs/guides/cli/getting-started`.)

### 8.2 — Conectar a CLI à sua conta e ao projeto

Dentro da pasta `versao-html-supabase` (onde está o arquivo `supabase/config.toml`), rode:

```
supabase login
supabase link --project-ref zqhuhaqothpxusnaijog
```

Isso vai abrir o navegador para você autorizar.

### 8.3 — Cadastrar o token do RD Station como segredo

Pegue o **Token da instância** no RD Station CRM (fica em **Editar Perfil**, no seu usuário — é o código que aparece logo abaixo de "Token da instância", com um botão "Desativar Token" ao lado). Depois rode (trocando `SEU_TOKEN_AQUI` pelo valor real):

```
supabase secrets set RD_STATION_TOKEN=SEU_TOKEN_AQUI
```

Esse comando roda no seu computador — o token nunca precisa ser digitado em nenhum arquivo do sistema nem enviado para mim.

### 8.4 — Publicar a função

```
supabase functions deploy sync-rd-station
```

### 8.5 — Testar manualmente

No painel do Supabase, vá em **Edge Functions** > **sync-rd-station** > aba **Testing** (ou use o botão de "Invoke"), e dispare uma chamada. Se preferir por linha de comando (troque `SUA_ANON_KEY` pela mesma chave que está no `js/config.js`):

```
curl -X POST "https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/sync-rd-station" -H "Authorization: Bearer SUA_ANON_KEY"
```

Se funcionar, a resposta traz um resumo tipo `{"ok":true,"counts":{"deals":42,"sales":10,"activities":87,...}}`. Você também pode conferir rodando no SQL Editor: `select * from sync_logs order by started_at desc limit 5;`.

### 8.6 — Agendar para rodar sozinha

No painel do Supabase: **Integrations** > **Cron** > **Create a new Cron Job**, escolha o tipo "Supabase Edge Function", selecione `sync-rd-station` e defina a frequência (ex: a cada hora). Existe também um caminho alternativo por SQL, mais avançado, no arquivo `04_agendar_sync_rd.sql` — só use esse se preferir controlar por SQL em vez do painel.

### O que a sincronização faz (e o que ainda não faz)

- Traz negociações (deals), marca como aberta/ganha/perdida, e cria a venda correspondente quando ganha.
- Traz ligações e reuniões (tasks do tipo `call` e `meeting`) do RD Station.
- Casa automaticamente com os vendedores e etapas do funil que você já tem cadastrados (por e-mail e por nome), e cria novos registros só se aparecer algo que ainda não existia.
- **Não traz margem de venda** nem **se a ligação foi atendida ou não** — o RD Station não guarda essas informações, então esses campos continuam sendo preenchidos manualmente quando fizer sentido.
- **Agenda (Google Calendar)**: continua não conectada automaticamente — as 46 reuniões reais seguem sendo as que já foram carregadas manualmente. Isso pode ser feito depois, seguindo o mesmo padrão (uma Edge Function separada), se você quiser.

## Se algo der errado

Qualquer tela de erro, print e me manda — a maior parte dos problemas nessa etapa costuma ser: chave errada no `config.js`, algum script SQL que não rodou completo, ou conta sem "Auto Confirm" marcado no Passo 3.
