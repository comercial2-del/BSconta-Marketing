# Colocar o sistema no ar

> **Resumo:** repositório privado **publica normalmente**. O site fica público
> no endereço; o código continua fechado. É assim que a maioria das empresas
> trabalha, e não custa nada a mais.

---

## O mal-entendido que quase nos custou caro (14/09/2026)

Durante a montagem do repositório, a ideia que circulou foi: *"não consigo
publicar um sistema e deixar ele no ar se o repositório é privado"*. Por causa
disso, quase deixamos público um repositório com o histórico de faturamento da
BSconta dentro.

**Não é verdade.** Netlify, Vercel e Cloudflare Pages leem repositórios
privados sem problema — você autoriza o aplicativo uma vez no GitHub e ele
passa a enxergar o repositório. O que vai para o ar é o *site gerado*; o
código-fonte continua fechado.

Fontes oficiais, conferidas em 14/09/2026:

- **Netlify** — repositórios privados **de conta pessoal** funcionam em
  **todos os planos**, inclusive o gratuito. Só repositórios privados de
  *organização* exigem o plano Core Pro.
  → https://docs.netlify.com/git/overview/
- **GitHub Pages** — esta é a única exceção relevante: publicar a partir de
  repositório privado exige **GitHub Pro** (pago). No plano gratuito, o Pages
  só serve repositório público.
  → https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

O repositório da BSconta está na conta pessoal `comercial2-del`, não numa
organização. **Ou seja: Netlify no plano gratuito, com o repositório privado,
resolve.**

---

## Por que isto importa aqui

Deixar este repositório público expõe três coisas, e nenhuma delas precisa
ficar exposta:

1. **O endereço do banco no Supabase** (`js/config.js`). A chave ali é a
   pública, que vai no navegador de qualquer visitante de qualquer forma, e as
   regras de acesso (RLS) do `banco/01_schema.sql` é que protegem os dados —
   mas publicar é entregar o mapa de onde bater.
2. **Os e-mails internos** (`comercial@`, `comercial2@`, `admin@`,
   `gestor@bsconta.com.br`), que viram alvo de phishing.
3. **O desenho da segurança** — as políticas de acesso, escritas e comentadas.

O histórico de faturamento já está de fora: o `banco/02_seed_dados_reais.sql`
está no `.gitignore` e nunca sobe. Quem instala do zero usa o
`banco/02_seed_exemplo.sql`.

---

## Publicando na Netlify (repositório privado)

1. Entre em **https://app.netlify.com** com a conta do GitHub
   (`comercial2-del`).
2. **Add new site → Import an existing project → GitHub**.
3. O GitHub vai pedir autorização. Escolha **Only select repositories** e
   marque só o repositório do sistema — assim a Netlify não enxerga mais nada
   da sua conta.
4. Selecione o repositório.
5. Nas configurações de build, **deixe tudo em branco**:
   - *Build command*: vazio (não existe build, são páginas prontas)
   - *Publish directory*: vazio, ou `.` — **a pasta raiz**, a que tem o
     `index.html`
6. **Deploy site**.

Em menos de um minuto sai um endereço tipo
`https://nome-aleatorio.netlify.app`. Dá para trocar por um nome melhor em
**Site configuration → Change site name**, ou apontar um domínio da BSconta.

### O erro que quebra tudo

**Não aponte o *publish directory* para `telas`.** É o engano mais fácil de
cometer, porque é lá que ficam as telas. Mas se você fizer isso, as páginas
sobem para a raiz do site e os caminhos `../css` e `../js` passam a apontar
para fora — resultado: tudo abre sem estilo e sem funcionar.

A raiz tem que ser a pasta com o `index.html`, que é quem manda o visitante
para `telas/login.html`.

### Depois de publicar

No painel do Supabase, em **Authentication → URL Configuration**, acrescente o
endereço do site em **Site URL** e em **Redirect URLs**. Sem isso o login pode
recusar a sessão vinda do domínio novo.

---

## E se mesmo assim quiser público

É uma decisão legítima — portfólio, por exemplo. Nesse caso, antes de subir:

- confirme que o `banco/02_seed_dados_reais.sql` continua no `.gitignore`;
- troque os e-mails de exemplo no `banco/03_promover_admins.sql`;
- e saiba que o `js/config.js` vai junto, porque sem ele o site não conecta.

Só nunca faça o caminho inverso: subir com os dados e apagar depois. O Git
guarda tudo o que já foi enviado, para sempre, mesmo depois de o arquivo ser
removido.
