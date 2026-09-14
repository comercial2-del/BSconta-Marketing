# BSconta + Marketing — SGCMP

Sistema comercial da BSconta: ligações, reuniões, funil, vendas, metas e
relatórios, alimentado automaticamente pelo **RD Station CRM** e pelo **Google
Agenda**.

São páginas HTML, CSS e JavaScript puro — sem framework e sem build. Qualquer
hospedagem de site estático coloca no ar, e o banco de dados fica no
**Supabase**.

> **O que este repositório deliberadamente NÃO contém.** O seed com o
> histórico real da BSconta — faturamento, ticket e desempenho por vendedor —
> fica de fora (ver `.gitignore`); quem instala do zero usa o
> `banco/02_seed_exemplo.sql`. Chaves de serviço, senhas e tokens também não
> estão aqui: as funções do Supabase leem tudo de variáveis de ambiente.

---

## Como rodar na sua máquina

Não precisa instalar nada para usar o sistema — basta abrir as páginas por um
servidor local (abrir o arquivo direto pelo `file://` não funciona, o login do
Supabase exige `http://`):

```bash
python3 -m http.server 8080
# depois abra http://localhost:8080
```

Para rodar os testes automatizados:

```bash
npm install     # baixa Playwright e Chart.js (só para os testes)
npm run teste   # roda a bateria inteira
```

---

## Estrutura

```
BSconta + Marketing/
├── index.html          ← porta de entrada: manda para o login ou para a visão geral
├── README.md
├── package.json
├── telas/              as 9 telas do sistema
├── css/                styles.css — todo o visual, responsivo e impressão
├── js/                 o funcionamento (ver tabela abaixo)
├── assets/             logo e ícone
├── banco/              as migrações SQL, na ordem numérica
├── docs/               GUIA, DEPLOY e INTEGRACAO_GOOGLE_CALENDAR
├── supabase/           as funções que falam com o RD e a Agenda
└── test/               testes automatizados
```

**Duas regras da estrutura que não dá para quebrar:**

1. **`index.html` fica na raiz.** É o arquivo que qualquer hospedagem serve
   quando alguém abre o endereço do site. Movido para dentro de `telas/`, o
   site perde a porta de entrada.
2. **`supabase/functions/` não muda de nome.** O caminho
   `supabase/functions/<nome>/index.ts` é exigido pela ferramenta do Supabase
   na hora de publicar as funções.

Como as telas moram em `telas/`, os caminhos dentro delas apontam para fora com
`../` (`../css/styles.css`, `../js/data.js`). O `test/verify-estrutura.mjs`
confere isso a cada execução: se algum arquivo deixar de ser encontrado, ele
reprova — mesmo que a página continue abrindo.

| Arquivo | O que é |
|---|---|
| `js/config.js` | Endereço e chave pública do Supabase. **Trocar ao mudar de projeto.** |
| `js/data.js` | Busca os dados no Supabase, com paginação e cache de sessão. |
| `js/calc.js` | Todas as regras de negócio: o que é reunião, o que é ligação, KPIs, funil, metas. |
| `js/ui.js` | Menu, cabeçalho, filtro de período, calendário, componentes de tela. |
| `js/charts.js` | Gráficos (Chart.js). |
| `js/sync.js` | Dispara a sincronização com RD/Agenda ao abrir uma página. |
| `js/auth.js` | Login, sessão e perfil de acesso. |

---

## Banco

Os arquivos `banco/NN_*.sql` são as migrações, aplicadas **em ordem** no SQL Editor do
Supabase. Cada uma pode ser rodada mais de uma vez sem estragar nada.

Os mais importantes de conhecer:

- `banco/02_seed_exemplo.sql` — vendedores, as 8 etapas do funil e alguns registros de exemplo.
- `banco/01_schema.sql` — tabelas base (vendedores, funil, negociações, atividades, vendas, metas) e as regras de acesso.
- `banco/09_meeting_confirmation.sql` — confirmação manual "a reunião aconteceu?".
- `banco/15_sincronizar_exclusoes.sql` — o que é apagado no RD/Agenda some do sistema (sem apagar de verdade).
- `banco/16_ocultar_dados_demo.sql` — escondeu 467 ligações de demonstração que inflavam os números.

Detalhes de instalação passo a passo estão no **`docs/GUIA.md`**; o que já foi
para produção e o que ainda está pendente, no **`docs/DEPLOY.md`**; a conexão com o
Google Agenda, no **`docs/INTEGRACAO_GOOGLE_CALENDAR.md`**.

Para colocar o sistema no ar, veja **`docs/HOSPEDAGEM.md`** — inclusive o
porquê de repositório privado publicar normalmente.

---

## Regras que não são óbvias olhando o código

Estão comentadas nos arquivos, mas vale registrar aqui porque foram decisões do
negócio, não escolhas técnicas:

- **Ligação nunca é reunião.** Qualquer evento cujo título fale de ligação,
  chamada, call ou telefonema conta como ligação, mesmo que a Agenda o tenha
  importado como reunião. Só conta como reunião o que se chama "Reunião..." ou
  "BSconta x <cliente>".
- **O mesmo evento na agenda de duas pessoas conta uma vez.** O Google grava uma
  cópia por participante; o sistema agrupa pelo identificador do evento.
- **Nada é apagado de verdade.** Exclusão no RD ou na Agenda marca `deleted_at`
  e o registro some das telas — mas continua no banco e volta sozinho se
  reaparecer na origem.

---

## Segredos

Nenhum arquivo deste repositório tem chave de serviço, senha ou token. As
funções do Supabase leem tudo de variáveis de ambiente
(`SUPABASE_SERVICE_ROLE_KEY`, `RD_STATION_TOKEN`, `GOOGLE_CLIENT_SECRET`), que
ficam no painel do Supabase. **Continue assim** — o `.gitignore` já bloqueia
`.env` e arquivos de chave.

A chave em `js/config.js` é a *publishable* (anon): ela é pública por natureza,
vai no navegador de qualquer jeito, e sozinha não dá acesso a nada — quem
protege os dados são as políticas de acesso (RLS) do `01_schema.sql`.
