// Cálculos da tela Leads (telas/leads.html). Funções puras sobre o `store`
// carregado por data.js — nada aqui vai ao banco.
//
// Como o funil do RD funciona (confirmado com o usuário em 25/09/2026):
// - todo lead nasce em "Sem contato" (pré-vendas). Por isso "leads que
//   chegaram" = negociações CRIADAS no período (deals.created_at, que é a
//   data de criação no próprio RD, não a da sincronização);
// - quem é perdido vai para o funil "Perdidos", que tem três etapas:
//   Retorno Futuro (vale a pena voltar a falar), Vendas Perdidas e
//   Sem Retorno. "Total de leads perdidos" é a soma dessas três.
//
// ATENÇÃO — nome de etapa desatualizado no banco: a sincronização grava o
// nome da etapa só na primeira vez que a vê e não renomeia depois. A etapa
// que hoje se chama "Retorno Futuro" no RD está gravada como "Perdidos".
// Por isso a identificação usa primeiro o id da etapa no RD e só depois o
// nome — assim funciona agora e continua funcionando se um dia os nomes
// forem atualizados.

const LEADS_ETAPAS_RD = {
  retornoFuturo: ["6ab5752e0688e30020df430e"],
  vendasPerdidas: ["6ab5752e0688e30020df430f"],
  semRetorno: ["6ab5752e0688e30020df4310"],
};

const LEADS_SITUACOES = {
  semContato: { label: "Sem contato", classe: "lead-new" },
  andamento: { label: "Em andamento", classe: "lead-contact" },
  vendido: { label: "Vendido", classe: "lead-won" },
  retornoFuturo: { label: "Retorno futuro", classe: "lead-negotiation" },
  vendasPerdidas: { label: "Venda perdida", classe: "lead-lost" },
  semRetorno: { label: "Sem retorno", classe: "lead-lost" },
  perdidoOutro: { label: "Perdido (fora do funil Perdidos)", classe: "lead-lost" },
};

const LEADS_BUCKETS_PERDA = ["retornoFuturo", "vendasPerdidas", "semRetorno"];

function leadsNorm(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Em qual etapa do funil "Perdidos" a etapa está (ou null). */
function leadsBucketDaEtapa(stage) {
  if (!stage) return null;
  const id = stage.rd_stage_id || "";
  const n = leadsNorm(stage.name);
  if (LEADS_ETAPAS_RD.retornoFuturo.includes(id) || n.includes("retorno futuro")) return "retornoFuturo";
  if (LEADS_ETAPAS_RD.vendasPerdidas.includes(id) || n.includes("vendas perdidas")) return "vendasPerdidas";
  if (LEADS_ETAPAS_RD.semRetorno.includes(id) || n.includes("sem retorno")) return "semRetorno";
  return null;
}

/** Situação atual de uma negociação, do ponto de vista de "lead". */
function leadsSituacao(deal, stage) {
  const bucket = leadsBucketDaEtapa(stage);
  if (bucket) return bucket;
  if (deal.status === "WON") return "vendido";
  if (deal.status === "LOST") return "perdidoOutro";
  if (stage && leadsNorm(stage.name) === "sem contato") return "semContato";
  return "andamento";
}

/** Nome da etapa para mostrar (corrige o nome desatualizado do banco). */
function leadsNomeDaEtapa(stage) {
  const bucket = leadsBucketDaEtapa(stage);
  if (bucket === "retornoFuturo") return "Perdidos · Retorno Futuro";
  if (bucket === "vendasPerdidas") return "Perdidos · Vendas Perdidas";
  if (bucket === "semRetorno") return "Perdidos · Sem Retorno";
  return stage ? stage.name : "—";
}

/** Data em que o lead foi perdido: fechamento no RD, senão última alteração. */
function leadsDataDaPerda(deal) {
  return deal.closed_at || deal.updated_at || null;
}

function leadsDentro(date, range) {
  return !!date && date >= range.start && date < range.end;
}

/**
 * Tudo o que a tela Leads mostra.
 * @param store  o store de data.js (deals, stages, sellers)
 * @param range  { start, end } do filtro de período
 * @param sellerId  vendedor (opcional)
 */
function getLeadsPainel(store, { range, sellerId } = {}) {
  const stages = new Map((store.stages || []).map((s) => [s.id, s]));
  const sellers = new Map((store.sellers || []).map((s) => [s.id, s.name]));
  const doVendedor = (d) => !sellerId || d.seller_id === sellerId;

  const leads = (store.deals || []).filter(doVendedor).map((d) => {
    const stage = stages.get(d.stage_id);
    const situacao = leadsSituacao(d, stage);
    return {
      id: d.id,
      nome: d.client_name || "Sem nome",
      empresa: d.company_name || "",
      valor: Number(d.value) || 0,
      status: d.status,
      situacao,
      etapa: leadsNomeDaEtapa(stage),
      vendedor: sellers.get(d.seller_id) || "—",
      chegada: d.created_at || null,
      perdidoEm: LEADS_BUCKETS_PERDA.includes(situacao) || situacao === "perdidoOutro" ? leadsDataDaPerda(d) : null,
      ultimaInteracao: d.last_interaction_at || null,
      origem: d.origin || "",
    };
  });

  const balde = () => ({ n: 0, valor: 0 });
  const somar = (b, l) => { b.n += 1; b.valor += l.valor; };

  // Chegadas no período (todo lead nasce em "Sem contato").
  const chegaram = leads.filter((l) => leadsDentro(l.chegada, range));

  // O que aconteceu com quem chegou no período (a "safra").
  const safra = { semContato: 0, andamento: 0, vendido: 0, perdido: 0 };
  for (const l of chegaram) {
    if (l.situacao === "semContato") safra.semContato++;
    else if (l.situacao === "andamento") safra.andamento++;
    else if (l.situacao === "vendido") safra.vendido++;
    else safra.perdido++;
  }

  // Perdas no período (data da perda) e o total que está hoje no funil Perdidos.
  const periodo = { total: balde(), retornoFuturo: balde(), vendasPerdidas: balde(), semRetorno: balde() };
  const atual = { total: balde(), retornoFuturo: balde(), vendasPerdidas: balde(), semRetorno: balde() };
  for (const l of leads) {
    if (!LEADS_BUCKETS_PERDA.includes(l.situacao)) continue;
    somar(atual[l.situacao], l);
    somar(atual.total, l);
    if (leadsDentro(l.perdidoEm, range)) {
      somar(periodo[l.situacao], l);
      somar(periodo.total, l);
    }
  }

  const semContatoAgora = leads.filter((l) => l.situacao === "semContato").length;

  return { leads, chegaram, safra, perdidos: { periodo, atual }, semContatoAgora };
}

/**
 * Agrupa as chegadas em barras (dia, semana ou mês, conforme o tamanho do
 * período) para o gráfico de chegadas.
 */
function leadsChegadasPorPeriodo(chegaram, range) {
  const MS_DIA = 86400000;
  // Período "todo o histórico" começa em 2000: a primeira barra é a do
  // primeiro lead de verdade, não 26 anos de barras vazias.
  const primeiro = chegaram.reduce((m, l) => Math.min(m, l.chegada.getTime()), Infinity);
  const inicio = new Date(Number.isFinite(primeiro) ? Math.max(range.start.getTime(), primeiro) : range.start.getTime());
  const fim = new Date(Math.min(range.end.getTime(), Date.now()));
  const dias = Math.max(1, Math.ceil((fim - inicio) / MS_DIA));
  const modo = dias <= 31 ? "dia" : dias <= 120 ? "semana" : "mes";
  const pad = (n) => String(n).padStart(2, "0");
  const chave = (d) => {
    if (modo === "mes") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (modo === "semana") {
      const dow = (x.getDay() + 6) % 7; // segunda = 0
      x.setDate(x.getDate() - dow);
    }
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  const rotulo = (k) => {
    const [y, m, d] = k.split("-");
    if (modo === "mes") return `${m}/${y.slice(2)}`;
    return modo === "semana" ? `sem. ${d}/${m}` : `${d}/${m}`;
  };

  // Todas as barras do intervalo, inclusive as vazias (dia sem lead também é informação).
  const barras = new Map();
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), modo === "mes" ? 1 : inicio.getDate());
  let guarda = 0;
  while (cursor <= fim && guarda++ < 400) {
    barras.set(chave(cursor), 0);
    if (modo === "mes") cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + (modo === "semana" ? 7 : 1));
  }
  for (const l of chegaram) {
    const k = chave(l.chegada);
    barras.set(k, (barras.get(k) || 0) + 1);
  }
  const lista = [...barras.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, n]) => ({ chave: k, rotulo: rotulo(k), n }));
  return { modo, barras: lista };
}

if (typeof module !== "undefined") {
  module.exports = { getLeadsPainel, leadsChegadasPorPeriodo, leadsSituacao, leadsBucketDaEtapa, LEADS_SITUACOES };
}
