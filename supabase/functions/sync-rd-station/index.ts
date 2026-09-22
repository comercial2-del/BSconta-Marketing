// ---------------------------------------------------------------------------
// SGCMP — BSconta — Edge Function: sync-rd-station
//
// Busca negociações (deals) e atividades (tasks: ligações e reuniões) do
// RD Station CRM (API v1) e grava/atualiza no banco Supabase.
//
// Como funciona a autenticação:
//   - O token de acesso ao RD Station NUNCA fica neste arquivo. Ele é lido
//     de uma variável de ambiente (secret) chamada RD_STATION_TOKEN,
//     configurada no painel do Supabase (Project Settings > Edge Functions
//     > Secrets) ou via CLI: `supabase secrets set RD_STATION_TOKEN=xxx`.
//   - SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetadas automaticamente
//     pelo runtime das Edge Functions — não precisa configurar.
//
// Como disparar:
//   - Manual (teste): POST na URL da função, com header
//     Authorization: Bearer <SUPABASE_ANON_KEY ou SERVICE_ROLE_KEY>
//   - Automático: agendar via Supabase Dashboard > Integrations > Cron
//     (ou pg_cron, veja 04_agendar_sync_rd.sql) chamando esta função a
//     cada X minutos/horas.
//
// O que a função faz, em ordem:
//   1. Abre um registro em sync_logs (status RUNNING).
//   2. Busca as negociações (deals) no RD Station, paginando, da mais
//      recentemente atualizada para a mais antiga, e grava cada PÁGINA
//      inteira de uma vez (upsert em lote) em vez de um registro por vez —
//      isso é essencial porque uma conta pode ter milhares de negociações.
//      Se a negociação estiver GANHA (win = true), garante também uma
//      linha correspondente em `sales` (também em lote).
//   3. Busca as tarefas do tipo "call" (ligação) e "meeting" (reunião),
//      paginando, e grava/atualiza em `activities` (upsert em lote por
//      external_id).
//   4. Fecha o registro em sync_logs (status SUCCESS ou ERROR).
//
// Sincronização incremental:
//   - A partir da segunda execução completa (sem interrupção por tempo),
//     as negociações são buscadas em ordem decrescente de updated_at e a
//     busca PARA assim que encontra uma negociação já sincronizada antes
//     (mais antiga que a última sincronização completa). Isso faz com que,
//     depois da carga inicial, cada execução processe só o que mudou —
//     rápido o suficiente para caber no orçamento de tempo de uma única
//     invocação, sobrando tempo para as atividades (ligações/reuniões).
//
// Segurança contra travamentos:
//   - Cada chamada à API do RD Station tem um tempo-limite (20s). Se o RD
//     Station não responder, a chamada é abortada com erro em vez de travar
//     a função indefinidamente.
//   - A função respeita um orçamento de tempo total (TIME_BUDGET_MS). Se uma
//     conta tiver MUITOS registros e o tempo acabar antes de processar tudo
//     (tipicamente só na carga inicial), a função finaliza graciosamente
//     com o que já sincronizou (status SUCCESS, com uma nota indicando
//     sincronização parcial) em vez de ser interrompida abruptamente pela
//     plataforma (o que deixaria o registro em sync_logs preso em RUNNING
//     para sempre). A próxima execução (manual ou agendada via Cron)
//     continua trazendo os dados restantes.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RD_BASE_URL = "https://crm.rdstation.com/api/v1";
const PAGE_LIMIT = 200; // máximo permitido pela API do RD Station
const MAX_PAGES = 200; // trava de segurança (200 * 200 = até 40.000 registros por recurso)
const FETCH_TIMEOUT_MS = 35_000; // tempo máximo esperando resposta do RD Station por chamada
// (20s era pouco: o endpoint /tasks do RD passava disso e derrubava a sincronização)
const TIME_BUDGET_MS = 100_000; // orçamento total de execução (deixa folga para o limite da plataforma)

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

async function rdFetch(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${RD_BASE_URL}${path}`);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`RD Station respondeu ${res.status} em ${path}: ${body.slice(0, 300)}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`RD Station não respondeu em ${FETCH_TIMEOUT_MS / 1000}s (${path})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Fuso do escritório. Sem isso o Postgres interpreta um horário "solto"
// (sem offset) como UTC: uma tarefa das 09:00 no Brasil virava 06:00, e uma
// tarefa SEM hora (00:00) virava 21:00 do DIA ANTERIOR — jogando o registro
// para o dia/semana errado em todos os filtros. Ver auditoria de 03/09/2026.
const BR_OFFSET = "-03:00";

/**
 * Carimba o fuso do Brasil num timestamp que veio sem offset. O Postgres
 * interpreta um horário "solto" como UTC, o que joga o registro até 3 horas
 * para trás (e para o dia anterior, perto da meia-noite).
 */
function stampBrOffset(value: any): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s; // já tem fuso
  return `${s.includes("T") ? s : s.replace(" ", "T")}${BR_OFFSET}`;
}

/** Junta task.date + task.hour num timestamp ISO com fuso, se necessário. */
function parseTaskDateTime(task: any): string | null {
  if (!task?.date) return null;
  // Já veio completo do RD (com T): só usa se tiver offset/Z; senão carimba.
  if (typeof task.date === "string" && task.date.includes("T")) {
    return /(Z|[+-]\d{2}:?\d{2})$/.test(task.date) ? task.date : `${task.date}${BR_OFFSET}`;
  }
  const hour = task.hour && /^\d{2}:\d{2}/.test(task.hour) ? task.hour : "00:00";
  return `${task.date}T${hour}:00${BR_OFFSET}`;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

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

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const rdToken = requireEnv("RD_STATION_TOKEN");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const counts = {
    stages: 0,
    sellers: 0,
    deals: 0,
    sales: 0,
    activities: 0,
    skipped: 0,
    vendas_desfeitas: 0,
    cards_apagados: 0,
    cards_restaurados: 0,
    tarefas_apagadas: 0,
  };
  // Problemas que NÃO impedem a sincronização de continuar (ex.: falha só nas
  // vendas). Vão para sync_logs.error e para a resposta, em vez de sumir.
  const errors: string[] = [];
  let partial = false;

  console.log("[sync-rd-station] iniciando sincronização");

  // Última sincronização completa (não parcial) — usada para parar a busca de
  // deals assim que alcançarmos registros já processados antes (sync incremental).
  const { data: lastFullSync } = await supabase
    .from("sync_logs")
    .select("started_at")
    .eq("source", "RD_STATION")
    .eq("status", "SUCCESS")
    .is("error", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sinceIso: string | null = lastFullSync?.started_at ?? null;
  // Corte do incremental em milissegundos, com 10 minutos de folga: o relógio
  // do RD e o do Supabase não são exatamente iguais, e sem essa folga uma
  // negociação alterada no limite da janela poderia escapar da sincronização.
  const SINCE_SAFETY_MS = 10 * 60_000;
  const sinceCutoffMs: number | null = sinceIso ? new Date(sinceIso).getTime() - SINCE_SAFETY_MS : null;
  console.log(`[sync-rd-station] última sincronização completa: ${sinceIso ?? "nenhuma (carga inicial)"}`);

  // TRAVA ANTI-SOBREPOSIÇÃO
  // Esta função pode rodar por até TIME_BUDGET_MS (100s). Com o agendamento
  // acelerado, uma nova execução começaria antes de a anterior terminar: duas
  // sincronizações gravando as mesmas linhas ao mesmo tempo e batendo em
  // dobro na API do RD (risco de bloqueio por excesso de chamadas).
  // Se já existe uma execução RUNNING recente, esta sai na hora, sem custo.
  // O limite de 5 min também destrava sozinho um RUNNING "preso" por queda.
  const lockCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: running } = await supabase
    .from("sync_logs")
    .select("id, started_at")
    .eq("source", "RD_STATION")
    .eq("status", "RUNNING")
    .gte("started_at", lockCutoff)
    .limit(1)
    .maybeSingle();
  if (running) {
    console.log(`[sync-rd-station] já existe sincronização em andamento (${running.started_at}) — saindo.`);
    return new Response(JSON.stringify({ ok: true, skipped: "já em execução", since: running.started_at }), {
      headers: JSON_HEADERS,
    });
  }

  const { data: logRow, error: logError } = await supabase
    .from("sync_logs")
    .insert({ source: "RD_STATION", status: "RUNNING" })
    .select()
    .single();
  if (logError) {
    console.error("[sync-rd-station] falha ao abrir sync_logs:", logError.message);
    return new Response(JSON.stringify({ error: `Falha ao abrir sync_logs: ${logError.message}` }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
  const logId = logRow.id;
  console.log(`[sync-rd-station] sync_logs aberto: ${logId}`);

  // A coluna `deleted_at` e a tabela `sync_state` só existem depois de rodar
  // 15_sincronizar_exclusoes.sql. Sem elas a função continua funcionando
  // exatamente como antes — só não sincroniza exclusões.
  let suportaExclusao = true;
  const avisos: string[] = [];
  {
    const p1 = await supabase.from("deals").select("deleted_at").limit(1);
    const p2 = await supabase.from("activities").select("deleted_at").limit(1);
    const p3 = await supabase.from("sync_state").select("key").limit(1);
    if (p1.error || p2.error || p3.error) {
      suportaExclusao = false;
      // Aviso, não erro: vai para o log e para a resposta, mas NÃO para
      // sync_logs.error — uma sincronização com `error` preenchido não conta
      // como "última sincronização completa", e o sistema voltaria a fazer
      // carga total a cada 5 minutos.
      console.warn("[sync-rd-station] estrutura de exclusões ausente — rode 15_sincronizar_exclusoes.sql.");
      avisos.push("Exclusões não sincronizadas: falta rodar 15_sincronizar_exclusoes.sql.");
    }
  }

  try {
    // Cache local para não repetir consultas ao banco a cada deal/task.
    const stageCache = new Map<string, string>(); // rd_stage_id -> stages.id
    const sellerCache = new Map<string, string>(); // rd_station_user_id ou email -> sellers.id
    const dealCache = new Map<string, string>(); // rd_deal_id -> deals.id

    // Pré-carrega o que já existe, para casar por nome/email na primeira sincronização
    // (os vendedores e etapas reais já foram cadastrados manualmente antes do RD existir).
    const { data: existingStages } = await supabase.from("stages").select("id, rd_stage_id, name");
    const stageByName = new Map<string, string>();
    for (const s of existingStages ?? []) {
      if (s.rd_stage_id) stageCache.set(s.rd_stage_id, s.id);
      stageByName.set(s.name.trim().toLowerCase(), s.id);
    }

    const { data: existingSellers } = await supabase.from("sellers").select("id, rd_station_user_id, email");
    const sellerByEmail = new Map<string, string>();
    for (const s of existingSellers ?? []) {
      if (s.rd_station_user_id) sellerCache.set(s.rd_station_user_id, s.id);
      if (s.email) sellerByEmail.set(s.email.trim().toLowerCase(), s.id);
    }

    console.log(
      `[sync-rd-station] cache pré-carregado: ${existingStages?.length ?? 0} etapas, ${existingSellers?.length ?? 0} vendedores`,
    );

    async function resolveStage(rdStage: any): Promise<string | null> {
      if (!rdStage?.id) return null;
      const rdId = String(rdStage.id);
      if (stageCache.has(rdId)) return stageCache.get(rdId)!;

      // Tenta casar pelo nome com uma etapa já cadastrada (funil real do BSconta).
      const byName = stageByName.get(String(rdStage.name ?? "").trim().toLowerCase());
      if (byName) {
        await supabase.from("stages").update({ rd_stage_id: rdId }).eq("id", byName);
        stageCache.set(rdId, byName);
        return byName;
      }

      // Etapa nova (não existia no funil manual) — cria com valores padrão.
      const nextOrder = (existingStages?.length ?? 0) + stageCache.size + 1;
      const { data, error } = await supabase
        .from("stages")
        .insert({ rd_stage_id: rdId, name: rdStage.name ?? "Sem nome", order: nextOrder })
        .select()
        .single();
      if (error) throw new Error(`Erro ao criar stage: ${error.message}`);
      counts.stages++;
      stageCache.set(rdId, data.id);
      // Atualiza o mapa de nomes na hora, para que outra etapa do RD com o
      // mesmo nome (comum quando há vários funis) reaproveite esta em vez de
      // criar uma etapa duplicada dentro da mesma sincronização.
      stageByName.set(String(rdStage.name ?? "").trim().toLowerCase(), data.id);
      return data.id;
    }

    async function resolveSeller(rdUser: any): Promise<string | null> {
      if (!rdUser?.id) return null;
      const rdId = String(rdUser.id);
      if (sellerCache.has(rdId)) return sellerCache.get(rdId)!;

      const email = String(rdUser.email ?? "").trim().toLowerCase();
      const byEmail = email ? sellerByEmail.get(email) : undefined;
      if (byEmail) {
        await supabase.from("sellers").update({ rd_station_user_id: rdId }).eq("id", byEmail);
        sellerCache.set(rdId, byEmail);
        return byEmail;
      }

      // Vendedor novo no RD que ainda não existe no nosso cadastro — cria.
      const { data, error } = await supabase
        .from("sellers")
        .insert({
          name: rdUser.name ?? rdUser.nickname ?? "Vendedor RD",
          email: email || `rd_${rdId}@sem-email.bsconta.com.br`,
          rd_station_user_id: rdId,
        })
        .select()
        .single();
      if (error) throw new Error(`Erro ao criar seller: ${error.message}`);
      counts.sellers++;
      sellerCache.set(rdId, data.id);
      return data.id;
    }

    // -------------------------------------------------------------------
    // 1) Negociações (deals) + vendas (sales) — gravadas em lote por página
    // -------------------------------------------------------------------
    let reachedKnownDeal = false;

    dealsLoop: for (let page = 1; page <= MAX_PAGES; page++) {
      if (outOfTime()) {
        console.log(`[sync-rd-station] orçamento de tempo esgotado antes da página ${page} de deals`);
        partial = true;
        break dealsLoop;
      }

      console.log(`[sync-rd-station] buscando deals — página ${page}`);
      const json = await rdFetch("/deals", rdToken, {
        page: String(page),
        limit: String(PAGE_LIMIT),
        order: "updated_at",
        direction: "desc",
      });
      const deals: any[] = json.deals ?? [];
      console.log(`[sync-rd-station] página ${page} de deals: ${deals.length} recebidos`);
      if (deals.length === 0) break dealsLoop;

      const dealRows: any[] = [];

      for (const deal of deals) {
        // Sincronização incremental: como a busca é da mais recente para a
        // mais antiga, assim que encontramos algo já visto na última
        // sincronização completa, tudo que vem depois já está sincronizado.
        //
        // ATENÇÃO — este era o BUG que fazia alterações no RD não aparecerem:
        // a comparação era feita entre TEXTOS. O RD devolve updated_at com
        // offset do Brasil ("2026-09-04T10:00:00-03:00") e o sinceIso vem em
        // UTC ("2026-09-04T12:00:00+00:00"). Comparando como texto, "10..." é
        // menor que "12..." e a negociação (que na verdade é MAIS NOVA, 13h
        // UTC) era tratada como já sincronizada. Pior: o `break` abortava a
        // varredura inteira. Resultado: tudo que mudou nas últimas ~3 horas
        // ficava invisível para o sistema.
        // Agora compara TEMPO de verdade, com 10 min de folga para não perder
        // nada por diferença de relógio entre o RD e o Supabase.
        if (sinceCutoffMs && deal.updated_at) {
          const updatedMs = new Date(deal.updated_at).getTime();
          if (Number.isFinite(updatedMs) && updatedMs <= sinceCutoffMs) {
            reachedKnownDeal = true;
            break;
          }
        }

        const stageId = await resolveStage(deal.deal_stage);
        const sellerId = await resolveSeller(deal.user);
        const status = deal.win === true ? "WON" : deal.win === false ? "LOST" : "OPEN";
        const clientName =
          deal.contacts?.[0]?.name || deal.organization?.name || deal.name || "Sem nome";
        const dealOrigin =
          typeof deal.origin === "string" ? deal.origin :
          deal.origin?.name ?? deal.source?.name ?? deal.source ??
          deal.custom_fields?.origin ?? deal.custom_fields?.campanha ?? null;

        // Valor: negociação só com mensalidade (recorrente) vinha como 0 —
        // agora a mensalidade entra como último recurso.
        const dealValue = deal.amount_total ?? deal.amount_unique ?? deal.amount_montly ?? 0;
        // Negociação ganha SEM data de fechamento não gerava venda nenhuma.
        // Nesse caso usamos a data da última alteração como fechamento.
        const closedAt = status === "WON" ? stampBrOffset(deal.closed_at) ?? stampBrOffset(deal.updated_at) : stampBrOffset(deal.closed_at);

        dealRows.push({
          rd_deal_id: String(deal.id ?? deal._id),
          client_name: clientName,
          company_name: deal.organization?.name ?? null,
          origin: dealOrigin,
          seller_id: sellerId,
          stage_id: stageId,
          value: dealValue,
          status,
          closed_at: closedAt,
          last_interaction_at: deal.last_activity_at ?? null,
          is_recurring: (deal.amount_montly ?? 0) > 0,
          created_at: deal.created_at ?? undefined,
          // O card existe no RD: se estava marcado como apagado, volta a
          // aparecer sozinho.
          ...(suportaExclusao ? { deleted_at: null } : {}),
          updated_at: deal.updated_at ?? new Date().toISOString(),
        });
      }

      if (dealRows.length > 0) {
        const { data: savedDeals, error: dealErr } = await supabase
          .from("deals")
          .upsert(dealRows, { onConflict: "rd_deal_id" })
          .select();
        if (dealErr) throw new Error(`Erro ao gravar página ${page} de deals: ${dealErr.message}`);
        counts.deals += savedDeals?.length ?? 0;

        const saleRows: any[] = [];
        // Negociações que DEIXARAM de ser ganhas (você clicou em "Retomar
        // Negociação", ou marcou como perdida). Antes, a venda continuava
        // registrada para sempre e inflava o faturamento.
        const semVenda: string[] = [];
        for (const savedDeal of savedDeals ?? []) {
          dealCache.set(savedDeal.rd_deal_id, savedDeal.id);
          if (!(savedDeal.status === "WON" && savedDeal.closed_at)) semVenda.push(savedDeal.id);
          if (savedDeal.status === "WON" && savedDeal.closed_at) {
            saleRows.push({
              deal_id: savedDeal.id,
              seller_id: savedDeal.seller_id,
              value: savedDeal.value,
              is_recurring: savedDeal.is_recurring,
              closed_at: savedDeal.closed_at,
            });
          }
        }

        if (saleRows.length > 0) {
          const { error: saleErr } = await supabase
            .from("sales")
            .upsert(saleRows, { onConflict: "deal_id" });
          // NÃO derruba a sincronização inteira por causa das vendas.
          // O onConflict "deal_id" exige um índice único em sales(deal_id);
          // se ele não existir, o Postgres devolve 42P10 e, no código antigo,
          // esse `throw` abortava TUDO — negociações, ligações e reuniões
          // paravam de sincronizar junto. Agora o erro é registrado e a
          // sincronização segue (o SQL 11 cria o índice que falta).
          if (saleErr) {
            const dica = saleErr.code === "42P10" || /no unique|constraint matching/i.test(saleErr.message)
              ? " — falta o índice único em sales(deal_id): rode o script 11_fix_sync_deal_link.sql"
              : "";
            const msg = `Vendas da página ${page}: ${saleErr.message}${dica}`;
            console.error(`[sync-rd-station] ${msg}`);
            errors.push(msg);
          } else {
            counts.sales += saleRows.length;
          }
        }

        // A venda espelha o card: se o card não está mais ganho, a venda sai.
        // Aqui apagar de verdade é seguro — a venda é derivada da negociação
        // e volta sozinha assim que o card for marcado como ganho de novo.
        if (semVenda.length > 0) {
          for (let i = 0; i < semVenda.length; i += 200) {
            const lote = semVenda.slice(i, i + 200);
            const { data: apagadas, error: delErr } = await supabase
              .from("sales")
              .delete()
              .in("deal_id", lote)
              .select("id");
            if (delErr) {
              const msg = `Ao remover vendas de negociações que deixaram de ser ganhas: ${delErr.message}`;
              console.error(`[sync-rd-station] ${msg}`);
              errors.push(msg);
            } else if (apagadas && apagadas.length > 0) {
              counts.vendas_desfeitas += apagadas.length;
              console.log(`[sync-rd-station] ${apagadas.length} venda(s) removida(s): o card não está mais ganho no RD`);
            }
          }
        }

        console.log(`[sync-rd-station] página ${page} gravada: ${dealRows.length} deals, ${saleRows.length} vendas (total: ${counts.deals} deals)`);
      }

      if (reachedKnownDeal) {
        console.log(`[sync-rd-station] alcançado deal já sincronizado — parando busca incremental na página ${page}`);
        break dealsLoop;
      }

      if (!json.has_more) break dealsLoop;
    }

    console.log(`[sync-rd-station] etapa de deals concluída: ${counts.deals} deals, ${counts.sales} vendas`);

    // -------------------------------------------------------------------
    // 2) Atividades: ligações (call) e reuniões (meeting) — em lote por página
    //    Observação: RD Station não informa "atendida/não atendida" nem
    //    margem de venda — esses campos continuam manuais quando aplicável.
    // -------------------------------------------------------------------
    const taskTypeMap: Record<string, { type: string; subtype: string }> = {
      call: { type: "CALL", subtype: "GENERIC_CALL" },
      meeting: { type: "MEETING", subtype: "COMMERCIAL_MEETING" },
    };

    // external_id de TODAS as tarefas que o RD devolveu nesta execução. Como
    // as tarefas são varridas por inteiro toda vez (não há incremental aqui),
    // o que está no banco e não veio na resposta foi apagado no RD.
    const tarefasVistas = new Set<string>();
    let tarefasCompletas = true;

    tasksLoop: for (const rdType of Object.keys(taskTypeMap)) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        if (outOfTime()) {
          console.log(`[sync-rd-station] orçamento de tempo esgotado antes da página ${page} de tasks (${rdType})`);
          partial = true;
          tarefasCompletas = false;
          break tasksLoop;
        }
        if (page === MAX_PAGES) tarefasCompletas = false;

        console.log(`[sync-rd-station] buscando tasks (${rdType}) — página ${page}`);
        // O endpoint /tasks do RD às vezes estoura o tempo (visto 7x em 24h
        // nos logs de 05/09/2026). Antes, esse erro subia até o catch geral e
        // derrubava a sincronização INTEIRA — negociações e vendas paravam
        // junto, e o log ficava ERROR, o que obrigava uma carga total na
        // execução seguinte. Agora a falha fica contida: esta lista para,
        // a conferência de exclusões é desligada (para não marcar tarefa
        // nenhuma por engano) e o resto da sincronização continua.
        let json: any;
        try {
          json = await rdFetch("/tasks", rdToken, {
            page: String(page),
            limit: String(PAGE_LIMIT),
            type: rdType,
          });
        } catch (tasksErr) {
          const msg = tasksErr instanceof Error ? tasksErr.message : String(tasksErr);
          console.error(`[sync-rd-station] falha ao buscar tasks (${rdType}) página ${page}: ${msg}`);
          avisos.push(`Tarefas (${rdType}) página ${page}: ${msg}`);
          tarefasCompletas = false;
          break; // vai para o próximo tipo de tarefa
        }
        const tasks: any[] = json.tasks ?? [];
        console.log(`[sync-rd-station] página ${page} de tasks (${rdType}): ${tasks.length} recebidas`);
        if (tasks.length === 0) break;

        const mapped = taskTypeMap[rdType];
        const activityRows: any[] = [];

        for (const task of tasks) {
          // Marcada como "vista" antes de qualquer filtro: a tarefa existe no
          // RD, mesmo que a gente não consiga gravá-la (ex.: sem data). Sem
          // isso, a conferência de exclusões a apagaria por engano.
          const externalId = `rd_task_${task.id ?? task._id}`;
          tarefasVistas.add(externalId);

          const scheduledAt = parseTaskDateTime(task);
          if (!scheduledAt) {
            counts.skipped++;
            continue;
          }

          const dealId = task.deal_id ? dealCache.get(String(task.deal_id)) ?? null : null;
          const firstUserId = task.user_ids?.[0] ? String(task.user_ids[0]) : null;
          const sellerId = firstUserId ? sellerCache.get(firstUserId) ?? null : null;

          activityRows.push({
            type: mapped.type,
            subtype: dealId ? (mapped.type === "CALL" ? "SALES_CALL" : "COMMERCIAL_MEETING") : mapped.subtype,
            source: "RD_STATION",
            external_id: externalId,
            deal_id: dealId,
            seller_id: sellerId,
            title: task.subject ?? null,
            scheduled_at: scheduledAt,
            status: task.done ? "DONE" : "SCHEDULED",
            has_note: !!task.notes,
            notes: task.notes ?? null,
            updated_at: new Date().toISOString(),
          });
        }

        if (activityRows.length > 0) {
          // Upsert via função no banco (upsert_rd_activities): o upsert padrão do
          // supabase-js não consegue mirar num índice único PARCIAL
          // (activities_external_id_rd_uidx, só para source = 'RD_STATION'),
          // que existe porque o mesmo índice em Google Calendar precisa ser
          // único por (seller_id, external_id) em vez de só external_id.
          const { error: actErr } = await supabase.rpc("upsert_rd_activities", { p_rows: activityRows });
          if (actErr) throw new Error(`Erro ao gravar página ${page} de activities (${rdType}): ${actErr.message}`);
          counts.activities += activityRows.length;
          console.log(`[sync-rd-station] página ${page} de tasks (${rdType}) gravada: ${activityRows.length} atividades (total: ${counts.activities})`);
        }

        if (!json.has_more) break;
      }
    }

    console.log(`[sync-rd-station] etapa de atividades concluída: ${counts.activities} atividades, ${counts.skipped} ignoradas`);

    // -------------------------------------------------------------------
    // 3) EXCLUSÕES — tarefas (ligações/reuniões) apagadas no RD
    //
    // As tarefas são varridas por inteiro em toda execução, então o que está
    // gravado e não veio na resposta foi apagado no RD. Marcamos (some da
    // tela) em vez de apagar do banco: se a tarefa voltar, ela reaparece.
    //
    // Travas: a varredura precisa ter terminado inteira E ter trazido alguma
    // coisa — uma resposta vazia é quase sempre falha de API, e marcar tudo
    // nesse caso limparia o histórico de uma vez.
    // -------------------------------------------------------------------
    if (suportaExclusao && tarefasCompletas && tarefasVistas.size > 0) {
      const { data: gravadas, error: readErr } = await supabase
        .from("activities")
        .select("id, external_id, deleted_at, updated_at")
        .eq("source", "RD_STATION");
      if (readErr) {
        errors.push(`Ao conferir tarefas apagadas no RD: ${readErr.message}`);
      } else {
        // PERÍODO DE CARÊNCIA — mesma proteção da Agenda (ver sync-calendar):
        // uma tarefa recém-criada que some de uma resposta é quase sempre a API
        // ainda não tendo estabilizado, não uma exclusão. Só é marcada depois
        // de algumas horas sem aparecer.
        const CARENCIA_MS = 3 * 60 * 60_000;
        const carenciaCorte = Date.now() - CARENCIA_MS;
        const sumiram = (gravadas ?? [])
          .filter(
            (a) =>
              !tarefasVistas.has(a.external_id) &&
              !a.deleted_at &&
              new Date(a.updated_at).getTime() <= carenciaCorte,
          )
          .map((a) => a.id);
        const voltaram = (gravadas ?? []).filter((a) => tarefasVistas.has(a.external_id) && a.deleted_at).map((a) => a.id);

        // TRAVA DE PROPORÇÃO — aprendida na prática em 05/09/2026.
        // Na primeira execução esta conferência quis marcar 468 ligações de
        // uma vez (37% de todo o histórico do RD). Ninguém apaga 468 ligações;
        // isso é a API não tendo devolvido tudo. Marcar teria derrubado o KPI
        // "Ligações" pela metade, sem ninguém mexer em nada.
        //
        // Regra: apagar algumas tarefas é normal e passa direto. Uma
        // "limpeza" grande é tratada como suspeita — nada é escondido e o
        // motivo fica registrado para ser conferido.
        const ativasNoBanco = (gravadas ?? []).filter((a) => !a.deleted_at).length;
        const LIMITE_ABSOLUTO = 25; // até isto, marca sem discutir
        const LIMITE_PROPORCAO = 0.1; // acima de 10% do histórico, desconfia
        const exagerado = sumiram.length > LIMITE_ABSOLUTO && sumiram.length > ativasNoBanco * LIMITE_PROPORCAO;
        if (exagerado) {
          const msg =
            `Conferência de tarefas apagadas ignorada por segurança: o RD deixou de devolver ${sumiram.length} de ` +
            `${ativasNoBanco} tarefas de uma vez. Isso não parece exclusão, e sim resposta incompleta da API. Nada foi escondido.`;
          console.warn(`[sync-rd-station] ${msg}`);
          avisos.push(msg);
          sumiram.length = 0; // não marca nada; as restaurações abaixo continuam
        }

        for (let i = 0; i < sumiram.length; i += 200) {
          const lote = sumiram.slice(i, i + 200);
          const { error } = await supabase.from("activities").update({ deleted_at: new Date().toISOString() }).in("id", lote);
          if (error) { errors.push(`Ao marcar tarefas apagadas: ${error.message}`); break; }
          counts.tarefas_apagadas += lote.length;
        }
        for (let i = 0; i < voltaram.length; i += 200) {
          const lote = voltaram.slice(i, i + 200);
          const { error } = await supabase.from("activities").update({ deleted_at: null }).in("id", lote);
          if (error) { errors.push(`Ao restaurar tarefas: ${error.message}`); break; }
        }
        if (sumiram.length > 0 || voltaram.length > 0) {
          console.log(`[sync-rd-station] tarefas: ${sumiram.length} apagada(s) no RD, ${voltaram.length} restaurada(s)`);
        }
      }
    }

    // -------------------------------------------------------------------
    // 4) EXCLUSÕES — cards (negociações) apagados no RD
    //
    // Aqui não dá para saber com uma sincronização incremental: o RD não
    // avisa que um card sumiu, ele simplesmente para de aparecer. A única
    // forma de descobrir é percorrer TODAS as negociações e comparar com o
    // que está no banco.
    //
    // COMO ISSO FICA RÁPIDO (o problema do "demora até 1 hora"):
    // antes de varrer tudo, uma única chamada barata pergunta ao RD QUANTAS
    // negociações existem. Se esse número não mudou desde a última vez,
    // ninguém apagou nem criou nada e a varredura é dispensada. Quando o
    // número muda, a varredura roda na hora — ou seja, o card apagado some
    // do sistema na PRÓXIMA sincronização (até 5 min), não em 1 hora.
    // A varredura completa também roda de tempos em tempos como rede de
    // segurança, para o caso raro de criar e apagar no mesmo intervalo
    // (o total volta ao mesmo número e a checagem barata não perceberia).
    //
    // Travas antes de marcar qualquer coisa:
    //   1. estrutura de exclusões instalada;
    //   2. a varredura precisa ter percorrido TODAS as páginas;
    //   3. precisa ter sobrado tempo (senão nem começa);
    //   4. o RD precisa ter devolvido pelo menos 70% do que temos no banco.
    //      Uma resposta truncada marcaria centenas de cards de uma vez.
    // -------------------------------------------------------------------
    const REDE_DE_SEGURANCA_MS = 60 * 60 * 1000; // varre de hora em hora mesmo sem mudança
    const RECONCILIACAO_TEMPO_MINIMO_MS = 30_000; // não começa sem esse tempo
    if (suportaExclusao && !partial) {
      const { data: estado } = await supabase
        .from("sync_state")
        .select("key, value")
        .in("key", ["ultima_varredura_exclusoes_rd", "total_negociacoes_rd"]);
      const porChave = new Map((estado ?? []).map((r: any) => [r.key, r.value]));
      const ultimaMs = porChave.get("ultima_varredura_exclusoes_rd")
        ? new Date(porChave.get("ultima_varredura_exclusoes_rd")).getTime()
        : 0;
      const totalAnterior = porChave.get("total_negociacoes_rd") ?? null;

      const temTempo = Date.now() - startedAt < TIME_BUDGET_MS - RECONCILIACAO_TEMPO_MINIMO_MS;

      // Checagem barata: 1 chamada, 1 registro. Só serve para ler o total.
      let totalAgora: string | null = null;
      if (temTempo) {
        try {
          const amostra = await rdFetch("/deals", rdToken, { page: "1", limit: "1" });
          const t = amostra?.total ?? amostra?.total_count ?? amostra?.count ?? null;
          if (typeof t === "number" && Number.isFinite(t)) totalAgora = String(t);
        } catch (e) {
          // Falhou a checagem barata: não é motivo para parar nada, a
          // varredura simplesmente cai na regra de tempo abaixo.
          console.warn("[sync-rd-station] checagem rápida de total falhou:", e instanceof Error ? e.message : e);
        }
      }

      const totalMudou = totalAgora !== null && totalAgora !== totalAnterior;
      // Se o RD não informa o total, não dá para ser esperto: varre sempre
      // que houver tempo (é o comportamento seguro, só gasta mais chamadas).
      const semTotal = totalAgora === null;
      const redeDeSeguranca = !Number.isFinite(ultimaMs) || Date.now() - ultimaMs > REDE_DE_SEGURANCA_MS;
      const precisaVarrer = totalMudou || semTotal || redeDeSeguranca;

      if (!precisaVarrer && temTempo) {
        console.log(`[sync-rd-station] nada mudou no RD (${totalAgora} negociações) — varredura dispensada`);
      }

      if (precisaVarrer && temTempo) {
        console.log(
          `[sync-rd-station] varredura de cards apagados: iniciando (motivo: ${totalMudou ? `total mudou ${totalAnterior} -> ${totalAgora}` : semTotal ? "RD não informou o total" : "rede de segurança"})`,
        );
        const idsNoRd = new Set<string>();
        let varreduraCompleta = false;

        for (let page = 1; page <= MAX_PAGES; page++) {
          if (outOfTime()) break;
          const json = await rdFetch("/deals", rdToken, {
            page: String(page),
            limit: String(PAGE_LIMIT),
            order: "updated_at",
            direction: "desc",
          });
          const lista: any[] = json.deals ?? [];
          for (const d of lista) idsNoRd.add(String(d.id ?? d._id));
          if (lista.length === 0 || !json.has_more) {
            varreduraCompleta = true;
            break;
          }
        }

        if (!varreduraCompleta) {
          console.log("[sync-rd-station] varredura de cards apagados incompleta — nada foi marcado");
        } else {
          const { data: noBanco, error: readErr } = await supabase
            .from("deals")
            .select("id, rd_deal_id, deleted_at");
          if (readErr) {
            errors.push(`Ao conferir cards apagados: ${readErr.message}`);
          } else {
            const ativosNoBanco = (noBanco ?? []).filter((d) => !d.deleted_at).length;
            // Trava anti-catástrofe: se o RD devolveu muito menos do que
            // temos, a resposta veio truncada — não é exclusão de verdade.
            if (ativosNoBanco > 0 && idsNoRd.size < ativosNoBanco * 0.7) {
              const msg = `Varredura de exclusões abortada por segurança: RD devolveu ${idsNoRd.size} cards para ${ativosNoBanco} no sistema.`;
              console.warn(`[sync-rd-station] ${msg}`);
              errors.push(msg);
            } else {
              const sumiram = (noBanco ?? []).filter((d) => !idsNoRd.has(d.rd_deal_id) && !d.deleted_at).map((d) => d.id);
              const voltaram = (noBanco ?? []).filter((d) => idsNoRd.has(d.rd_deal_id) && d.deleted_at).map((d) => d.id);

              for (let i = 0; i < sumiram.length; i += 200) {
                const lote = sumiram.slice(i, i + 200);
                const { error } = await supabase.from("deals").update({ deleted_at: new Date().toISOString() }).in("id", lote);
                if (error) { errors.push(`Ao marcar cards apagados: ${error.message}`); break; }
                counts.cards_apagados += lote.length;
                // A venda do card apagado sai junto — senão o faturamento
                // continuaria contando uma negociação que não existe mais.
                const { error: delErr } = await supabase.from("sales").delete().in("deal_id", lote);
                if (delErr) errors.push(`Ao remover vendas de cards apagados: ${delErr.message}`);
              }
              for (let i = 0; i < voltaram.length; i += 200) {
                const lote = voltaram.slice(i, i + 200);
                const { error } = await supabase.from("deals").update({ deleted_at: null }).in("id", lote);
                if (error) { errors.push(`Ao restaurar cards: ${error.message}`); break; }
                counts.cards_restaurados += lote.length;
              }

              // Só grava o "está tudo conferido" depois de uma varredura que
              // realmente terminou. Se ela falhar no meio, a próxima execução
              // tenta de novo em vez de achar que já checou.
              const marcas: any[] = [
                { key: "ultima_varredura_exclusoes_rd", value: new Date().toISOString(), updated_at: new Date().toISOString() },
              ];
              if (totalAgora !== null) {
                marcas.push({ key: "total_negociacoes_rd", value: totalAgora, updated_at: new Date().toISOString() });
              }
              await supabase.from("sync_state").upsert(marcas, { onConflict: "key" });

              console.log(`[sync-rd-station] varredura concluída: ${counts.cards_apagados} card(s) apagado(s), ${counts.cards_restaurados} restaurado(s)`);
            }
          }
        }
      }
    }

    // Junta os avisos parciais (ex.: vendas que não gravaram) para que nada
    // fique escondido: vai para sync_logs.error E para a resposta, que a tela
    // usa para mostrar "Sincronização parcial" com o motivo.
    const notas: string[] = [];
    if (partial) {
      notas.push(
        `Sincronização parcial: orçamento de tempo esgotado. Progresso: ${JSON.stringify(counts)}. A próxima execução continua de onde parou.`
      );
    }
    notas.push(...errors);
    const finalError = notas.length > 0 ? notas.join(" | ").slice(0, 2000) : null;

    await supabase
      .from("sync_logs")
      .update({
        status: "SUCCESS",
        finished_at: new Date().toISOString(),
        records_synced: counts.deals + counts.sales + counts.activities,
        error: finalError,
      })
      .eq("id", logId);

    console.log(`[sync-rd-station] finalizado${partial ? " (parcial)" : ""}:`, counts, errors);

    return new Response(JSON.stringify({ ok: true, partial, counts, errors, avisos, registros: counts.deals + counts.sales + counts.activities }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-rd-station] erro:", message);
    await supabase
      .from("sync_logs")
      .update({ status: "ERROR", finished_at: new Date().toISOString(), error: message })
      .eq("id", logId);

    return new Response(JSON.stringify({ ok: false, error: message, counts }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
});
