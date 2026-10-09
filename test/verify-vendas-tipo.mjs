// ---------------------------------------------------------------------------
// Vendas ÚNICAS x RECORRENTES (09/10/2026)
//
// Caso real que motivou a mudança: Ingrid Figueira Baeta Neves tem no RD um
// card com dois produtos — Serviços Contábeis MENSAL (R$ 290) e Serviços
// Contábeis ÚNICO (R$ 800), total R$ 1.090. O sistema mostrava uma venda de
// R$ 1.090 marcada inteira como "Recorrente: Sim".
//
// Este teste confere:
//   1. as regras puras da sincronização (supabase/functions/.../produtos.mjs);
//   2. os cálculos das telas (js/calc.js): divisão, totais sem contagem dupla
//      e uma linha por produto;
//   3. a Visão geral e a tela de Vendas num navegador de verdade.
//
// Rodar: node test/verify-vendas-tipo.mjs
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { stripTypeScriptTypes } from "node:module";

// As regras da sincronização moram dentro do index.ts (o deploy é feito
// colando só esse arquivo no Supabase). Recorta o trecho entre os marcadores,
// tira os tipos e roda aqui, sem Deno.
const fonteSync = readFileSync(new URL("../supabase/functions/sync-rd-station/index.ts", import.meta.url), "utf8");
const trecho = fonteSync.match(/\/\/ <produtos>\n([\s\S]*?)\/\/ <\/produtos>/);
if (!trecho) throw new Error("marcadores <produtos> não encontrados no sync-rd-station/index.ts");
const ctxSync = {};
vm.createContext(ctxSync);
vm.runInContext(`${stripTypeScriptTypes(trecho[1])}\n;globalThis.__regras = { dividirValor, normalizarProduto, produtoEhRecorrente, rotuloRecorrencia };`, ctxSync);
const { dividirValor, normalizarProduto, produtoEhRecorrente, rotuloRecorrencia } = ctxSync.__regras;

let falhas = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "OK" : "FALHOU"}: ${msg}`);
  if (!cond) falhas++;
};
const quase = (a, b) => Math.abs(a - b) < 0.005;

// ---------------------------------------------------------------------------
// 1) Regras da sincronização
// ---------------------------------------------------------------------------
ok(produtoEhRecorrente("monthly") === true, "monthly é recorrente");
ok(produtoEhRecorrente("spare") === false, "spare é único");
ok(produtoEhRecorrente(null) === false, "sem recorrência conta como único (não infla o recorrente)");
ok(rotuloRecorrencia("monthly") === "Mensal" && rotuloRecorrencia("spare") === "Único", "rótulos Mensal / Único");

// Formato de /deals/{id}/deal_products da API v1 do RD.
const rdProdutos = [
  { _id: "p1", id: "p1", product_id: "cat1", name: "Serviços Contábeis", amount: 1, price: 290, base_price: 290, discount: 0, discount_type: "value", total: 290, recurrence: "monthly" },
  { _id: "p2", id: "p2", product_id: "cat1", name: "Serviços Contábeis", amount: 1, price: 800, base_price: 800, discount: 0, discount_type: "value", total: 800, recurrence: "spare" },
];
const prods = rdProdutos.map((p, i) => normalizarProduto(p, i));
ok(prods.length === 2 && prods[0].rd_deal_product_id === "p1" && prods[1].rd_deal_product_id === "p2", "produtos com o mesmo nome continuam separados pelo id do RD");
ok(prods[0].is_recurring && !prods[1].is_recurring, "um mensal e um único");
ok(normalizarProduto({ id: "x", price: 100, amount: 3, discount: 50 }).total === 250, "sem total: preço × quantidade − desconto");
ok(normalizarProduto({ id: "x", price: 100, amount: 2, discount: 10, discount_type: "percentage" }).total === 180, "desconto percentual");

const cardIngrid = { amount_total: 1090, amount_unique: 800, amount_montly: 290 };
const d1 = dividirValor(cardIngrid, null, 1090);
ok(d1.unique === 800 && d1.recurring === 290 && d1.divergencia === 0, "Ingrid: card dividido em R$ 800 único + R$ 290 recorrente");
const d2 = dividirValor({}, prods, 1090);
ok(d2.unique === 800 && d2.recurring === 290, "sem totais no card, divide pela soma dos produtos");
const d3 = dividirValor({ amount_total: 500, amount_unique: 0, amount_montly: 500 }, null, 500);
ok(d3.unique === 0 && d3.recurring === 500, "só mensalidade: tudo recorrente");
const d4 = dividirValor({ amount_total: 1000, amount_unique: 600, amount_montly: 300 }, null, 1000);
ok(d4.unique + d4.recurring === 1000 && d4.divergencia === 100, "total do card diferente das partes: soma continua igual ao total e a divergência é avisada");
const d5 = dividirValor({}, [], 700);
ok(d5.unique === 700 && d5.recurring === 0, "nada conhecido: tudo único (neutro)");

// ---------------------------------------------------------------------------
// 2) Cálculos das telas
// ---------------------------------------------------------------------------
const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../js/calc.js", import.meta.url), "utf8"), ctx);

const agora = new Date();
const hoje = (h) => { const d = new Date(agora); d.setHours(h, 0, 0, 0); return d; };
const range = { start: new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1), end: new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59) };

const uriel = { id: "s-uriel", name: "Uriel Coelho" };
const stageWon = { id: "st-won", name: "Venda Realizada", is_won: true, is_lost: false, order: 7 };
const deals = [
  { id: "d-ingrid", client_name: "Ingrid Figueira Baeta Neves", company_name: null, seller_id: uriel.id, stage_id: stageWon.id, value: 1090, status: "WON", closed_at: hoje(13), created_at: hoje(9), is_recurring: true, origin: "Busca Paga | Facebook Ads" },
  { id: "d-so-mensal", client_name: "Cliente Só Mensal", seller_id: uriel.id, stage_id: stageWon.id, value: 350, status: "WON", closed_at: hoje(11), created_at: hoje(9), is_recurring: true },
  { id: "d-antigo", client_name: "Cliente Antigo", seller_id: uriel.id, stage_id: stageWon.id, value: 500, status: "WON", closed_at: hoje(10), created_at: hoje(9), is_recurring: true },
  { id: "d-unico", client_name: "Cliente Único", seller_id: uriel.id, stage_id: stageWon.id, value: 1200, status: "WON", closed_at: hoje(12), created_at: hoje(9), is_recurring: false },
];
const sales = [
  // Já reprocessada pela sincronização (SQL 29).
  { id: "v-ingrid", deal_id: "d-ingrid", seller_id: uriel.id, value: 1090, is_recurring: true, value_unique: 800, value_recurring: 290, closed_at: hoje(13) },
  { id: "v-so-mensal", deal_id: "d-so-mensal", seller_id: uriel.id, value: 350, is_recurring: true, value_unique: 0, value_recurring: 350, closed_at: hoje(11) },
  // Venda antiga, ainda sem divisão nem produtos: usa o antigo Sim/Não.
  { id: "v-antigo", deal_id: "d-antigo", seller_id: uriel.id, value: 500, is_recurring: true, value_unique: null, value_recurring: null, closed_at: hoje(10) },
  // Sem divisão gravada, mas com produtos lidos.
  { id: "v-unico", deal_id: "d-unico", seller_id: uriel.id, value: 1200, is_recurring: false, closed_at: hoje(12) },
];
const deal_products = [
  { id: "dp1", deal_id: "d-ingrid", name: "Serviços Contábeis", recurrence: "monthly", is_recurring: true, quantity: 1, price: 290, total: 290, position: 0 },
  { id: "dp2", deal_id: "d-ingrid", name: "Serviços Contábeis", recurrence: "spare", is_recurring: false, quantity: 1, price: 800, total: 800, position: 1 },
  { id: "dp3", deal_id: "d-so-mensal", name: "Serviços Contábeis", recurrence: "monthly", is_recurring: true, quantity: 1, price: 350, total: 350, position: 0 },
  { id: "dp4", deal_id: "d-unico", name: "Abertura de empresa", recurrence: "spare", is_recurring: false, quantity: 1, price: 1200, total: 1200, position: 0 },
];
const store = { sellers: [uriel], stages: [stageWon], deals, sales, activities: [], goals: [], deal_products };

const split = ctx.getSalesSplit(store, { range });
const kpis = ctx.getKpis(store, { range });
ok(quase(split.unique, 800 + 1200), `vendas únicas = R$ 2.000 (veio ${split.unique})`);
ok(quase(split.recurring, 290 + 350 + 500), `vendas recorrentes = R$ 1.140 (veio ${split.recurring})`);
ok(quase(split.total, split.unique + split.recurring), "total = únicas + recorrentes");
ok(quase(split.total, kpis.revenue), `total do resumo = "Valor total de vendas realizadas" (${kpis.revenue}) — sem contagem dupla`);
ok(split.count === 4 && kpis.salesCount === 4, "continuam sendo 4 vendas (a Ingrid não conta duas vezes)");
ok(split.countUnique === 2 && split.countRecurring === 3, "Ingrid aparece nas duas contagens de tipo, uma vez em cada");

const linhas = ctx.getClientEntries(store, { range });
const daIngrid = linhas.filter((l) => l.clientName === "Ingrid Figueira Baeta Neves");
ok(daIngrid.length === 2, "Ingrid: 2 linhas na tabela (uma por produto)");
ok(daIngrid.every((l) => l.saleId === "v-ingrid" && l.sellerName === "Uriel Coelho"), "as 2 linhas são do mesmo cliente / mesma venda");
ok(daIngrid.some((l) => l.tipo === "RECORRENTE" && l.value === 290 && l.recorrencia === "Mensal"), "linha Recorrente · Mensal de R$ 290");
ok(daIngrid.some((l) => l.tipo === "UNICO" && l.value === 800), "linha Único de R$ 800");
ok(quase(daIngrid.reduce((a, l) => a + l.value, 0), 1090), "as linhas da Ingrid somam o valor da venda");
ok(linhas.filter((l) => l.clientName === "Cliente Só Mensal").length === 1, "cliente com um produto continua com uma linha");
const antigo = linhas.filter((l) => l.clientName === "Cliente Antigo");
ok(antigo.length === 1 && antigo[0].tipo === "RECORRENTE" && antigo[0].produto === null, "venda antiga sem produtos: uma linha, tipo do antigo Sim/Não");
ok(new Set(linhas.map((l) => l.linhaId)).size === linhas.length, "cada linha tem identificador próprio");

// Card misto sem produtos lidos: duas linhas pelas partes.
const misto = ctx.linhasDaVenda({ id: "x", deal_id: "y", value: 1000, value_unique: 700, value_recurring: 300 }, null);
ok(misto.length === 2 && misto.some((l) => l.tipo === "UNICO" && l.value === 700) && misto.some((l) => l.tipo === "RECORRENTE" && l.value === 300), "card misto sem produtos: uma linha por parte");

// Filtro de vendedor respeitado.
ok(ctx.getSalesSplit(store, { range, sellerId: "outro" }).total === 0, "filtro de vendedor vale para o resumo");

// ---------------------------------------------------------------------------
// 3) Telas no navegador
// ---------------------------------------------------------------------------
const RAIZ = path.dirname(fileURLToPath(new URL("../x", import.meta.url)));
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
  const arq = path.join(RAIZ, rel);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) return res.writeHead(404).end("nao encontrado");
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" });
  res.end(fs.readFileSync(arq));
});
await new Promise((r) => servidor.listen(0, r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

const iso = (d) => d.toISOString();
const TABELAS = {
  sellers: [{ id: "00000000-0000-4000-8000-000000000002", name: "Uriel Coelho", email: "comercial@bsconta.com.br" }],
  stages: [{ id: "st-won", name: "Venda Realizada", funnel_name: "Vendas", order: 7, is_won: true, is_lost: false }],
  deals: deals.map((d) => ({ ...d, seller_id: "00000000-0000-4000-8000-000000000002", closed_at: iso(d.closed_at), created_at: iso(d.created_at), updated_at: iso(d.closed_at), deleted_at: null })),
  sales: sales.map((s) => ({ ...s, seller_id: "00000000-0000-4000-8000-000000000002", margin: 0, closed_at: iso(s.closed_at) })),
  deal_products,
  activities: [],
  goals: [],
  profiles: [{ id: "00000000-0000-4000-8000-000000000001", name: "Gabriel", role: "ADMIN", seller_id: null }],
};

const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } });
await contexto.route("**/cdn.jsdelivr.net/**", (rota) => {
  const url = rota.request().url();
  if (url.includes("chart.js")) return rota.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chart.js/dist/chart.umd.js"), "utf8") });
  if (url.includes("datalabels")) return rota.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.js"), "utf8") });
  return rota.fulfill({ contentType: "text/javascript", body: "/* substituido pelo teste */" });
});
await contexto.addInitScript((TAB) => {
  function consulta(tabela) {
    let linhas = (TAB[tabela] || []).slice();
    let contar = false;
    const api = {
      select(_c, o) { if (o && o.count === "exact") contar = true; return api; },
      eq(campo, valor) { linhas = linhas.filter((r) => r[campo] === valor); return api; },
      gte(campo, valor) { linhas = linhas.filter((r) => String(r[campo]) >= valor); return api; },
      lte(campo, valor) { linhas = linhas.filter((r) => String(r[campo]) <= valor); return api; },
      is() { return api; }, in() { return api; }, not() { return api; },
      upsert: () => api, delete: () => api, insert: () => api, update: () => api,
      order() { return api; },
      limit(n) { linhas = linhas.slice(0, n); return api; },
      maybeSingle() { return Promise.resolve({ data: linhas[0] || null, error: null }); },
      single() { return Promise.resolve({ data: linhas[0] || null, error: linhas[0] ? null : { message: "sem linhas" } }); },
      range(de, ate) { return Promise.resolve({ data: linhas.slice(de, ate + 1), error: null, count: contar ? linhas.length : null }); },
      then(res, rej) { return Promise.resolve({ data: linhas, error: null }).then(res, rej); },
    };
    return api;
  }
  window.supabase = {
    createClient: () => ({
      from: consulta,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: "fake", user: { id: "00000000-0000-4000-8000-000000000001", email: "gabriel@bsconta.com.br" } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: () => Promise.resolve({}),
      },
    }),
  };
  const fetchOriginal = window.fetch;
  window.fetch = (url, opts) =>
    String(url).includes("/functions/v1/")
      ? Promise.resolve(new Response(JSON.stringify({ ok: true, registros: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      : fetchOriginal(url, opts);
}, TABELAS);

async function abrir(tela, periodo) {
  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(String(e.message)));
  await pagina.goto(`${BASE}/telas/${tela}?period=${periodo}`, { waitUntil: "load" });
  await pagina.waitForFunction(() => {
    const c = document.getElementById("content");
    return c && !c.querySelector(".spinner") && c.textContent.trim().length > 40;
  }, { timeout: 15000 }).catch(() => {});
  return { pagina, erros };
}

{
  const { pagina, erros } = await abrir("dashboard.html", "today");
  const r = await pagina.evaluate(() => {
    const val = (k) => document.querySelector(`[data-resumo="${k}"]`)?.textContent.replace(/\s/g, " ").trim();
    const linhas = [...document.querySelectorAll(".client-entries-table tbody tr")].map((tr) => tr.textContent.replace(/\s+/g, " ").trim());
    return {
      unico: val("unico"), recorrente: val("recorrente"), total: val("total"),
      valorTotal: document.querySelector(".sales-highlight-value")?.textContent.replace(/\s/g, " ").trim(),
      linhasIngrid: linhas.filter((t) => t.includes("Ingrid Figueira")),
      pill: document.querySelector(".client-count-pill")?.textContent.trim(),
    };
  });
  ok(erros.length === 0, `Visão geral abriu sem erro${erros.length ? ": " + erros.join(" | ") : ""}`);
  ok(r.unico === "R$ 2.000", `card Vendas únicas = R$ 2.000 (veio ${r.unico})`);
  ok(r.recorrente === "R$ 1.140", `card Vendas recorrentes = R$ 1.140 (veio ${r.recorrente})`);
  ok(r.total === "R$ 3.140" && r.total === r.valorTotal, `Total de vendas = Valor total de vendas realizadas (${r.total} / ${r.valorTotal})`);
  ok(r.linhasIngrid.length === 2, `Ingrid aparece em 2 linhas na tabela (${r.linhasIngrid.length})`);
  ok(r.linhasIngrid.some((t) => /Recorrente · Mensal/.test(t) && t.includes("R$ 290")) && r.linhasIngrid.some((t) => /Único/.test(t) && t.includes("R$ 800")), "uma linha Recorrente · Mensal R$ 290 e outra Único R$ 800");
  ok(/^4 clientes · 5 produtos$/.test(r.pill || ""), `contador fala em clientes, não em linhas (${r.pill})`);
  await pagina.screenshot({ path: path.join(os.tmpdir(), "vendas-tipo-dashboard.png"), fullPage: true }).catch(() => {});
  await pagina.close();
}

{
  const { pagina, erros } = await abrir("vendas.html", "today");
  const r = await pagina.evaluate(() => {
    const linhas = [...document.querySelectorAll("table.vendas-linhas tbody tr")].map((tr) => tr.textContent.replace(/\s+/g, " ").trim());
    return { linhas, temSimNao: linhas.some((t) => / (Sim|Não)$/.test(t)) };
  });
  ok(erros.length === 0, `Vendas abriu sem erro${erros.length ? ": " + erros.join(" | ") : ""}`);
  ok(r.linhas.filter((t) => t.includes("Ingrid Figueira")).length === 2, "tela de Vendas: Ingrid em 2 linhas");
  ok(!r.temSimNao, "coluna Recorrente Sim/Não trocada pelo tipo de cobrança");
  await pagina.close();
}

await navegador.close();
servidor.close();
console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
