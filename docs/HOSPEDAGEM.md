# Colocar o sistema no ar

Do computador ao endereço na internet, em seis passos. O código fica num
repositório **privado** no GitHub; a Netlify lê esse repositório e publica o
site. O que vai para o ar é o site — o código continua fechado.

**Antes de começar:** a pasta do projeto conferida, conta no GitHub
(`comercial2-del`) e conta na Netlify (dá para entrar com o próprio GitHub).

---

## 1. Mostrar os arquivos ocultos no Windows

No Explorer, aba **Exibir** → marque **Itens ocultos**.

**Não pule.** O `.gitignore` começa com ponto, então o Windows esconde ele. Com
os itens ocultos desligados, o `Ctrl+A` não pega esse arquivo e ele não sobe —
foi exatamente o que aconteceu na primeira tentativa (14/09/2026). É o arquivo
que impede o `node_modules` e os dados reais de irem parar no repositório.

## 2. Criar o repositório

No GitHub: **New repository**. Nome `BSconta-Marketing`, visibilidade
**Private**, e **não** marque "Add a README file" — o projeto já tem o dele.
**Create repository**.

### Privado publica normalmente

Repositório privado **de conta pessoal** funciona na Netlify em **todos os
planos**, inclusive o gratuito. Você autoriza o aplicativo uma vez no GitHub e
ele passa a enxergar o repositório.

Isso precisa estar escrito porque, durante a montagem, circulou a ideia de que
"não dá para publicar com repositório privado" — e por causa disso quase
deixamos público um repositório com o histórico de faturamento da BSconta
dentro.

Fontes oficiais, conferidas em 14/09/2026:

- **Netlify** — privados de conta pessoal em todos os planos; só os de
  *organização* exigem o Core Pro. → https://docs.netlify.com/git/overview/
- **GitHub Pages** — a única exceção relevante: publicar a partir de
  repositório privado exige GitHub Pro (pago).
  → https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

## 3. Enviar os arquivos

Na tela do repositório vazio, clique em **uploading an existing file**. Abra a
pasta do projeto, **entre nela**, dê `Ctrl+A` e arraste tudo. Mensagem do
commit: `Sistema comercial BSconta (SGCMP)`.

Antes de confirmar, a lista tem que começar assim:

```
.gitignore · 404.html · assets/ · banco/ · css/ …
```

**Se aparecer o nome da pasta na frente** (`bsconta-sistema/css/styles.css`),
cancele e refaça **entrando** na pasta antes do `Ctrl+A`. Arrastando a pasta
inteira, tudo vai parar um nível abaixo e o site não encontra nada.

## 4. Conectar a Netlify

**Add new site → Import an existing project → GitHub**. Na autorização, escolha
**Only select repositories** e marque só este — assim a Netlify não enxerga mais
nada da sua conta. Depois, as configurações de build:

| Campo             | Valor          |
| ----------------- | -------------- |
| Base directory    | **deixe vazio** |
| Build command     | deixe vazio    |
| Publish directory | `.`            |

**Deploy site.** Em menos de um minuto sai um endereço `.netlify.app`.

### As duas armadilhas

**Base directory precisa ficar vazio.** Apontado para uma subpasta, a Netlify
procura o site no lugar errado e serve "Page not found".

**Nunca aponte o publish para `telas`.** É o engano mais fácil de cometer,
porque é lá que ficam as telas. Mas aí elas sobem para a raiz do site e os
caminhos `../css` e `../js` passam a apontar para fora — tudo abre sem estilo e
sem funcionar. A raiz tem que ser a pasta com o `index.html`, que é quem manda o
visitante para `telas/login.html`.

## 5. Deixar o site público

Em **Site configuration**, confirme que o site não está protegido por senha. O
repositório é privado; o *site* precisa ser público, senão quem abrir o endereço
leva um erro `401` em vez da tela de login.

Aproveite e troque o endereço aleatório em **Site configuration → Change site
name**.

## 6. Avisar o Supabase do endereço novo

No painel do Supabase: **Authentication → URL Configuration**. Coloque o
endereço do site em **Site URL** e acrescente em **Redirect URLs**.

Sintoma de quem esquece: o site abre, a tela de login aparece, a senha está
certa — e a sessão é recusada. O Supabase só aceita login vindo de endereços que
ele conhece.

---

## Quando você mudar alguma coisa depois

Todo commit no GitHub dispara uma publicação automática na Netlify. É bom — e é
caro:

- **15 créditos** por publicação
- **300 créditos** por mês no plano gratuito

Ou seja: **20 publicações por mês**. Por isso vale juntar várias mudanças num
commit só, em vez de subir arquivo por arquivo.

## O que nunca sobe

O `banco/02_seed_dados_reais.sql` — faturamento, ticket e desempenho por
vendedor. Está no `.gitignore` e fica só no computador de quem administra. Quem
instala do zero usa o `banco/02_seed_exemplo.sql`.

Uma vez commitado, um arquivo fica no histórico **para sempre**, mesmo depois de
apagado. Por isso a ordem importa: conferir antes de subir, nunca subir e limpar
depois.

## O que o netlify.toml já resolve

Ele está na raiz do projeto e cuida sozinho de:

- bloquear `banco/`, `docs/`, `test/` e `supabase/` no ar (ficam no
  repositório, mas não são servidos);
- apontar a página de erro para o `404.html`;
- mandar o navegador sempre revalidar o HTML, para não misturar uma tela antiga
  em cache com um `js/` novo.
