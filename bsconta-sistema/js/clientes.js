// ---------------------------------------------------------------------------
// Métricas e Histórico do Cliente — camada de dados e de cálculo.
//
// Fica separado do data.js de propósito. O data.js é carregado por TODAS as
// telas e foi enxugado para ser rápido; jogar mais três tabelas lá dentro
// deixaria a Visão geral, Ligações, Reuniões e Metas mais lentas para buscar
// dados que elas não usam. Só as duas telas de cliente carregam este arquivo.
//
// Ver 17_clientes_metricas.sql para as tabelas.
// ---------------------------------------------------------------------------

// As quatro situações pedidas, na ordem em que aparecem na tela.
// `UNSET` existe porque cliente que ninguém avaliou ainda não é cliente
// satisfeito — seria inventar um número bom que não foi medido.
const HEALTH = {
  GREEN:  { label: "Cliente satisfeito",  curto: "Satisfeito",  cor: "#10b981", tone: "green",  dot: "🟢" },
  YELLOW: { label: "Precisa de atenção",  curto: "Atenção",     cor: "#f59e0b", tone: "amber",  dot: "🟡" },
  RED:    { label: "Cliente com problema", curto: "Problema",   cor: "#ef4444", tone: "red",    dot: "🔴" },
  BLUE:   { label: "Oportunidade de crescimento", curto: "Oportunidade", cor: "#6366f1", tone: "indigo", dot: "🔵" },
  UNSET:  { label: "Sem avaliação",       curto: "Sem avaliação", cor: "#9799ad", tone: "neutral", dot: "⚪" },
};
const HEALTH_ORDEM = ["GREEN", "YELLOW", "RED", "BLUE", "UNSET"];

const CLIENT_STATUS = {
  ACTIVE:     { label: "Ativo",           tone: "green" },
  ONBOARDING: { label: "Em implantação",  tone: "indigo" },
  PAUSED:     { label: "Pausado",         tone: "amber" },
  CHURNED:    { label: "Encerrado",       tone: "neutral" },
};

const SEVERITY = { HIGH: "Alta", MEDIUM: "Média", LOW: "Baixa" };

// Os acontecimentos da linha do tempo. A ordem aqui é a do formulário.
const EVENT_KINDS = {
  ENTRADA:      { label: "Entrada do cliente",  tone: "indigo" },
  CONTATO:      { label: "Contato",             tone: "indigo" },
  ENTREGA:      { label: "Entrega",             tone: "teal" },
  FEEDBACK:     { label: "Feedback",            tone: "violet" },
  PROBLEMA:     { label: "Problema identificado", tone: "red" },
  SOLUCAO:      { label: "Solução realizada",   tone: "green" },
  SATISFEITO:   { label: "Cliente satisfeito",  tone: "green" },
  OPORTUNIDADE: { label: "Oportunidade",        tone: "indigo" },
  REAJUSTE:     { label: "Mudança de valor",    tone: "amber" },
  SAIDA:        { label: "Encerramento",        tone: "neutral" },
  OBSERVACAO:   { label: "Observação",          tone: "neutral" },
};

const healthInfo = (h) => HEALTH[h] || HEALTH.UNSET;
const statusInfo = (s) => CLIENT_STATUS[s] || CLIENT_STATUS.ACTIVE;
const eventInfo = (k) => EVENT_KINDS[k] || EVENT_KINDS.OBSERVACAO;

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------
const CLIENTES_CACHE_KEY = "sgcmp:clientes:v1";
const CLIENTES_CACHE_TTL_MS = 30_000;

const CLIENTES_DATE_FIELDS = {
  clients: ["started_at", "created_at", "updated_at"],
  client_events: ["happened_at", "created_at"],
  client_issues: ["opened_at", "resolved_at", "created_at"],
};

function hydrateClientes(raw) {
  const out = {};
  for (const [tabela, campos] of Object.entries(CLIENTES_DATE_FIELDS)) {
    out[tabela] = (raw[tabela] || []).map((linha) => {
      const copia = { ...linha };
      for (const c of campos) copia[c] = linha[c] ? new Date(linha[c]) : null;
      return copia;
    });
  }
  return { clients: out.clients, events: out.client_events, issues: out.client_issues };
}

function lerClientesCache(idadeMaximaMs = CLIENTES_CACHE_TTL_MS) {
  try {
    const txt = sessionStorage.getItem(CLIENTES_CACHE_KEY);
    if (!txt) return null;
    const { at, raw } = JSON.parse(txt);
    if (!at || Date.now() - at > idadeMaximaMs) return null;
    return hydrateClientes(raw);
  } catch {
    return null;
  }
}

function gravarClientesCache(raw) {
  try {
    sessionStorage.setItem(CLIENTES_CACHE_KEY, JSON.stringify({ at: Date.now(), raw }));
  } catch {
    /* sem espaço: segue sem cache */
  }
}

/** Obrigatório depois de QUALQUER gravação — senão a tela volta ao valor velho. */
function invalidateClientesCache() {
  try {
    sessionStorage.removeItem(CLIENTES_CACHE_KEY);
  } catch {
    /* nada a fazer */
  }
}

async function fetchTabela(nome, ordem) {
  let q = sb.from(nome).select("*").is("deleted_at", null);
  if (ordem) q = q.order(ordem.campo, { ascending: !!ordem.asc });
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Carrega a carteira inteira: clientes, linha do tempo e problemas. */
async function loadClientes(opts = {}) {
  if (!opts.fresh) {
    const doCache = lerClientesCache();
    if (doCache) return doCache;
  }
  const [clients, eventos, problemas] = await Promise.all([
    fetchTabela("clients", { campo: "name", asc: true }),
    fetchTabela("client_events", { campo: "happened_at" }),
    fetchTabela("client_issues", { campo: "opened_at" }),
  ]);
  gravarClientesCache({ clients, client_events: eventos, client_issues: problemas });
  return hydrateClientes({ clients, client_events: eventos, client_issues: problemas });
}

/** Mesma ideia do loadAllInstantaneo: desenha já, atualiza por trás. */
async function loadClientesInstantaneo(aoAtualizar) {
  const doCache = lerClientesCache(10 * 60_000);
  if (!doCache) return loadClientes();
  if (lerClientesCache(CLIENTES_CACHE_TTL_MS)) return doCache;
  loadClientes({ fresh: true })
    .then((novo) => typeof aoAtualizar === "function" && aoAtualizar(novo))
    .catch((e) => console.warn("[clientes] atualização em segundo plano falhou:", e));
  return doCache;
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------
async function salvarCliente(id, campos) {
  const { data, error } = await sb.from("clients").update(campos).eq("id", id).select().single();
  if (error) throw error;
  invalidateClientesCache();
  return data;
}

async function criarClienteManual(campos) {
  const { data, error } = await sb.from("clients").insert(campos).select().single();
  if (error) throw error;
  invalidateClientesCache();
  return data;
}

async function criarEvento(evento) {
  const { data, error } = await sb.from("client_events").insert(evento).select().single();
  if (error) throw error;
  invalidateClientesCache();
  return data;
}

async function criarProblema(problema) {
  const { data, error } = await sb.from("client_issues").insert(problema).select().single();
  if (error) throw error;
  invalidateClientesCache();
  return data;
}

async function resolverProblema(id, resolution, quemResolveu) {
  const { data, error } = await sb
    .from("client_issues")
    .update({ resolved_at: new Date().toISOString(), resolution, resolved_by_name: quemResolveu })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  invalidateClientesCache();
  return data;
}

/** Esconder (não apaga de verdade). Só Administrador consegue — ver a política
 *  "editar - ..." no 17_clientes_metricas.sql. */
async function esconderLinha(tabela, id) {
  const { error } = await sb.from(tabela).update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  invalidateClientesCache();
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

/** Há quanto tempo é cliente, em texto ("1 ano e 3 meses"). */
function tempoDeCliente(desde, ate = new Date()) {
  if (!desde) return "—";
  const meses = Math.max(0, (ate.getFullYear() - desde.getFullYear()) * 12 + (ate.getMonth() - desde.getMonth()) - (ate.getDate() < desde.getDate() ? 1 : 0));
  if (meses < 1) {
    const dias = Math.max(0, Math.floor((ate - desde) / 86400000));
    return dias <= 1 ? "entrou hoje" : `${dias} dias`;
  }
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const parteAnos = anos ? `${anos} ano${anos > 1 ? "s" : ""}` : "";
  const parteMeses = resto ? `${resto} ${resto > 1 ? "meses" : "mês"}` : "";
  return [parteAnos, parteMeses].filter(Boolean).join(" e ") || "1 mês";
}

/** Problemas ainda em aberto de um cliente. */
const problemasAbertos = (issues, clientId) =>
  (issues || []).filter((p) => p.client_id === clientId && !p.resolved_at);

/**
 * Números da carteira inteira.
 * "Em risco" é uma leitura, não um campo: cliente marcado como vermelho OU com
 * problema aberto há mais de 15 dias. Um problema que ninguém resolveu há duas
 * semanas é risco de perder o cliente, mesmo que ninguém tenha trocado a cor.
 */
const RISCO_DIAS = 15;

function metricasCarteira(clients, issues, agora = new Date()) {
  const ativos = (clients || []).filter((c) => c.status !== "CHURNED");
  const porSituacao = Object.fromEntries(HEALTH_ORDEM.map((k) => [k, 0]));
  for (const c of ativos) porSituacao[HEALTH[c.health] ? c.health : "UNSET"]++;

  const abertos = (issues || []).filter((p) => !p.resolved_at);
  const idClientesAtivos = new Set(ativos.map((c) => c.id));
  const abertosDeAtivos = abertos.filter((p) => idClientesAtivos.has(p.client_id));

  const arrastando = abertosDeAtivos.filter((p) => agora - p.opened_at > RISCO_DIAS * 86400000);
  const emRisco = new Set([
    ...ativos.filter((c) => c.health === "RED").map((c) => c.id),
    ...arrastando.map((p) => p.client_id),
  ]);

  const resolvidos = (issues || []).filter((p) => p.resolved_at);

  return {
    total: ativos.length,
    encerrados: (clients || []).length - ativos.length,
    satisfeitos: porSituacao.GREEN,
    atencao: porSituacao.YELLOW,
    comProblema: porSituacao.RED,
    oportunidade: porSituacao.BLUE,
    semAvaliacao: porSituacao.UNSET,
    porSituacao,
    problemasAbertos: abertosDeAtivos.length,
    problemasArrastando: arrastando.length,
    problemasResolvidos: resolvidos.length,
    clientesEmRisco: emRisco.size,
    valorCarteira: ativos.reduce((a, c) => a + Number(c.contract_value || 0), 0),
    valorEmRisco: ativos.filter((c) => emRisco.has(c.id)).reduce((a, c) => a + Number(c.contract_value || 0), 0),
    // Média de dias para resolver — mede se o problema vira solução ou fica parado.
    diasMedioResolucao: resolvidos.length
      ? Math.round(resolvidos.reduce((a, p) => a + (p.resolved_at - p.opened_at) / 86400000, 0) / resolvidos.length)
      : null,
  };
}

/** Os assuntos que mais aparecem nos problemas, do mais frequente ao menos. */
function principaisProblemas(issues, limite = 5) {
  const contagem = new Map();
  for (const p of issues || []) {
    const chave = (p.category || "").trim() || (p.title || "").trim() || "Sem categoria";
    const atual = contagem.get(chave) || { assunto: chave, total: 0, abertos: 0 };
    atual.total++;
    if (!p.resolved_at) atual.abertos++;
    contagem.set(chave, atual);
  }
  return [...contagem.values()].sort((a, b) => b.abertos - a.abertos || b.total - a.total).slice(0, limite);
}

/**
 * Evolução da satisfação mês a mês.
 * Cada mudança de situação fica gravada na linha do tempo (gatilho no banco),
 * então dá para reconstruir a foto de cada mês sem ninguém ter anotado nada:
 * para cada cliente, vale a última mudança até o fim daquele mês.
 */
function evolucaoSatisfacao(clients, events, meses = 6, agora = new Date()) {
  const mudancas = (events || [])
    .filter((e) => e.health_after)
    .sort((a, b) => a.happened_at - b.happened_at);

  const saida = [];
  for (let i = meses - 1; i >= 0; i--) {
    const fim = new Date(agora.getFullYear(), agora.getMonth() - i + 1, 0, 23, 59, 59, 999);
    const situacaoPorCliente = new Map();
    for (const e of mudancas) {
      if (e.happened_at > fim) break;
      situacaoPorCliente.set(e.client_id, e.health_after);
    }
    const contagem = { GREEN: 0, YELLOW: 0, RED: 0, BLUE: 0 };
    for (const c of clients || []) {
      if (c.started_at > fim) continue;
      const s = situacaoPorCliente.get(c.id);
      if (s && contagem[s] !== undefined) contagem[s]++;
    }
    saida.push({
      mes: fim.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""),
      ...contagem,
    });
  }
  return saida;
}
