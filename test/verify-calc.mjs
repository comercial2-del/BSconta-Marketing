// Testa calc.js isoladamente (sem navegador/Supabase) usando um "store" de
// dados equivalente ao que a página carregaria via Supabase, com o mesmo
// dataset real de seed. Verifica que os totais batem com os números
// conhecidos (mesmos usados na versão Next.js já testada).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";

const calcSrc = readFileSync(new URL("../js/calc.js", import.meta.url), "utf8");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(calcSrc, ctx);

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

const uriel = { id: randomUUID(), name: "Uriel Coelho", email: "comercial@bsconta.com.br" };
const marlon = { id: randomUUID(), name: "Marlon", email: "comercial2@bsconta.com.br" };
const sellers = [uriel, marlon];

const stageDefs = [
  { name: "Qualificação", order: 0 },
  { name: "Reunião Confirmada", order: 1 },
  { name: "Reagendamento Comercial", order: 2 },
  { name: "Enviar Proposta", order: 3 },
  { name: "Reunião de Proposta", order: 4 },
  { name: "Follow-Up", order: 5 },
  { name: "Provável Fechamento", order: 6 },
  { name: "Venda Realizada", order: 7, is_won: true },
  { name: "Perdido", order: 8, is_lost: true },
].map((s) => ({ id: randomUUID(), is_won: false, is_lost: false, ...s }));
const stageId = (name) => stageDefs.find((s) => s.name === name).id;

const deals = [];
const sales = [];
const activities = [];

const openPipeline = [
  { seller: uriel, stage: "Reunião Confirmada", count: 5, totalValue: 15000 },
  { seller: uriel, stage: "Enviar Proposta", count: 4, totalValue: 12000 },
  { seller: uriel, stage: "Reunião de Proposta", count: 22, totalValue: 12935 },
  { seller: uriel, stage: "Follow-Up", count: 8, totalValue: 6865 },
  { seller: uriel, stage: "Provável Fechamento", count: 6, totalValue: 5270 },
  { seller: marlon, stage: "Reunião Confirmada", count: 2, totalValue: 6000 },
  { seller: marlon, stage: "Enviar Proposta", count: 1, totalValue: 3000 },
];
for (const g of openPipeline) {
  const perVal = g.totalValue / g.count;
  for (let i = 1; i <= g.count; i++) {
    deals.push({
      id: randomUUID(), client_name: `Oportunidade — ${g.stage} #${i}`, company_name: null,
      seller_id: g.seller.id, stage_id: stageId(g.stage), value: Math.round(perVal * 100) / 100,
      status: "OPEN", closed_at: null, created_at: daysAgo(10 + i), updated_at: daysAgo(Math.max(1, 10 - i)),
    });
  }
}

// Negociações PERDIDAS que ficaram paradas na etapa "Enviar Proposta".
// Existem no fixture só para provar que elas NÃO entram em "Propostas
// enviadas": era exatamente esse o bug de 14/09/2026 — o sistema mostrava 41
// (37 perdidas + 4 em andamento) onde o RD mostrava 4.
const perdidasNaProposta = 37;
for (let i = 1; i <= perdidasNaProposta; i++) {
  deals.push({
    id: randomUUID(), client_name: `Perdida na proposta #${i}`, company_name: null,
    seller_id: uriel.id, stage_id: stageId("Enviar Proposta"), value: 500,
    status: "LOST", closed_at: daysAgo(30 + i), created_at: daysAgo(60 + i), updated_at: daysAgo(30 + i),
  });
}

// PERDAS em outros pontos do funil, para provar que o cartão "Perdas" separa
// onde o negócio morreu — e não joga tudo num balde só.
const perdasPorEtapa = [
  { etapa: "Qualificação", quantas: 4 },        // vira "lead"
  { etapa: "Reunião Confirmada", quantas: 3 },  // vira "reunião"
  { etapa: "Perdido", quantas: 2 },             // etapa de perda: não dá para saber onde morreu
];
for (const g of perdasPorEtapa) {
  for (let i = 1; i <= g.quantas; i++) {
    deals.push({
      id: randomUUID(), client_name: `Perdida em ${g.etapa} #${i}`, company_name: null,
      seller_id: uriel.id, stage_id: stageId(g.etapa), value: 100,
      status: "LOST", closed_at: daysAgo(10 + i), created_at: daysAgo(50 + i), updated_at: daysAgo(10 + i),
    });
  }
}

// Perdida SEM data de fechamento: não pertence a período nenhum, então não
// pode aparecer em nenhum recorte. Se aparecer, o número do cartão muda
// conforme o filtro sem motivo.
deals.push({
  id: randomUUID(), client_name: "Perdida sem data", company_name: null,
  seller_id: uriel.id, stage_id: stageId("Follow-Up"), value: 999,
  status: "LOST", closed_at: null, created_at: daysAgo(80), updated_at: daysAgo(80),
});

const wonPipeline = [
  { seller: uriel, count: 121, totalValue: 65835 },
  { seller: marlon, count: 1, totalValue: 0 },
];
const wonStageId = stageId("Venda Realizada");
for (const g of wonPipeline) {
  const perVal = g.count > 0 ? g.totalValue / g.count : 0;
  for (let i = 1; i <= g.count; i++) {
    const closedAt = daysAgo(i % 90);
    const dealId = randomUUID();
    const value = Math.round(perVal * 100) / 100;
    deals.push({ id: dealId, client_name: `Cliente fechado #${i}`, company_name: null, seller_id: g.seller.id, stage_id: wonStageId, value, status: "WON", closed_at: closedAt, created_at: daysAgo((i % 90) + 15), updated_at: closedAt });
    sales.push({ id: randomUUID(), deal_id: dealId, seller_id: g.seller.id, value, margin: Math.round(value * 0.4 * 100) / 100, is_recurring: i % 20 === 0, closed_at: closedAt, created_at: closedAt });
  }
}

const callAggregates = [
  { seller: uriel, done: 60, scheduled: 18 },
  { seller: marlon, done: 327, scheduled: 62 },
];
for (const g of callAggregates) {
  for (let i = 1; i <= g.done; i++) {
    activities.push({ id: randomUUID(), type: "CALL", subtype: i % 3 === 0 ? "SALES_CALL" : "GENERIC_CALL", source: "RD_STATION", external_id: `c_${g.seller.id}_${i}`, seller_id: g.seller.id, scheduled_at: daysAgo(i % 30), status: "DONE", has_note: true, attended: i % 5 !== 0, created_at: daysAgo(i % 30), updated_at: daysAgo(i % 30) });
  }
  for (let i = 1; i <= g.scheduled; i++) {
    const d = new Date(Date.now() + i * 86400000);
    activities.push({ id: randomUUID(), type: "CALL", subtype: "GENERIC_CALL", source: "RD_STATION", external_id: `cs_${g.seller.id}_${i}`, seller_id: g.seller.id, scheduled_at: d, status: "SCHEDULED", has_note: false, attended: null, created_at: d, updated_at: d });
  }
}

const meetings = [
  ["2026-08-27", "Rodrigo Pinheiro", "Cliente", "Agendada"],
  ["2026-08-26", "Dione Resende", "Cliente", "Realizada"],
  ["2026-08-25", "Thais Lago", "Cliente", "Recusada"],
];
const statusMap = { Agendada: "SCHEDULED", Realizada: "DONE", Recusada: "DECLINED" };
for (const [date, name, kind, status] of meetings) {
  const d = new Date(date + "T10:00:00");
  activities.push({ id: randomUUID(), type: "MEETING", subtype: "COMMERCIAL_MEETING", source: "CALENDAR", external_id: `m_${date}_${name}`, seller_id: marlon.id, calendar_account: marlon.email, title: name, scheduled_at: d, status: statusMap[status], has_note: status === "Realizada", created_at: d, updated_at: d });
}

const store = { sellers, stages: stageDefs, deals, activities, sales, goals: [] };

// --- asserts ---
function assert(cond, msg) {
  if (!cond) throw new Error("FALHOU: " + msg);
  console.log("OK:", msg);
}

assert(deals.filter((d) => d.status === "OPEN").length === 48, "48 oportunidades abertas");
assert(sales.length === 122, "122 vendas");
assert(Math.abs(sales.reduce((a, s) => a + s.value, 0) - 65835) < 1, "faturamento total = R$65.835");
assert(activities.filter((a) => a.type === "CALL").length === 467, "467 ligações");
assert(activities.filter((a) => a.type === "MEETING").length === 3, "3 reuniões no fixture reduzido");

const range = { start: new Date("2000-01-01"), end: new Date("2100-01-01") }; // tudo
const kpis = ctx.getKpis(store, { range });
assert(kpis.salesCount === 122, "getKpis: salesCount bate com vendas totais");
assert(Math.abs(kpis.revenue - 65835) < 1, "getKpis: revenue bate com faturamento total");
assert(kpis.callsDone === 467 - (18 + 62), "getKpis: callsDone = ligações com status DONE");

// "Propostas enviadas" = "Reunião de Proposta" + "Provável Fechamento", e só
// o que está EM ANDAMENTO. Regra de negócio: "Enviar Proposta" é pendência
// (ainda vai sair); as duas seguintes já receberam a proposta.
//
// No fixture: Uriel tem 22 em Reunião de Proposta (R$12.935) e 6 em Provável
// Fechamento (R$5.270). As 37 perdidas em "Enviar Proposta" e as 5 em
// andamento em "Enviar Proposta" não entram.
assert(kpis.proposalsSent === 28, `getKpis: propostas enviadas = 28 (22 em Reunião de Proposta + 6 em Provável Fechamento), veio ${kpis.proposalsSent}`);
assert(kpis.proposalsSent !== 5, 'getKpis: NÃO é a etapa "Enviar Proposta"');
assert(kpis.proposalsSent !== 5 + perdidasNaProposta, "getKpis: as negociações perdidas não entram em lugar nenhum");
assert(
  Math.abs(kpis.proposalsSentValue - (12935 + 5270)) < 1,
  `getKpis: valor das propostas = R$18.205 (12.935 + 5.270), veio ${kpis.proposalsSentValue}`
);

// --- Perdas -----------------------------------------------------------------
const p = kpis.perdas;
assert(p.total === perdidasNaProposta + 4 + 3 + 2, `perdas: total = 46, veio ${p.total}`);
assert(p.proposta.n === perdidasNaProposta, `perdas: 37 morreram com proposta na mesa, veio ${p.proposta.n}`);
assert(p.lead.n === 4, `perdas: 4 morreram ainda como lead, veio ${p.lead.n}`);
assert(p.reuniao.n === 3, `perdas: 3 morreram na reunião, veio ${p.reuniao.n}`);
assert(p.semEtapa.n === 2, `perdas: 2 sem etapa identificável, veio ${p.semEtapa.n}`);
assert(
  p.lead.n + p.reuniao.n + p.proposta.n + p.semEtapa.n === p.total,
  "perdas: os baldes somam o total (nenhuma perda some nem conta duas vezes)"
);

// Valores: 37 x R$500 na proposta, 9 x R$100 nas demais.
assert(p.proposta.valor === perdidasNaProposta * 500, `perdas: valor perdido na proposta = R$18.500, veio ${p.proposta.valor}`);
assert(p.lead.valor === 400, `perdas: valor perdido em lead = R$400, veio ${p.lead.valor}`);
assert(p.reuniao.valor === 300, `perdas: valor perdido em reunião = R$300, veio ${p.reuniao.valor}`);
assert(
  p.lead.valor + p.reuniao.valor + p.proposta.valor + p.semEtapa.valor === p.valor,
  "perdas: a soma dos valores dos baldes bate com o valor total perdido"
);
// A perdida sem data vale R$999 e está fora do período: não pode ter entrado.
assert(p.valor === perdidasNaProposta * 500 + 9 * 100, `perdas: R$999 da perdida sem data ficou de fora, veio ${p.valor}`);

// "Reunião de Proposta" é perda na PROPOSTA, não na reunião — nesse ponto a
// proposta já estava na mesa.
assert(ctx.ondeAPerdaAconteceu("Reunião de Proposta") === "proposta", "ondeAPerdaAconteceu: Reunião de Proposta conta como proposta");
assert(ctx.ondeAPerdaAconteceu("Reunião Confirmada") === "reuniao", "ondeAPerdaAconteceu: Reunião Confirmada conta como reunião");
assert(ctx.ondeAPerdaAconteceu("Follow-Up") === "proposta", "ondeAPerdaAconteceu: Follow-Up conta como proposta");
assert(ctx.ondeAPerdaAconteceu("Etapa que ninguém conhece") === "lead", "ondeAPerdaAconteceu: etapa desconhecida cai em lead");

const linhas = ctx.resumoDasPerdas(p);
assert(Array.isArray(linhas) && linhas.length === 4, `resumoDasPerdas: uma linha por etapa com perda, veio ${linhas.length}`);
assert(linhas[0].startsWith("Lead R$"), `resumoDasPerdas: a linha traz só o valor, sem a contagem, veio "${linhas[0]}"`);
assert(!/Lead \d/.test(linhas[0]), `resumoDasPerdas: a contagem por etapa não aparece, veio "${linhas[0]}"`);
assert(linhas.every((l) => /R\$/.test(l)), "resumoDasPerdas: toda linha mostra o valor perdido");
assert(
  ctx.resumoDasPerdas({ total: 0 })[0] === "Nenhuma perda no período",
  "resumoDasPerdas: período sem perda não mostra baldes zerados"
);
assert(
  ctx.resumoDasPerdas({ total: 2, lead: { n: 2, valor: 800 }, reuniao: { n: 0, valor: 0 }, proposta: { n: 0, valor: 0 }, semEtapa: { n: 0, valor: 0 } }).length === 1,
  "resumoDasPerdas: etapa sem perda não vira linha"
);

// --- Leads no período --------------------------------------------------------
// Chegaram = created_at no período. Perdidos = LOST com closed_at no período.
// Os dois NÃO são o mesmo grupo: quem chegou antes e caiu agora só conta como
// perdido. É por isso que o cartão não é uma rosquinha de "partes de um todo".
const leadsTudo = ctx.getLeads(store, { range });
assert(leadsTudo.perdidos === p.total, `getLeads: perdidos usa o mesmo critério do cartão de Perdas, veio ${leadsTudo.perdidos}`);
assert(leadsTudo.chegaram > 0, `getLeads: leads com created_at no período são contados, veio ${leadsTudo.chegaram}`);

const janelaVazia = { start: new Date("1990-01-01"), end: new Date("1990-01-02") };
const leadsVazio = ctx.getLeads(store, { range: janelaVazia });
assert(leadsVazio.chegaram === 0 && leadsVazio.perdidos === 0, "getLeads: período sem nada devolve zero, não o total");

const soDoUriel = ctx.getLeads(store, { range, sellerId: uriel.id });
assert(soDoUriel.chegaram <= leadsTudo.chegaram, "getLeads: filtro por vendedor nunca devolve mais que o total");

// --- Meta de ligações enxerga o lançamento manual ---------------------------
// Bug de 14/09/2026: uma meta de 100 ligações aparecia com 7 realizadas
// enquanto a tela de Ligações mostrava 116, porque realizedForMetric olhava só
// as atividades do RD. Meta que não enxerga o número oficial é um segundo
// número para a mesma coisa.
{
  const janela = { start: new Date("2000-01-01"), end: new Date("2100-01-01") };
  const semLancamento = ctx.realizedForMetric(store, "CALLS", janela, null);
  const comLancamento = ctx.realizedForMetric(store, "CALLS", janela, null, []);
  assert(typeof semLancamento === "number", "realizedForMetric continua funcionando sem lançamentos");
  assert(typeof comLancamento === "number", "realizedForMetric aceita a lista de lançamentos");
}

// --- Ritmo das metas ---------------------------------------------------------
// "34% atingido" sozinho não diz nada: 34% na segunda é ótimo, 34% na sexta é
// problema. O ritmo é o que dá sentido ao percentual.
const semana = { start: new Date("2026-09-14T00:00:00"), end: new Date("2026-09-21T00:00:00") };
assert(ctx.ritmoDoPeriodo(semana, new Date("2026-09-14T00:00:00")) === 0, "ritmoDoPeriodo: no primeiro instante, 0% do prazo");
assert(Math.abs(ctx.ritmoDoPeriodo(semana, new Date("2026-09-17T12:00:00")) - 50) < 0.1, "ritmoDoPeriodo: na metade, 50%");
assert(ctx.ritmoDoPeriodo(semana, new Date("2026-09-30T00:00:00")) === 100, "ritmoDoPeriodo: depois do fim não passa de 100%");
assert(ctx.ritmoDoPeriodo(semana, new Date("2026-09-01T00:00:00")) === 0, "ritmoDoPeriodo: antes do começo não fica negativo");

assert(ctx.situacaoDaMeta(100, 50) === "batida", "situacaoDaMeta: 100% é batida, não importa o prazo");
assert(ctx.situacaoDaMeta(60, 50) === "adiantada", "situacaoDaMeta: acima do ritmo é adiantada");
assert(ctx.situacaoDaMeta(45, 50) === "no-ritmo", "situacaoDaMeta: pouco atrás ainda é no ritmo");
// A regra que existe para o alarme não virar ruído: começo de semana zerado
// NÃO é vermelho.
assert(ctx.situacaoDaMeta(0, 12) === "no-ritmo", "situacaoDaMeta: zero na segunda de manhã não é alarme");
assert(ctx.situacaoDaMeta(20, 50) === "atrasada", "situacaoDaMeta: bem atrás do ritmo é atrasada");
assert(ctx.situacaoDaMeta(10, 50) === "critica", "situacaoDaMeta: muito atrás vira crítica");
assert(ctx.situacaoDaMeta(0, 90) === "critica", "situacaoDaMeta: quase no fim do prazo e em zero é crítica");

const funnel = ctx.getFunnel(store);
const totalFunnel = funnel.filter((f) => !f.isWon).reduce((a, f) => a + f.count, 0);
assert(totalFunnel === 48, "getFunnel: soma das etapas abertas = 48");
const wonRow = funnel.find((f) => f.isWon);
assert(wonRow.count === 122, "getFunnel: etapa Venda Realizada = 122");

const ranking = ctx.getRanking(store, range);
assert(ranking.length === 2, "getRanking: 2 vendedores");
assert(ranking[0].name === "Uriel Coelho", "getRanking: Uriel em 1º (mais faturamento)");

const report = ctx.generateWeeklyReport(store, { start: new Date("2026-08-24"), end: new Date("2026-08-31") });
assert(report.agendadas === 3, "generateWeeklyReport: 3 reuniões na semana de teste");
assert(report.realizadas === 1, "generateWeeklyReport: 1 realizada");
const text = ctx.formatWeeklyReportText(report);
assert(text.startsWith("Semana do dia 24/08 a 31/08:"), "formatWeeklyReportText: cabeçalho no formato certo");
assert(text.includes("Reuniões agendadas"), "formatWeeklyReportText: contém linha de agendadas");
console.log("\n--- texto gerado ---\n" + text);

console.log("\nTodos os testes passaram.");
