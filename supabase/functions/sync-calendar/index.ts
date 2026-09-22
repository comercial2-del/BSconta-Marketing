// ---------------------------------------------------------------------------
// SGCMP — BSconta — Edge Function: sync-calendar
//
// Para cada vendedor com Agenda Google conectada (tabela calendar_tokens),
// busca os eventos do Google Calendar (numa janela de dias antes/depois de
// hoje) e grava/atualiza em `activities` com source = 'CALENDAR'.
//
// Isso é o que alimenta a view `meeting_divergences` (05_calendar_schema.sql):
// reuniões registradas no RD Station que NÃO têm um evento correspondente
// na Agenda do vendedor no mesmo horário (± 30 min) — a "verificação de
// reuniões" pedida.
//
// Configuração necessária (Project Settings > Edge Functions > Secrets):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetadas automaticamente)
//
// Como disparar:
//   - Manual (teste): POST na URL da função com header
//     Authorization: Bearer <SUPABASE_ANON_KEY ou SERVICE_ROLE_KEY>
//   - Automático: agendar via Supabase Dashboard > Integrations > Cron,
//     igual ao sync-rd-station (veja 04_agendar_sync_rd.sql como modelo).
//
// Um vendedor sem Agenda conectada é simplesmente ignorado (sem erro) —
// conecte pelo link de google-oauth-start quando estiver pronto.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// A janela precisa cobrir o filtro mais longo do sistema ("Mês passado", que
// no dia 1º alcança ~62 dias atrás) — com 14 dias, relatórios de mês passado
// saíam incompletos e eventos lançados retroativamente nunca entravam.
// 75 dias cobrem mês passado + folga, e batem com a regra de retenção.
const DAYS_BACK = 75;
const DAYS_FORWARD = 45; // e futuros até N dias à frente
const FETCH_TIMEOUT_MS = 20_000;

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Troca o refresh_token por um access_token novo. */
async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string) {
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Falha ao renovar token: ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json as { access_token: string; expires_in: number };
}

/** Converte um start/end do Google (dateTime ou date, evento dia-inteiro) em ISO. */
// Fuso do escritório: um horário sem offset é lido como UTC pelo Postgres,
// e "T00:00:00" de um evento de dia inteiro viraria 21:00 do dia anterior no
// Brasil — jogando o evento para o dia/semana errado nos filtros.
const BR_OFFSET = "-03:00";

function eventTimeToIso(t: { dateTime?: string; date?: string } | undefined): string | null {
  if (!t) return null;
  if (t.dateTime) return t.dateTime; // o Google já manda com offset
  if (t.date) return `${t.date}T00:00:00${BR_OFFSET}`; // evento de dia inteiro
  return null;
}

function mapStatus(googleStatus: string | undefined, startIso: string | null): string {
  if (googleStatus === "cancelled") return "CANCELED";
  if (startIso && new Date(startIso).getTime() < Date.now()) return "DONE";
  return "SCHEDULED";
}
// A Agenda de cada vendedor tem, além das reuniões de venda de verdade,
// vários outros compromissos (treinamentos, alinhamentos internos, blocos de
// agenda etc.) que não interessam para o funil comercial. A pedido do
// usuário (03/09/2026), só trazemos da Agenda os eventos cujo título seja
// claramente uma reunião com cliente (Reunião BSconta x) ou uma ligação de vendas (Ligação - Vendas). Tudo o mais é ignorado.
function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/ç/g,"c").replace(/ã/g,"a").replace(/á/g,"a").replace(/â/g,"a").replace(/à/g,"a").replace(/é/g,"e").replace(/ê/g,"e").replace(/í/g,"i").replace(/ó/g,"o").replace(/ô/g,"o").replace(/õ/g,"o").replace(/ú/g,"u").replace(/\s+/g, " ").trim();
}
// Regra do usuário (03/09/2026): LIGAÇÃO NUNCA É REUNIÃO. O título manda —
// e ele decide também como o evento é gravado em `activities`:
//   - "Ligação/Chamada/Call/Telefonema/Contato telefônico"  -> type CALL
//   - "Reunião", "Reunião x ...", "BSconta x <cliente>"     -> type MEETING
//   - qualquer outro título (treinamento, alinhamento interno, bloco de
//     agenda, "Reunião IA/Gabriel")                          -> ignorado
// A mesma regra está espelhada em js/calc.js (activityKind), para que a tela
// já mostre certo mesmo antes de uma nova sincronização.
const CALL_TITLE_PATTERNS = ["ligacao", "ligacoes", "ligar ", "chamada", "telefonema", "contato telefonico", "telefonico"];
const CALL_WORD_RE = /\bcalls?\b/;
const INTERNAL_MEETING_PATTERNS = ["ia/gabriel", "reuniao ia"];

function isCallTitle(title: string): boolean {
  const n = normalize(title);
  if (!n) return false;
  return CALL_TITLE_PATTERNS.some((p) => n.includes(p)) || CALL_WORD_RE.test(n);
}

function isMeetingTitle(title: string): boolean {
  const n = normalize(title);
  if (!n) return false;
  if (isCallTitle(n)) return false;
  if (INTERNAL_MEETING_PATTERNS.some((p) => n.includes(p))) return false;
  return n.startsWith("reuniao") || n.includes("bsconta x");
}

/** null = evento irrelevante para o comercial (não é importado). */
function classifyEvent(title: string): { type: "CALL"; subtype: string } | { type: "MEETING"; subtype: string } | null {
  if (isCallTitle(title)) {
    // "Ligação - Vendas" x demais ligações (agendamento/follow-up).
    return { type: "CALL", subtype: /venda/.test(normalize(title)) ? "SALES_CALL" : "GENERIC_CALL" };
  }
  if (isMeetingTitle(title)) return { type: "MEETING", subtype: "OTHER" };
  return null;
}

// CORS: sem estes cabeçalhos o navegador bloqueia a chamada que a própria
// página do sistema faz ao ser carregada (sincronização ao abrir/atualizar).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  // Pré-checagem do navegador (preflight).
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

  // TRAVA ANTI-SOBREPOSIÇÃO — com o agendamento acelerado, uma execução nova
  // poderia começar antes de a anterior terminar (cada vendedor renova token
  // + pagina eventos no Google). Se já há uma rodando, esta sai na hora.
  // O corte de 5 min também destrava um RUNNING "preso" por queda.
  const lockCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: running } = await supabase
    .from("sync_logs")
    .select("id, started_at")
    .eq("source", "CALENDAR")
    .eq("status", "RUNNING")
    .gte("started_at", lockCutoff)
    .limit(1)
    .maybeSingle();
  if (running) {
    console.log(`[sync-calendar] já existe sincronização em andamento (${running.started_at}) — saindo.`);
    return new Response(JSON.stringify({ ok: true, skipped: "já em execução", since: running.started_at }), {
      headers: JSON_HEADERS,
    });
  }

  const { data: logRow, error: logError } = await supabase
    .from("sync_logs")
    .insert({ source: "CALENDAR", status: "RUNNING" })
    .select()
    .single();
  if (logError) {
    console.error("[sync-calendar] falha ao abrir sync_logs:", logError.message);
    return new Response(JSON.stringify({ error: `Falha ao abrir sync_logs: ${logError.message}` }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
  const logId = logRow.id;

  const counts = { sellers_conectados: 0, eventos: 0, erros_por_vendedor: 0, removidos: 0, restaurados: 0 };
  const errors: string[] = [];

  // A coluna `deleted_at` só existe depois de rodar 15_sincronizar_exclusoes.sql.
  // Se ela ainda não existir, a função continua funcionando exatamente como
  // antes (só não marca exclusões) em vez de quebrar tudo.
  let suportaExclusao = true;
  const avisos: string[] = [];
  {
    const probe = await supabase.from("activities").select("deleted_at").limit(1);
    if (probe.error) {
      suportaExclusao = false;
      console.warn("[sync-calendar] coluna deleted_at ausente — exclusões não serão sincronizadas. Rode 15_sincronizar_exclusoes.sql.");
      avisos.push("Exclusões não sincronizadas: falta a coluna activities.deleted_at (rode 15_sincronizar_exclusoes.sql).");
    }
  }

  try {
    const { data: tokens, error: tokensError } = await supabase
      .from("calendar_tokens")
      .select("seller_id, refresh_token, google_email");
    if (tokensError) throw new Error(`Erro ao ler calendar_tokens: ${tokensError.message}`);

    if (!tokens || tokens.length === 0) {
      console.log("[sync-calendar] nenhum vendedor com Agenda Google conectada ainda.");
    }

    const timeMin = new Date(Date.now() - DAYS_BACK * 86_400_000).toISOString();
    const timeMax = new Date(Date.now() + DAYS_FORWARD * 86_400_000).toISOString();

    for (const row of tokens ?? []) {
      counts.sellers_conectados++;
      try {
        const { access_token, expires_in } = await refreshAccessToken(row.refresh_token, clientId, clientSecret);

        await supabase
          .from("calendar_tokens")
          .update({
            access_token,
            access_token_expires_at: new Date(Date.now() + (Number(expires_in) || 3600) * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("seller_id", row.seller_id);

        // Paginação: sem seguir o nextPageToken, um vendedor com mais de 250
        // eventos na janela tinha o restante descartado em silêncio — e as
        // reuniões que ficavam de fora simplesmente não apareciam no sistema.
        const items: any[] = [];
        let pageToken: string | undefined;
        let guard = 0;
        do {
          const eventsUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
          eventsUrl.searchParams.set("timeMin", timeMin);
          eventsUrl.searchParams.set("timeMax", timeMax);
          eventsUrl.searchParams.set("singleEvents", "true");
          eventsUrl.searchParams.set("orderBy", "startTime");
          eventsUrl.searchParams.set("maxResults", "250");
          if (pageToken) eventsUrl.searchParams.set("pageToken", pageToken);

          const evRes = await fetchWithTimeout(eventsUrl.toString(), {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          const evJson = await evRes.json();
          if (!evRes.ok) {
            throw new Error(`Google Calendar respondeu ${evRes.status}: ${JSON.stringify(evJson).slice(0, 300)}`);
          }
          items.push(...(evJson.items ?? []));
          pageToken = evJson.nextPageToken;
        } while (pageToken && ++guard < 20);

        // Só dá para afirmar "este evento sumiu da Agenda" se recebemos a
        // janela INTEIRA. Se a paginação parou pela trava de segurança, ainda
        // havia página para vir — e apagar com base nisso esconderia reuniões
        // que continuam existindo.
        const janelaCompleta = !pageToken;

        // external_id de tudo o que o Google devolveu como ATIVO e relevante
        // nesta janela. É a lista contra a qual conferimos o que já está
        // gravado no banco, para descobrir o que foi apagado da Agenda.
        const vistosAgora = new Set<string>();

        {
          const rows = items
            .map((ev) => {
              const scheduledAt = eventTimeToIso(ev.start);
              if (!scheduledAt || !ev.id) return null;
              // Evento cancelado/apagado no Google: não é gravado — e, por não
              // entrar em `vistosAgora`, a conferência abaixo o marca como
              // excluído.
              if (ev.status === "cancelled") return null;
              const kind = classifyEvent(ev.summary ?? "");
              if (!kind) return null;
              vistosAgora.add(`gcal_${ev.id}`);
              return {
                type: kind.type,
                subtype: kind.subtype,
                source: "CALENDAR",
                external_id: `gcal_${ev.id}`,
                seller_id: row.seller_id,
                calendar_account: row.google_email,
                organizer_email: ev.organizer?.email ?? null,
                title: ev.summary ?? "(sem título)",
                scheduled_at: scheduledAt,
                status: mapStatus(ev.status, scheduledAt),
                // Evento que voltou a existir na Agenda reaparece sozinho no
                // sistema: a marca de excluído é limpa aqui.
                ...(suportaExclusao ? { deleted_at: null } : {}),
                updated_at: new Date().toISOString(),
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);

          if (rows.length > 0) {
            // IMPORTANTE: o mesmo evento do Google aparece na agenda do
            // organizador E de cada convidado, com o MESMO id de evento.
            // Por isso o conflito é por (seller_id, external_id) — cada
            // vendedor mantém sua própria cópia do evento — e não só por
            // external_id, o que faria a sincronização de um vendedor
            // sobrescrever (e "roubar" para si) o registro de outro.
            const { error: upsertError } = await supabase
              .from("activities")
              .upsert(rows, { onConflict: "seller_id,external_id" });
            if (upsertError) throw new Error(`Erro ao gravar activities: ${upsertError.message}`);
            counts.eventos += rows.length;
          }
        }

        // -----------------------------------------------------------------
        // CONFERÊNCIA DE EXCLUSÕES
        // Tudo o que está gravado para este vendedor DENTRO da janela e não
        // veio na resposta do Google foi apagado (ou cancelado, ou teve o
        // título mudado para algo que não é reunião nem ligação). Marcamos —
        // some da tela — sem apagar do banco.
        //
        // Travas antes de marcar qualquer coisa:
        //   1. a coluna deleted_at precisa existir;
        //   2. a paginação precisa ter trazido a janela inteira;
        //   3. a chamada ao Google precisa ter terminado com sucesso — erros
        //      abortam a sincronização antes desta etapa.
        // -----------------------------------------------------------------
        if (suportaExclusao && janelaCompleta) {
          const { data: gravados, error: readErr } = await supabase
            .from("activities")
            .select("id, external_id, deleted_at, updated_at")
            .eq("source", "CALENDAR")
            .eq("seller_id", row.seller_id)
            .gte("scheduled_at", timeMin)
            .lte("scheduled_at", timeMax);
          if (readErr) throw new Error(`Erro ao conferir exclusões: ${readErr.message}`);

          // EXCLUSÃO IMEDIATA — uma ausência na resposta completa do Google
          // já é suficiente para marcar o registro. A API foi chamada com
          // sucesso e a paginação terminou; não há motivo para segurar a
          // alteração por horas.

          const sumiram = (gravados ?? [])
            .filter(
              (a) =>
                !vistosAgora.has(a.external_id) &&
                !a.deleted_at,
            )
            .map((a) => a.id);
          const voltaram = (gravados ?? [])
            .filter((a) => vistosAgora.has(a.external_id) && a.deleted_at)
            .map((a) => a.id);

          // TRAVA DE PROPORÇÃO — apagar alguns compromissos é normal; sumir
          // com um terço da agenda de uma vez é resposta incompleta do Google,
          // não exclusão. Nesse caso nada é escondido e o motivo é registrado.
          const ativosNoBanco = (gravados ?? []).filter((a) => !a.deleted_at).length;
          if (sumiram.length > 25 && sumiram.length > ativosNoBanco * 0.1) {
            const msg =
              `${row.google_email}: conferência de exclusões ignorada por segurança — a Agenda deixou de devolver ` +
              `${sumiram.length} de ${ativosNoBanco} eventos de uma vez. Nada foi escondido.`;
            console.warn(`[sync-calendar] ${msg}`);
            avisos.push(msg);
            sumiram.length = 0;
          }

          for (let i = 0; i < sumiram.length; i += 200) {
            const lote = sumiram.slice(i, i + 200);
            const { error } = await supabase
              .from("activities")
              .update({ deleted_at: new Date().toISOString() })
              .in("id", lote);
            if (error) throw new Error(`Erro ao marcar excluídos: ${error.message}`);
            counts.removidos += lote.length;
          }

          // Rede de segurança: o upsert acima já limpa a marca dos eventos
          // que voltaram, mas isto cobre o caso de o upsert não ter passado
          // por eles (ex.: evento fora do lote gravado).
          for (let i = 0; i < voltaram.length; i += 200) {
            const lote = voltaram.slice(i, i + 200);
            const { error } = await supabase
              .from("activities")
              .update({ deleted_at: null })
              .in("id", lote);
            if (error) throw new Error(`Erro ao restaurar eventos: ${error.message}`);
            counts.restaurados += lote.length;
          }

          if (sumiram.length > 0 || voltaram.length > 0) {
            console.log(
              `[sync-calendar] ${row.google_email}: ${sumiram.length} evento(s) apagado(s) na Agenda, ${voltaram.length} restaurado(s)`,
            );
          }
        }
      } catch (sellerErr) {
        counts.erros_por_vendedor++;
        const msg = sellerErr instanceof Error ? sellerErr.message : String(sellerErr);
        console.error(`[sync-calendar] vendedor ${row.seller_id} (${row.google_email}):`, msg);
        errors.push(`${row.google_email ?? row.seller_id}: ${msg}`);
      }
    }

    const finalStatus = errors.length > 0 && counts.eventos === 0 && counts.sellers_conectados > 0 ? "ERROR" : "SUCCESS";
    await supabase
      .from("sync_logs")
      .update({
        status: finalStatus,
        finished_at: new Date().toISOString(),
        records_synced: counts.eventos,
        error: errors.length > 0 ? errors.join(" | ").slice(0, 2000) : null,
      })
      .eq("id", logId);

    // A exclusão é marcada no mesmo ciclo em que uma resposta completa do
    // Google deixa de conter o evento. O frontend faz um reload fresh após a
    // função terminar, então a Agenda não depende de esperar o próximo ciclo.
    console.log("[sync-calendar] concluído:", counts);
    return new Response(JSON.stringify({ ok: true, counts, errors, avisos, registros: counts.eventos }), {
      headers: JSON_HEADERS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-calendar] erro fatal:", msg);
    await supabase
      .from("sync_logs")
      .update({ status: "ERROR", finished_at: new Date().toISOString(), error: msg.slice(0, 2000) })
      .eq("id", logId);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
});
