# Integração Google Agenda ↔ RD Station — verificação de reuniões

Documentação da integração testada e ativada em 02/09/2026, no projeto Supabase
`zqhuhaqothpxusnaijog` (BSconta Marketing).

## O que foi feito

1. Criado um projeto no Google Cloud (`BSconta-SGCMP-Agenda`), com a API do
   Google Calendar ativada e uma tela de consentimento OAuth ("Externo",
   porque a vendedora Dayane Silva usa e-mail `agmoonflag.com.br`, diferente
   do domínio `bsconta.com.br`). Usuários de teste cadastrados: os 3 e-mails
   do time (`comercial2@`, `comercial@`, `gabriel@bsconta.com.br`).
2. Criado um Client ID OAuth 2.0 "Aplicativo da Web", com redirect URI
   apontando para a Edge Function `google-oauth-callback`.
3. Três Edge Functions no Supabase (já existiam no projeto, apenas configuradas
   e testadas nesta rodada):
   - `google-oauth-start` — gera o link de autorização do Google para um vendedor.
   - `google-oauth-callback` — recebe o retorno do Google, troca o código por
     tokens e grava em `calendar_tokens`.
   - `sync-calendar` — para cada vendedor conectado, renova o access_token e
     importa os eventos da Agenda (últimos 14 dias + próximos 30) para a
     tabela `activities` (`source = 'CALENDAR'`).
4. Uma tabela nova (`calendar_tokens`, sem policies de RLS — só as Edge
   Functions com service_role conseguem ler) e uma view (`meeting_divergences`)
   que compara reuniões do RD Station com eventos da Agenda do mesmo vendedor
   dentro de uma janela de 30 minutos, sinalizando `SEM_EVENTO_NA_AGENDA`
   quando não há evento correspondente. Script: `05_calendar_schema.sql`
   (já executado).
5. Cron job `sync_calendar_30min` (a cada 30 minutos), igual em espírito ao
   `sync_rd_station_15min` já existente. Script: `06_agendar_sync_calendar.sql`
   (já executado).

## Credenciais/segredos provisórios criados

Configurados em **Supabase > Project Settings > Edge Functions > Secrets**
(mecanismo apropriado para Edge Functions — não usa `.env`, que não se aplica
ao runtime Deno do Supabase):

| Secret | Valor | Observação |
|---|---|---|
| `GOOGLE_CLIENT_ID` | `9220965926-jl0lkltqkjtrqdqb918gghv1rqujj6es.apps.googleusercontent.com` | Do OAuth Client "SGCMP - Agenda Vendedores" |
| `GOOGLE_CLIENT_SECRET` | (valor secreto, salvo no Supabase) | **Regenerado** durante o teste — o primeiro valor digitado estava incorreto (erro `invalid_client` do Google) e foi substituído por um novo secret válido, gerado direto no Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | `https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/google-oauth-callback` | Precisa ser idêntico ao cadastrado no Google Cloud Console |

Nenhum segredo foi exposto em código-fonte; tudo está apenas nos Secrets do
Supabase.

**Vendedor conectado neste teste:** Marlon (`comercial2@bsconta.com.br`,
`seller_id = 4d483cc9-7b90-44fb-91a0-85cfa7d934be`). Os demais vendedores
(Dayane, Gabriel, Uriel) ainda não conectaram a própria Agenda.

## Como conectar a Agenda de outro vendedor

Peça para o vendedor (logado com a própria conta Google) abrir, no navegador:

```
https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/google-oauth-start?seller_id=<seller_id do vendedor>
```

Ele vai autorizar o acesso (somente leitura da Agenda) e ver a mensagem
"Agenda conectada com sucesso!". Nenhuma senha do BSconta é envolvida — é
login do Google do próprio vendedor.

**Atenção:** enquanto a tela de consentimento OAuth estiver em modo "Teste"
(Google Cloud > Tela de permissão OAuth), só os e-mails cadastrados como
"usuários de teste" conseguem autorizar. Para liberar para qualquer vendedor
sem cadastrá-lo manualmente, será preciso publicar o app (Google pode exigir
verificação, já que o escopo do Calendar é sensível).

## Como foi testado (validação de ponta a ponta)

1. Autorizado o acesso via `google-oauth-start` para o vendedor Marlon →
   redirecionou corretamente para o Google → callback processou o código e
   gravou `calendar_tokens` com `refresh_token` real (confirmado via SQL).
2. Invocado manualmente `sync-calendar` (via `net.http_post` no SQL Editor,
   mesma técnica usada pelo cron do RD Station) → resposta HTTP 200:
   `{"ok":true,"counts":{"sellers_conectados":1,"eventos":45,"erros_por_vendedor":0}}`.
3. Conferido `sync_logs`: linha nova com `source = CALENDAR`,
   `status = SUCCESS`, `records_synced = 45`.
4. Consultada a view `meeting_divergences`: retornou 3 reuniões "OK" (com
   evento correspondente na Agenda) e 200 "SEM_EVENTO_NA_AGENDA" — número alto
   porque só 1 de 4 vendedores tem a Agenda conectada até agora; à medida que
   os outros conectarem, essa comparação passa a valer para eles também.
5. Conferido que o sync do RD Station continua saudável (rodando a cada 15
   min, 803 registros por execução, `status = SUCCESS`) — a nova integração
   não interferiu na existente.

## Resultado

Integração funcional de ponta a ponta, validada com dados reais (não é só
"o código compila"): OAuth completo, tokens salvos, eventos importados,
comparação RD × Agenda funcionando, e sincronização automática agendada.

## Atualização de 02/09/2026 — bug crítico corrigido (reuniões "sumindo")

Depois que Marlon e Uriel conectaram a Agenda, o Marlon relatou ver muito
menos reuniões no sistema do que via de fato no Google Calendar (ex.: só
2-3 reuniões na semana, quando a Agenda mostrava mais de 20).

**Causa:** o Google Calendar usa o MESMO id de evento na agenda do
organizador e na de cada convidado. Como o Marlon é o SDR (agenda as
reuniões) e convida o Uriel (quem realiza a reunião), todo evento
"Reunião BSconta x (Cliente)" aparecia nas DUAS agendas com o mesmo id. A
tabela `activities` só tinha uma trava de unicidade global em
`external_id`, então a cada sincronização o vendedor processado por
último "roubava" o registro do outro — o Marlon ficava com quase nada na
tabela, mesmo tendo agendado a reunião de verdade.

**Correção aplicada** (script `07_fix_calendar_seller_uniqueness.sql` +
nova versão de `sync-calendar/index.ts`):
- A trava de unicidade passou a ser por (vendedor, id do evento) — cada
  vendedor mantém sua própria cópia do evento compartilhado.
- Foi adicionada a coluna `organizer_email`, gravando quem de fato
  organizou cada evento na Agenda (não só em quem ela aparece).

**Resultado depois de corrigido e ressincronizado:** Marlon passou de 3
para 45 reuniões reais na tabela (42 como organizador, 3 como convidado);
Uriel tinha 74 (19 como organizador, 55 como convidado — as que o Marlon
agenda para ele). Os números batem com a Agenda real conferida diretamente
via API do Google.

### Como consultar "quem agendou" x "quem realizou"

Regra de negócio: o **Marlon é o SDR** (agenda as reuniões) e o **Uriel é
quem realiza** as reuniões, todas nomeadas "Reunião BSconta x (Cliente)".

```sql
-- Reuniões que o Marlon agendou (ele aparece como organizador do evento)
select count(distinct external_id)
from activities
where source = 'CALENDAR' and external_id like 'gcal_%'
  and organizer_email = 'comercial2@bsconta.com.br'
  and title ilike '%bsconta x%'
  and scheduled_at >= '2026-09-01' and scheduled_at < '2026-10-01';

-- Reuniões que o Uriel participou e já realizou (status DONE na própria agenda dele)
select count(*)
from activities
where source = 'CALENDAR' and external_id like 'gcal_%'
  and seller_id = (select id from sellers where email = 'comercial@bsconta.com.br')
  and status = 'DONE'
  and title ilike '%bsconta x%'
  and scheduled_at >= '2026-09-01' and scheduled_at < '2026-10-01';
```

Exemplo real conferido (semana de 31/08 a 04/09/2026): 21 reuniões
"BSconta x" na agenda do Uriel, sendo 16 já `DONE` e 5 ainda `SCHEDULED` —
todas com o Marlon como organizador. Bate exatamente com o que foi
conferido direto no Google Calendar.

## Pendências / limitações

- Apenas 2 vendedores (Marlon e Uriel) estão com a Agenda conectada.
  Gabriel e Dayane ainda precisam passar pelo link de `google-oauth-start`
  (veja acima).
- O app OAuth está em modo "Teste" no Google — só os 3 e-mails
  `@bsconta.com.br` cadastrados (e não a Dayane, que usa domínio diferente)
  conseguem autorizar por enquanto. Adicionar o e-mail dela como usuário de
  teste, ou publicar o app, quando for revisar definitivamente.
- O `access_token` de teste expira em ~1h, mas é renovado automaticamente a
  cada execução do `sync-calendar` usando o `refresh_token` — não deveria
  exigir reconexão, exceto se o usuário revogar o acesso pela própria conta
  Google.
- Não foi criada nenhuma conta de login (usuário/senha) no sistema BSconta
  para teste — isso continua pendente e deve ser feito por você mesmo em
  **Authentication > Users > Add user** no Supabase, seguido de rodar
  `03_promover_admins.sql` para o papel de admin, se for o caso.

## O que fazer para tornar definitivo

1. Conectar a Agenda dos demais vendedores (link acima, um de cada vez).
2. Adicionar `dsilva@agmoonflag.com.br` como usuário de teste (Google Cloud >
   Tela de permissão OAuth > Público-alvo) ou publicar o app para produção.
3. Revisar o intervalo do cron (`sync_calendar_30min`) se quiser mais ou
   menos frequência.
4. Se quiser trocar de app Google (produção própria, branding definitivo),
   revisar `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` nos
   Secrets do Supabase.
5. Avaliar se o secret antigo do OAuth Client (`****cfwV`) deve ser desativado
   no Google Cloud, já que um novo (`****blbN`) foi criado e é o que está em
   uso agora — ter dois secrets ativos aumenta a superfície de risco.
