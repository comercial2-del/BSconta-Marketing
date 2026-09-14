// Cálculos de KPI, funil, ranking, metas e relatório — porta fiel da lógica
// que existia em src/lib/metrics.ts, reports.ts e goals.ts (versão Next.js),
// agora operando sobre os arrays já carregados em memória (ver data.js).

// Se a reunião já foi confirmada manualmente (Sim/Não, ver reunioes.html e
// 09_meeting_confirmation.sql), essa confirmação manda — inclusive para
// marcar como NÃO realizada uma reunião que a Agenda/RD tinham marcado como
// "Realizada" por engano. Sem confirmação manual (meeting_confirmed = null),
// cai no status automático que já vinha da Agenda/RD Station.
function isMeetingRealized(a) {
  if (a.meeting_confirmed === true) return true;
  if (a.meeting_confirmed === false) return false;
  return a.status === "DONE";
}

// O Google Calendar grava uma cópia do MESMO evento para cada vendedor
// envolvido: o Marlon, como SDR, agenda a reunião e convida o Uriel (que é
// quem de fato a realiza) — as duas cópias têm o mesmo `external_id`. O
// Uriel também agenda reuniões por conta própria (só a cópia dele existe
// nesse caso). Quando não há filtro de vendedor ("Todos os vendedores"),
// isso faz cada reunião real aparecer/duplicar 2x. Para contar/mostrar cada
// reunião real uma única vez, agrupamos por `external_id` e ficamos só com
// uma linha por reunião — priorizando a cópia do Uriel quando existir (é
// quem realiza), e herdando a confirmação manual (Sim/Não) de qualquer uma
// das cópias caso a cópia escolhida ainda não tenha sido confirmada.
const URIEL_EMAIL = "comercial@bsconta.com.br";

function dedupeCalendarMeetings(rows, sellers) {
  const uriel = (sellers || []).find((s) => s.email === URIEL_EMAIL);
  const groups = new Map();
  for (const a of rows) {
    const key = a.external_id || `id_${a.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const result = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }
    const winner = (uriel && group.find((a) => a.seller_id === uriel.id)) || group[0];
    const otherConfirmed = group.find((a) => a.meeting_confirmed === true || a.meeting_confirmed === false);
    const meeting_confirmed = winner.meeting_confirmed ?? (otherConfirmed ? otherConfirmed.meeting_confirmed : null);
    result.push({ ...winner, meeting_confirmed });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Classificação: o que é REUNIÃO e o que é LIGAÇÃO
//
// Regra definida pelo usuário (03/09/2026): ligação NUNCA é reunião. Qualquer
// evento cujo título fale de ligação / chamada / call / telefonema / contato
// telefônico é tratado como LIGAÇÃO, mesmo que a sincronização da Agenda o
// tenha gravado como type = 'MEETING' (a sync-calendar antiga marcava todo
// evento importado como MEETING — ver supabase/functions/sync-calendar).
//
// Só conta como REUNIÃO o evento explicitamente nomeado como reunião:
// "Reunião", "Reunião x ...", "Reunião BSconta x <cliente>" — e a variação
// sem o prefixo ("BSconta x <cliente>") que também é usada na Agenda.
// Reuniões internas (ex.: "Reunião IA/Gabriel") não entram nos indicadores
// comerciais.
//
// O título manda sobre o `type` gravado no banco, então a regra vale para
// exibição, contadores, filtros, indicadores, gráficos e relatórios de uma
// vez só — inclusive para os registros que já estão gravados errados.
// ---------------------------------------------------------------------------
function normalizeText(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira acentos: "Ligação" -> "ligacao"
    .replace(/\s+/g, " ")
    .trim();
}

// Padrões que caracterizam LIGAÇÃO (nunca reunião).
const CALL_TITLE_PATTERNS = ["ligacao", "ligacoes", "ligar ", "chamada", "telefonema", "contato telefonico", "telefonico"];
// "call" precisa de fronteira de palavra para não casar com "callback"/nomes.
const CALL_WORD_RE = /\bcalls?\b/;
// Reuniões internas / não comerciais que o usuário pediu para não contar.
const INTERNAL_MEETING_PATTERNS = ["ia/gabriel", "reuniao ia"];

function isCallTitle(title) {
  const n = normalizeText(title);
  if (!n) return false;
  return CALL_TITLE_PATTERNS.some((p) => n.includes(p)) || CALL_WORD_RE.test(n);
}

function isMeetingTitle(title) {
  const n = normalizeText(title);
  if (!n) return false;
  if (isCallTitle(n)) return false;
  if (INTERNAL_MEETING_PATTERNS.some((p) => n.includes(p))) return false;
  return n.startsWith("reuniao") || n.includes("bsconta x");
}

// Ligação de vendas x de agendamento: na Agenda o título costuma trazer
// "Ligação - Vendas"; no RD Station vem pelo subtype SALES_CALL.
function isSalesCall(a) {
  return a.subtype === "SALES_CALL" || /\bvenda/.test(normalizeText(a.title));
}

// Subtipos que o próprio RD Station classifica como reunião. São um sinal
// confiável (vêm do tipo da tarefa no CRM, não de um bloco solto de agenda):
// nessas o título costuma ser só o nome do cliente ("Rodrigo Pinheiro"), sem
// a palavra "Reunião". A Agenda, por outro lado, importa tudo como 'OTHER' —
// por isso 'OTHER' NÃO entra nesta lista: é lá que moram os compromissos
// internos que devem ficar de fora.
const MEETING_SUBTYPES = ["COMMERCIAL_MEETING", "PROPOSAL_MEETING", "CONFIRMED_MEETING"];

/** "MEETING" | "CALL" | "OTHER" — o título tem prioridade sobre o type. */
function activityKind(a) {
  // 1) Ligação sempre vence: nenhum título de ligação vira reunião, seja qual
  //    for o type/subtype gravado no banco.
  if (isCallTitle(a.title)) return "CALL";
  // 2) Reunião interna/não comercial fica de fora dos indicadores.
  if (INTERNAL_MEETING_PATTERNS.some((p) => normalizeText(a.title).includes(p))) return "OTHER";
  // 3) Título explicitamente de reunião ("Reunião...", "BSconta x ...").
  if (isMeetingTitle(a.title)) return "MEETING";
  // 4) Sem título de reunião, só vale como reunião se a ORIGEM já a
  //    classificou assim (tarefa "meeting" do RD). Evento genérico da Agenda
  //    (subtype 'OTHER') nunca entra — treinamento, alinhamento, bloco etc.
  if (a.type === "MEETING" && MEETING_SUBTYPES.includes(a.subtype)) return "MEETING";
  return a.type === "CALL" ? "CALL" : "OTHER";
}

function isRealMeeting(a) {
  return activityKind(a) === "MEETING";
}

/**
 * Separa as atividades de um período em reuniões e ligações já aplicando a
 * regra de nomenclatura e removendo as cópias duplicadas da Agenda (o mesmo
 * evento aparece na agenda do organizador e de cada convidado). É a fonte
 * única usada por getKpis, pela página Reuniões e pela página Ligações.
 */
function classifyActivities(acts, sellers, sellerId) {
  const meetingsRaw = acts.filter((a) => a.source === "CALENDAR" && isRealMeeting(a));
  const callsRaw = acts.filter((a) => activityKind(a) === "CALL");

  // Com filtro de vendedor, cada vendedor vê a própria cópia (não deduplica).
  if (sellerId) return { meetings: meetingsRaw, calls: callsRaw };

  const callsFromCalendar = callsRaw.filter((a) => a.source === "CALENDAR");
  const callsFromOtherSources = callsRaw.filter((a) => a.source !== "CALENDAR");
  return {
    meetings: dedupeCalendarMeetings(meetingsRaw, sellers),
    calls: [...callsFromOtherSources, ...dedupeCalendarMeetings(callsFromCalendar, sellers)],
  };
}

// ---------------------------------------------------------------------------
// Datas — pequenas funções equivalentes ao date-fns usado antes (semana
// começando na segunda-feira, igual ao original).
// ---------------------------------------------------------------------------
function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function subDays(d, n) { const r = new Date(d); r.setDate(r.getDate() - n); return r; }
function startOfWeek(d) {
  const r = startOfDay(d);
  const day = r.getDay(); // 0 = domingo
  const diff = (day + 6) % 7; // dias desde a última segunda-feira
  r.setDate(r.getDate() - diff);
  return r;
}
function endOfWeek(d) { return endOfDay(new Date(startOfWeek(d).getTime() + 6 * 86400000)); }
function subWeeks(d, n) { return subDays(d, n * 7); }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }
function subMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() - n, d.getDate()); }

/** Lê ?start=YYYY-MM-DD&end=YYYY-MM-DD da URL (período do calendário). */
function customRangeFromUrl() {
  if (typeof window === "undefined" || !window.location) return null;
  const p = new URLSearchParams(window.location.search);
  const s = p.get("start");
  const e = p.get("end");
  if (!s || !e) return null;
  const start = new Date(`${s}T00:00:00`);
  const end = new Date(`${e}T23:59:59.999`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return null;
  return { start, end };
}

function resolvePeriod(period, now = new Date(), custom) {
  switch (period) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "this_week":
      return { start: startOfWeek(now), end: endOfWeek(now) };
    case "last_week": {
      const lw = subWeeks(now, 1);
      return { start: startOfWeek(lw), end: endOfWeek(lw) };
    }
    case "this_month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "last_month": {
      const lm = subMonths(now, 1);
      return { start: startOfMonth(lm), end: endOfMonth(lm) };
    }
    case "custom": {
      // Período escolhido no calendário (?period=custom&start=&end=). Quando
      // a página chama resolvePeriod("custom") sem passar o intervalo, ele é
      // lido da própria URL — assim nenhuma página precisou mudar.
      const range = custom || customRangeFromUrl();
      if (!range) return { start: startOfWeek(now), end: endOfWeek(now) };
      return range;
    }
    default:
      return { start: startOfWeek(now), end: endOfWeek(now) };
  }
}

function previousRange(range) {
  const lengthMs = range.end.getTime() - range.start.getTime();
  return { start: new Date(range.start.getTime() - lengthMs), end: new Date(range.start.getTime()) };
}

function pctChange(current, previous) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function inRange(date, range) {
  return date >= range.start && date < range.end;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

/**
 * Em que ponto do funil a negociação morreu, a partir do nome da etapa.
 *
 * Olha o NOME e não o id porque o funil do RD tem 25 etapas e muda: amarrar
 * em id exigiria reescrever código a cada etapa nova. A ordem dos testes
 * importa — "Reunião de Proposta" é perda na PROPOSTA, não na reunião, porque
 * nesse ponto a proposta já estava na mesa.
 *
 * Etapa desconhecida cai em "lead": o que não é reunião nem proposta é o
 * começo do funil.
 */
function ondeAPerdaAconteceu(nomeDaEtapa) {
  const n = (nomeDaEtapa || "").toLowerCase();
  if (n.includes("proposta") || n.includes("follow") || n.includes("fechamento")) return "proposta";
  if (n.includes("reuni") || n.includes("reagend") || n.includes("agendad")) return "reuniao";
  return "lead";
}

/**
 * Linhas de baixo do cartão de perdas — uma por etapa, com o valor perdido:
 *
 *     Lead R$ 800
 *     Proposta R$ 700
 *
 * Só o valor, sem repetir a contagem: o total de perdas já é o número grande
 * do cartão, e a contagem por etapa competia com o dinheiro pela atenção sem
 * responder nada que o valor não responda melhor.
 *
 * Uma linha por etapa e não tudo emendado: a linha única ficaria comprida
 * demais para a largura de um cartão e quebraria no meio de um número. Etapa
 * sem perda não aparece — balde zerado polui sem informar.
 */
function resumoDasPerdas(perdas) {
  if (!perdas || !perdas.total) return ["Nenhuma perda no período"];
  const reais = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const linha = (rotulo, b) => (b && b.n ? `${rotulo} ${reais(b.valor)}` : null);
  return [
    linha("Lead", perdas.lead),
    linha("Reunião", perdas.reuniao),
    linha("Proposta", perdas.proposta),
    linha("Sem etapa", perdas.semEtapa),
  ].filter(Boolean);
}
function getKpis(store, { range, sellerId }) {
  const acts = store.activities.filter((a) => inRange(a.scheduled_at, range) && (!sellerId || a.seller_id === sellerId));

  const count = (pred) => acts.filter(pred).length;

  // Reuniões e ligações saem da MESMA classificação (ver classifyActivities):
  // o título manda, então "Ligação – Follow-up" importada da Agenda conta
  // como ligação e nunca como reunião, e cada evento conta uma única vez.
  const { meetings: meetingsPool, calls: callsPool } = classifyActivities(acts, store.sellers, sellerId);

  const callsDone = callsPool.filter((a) => a.status === "DONE").length;
  const salesCallsDone = callsPool.filter((a) => a.status === "DONE" && isSalesCall(a)).length;
  // "Reunião" = evento real da Agenda (source = CALENDAR). Tasks do tipo
  // "meeting" vindas do RD Station (source = RD_STATION) são tarefas do CRM,
  // não reuniões de verdade da Agenda — a pedido do usuário (03/09/2026),
  // não entram nessa contagem. Quando não há filtro de vendedor específico,
  // cada reunião real conta 1x (ver dedupeCalendarMeetings) — sem isso, uma
  // reunião com Marlon (organizador) e Uriel (convidado) contaria 2x.
  const meetingsScheduled = meetingsPool.length;
  const meetingsDone = meetingsPool.filter(isMeetingRealized).length;
  const meetingsConfirmed = meetingsPool.filter((a) => a.subtype === "CONFIRMED_MEETING").length;
  const meetingsCanceled = meetingsPool.filter((a) => a.status === "CANCELED").length;
  const meetingsNoShow = meetingsPool.filter((a) => a.status === "NO_SHOW").length;
  const proposalMeetings = meetingsPool.filter((a) => a.subtype === "PROPOSAL_MEETING").length;
  const followUps = count((a) => a.subtype === "FOLLOW_UP");

  // Contagem/valor "ao vivo" (não filtrado por período) de negociações
  // OPEN numa etapa do funil pelo nome — mesmo critério usado pelos boards
  // (colunas) do RD Station, para os números baterem com o RD.
  const stageSnapshot = (stageName) => {
    const stage = store.stages.find((s) => s.name === stageName);
    if (!stage) return { count: 0, value: 0 };
    const rows = store.deals.filter((d) => d.stage_id === stage.id && d.status === "OPEN" && (!sellerId || d.seller_id === sellerId));
    return { count: rows.length, value: rows.reduce((a, d) => a + Number(d.value), 0) };
  };

  const probable = stageSnapshot("Provável Fechamento");
  const probableClosures = probable.count;
  const probableClosuresValue = probable.value;

  const reuniaoProposta = stageSnapshot("Reunião de Proposta");
  const followUpStage = stageSnapshot("Follow-Up");

  // "Propostas enviadas" = "Reunião de Proposta" + "Provável Fechamento".
  //
  // A regra é de negócio, definida pelo usuário em 14/09/2026, e a lógica é
  // esta: a etapa "Enviar Proposta" do RD é uma PENDÊNCIA — a proposta ainda
  // vai ser enviada. Quem já avançou para "Reunião de Proposta" ou "Provável
  // Fechamento" é porque a proposta SAIU. Então quem conta como enviada são
  // essas duas, não a primeira.
  //
  // Histórico de dois erros nesta linha, ambos no mesmo dia:
  //   1. Contava todas as negociações que já passaram por "Enviar Proposta",
  //      inclusive as perdidas: 41 onde o RD mostrava 4.
  //   2. Passou a contar só as em andamento de "Enviar Proposta" (4) — certo
  //      pelo RD, errado pela regra do negócio, que é a de cima.
  //
  // Só as negociações EM ANDAMENTO entram (é o que o stageSnapshot faz), então
  // perdidas e ganhas ficam de fora.
  const proposalsSent = reuniaoProposta.count + probable.count;
  const proposalsSentValue = reuniaoProposta.value + probable.value;

  // -------------------------------------------------------------------------
  // PERDAS — quantas negociações caíram no período e, principalmente, EM QUE
  // PONTO DO FUNIL elas morreram.
  //
  // Por que isso é possível: o RD NÃO joga a negociação perdida numa etapa
  // "Perdido". Ela fica parada na etapa em que estava quando o negócio caiu —
  // foi assim que se descobriu, em 14/09/2026, que havia 37 perdidas paradas
  // em "Enviar Proposta". É esse resíduo que permite dizer onde a perda
  // aconteceu.
  //
  // Por que importa separar: perder no lead e perder na proposta são
  // problemas diferentes. Perda no lead é prospecção (lista ruim, abordagem
  // errada). Perda na proposta é preço, prazo ou concorrente. O número total
  // sozinho não distingue os dois, e é justamente essa distinção que diz o
  // que consertar.
  //
  // O período segue closed_at, igual ao "Perdidos" do relatório semanal, para
  // os dois nunca divergirem.
  const nomeDaEtapa = new Map(store.stages.map((s) => [s.id, s.name]));
  const etapasDePerda = new Set(store.stages.filter((s) => s.is_lost).map((s) => s.id));

  const perdidasNoPeriodo = store.deals.filter(
    (d) => d.status === "LOST" && d.closed_at && inRange(d.closed_at, range) && (!sellerId || d.seller_id === sellerId)
  );

  // Cada balde guarda QUANTAS e QUANTO. Só a contagem não serve para decidir
  // nada: perder 5 leads de R$ 200 e perder 1 proposta de R$ 8.000 aparecem
  // como "5" e "1" — o número maior é o problema menor. O dinheiro é que diz
  // onde dói.
  const balde = () => ({ n: 0, valor: 0 });
  const perdas = { total: perdidasNoPeriodo.length, valor: 0, lead: balde(), reuniao: balde(), proposta: balde(), semEtapa: balde() };
  for (const d of perdidasNoPeriodo) {
    const valor = Number(d.value) || 0;
    perdas.valor += valor;
    const etapa = nomeDaEtapa.get(d.stage_id);
    // Se a negociação foi mesmo movida para uma etapa de perda, o funil não
    // guarda onde ela morreu. Chutar um balde seria inventar número: fica em
    // separado, e a soma dos baldes continua batendo com o total.
    const onde = !etapa || etapasDePerda.has(d.stage_id) ? "semEtapa" : ondeAPerdaAconteceu(etapa);
    perdas[onde].n += 1;
    perdas[onde].valor += valor;
  }

  const salesInRange = store.sales.filter((s) => inRange(s.closed_at, range) && (!sellerId || s.seller_id === sellerId));
  const salesCount = salesInRange.length;
  const revenue = salesInRange.reduce((a, s) => a + Number(s.value), 0);
  const margin = salesInRange.reduce((a, s) => a + Number(s.margin || 0), 0);
  const ticketMedio = salesCount > 0 ? revenue / salesCount : 0;

  // "Valor em oportunidades abertas" = soma exata dos 3 cartões do funil
  // acima (Reunião de proposta + Follow-up + Prováveis fechamentos), a
  // pedido do usuário — não a soma de todas as etapas abertas.
  const opportunitiesValue = reuniaoProposta.value + followUpStage.value + probable.value;

  return {
    callsDone, salesCallsDone, meetingsScheduled, meetingsDone, meetingsConfirmed,
    meetingsCanceled, meetingsNoShow, proposalsSent, proposalMeetings, followUps,
    probableClosures, probableClosuresValue,
    proposalsSentValue,
    reuniaoPropostaCount: reuniaoProposta.count, reuniaoPropostaValue: reuniaoProposta.value,
    followUpCount: followUpStage.count, followUpValue: followUpStage.value,
    perdas,
    salesCount, revenue, margin, ticketMedio,
    opportunitiesValue,
    meetingRealizationRate: meetingsScheduled > 0 ? (meetingsDone / meetingsScheduled) * 100 : null,
  };
}

/**
 * LEADS DO PERÍODO — quantos entraram e quantos foram perdidos.
 *
 * "Chegaram" usa created_at, que é a data em que o lead nasceu NO RD: o
 * sync-rd-station grava a data que vem do RD, e não a data da importação
 * (`created_at: deal.created_at ?? undefined`). Se fosse a da importação,
 * todos os leads antigos teriam nascido no mesmo dia e o número não diria nada.
 *
 * "Perdidos" usa closed_at, o mesmo critério do cartão de Perdas e do
 * relatório semanal — assim os três nunca divergem.
 *
 * Os dois NÃO são o mesmo grupo de leads: um lead que chegou em agosto e caiu
 * em setembro conta como perdido aqui sem ter chegado aqui. O cartão compara
 * dois fluxos do período, não o destino de uma safra.
 */
function getLeads(store, { range, sellerId }) {
  const meu = (d) => !sellerId || d.seller_id === sellerId;
  const chegaram = store.deals.filter((d) => d.created_at && inRange(d.created_at, range) && meu(d));
  const perdidos = store.deals.filter(
    (d) => d.status === "LOST" && d.closed_at && inRange(d.closed_at, range) && meu(d)
  );
  return { chegaram: chegaram.length, perdidos: perdidos.length };
}

// ---------------------------------------------------------------------------
// Funil
// ---------------------------------------------------------------------------
function getFunnel(store, sellerId) {
  const allStages = store.stages.filter((s) => !s.is_lost).sort((a, b) => a.order - b.order);

  const rows = allStages.map((stage) => {
    const matching = store.deals.filter((d) => {
      if (d.stage_id !== stage.id) return false;
      if (sellerId && d.seller_id !== sellerId) return false;
      return stage.is_won ? d.status === "WON" : d.status === "OPEN";
    });
    return {
      stage: stage.name,
      order: stage.order,
      count: matching.length,
      value: matching.reduce((a, d) => a + Number(d.value), 0),
      isWon: stage.is_won,
      conversionFromPrev: null,
    };
  });

  for (let i = 0; i < rows.length; i++) {
    const prev = rows[i - 1];
    rows[i].conversionFromPrev = prev && prev.count > 0 ? (rows[i].count / prev.count) * 100 : null;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------
function getRanking(store, range) {
  return store.sellers
    .map((seller) => {
      const k = getKpis(store, { range, sellerId: seller.id });
      return { sellerId: seller.id, name: seller.name, calls: k.callsDone, meetings: k.meetingsDone, proposals: k.proposalMeetings, sales: k.salesCount, revenue: k.revenue };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Relatório semanal — mesmo formato combinado com o usuário
// ---------------------------------------------------------------------------
function generateWeeklyReport(store, range) {
  // Mesmo critério de getKpis: só reuniões reais da Agenda (source =
  // CALENDAR), com cada reunião contando 1x mesmo aparecendo em mais de uma
  // cópia (Marlon + Uriel) — ver dedupeCalendarMeetings.
  const meetings = classifyActivities(
    store.activities.filter((a) => inRange(a.scheduled_at, range)),
    store.sellers
  ).meetings;
  const agendadas = meetings.length;
  const noShow = meetings.filter((a) => a.status === "NO_SHOW").length;
  const realizadas = meetings.filter(isMeetingRealized).length;

  const dealById = new Map(store.deals.map((d) => [d.id, d]));
  const fechamentos = store.sales
    .filter((s) => inRange(s.closed_at, range))
    .map((s) => {
      const deal = dealById.get(s.deal_id);
      return {
        nome: deal?.client_name || "Não localizado",
        empresa: deal?.company_name || null,
        valor: Number(s.value),
        recorrente: s.is_recurring,
      };
    });

  const emAnaliseStageNames = ["Reunião de Proposta", "Follow-Up"];
  const emAnaliseStageIds = store.stages.filter((s) => emAnaliseStageNames.includes(s.name)).map((s) => s.id);
  const emAnaliseCount = store.deals.filter(
    (d) => emAnaliseStageIds.includes(d.stage_id) && d.status === "OPEN" && inRange(d.updated_at, range)
  ).length;

  const perdidosRows = store.deals.filter((d) => d.status === "LOST" && d.closed_at && inRange(d.closed_at, range));

  return {
    range,
    agendadas,
    noShow,
    realizadas,
    fechamentos,
    emAnalise: { count: emAnaliseCount, isEstimate: true },
    perdidos: {
      count: perdidosRows.length,
      names: perdidosRows.map((p) => p.client_name).filter(Boolean),
      namesConfirmed: perdidosRows.every((p) => !!p.client_name),
    },
  };
}

function formatWeeklyReportText(report) {
  const { range } = report;
  const fmt = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const pad = (n) => String(n).padStart(2, "0");
  const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const lines = [];
  lines.push(`Semana do dia ${fmt(range.start)} a ${fmt(range.end)}:`);
  lines.push(`${pad(report.agendadas)} Reuniões agendadas`);
  lines.push(`${pad(report.noShow)} No-show`);
  lines.push(`${pad(report.realizadas)} Reuniões realizadas`);
  lines.push(`${pad(report.fechamentos.length)} Fechamentos ("Recorrente")`);
  for (const f of report.fechamentos) {
    const empresa = f.empresa ? ` — ${f.empresa}` : "";
    lines.push(`— ${f.nome}${empresa} — ${brl(f.valor)}`);
  }
  lines.push(`${pad(report.emAnalise.count)} Em análise${report.emAnalise.isEstimate ? "*" : ""}`);
  lines.push(`${pad(report.perdidos.count)} Perdidos (leads desqualificados)`);
  if (report.emAnalise.isEstimate) {
    lines.push(`*Não confirmado pelo CRM — estimativa baseada no estágio do funil (Reunião de Proposta / Follow-Up).`);
  }
  if (!report.perdidos.namesConfirmed) {
    lines.push(`Observação: nem todos os nomes das perdas puderam ser identificados.`);
  }
  return lines.join("\n");
}

function compareReports(current, previous) {
  return {
    agendadas: pctChange(current.agendadas, previous.agendadas),
    realizadas: pctChange(current.realizadas, previous.realizadas),
    fechamentos: pctChange(current.fechamentos.length, previous.fechamentos.length),
    receita: pctChange(
      current.fechamentos.reduce((a, f) => a + f.valor, 0),
      previous.fechamentos.reduce((a, f) => a + f.valor, 0)
    ),
  };
}

function bestSeller(store, range) {
  let best = null;
  for (const s of store.sellers) {
    const revenue = store.sales
      .filter((sale) => sale.seller_id === s.id && inRange(sale.closed_at, range))
      .reduce((a, sale) => a + Number(sale.value), 0);
    if (!best || revenue > best.revenue) best = { name: s.name, revenue };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Metas
// ---------------------------------------------------------------------------
function realizedForMetric(store, metric, range, sellerId, lancamentos) {
  // LIGAÇÕES vêm de js/lancamentos.js, a mesma fonte da tela de Ligações e da
  // Visão geral. O getKpis só enxerga as atividades do RD e não conhece o
  // lançamento manual do dia — foi por isso que, em 14/09/2026, uma meta de
  // 100 ligações aparecia com 7 realizadas enquanto a tela de Ligações
  // mostrava 116. Meta que não enxerga o número oficial não é meta: é um
  // segundo número para a mesma coisa, e ninguém sabe em qual acreditar.
  //
  // Quando `lancamentos` não é informado (ou a página não carregou o
  // lancamentos.js), cai no comportamento antigo em vez de quebrar.
  if ((metric === "CALLS" || metric === "SALES_CALLS") && lancamentos && typeof numerosDeLigacoes === "function") {
    const n = sellerId
      ? numerosDeLigacoes(store, lancamentos, range, sellerId)
      : numerosDeLigacoesGeral(store, lancamentos, range);
    return metric === "CALLS" ? n.total : n.vendas;
  }

  const k = getKpis(store, { range, sellerId });
  switch (metric) {
    case "CALLS": return k.callsDone;
    case "SALES_CALLS": return k.salesCallsDone;
    case "MEETINGS": return k.meetingsScheduled;
    case "MEETINGS_HELD": return k.meetingsDone;
    case "PROPOSALS": return k.proposalsSent;
    case "SALES": return k.salesCount;
    case "REVENUE": return k.revenue;
    default: return 0;
  }
}

function metricLabel(metric) {
  return {
    CALLS: "Ligações",
    SALES_CALLS: "Ligações de vendas",
    MEETINGS: "Reuniões agendadas",
    MEETINGS_HELD: "Reuniões realizadas",
    PROPOSALS: "Propostas enviadas",
    SALES: "Vendas",
    REVENUE: "Faturamento (R$)",
  }[metric];
}

function rangeForGoalPeriod(period) {
  return resolvePeriod(period === "WEEK" ? "this_week" : "this_month");
}

/**
 * RITMO DA META — quanto do período já passou, de 0 a 100.
 *
 * Existe porque "34% atingido" sozinho não diz se é bom ou ruim. 34% na
 * segunda-feira é ótimo; 34% na sexta é problema. Comparando o quanto foi
 * feito com o quanto do prazo já correu, a mesma barra passa a responder a
 * pergunta que se faz de verdade: dá tempo?
 *
 * Antes do começo do período devolve 0; depois do fim, 100.
 */
function ritmoDoPeriodo(range, agora = new Date()) {
  const inicio = range.start.getTime();
  const fim = range.end.getTime();
  if (!(fim > inicio)) return 100;
  const passou = ((agora.getTime() - inicio) / (fim - inicio)) * 100;
  return Math.max(0, Math.min(100, passou));
}

/**
 * Situação de uma meta, comparando o realizado com o ritmo do prazo.
 *
 * As folgas existem para o alarme continuar sendo alarme. Trabalho comercial
 * não entra em ritmo constante: na segunda de manhã quase toda meta está em
 * zero, e marcar todas de vermelho todo começo de semana ensina a ignorar o
 * vermelho. Só vira alerta quando a distância para o relógio é grande o
 * bastante para ser difícil recuperar.
 */
function situacaoDaMeta(pct, ritmo) {
  if (pct >= 100) return "batida";
  if (pct >= ritmo) return "adiantada";
  if (pct >= ritmo - 15) return "no-ritmo";
  if (pct >= ritmo - 35) return "atrasada";
  return "critica";
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------
function brl(v) { return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }); }
function pctText(v) { return v == null ? "sem base de comparação" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`; }
