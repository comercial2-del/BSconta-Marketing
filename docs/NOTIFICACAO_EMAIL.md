# Notificação por e-mail — 1ª etapa → Gustavo (01/10/2026)

Quando a **1ª etapa (Handoff)** do Onboarding é concluída e o processo vai para o
**Gustavo**, o sistema envia o e-mail **"Nova notificação no SGCMP — BSconta"**.

- **De:** comercial@bsconta.com.br (Gmail do Uriel)
- **Para:** e-mail cadastrado do Gustavo no sistema (Supabase Auth → gustavo@bsconta.com.br)
  + cópia para izadora@bsconta.com.br
- **Visual:** HTML com a logo da BSconta (embutida no e-mail), mais uma versão em texto.

## Como funciona

```
Tela Onboarding (etapa 01 → Concluído)
   └─ grava public.onboarding_etapas            (igual a antes)
        └─ gatilho onb_detectar_transferencia   (banco, SQL 25)
             ├─ grava public.onboarding_transferencias  (log + fila, 1 linha por venda)
             └─ pg_net → Edge Function notificar-transferencia
                    └─ Gmail API (token em public.email_remetente_gmail)
                         └─ atualiza email_status: enviado | erro
cron "onboarding-email-reenvio" (10 em 10 min) → tenta de novo pendentes/erros (até 5x)
Janela da etapa 01 → mostra o status e o botão "Tentar de novo"
```

| Requisito | Onde |
|---|---|
| Detectar a transferência | gatilho no banco: 1ª etapa passou de "não concluída" para "done", com conclusão recente (até 2 h) e próxima etapa sem outro responsável (= Gustavo) |
| Sem duplicidade | O gatilho só dispara na troca para verde + reserva da linha (pendente/erro → enviando) antes de enviar. Desde o SQL 28: voltar a 01 para bloqueado e marcar verde de novo **envia outro e-mail** (a trava UNIQUE foi removida) |
| Log | `public.onboarding_transferencias`: cliente, responsável anterior, novo responsável, etapa anterior, nova etapa, data/hora, quem marcou, status, tentativas, erro, destinatários, id da mensagem no Gmail |
| Falha não perde a etapa | o gatilho nunca bloqueia o salvamento; o e-mail é assíncrono e fica na fila |
| Nova tentativa | automática (cron) e manual (botão na etapa 01, só usuário logado) |
| Sem credenciais no navegador | Client Secret do Google e refresh token ficam só no servidor (Secrets / tabela sem acesso pelo sistema) |

## Arquivos

- `banco/25_onboarding_notificacao_email.sql` — tabelas, gatilho e cron (schema `public`, não mexe no `rh`)
- `supabase/functions/notificar-transferencia/index.ts` — monta e envia o e-mail
- `supabase/functions/gmail-conectar/index.ts` — conecta o Gmail do remetente (uma vez)
- `telas/onboarding.html` — status do e-mail + "Tentar de novo" na janela da etapa 01
- `test/verify-onboarding-email.mjs` — teste da tela

## Configuração (uma vez)

1. **SQL:** rodar `banco/25_onboarding_notificacao_email.sql` no SQL Editor.
2. **Funções:** publicar `notificar-transferencia` e `gmail-conectar`.
   As duas precisam de **Verify JWT desligado**: o gatilho/cron do banco chamam
   `notificar-transferencia` sem chave, e `gmail-conectar` é aberta direto no
   navegador. Por isso `notificar-transferencia` só envia o que já está na fila
   do banco (nunca recebe texto, destinatário ou remetente de fora) e só aceita
   o reenvio manual de usuário logado; `gmail-conectar` só aceita a conta
   comercial@bsconta.com.br. (Se preferir manter o Verify JWT ligado, o gatilho
   e o cron precisam mandar a chave, como no SQL 14.)
3. **Google Cloud** (mesmo cliente OAuth da Agenda): ativar a **Gmail API** e
   adicionar o URI de redirecionamento
   `https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/gmail-conectar`.
4. **Conectar o Gmail do Uriel:** logado como **comercial@bsconta.com.br**, abrir
   https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/gmail-conectar e aceitar.
   Só essa conta é aceita como remetente.

Opcional (Secrets): `EMAIL_REMETENTE` (padrão comercial@bsconta.com.br) e
`EMAIL_COPIA` (padrão izadora@bsconta.com.br; vários separados por vírgula).

## Testar ponta a ponta

1. No Onboarding, abra uma venda com a etapa 01 pendente → marque **Concluído**.
2. Em segundos a janela da etapa 01 mostra **"Aviso por e-mail ao Gustavo: Enviado"**
   com os destinatários. Confira a caixa do Gustavo e da Izadora.
3. Conferir no banco:
   ```sql
   select cliente, responsavel_anterior, novo_responsavel, etapa_anterior, nova_etapa,
          transferido_em, email_status, email_tentativas, email_erro, email_destinatarios
     from public.onboarding_transferencias order by transferido_em desc limit 10;
   ```
4. Reabrir e concluir de novo a etapa 01 → **não** chega outro e-mail.
5. Falha: se aparecer **Falhou**, o erro vem escrito; clique **Tentar de novo**
   (ou espere o cron de 10 min).

---

# Fluxo do Handoff — vermelho → verde → cinza → azul (05/10/2026, fase de teste)

```
VENDIDA → 01 · Handoff VERMELHO/BLOQUEADO → marcada VERDE → LIBERADA → E-MAIL DE HANDOFF
        → etapa 02 com o Gustavo (CINZA, aguardando início) → Gustavo inicia (AZUL, em andamento)
```

| Cor | Onde aparece | Significado |
|---|---|---|
| 🔴 Vermelho | bolinha 01 + borda/selo do card "Bloqueado · aguardando validação" | Vendida e bloqueada. Nenhuma etapa avança e nenhum e-mail sai. |
| 🟢 Verde | bolinha 01 | Validada e liberada. É neste momento que o e-mail de Handoff é disparado. |
| ⚪ Cinza | bolinha 02 + borda/selo "Aguardando Gustavo" | Direcionada ao Gustavo, aguardando ele dar início. |
| 🔵 Azul | bolinha 02 + borda/selo "Em andamento · Gustavo" | Gustavo assumiu (status da 02 = Em andamento). |

Regras (tela `telas/onboarding.html`):
- Toda venda nova entra com a 01 em **Bloqueado**. Cards que já existiam com a 01 ainda não concluída também passam a aparecer bloqueados.
- A 01 só tem duas opções: **Bloqueado** e **Verde (liberado)**. Marcar verde pede confirmação.
- Enquanto a 01 está vermelha, as etapas 02 a 10 ficam travadas (status, checklist e campos).
- Ao marcar verde: a 02 fica "Aguardando início" com o responsável configurado (Gustavo) e o histórico registra a liberação.
- Depois que o Gustavo inicia a 02, a 01 não pode voltar para vermelho.
- O e-mail continua sendo disparado só pelo banco (gatilho), e **só** quando a 01 passa a "done" (verde) — vermelho nunca dispara.

Responsável da etapa seguinte = **configuração** (`banco/26_onboarding_fluxo_handoff.sql`), não regra fixa:

```sql
update public.onboarding_config set valor = '"Fulano"', atualizado_em = now()
 where chave = 'responsavel_proxima_etapa';
```

A tela e o gatilho passam a usar o novo nome. (O destinatário do e-mail ainda é buscado pelo
nome "Gustavo" na Edge Function `notificar-transferencia`; ao trocar o responsável, ajustar lá também.)

Teste automatizado: `test/verify-onboarding-fluxo.mjs`.
