# Deploy — 4 passos (~12 minutos)

Tudo já está pronto nos arquivos. O que falta são quatro ações que só podem ser
feitas com a sua conta do Supabase logada.

> **Se você já fez o deploy antes:** refaça os Passos 1 e 2 (as duas funções
> mudaram) e rode o **Passo 4** (novo). O Passo 3 não precisa ser repetido.

---

## Passo 1 — Publicar a função `sync-rd-station`

1. Abra: https://supabase.com/dashboard/project/zqhuhaqothpxusnaijog/functions
2. Clique em **sync-rd-station**
3. Clique em **Code** (ou no ícone de lápis / "Edit function")
4. Selecione **todo** o conteúdo do editor (`Ctrl+A`) e apague
5. Abra o arquivo `supabase/functions/sync-rd-station/index.ts` da sua pasta,
   copie tudo (`Ctrl+A`, `Ctrl+C`) e cole no editor
6. Clique em **Deploy** / **Save and deploy**

## Passo 2 — Publicar a função `sync-calendar`

Mesma coisa, com o arquivo `supabase/functions/sync-calendar/index.ts`.

> **Se preferir usar o terminal** (mais rápido e menos sujeito a erro), dentro
> da pasta `versao-html-supabase`:
> ```
> npx supabase login
> npx supabase link --project-ref zqhuhaqothpxusnaijog
> npx supabase functions deploy sync-rd-station
> npx supabase functions deploy sync-calendar
> ```

## Passo 3 — Rodar o SQL

1. Abra: https://supabase.com/dashboard/project/zqhuhaqothpxusnaijog/sql/new
2. Abra o arquivo `14_DEPLOY.sql` da sua pasta e copie **tudo**
3. **Antes de rodar**, troque os dois `SUA_SERVICE_ROLE_KEY` (no final do
   arquivo) pela sua chave real:
   Project Settings → API → `service_role` → Copy
4. Clique em **Run**

Se aparecer erro na PARTE 4 (`pg_cron`/`pg_net`), rode só até a PARTE 3 — o
essencial já estará feito, e o agendamento continua no ritmo antigo.

## Passo 4 — Rodar o SQL das exclusões

1. Abra: https://supabase.com/dashboard/project/zqhuhaqothpxusnaijog/sql/new
2. Abra o arquivo `15_sincronizar_exclusoes.sql` da sua pasta, copie **tudo** e cole
3. Clique em **Run**

Não pede chave nenhuma e não apaga nada — só cria a coluna `deleted_at` (nas
negociações e nas atividades) e uma tabelinha de controle. No fim ele mostra
uma conferência com `OK` em cada linha.

É isto que faz o que você pediu: **apagou na Agenda ou no RD, some do
sistema.** Sem este passo as funções continuam rodando normalmente, só que sem
sincronizar exclusões.

---

## Como saber se funcionou

**No Supabase**, rode no SQL Editor:

```sql
select source, status, started_at, finished_at, records_synced, error
  from public.sync_logs
 order by started_at desc limit 10;
```

Espere ver linhas com `status = SUCCESS`. A coluna `error` pode ter avisos de
sincronização parcial — isso é informativo, não é falha.

**No sistema**, abra o dashboard e aperte **Ctrl+Shift+R** (não só Ctrl+R — o
navegador guarda CSS e JS em cache). Você deve ver:

- o aviso **"Sincronizando..."** no canto inferior direito
- depois **"Sincronização concluída — X registros atualizados"** em verde

Se aparecer vermelho, clique no aviso: ele mostra o erro técnico exato.

---

## Teste rápido depois do deploy

1. No RD, mova um card de coluna ou mude um valor
2. Espere ~1 minuto
3. No sistema, aperte `Ctrl+R`
4. A mudança deve aparecer

Para a venda: marque uma negociação como ganha no RD, recarregue e confira a
tela **Vendas** com o filtro no período do fechamento (a venda entra na data
de fechamento, não na data de hoje).

---

## O que cada parte do SQL resolve

| Parte | Resolve | Obrigatório? |
|---|---|---|
| 1 — índice único em `sales` | **A venda não importava.** Sem o índice o Postgres devolve erro 42P10 e a sincronização inteira era abortada — negociações, ligações e reuniões paravam junto | **Sim** |
| 2 — `upsert_rd_activities` | O KPI "Ligações de vendas" caía sozinho a cada sincronização | **Sim** |
| 3 — reclassificação | Deixa o banco coerente com a tela (a tela já mostra certo sem isto) | Opcional |
| 4 — agendamento | RD a cada 5 min, Agenda a cada 1 min | Opcional |

## O que já está corrigido no código (vale a partir do deploy)

- **Comparação de datas por texto** na sincronização incremental: o RD manda a
  data com fuso `-03:00` e o sistema comparava com UTC como se fosse texto.
  Tudo que mudou nas últimas ~3 horas ficava invisível — e o `break` abortava a
  varredura inteira. Agora compara tempo de verdade, com 10 min de folga.
- **Fuso horário na gravação**: horário sem offset era lido como UTC. Uma
  tarefa das 09:00 virava 06:00, e uma tarefa sem hora caía no **dia anterior**
  — errando o filtro por dia/semana.
- **Janela de busca da Agenda**: 14 → 75 dias (14 não cobria "Mês passado").
- **Paginação da Agenda**: acima de 250 eventos o resto era descartado calado.
- **Erro nas vendas não derruba mais o resto** da sincronização.
- **Trava anti-sobreposição**: duas execuções nunca rodam ao mesmo tempo.
- **CORS**: permite a página disparar a sincronização ao ser carregada.

---

## Exclusões — o que passa a acontecer (Passo 4)

| Você apaga / desfaz | Some do sistema em |
|---|---|
| Reunião ou ligação na **Agenda** | até **1 minuto** |
| Ligação ou reunião (tarefa) no **RD** | até **5 minutos** |
| **"Retomar Negociação"** (o card deixa de estar ganho) | até **5 minutos** — a venda sai do faturamento |
| **Card apagado** no RD | até **5 minutos** |
| Tarefa apagada no RD, em pequena quantidade | até **5 minutos** |

O RD não avisa que um card sumiu — ele simplesmente para de aparecer. Para
descobrir, seria preciso percorrer **todas** as negociações e comparar, o que é
pesado demais para fazer de 5 em 5 minutos. Então, antes de varrer, uma única
chamada barata pergunta ao RD **quantas** negociações existem: se o número não
mudou, ninguém apagou nada e a varredura é dispensada. Quando o número muda, a
varredura roda na hora. Uma varredura completa também acontece de hora em hora
como rede de segurança.

**Nada é apagado do banco.** O registro recebe uma marca de "excluído" e some
da tela. Se ele voltar a existir na origem, a marca é limpa sozinha e ele
reaparece — inclusive os números históricos.

**Quatro travas de segurança** impedem que uma falha de API esvazie o sistema:

1. se a busca não trouxe a janela/lista inteira, nada é marcado;
2. se a origem devolveu uma lista vazia, nada é marcado;
3. se o RD devolveu menos de 70% dos cards que existem no sistema, a varredura
   é abortada e o motivo fica registrado;
4. se de uma vez sumirem mais de 25 registros **e** mais de 10% do histórico,
   nada é escondido — ninguém apaga centenas de ligações de uma vez; isso é
   resposta incompleta da API.

> A trava nº 4 não é teoria: na primeira execução real (05/09/2026) a
> conferência quis esconder **468 ligações** — 37% de todo o histórico do RD.
> Teria derrubado o KPI "Ligações" pela metade sem ninguém mexer em nada.
> Hoje o aviso aparece na resposta da sincronização e nada é escondido.
>
> **RESOLVIDO em 06/09/2026.** As 468 não eram tarefas do RD: 467 delas eram
> ligações **inventadas** pelo `02_seed_dados_reais.sql` (external_id
> `seed_call_...`, sem título, sem negociação), gravadas com
> `source = 'RD_STATION'` e por isso confundidas com tarefas reais. A conta
> fecha exatamente: 803 reais + 467 inventadas + 1 tarefa que o RD deixou de
> devolver = 1.271. A conferência estava certa; a trava é que vinha segurando
> dados falsos no ar. O `16_ocultar_dados_demo.sql` escondeu as 467 (exclusão
> suave, reversível) e a trava voltou a ficar quieta.

Sentido único, por definição: o sistema **lê** do RD e da Agenda, nunca
escreve. Apagar algo dentro do sistema não apaga no RD nem na Agenda.
