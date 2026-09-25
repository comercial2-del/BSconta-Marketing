// Origem dos leads por canal e por campanha (aba Marketing).
//
// Vem do RD Station: a sincronização grava a FONTE da negociação em
// deals.origin e a CAMPANHA em deals.campaign (desde 25/09/2026).
//
// Canais definidos pelo usuário em 25/09/2026. Cada fonte do RD cai em um
// canal; o que não se encaixa em nenhum fica em "Outros / não informado",
// para o total sempre bater com a quantidade de leads.
const CANAIS_LEAD = [
  { id: "facebook", nome: "Facebook (Moonflag)", cor: "#4f46e5", fontes: [/facebook/] },
  { id: "indicacao", nome: "Indicação", cor: "#059669", fontes: [/indica/] },
  // "Busca Paga | Google" entra em Site: o anúncio do Google leva o lead ao site.
  { id: "site", nome: "Site", cor: "#0ea5e9", fontes: [/site/, /google/, /buscador/, /organica/, /trafego direto/] },
  { id: "outbound", nome: "Outbound", cor: "#f59e0b", fontes: [/outbound/, /prospec/] },
  { id: "redes", nome: "Redes sociais", cor: "#db2777", fontes: [/redes sociais/, /instagram/, /linkedin/, /tiktok/] },
];
const CANAL_OUTROS = { id: "outros", nome: "Outros / não informado", cor: "#9799ad" };

function origemNorm(s) {
  return (s ?? "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/** Canal de uma fonte do RD (ex.: "Busca Paga | Facebook Ads" -> Facebook). */
function canalDaFonte(fonte) {
  const n = origemNorm(fonte);
  if (!n) return CANAL_OUTROS;
  return CANAIS_LEAD.find((c) => c.fontes.some((re) => re.test(n))) || CANAL_OUTROS;
}

/**
 * Leads que chegaram no período agrupados por canal e por campanha, com
 * quantos viraram venda e quantos foram perdidos (funil Perdidos do RD).
 * Usa getLeadsPainel (js/leads.js) para ter exatamente os mesmos critérios
 * da tela Leads.
 */
function getOrigensDosLeads(store, { range }) {
  const painel = getLeadsPainel(store, { range });
  const porId = new Map((store.deals || []).map((d) => [d.id, d]));
  const perdido = (l) => ["retornoFuturo", "vendasPerdidas", "semRetorno"].includes(l.situacao);

  const novo = (extra) => ({ ...extra, leads: 0, vendas: 0, valorVendido: 0, perdidos: 0 });
  const canais = new Map([...CANAIS_LEAD, CANAL_OUTROS].map((c) => [c.id, novo({ id: c.id, nome: c.nome, cor: c.cor, fontes: new Map() })]));
  const campanhas = new Map();

  for (const l of painel.chegaram) {
    const d = porId.get(l.id) || {};
    const canal = canalDaFonte(d.origin);
    const campanha = (d.campaign || "").trim() || "Sem campanha";
    const alvoCanal = canais.get(canal.id);
    if (!campanhas.has(campanha)) campanhas.set(campanha, novo({ nome: campanha, canais: new Map() }));
    const alvoCampanha = campanhas.get(campanha);
    for (const alvo of [alvoCanal, alvoCampanha]) {
      alvo.leads += 1;
      if (l.situacao === "vendido") { alvo.vendas += 1; alvo.valorVendido += l.valor; }
      if (perdido(l)) alvo.perdidos += 1;
    }
    const fonte = d.origin || "Não informada";
    alvoCanal.fontes.set(fonte, (alvoCanal.fontes.get(fonte) || 0) + 1);
    alvoCampanha.canais.set(canal.nome, (alvoCampanha.canais.get(canal.nome) || 0) + 1);
  }

  const taxa = (g) => ({ ...g, conversao: g.leads ? (g.vendas / g.leads) * 100 : 0 });
  const listaCanais = [...canais.values()]
    .filter((c) => c.id !== "outros" || c.leads > 0)
    .map((c) => taxa({ ...c, fontes: [...c.fontes.entries()].sort((a, b) => b[1] - a[1]) }));
  const listaCampanhas = [...campanhas.values()]
    .map((c) => taxa({ ...c, canal: [...c.canais.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—" }))
    .sort((a, b) => b.leads - a.leads || b.vendas - a.vendas || a.nome.localeCompare(b.nome, "pt-BR"));

  return { total: painel.chegaram.length, canais: listaCanais, campanhas: listaCampanhas };
}

if (typeof module !== "undefined") module.exports = { canalDaFonte, getOrigensDosLeads, CANAIS_LEAD };
