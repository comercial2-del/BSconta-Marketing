// ---------------------------------------------------------------------------
// [verify-ficha-cliente] Clicar numa linha da tabela "Clientes das vendas
// realizadas" (Visão geral) abre a ficha do cliente no meio da tela, com
// CNPJ, contato, venda e dados da Receita. Base copiada do
// verify-qualificacao-visao-geral.mjs.
// Abre TODAS as telas num navegador de verdade e confere que ainda desenham.
//
// Por que este teste existe: as mudanças de velocidade mexeram em todas as
// páginas ao mesmo tempo — ordem dos <script>, o carregamento instantâneo pelo
// cache, as colunas que vêm do banco. Cada uma dessas coisas quebra em
// silêncio: a tela fica em branco ou um número some, e nada aparece no
// terminal. Aqui o navegador abre cada tela com um Supabase de mentira e o
// teste falha se der erro de JavaScript ou se a tela não pintar conteúdo.
//
// Rodar: node test/verify-telas.mjs
// ---------------------------------------------------------------------------
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(fileURLToPath(new URL("../x", import.meta.url)));
let falhas = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "OK" : "FALHOU"}: ${msg}`);
  if (!cond) falhas++;
};

// --- Servidor local simples ------------------------------------------------
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
  const arq = path.join(RAIZ, rel);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
    res.writeHead(404).end("nao encontrado");
    return;
  }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" });
  res.end(fs.readFileSync(arq));
});
await new Promise((r) => servidor.listen(0, r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

// --- Dados de mentira, no formato exato que o Postgrest devolve -------------
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (diasAtras) => new Date(Date.now() - diasAtras * 86400000).toISOString();

const sellers = [
  { id: uuid(1), name: "Marlon", email: "comercial2@bsconta.com.br" },
  { id: uuid(3), name: "Dayane Silva", email: "sdr@bsconta.com.br" },
  { id: uuid(2), name: "Uriel", email: "comercial@bsconta.com.br" },
];
const etapasDef = [
  ["Reunião Confirmada", 1, false, false],
  ["Enviar Proposta", 2, false, false],
  ["Reunião de Proposta", 3, false, false],
  ["Follow-Up", 4, false, false],
  ["Provável Fechamento", 5, false, false],
  ["Venda Realizada", 6, true, false],
  ["Perdido", 7, false, true],
];
const stages = etapasDef.map(([name, order, is_won, is_lost], i) => ({
  id: uuid(100 + i), name, funnel_name: "Vendas", order, is_won, is_lost, rd_stage_id: `rd${i}`, created_at: iso(400),
}));

// 1.200 negociações: passa de 1.000 de propósito, para exercitar a paginação.
const deals = Array.from({ length: 1200 }, (_, i) => ({
  id: uuid(1000 + i),
  rd_deal_id: `rd_deal_${i}`,
  client_name: `Cliente ${i}`,
  company_name: null,
  seller_id: sellers[i % 2].id,
  stage_id: stages[i % 5].id,
  value: 1000 + i,
  status: i % 7 === 0 ? "WON" : i % 11 === 0 ? "LOST" : "OPEN",
  probability: 50,
  closed_at: i % 7 === 0 ? iso(i % 20) : null,
  is_recurring: i % 3 === 0,
  updated_at: iso(i % 30),
  deleted_at: null,
  created_at: iso(i % 400),
  // Campos personalizados do RD (como o sync-rd-station grava em rd_details).
  rd_details: { campos: [
    { label: "CNPJ", value: i % 2 === 0 ? "11222333000181" : null },
    { label: "Nome da empresa", value: `Empresa ${i} Ltda` },
    { label: "Serviço contratado", value: "Troca de Contabilidade" },
    { label: "Conta Azul", value: [null, "Sim", "Não"][i % 3] },
    { label: "Constituição ou Troca", value: [null, "Constituição", "Troca de contabilidade"][i % 3] },
    { label: "Qualidade do Cliente", value: [null, "A", "B", "C"][i % 4] },
  ], contatos: [{ nome: `Contato ${i}`, cargo: "Sócio", telefones: ["+55 61 99876-5432"], emails: [`Contato${i}@Exemplo.com.br`] }], fonte: "Facebook Ads", campanha: "[AD25] Trocar de contador é fácil" },
}));

const activities = Array.from({ length: 300 }, (_, i) => ({
  id: uuid(5000 + i),
  type: i % 2 === 0 ? "MEETING" : "CALL",
  subtype: i % 2 === 0 ? "COMMERCIAL_MEETING" : "SALES_CALL",
  source: i % 2 === 0 ? "CALENDAR" : "RD_STATION",
  external_id: `ext_${i}`,
  deal_id: deals[i].id,
  seller_id: sellers[i % 2].id,
  title: i % 2 === 0 ? `Reunião BSconta x Cliente ${i}` : `Ligação - Vendas ${i}`,
  scheduled_at: iso(i % 25),
  status: i % 3 === 0 ? "DONE" : "SCHEDULED",
  meeting_confirmed: null,
  meeting_confirmed_at: null,
  deleted_at: null,
}));

const sales = deals
  .filter((d) => d.status === "WON")
  .map((d, i) => ({ id: uuid(9000 + i), deal_id: d.id, seller_id: d.seller_id, value: d.value, margin: d.value * 0.3, is_recurring: d.is_recurring, closed_at: d.closed_at }));

const TABELAS = {
  sellers, stages, deals, activities, sales,
  goals: [{ id: uuid(1), period: "WEEK", metric: "CALLS", seller_id: null, target_value: 50, period_start: iso(3), created_at: iso(3) }],
  profiles: [{ id: uuid(1), name: "Marlon", role: "ADMIN", seller_id: sellers[0].id }],
};

// --- Navegador -------------------------------------------------------------
const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--no-sandbox"] });
const contexto = await navegador.newContext();

// O CDN não existe aqui dentro: Chart.js sai do node_modules, e o cliente do
// Supabase é substituído pelo de mentira logo abaixo.
await contexto.route("**/cdn.jsdelivr.net/**", (rota) => {
  const url = rota.request().url();
  if (url.includes("chart.js")) {
    return rota.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chart.js/dist/chart.umd.js"), "utf8") });
  }
  if (url.includes("datalabels")) {
    return rota.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.js"), "utf8") });
  }
  return rota.fulfill({ contentType: "text/javascript", body: "/* substituido pelo teste */" });
});
// Receita Federal (BrasilAPI) de mentira.
let consultasCnpj = 0;
await contexto.route("**/brasilapi.com.br/**", (rota) => {
  consultasCnpj++;
  return rota.fulfill({ contentType: "application/json", body: JSON.stringify({
    razao_social: "EMPRESA TESTE LTDA", nome_fantasia: "TESTE", descricao_situacao_cadastral: "ATIVA",
    data_inicio_atividade: "2019-03-05", porte: "MICRO EMPRESA", natureza_juridica: "Sociedade Empresária Limitada",
    cnae_fiscal: 6920601, cnae_fiscal_descricao: "Atividades de contabilidade", municipio: "BRASILIA", uf: "DF",
    opcao_pelo_simples: true, opcao_pelo_mei: false, qsa: [{ nome_socio: "A" }, { nome_socio: "B" }],
  }) });
});

await contexto.addInitScript((dados) => {
  const TAB = dados;
  function consulta(tabela) {
    let linhas = (TAB[tabela] || []).slice();
    let contar = false;
    const api = {
      select(_c, o) { if (o && o.count === "exact") contar = true; return api; },
      eq(campo, valor) { linhas = linhas.filter((r) => r[campo] === valor); return api; },
      // Usados pela tabela de lançamentos manuais (call_entries),
      // que é filtrada por intervalo de datas.
      gte(campo, valor) { linhas = linhas.filter((r) => String(r[campo]) >= valor); return api; },
      lte(campo, valor) { linhas = linhas.filter((r) => String(r[campo]) <= valor); return api; },
      is() { return api; },
      in(campo, valores) { const s = new Set(valores); linhas = linhas.filter((r) => s.has(r[campo])); return api; },
      upsert: () => api,
      delete: () => api,
      order() { return api; },
      limit(n) { linhas = linhas.slice(0, n); return api; },
      single() { return Promise.resolve({ data: linhas[0] || null, error: linhas[0] ? null : { message: "sem linhas" } }); },
      range(de, ate) {
        const total = linhas.length;
        return Promise.resolve({ data: linhas.slice(de, Math.min(ate + 1, de + 1000)), error: null, count: contar ? total : null });
      },
      then(res) { return Promise.resolve({ data: linhas, error: null }).then(res); },
      insert() { return api; },
    };
    return api;
  }
  window.__erros = [];
  window.supabase = {
    createClient: () => ({
      from: consulta,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: {
        getSession: () => Promise.resolve({ data: { session: { access_token: "fake", user: { id: "00000000-0000-4000-8000-000000000001", email: "comercial2@bsconta.com.br" } } } }),
        signOut: () => Promise.resolve({}),
        signInWithPassword: () => Promise.resolve({ error: null }),
      },
    }),
  };
  // A sincronização chamaria as Edge Functions; aqui só responde "ok".
  const fetchOriginal = window.fetch;
  window.fetch = (url, opts) =>
    String(url).includes("/functions/v1/")
      ? Promise.resolve(new Response(JSON.stringify({ ok: true, registros: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
      : fetchOriginal(url, opts);
}, TABELAS);


const pagina = await contexto.newPage();
const erros = [];
pagina.on("pageerror", (e) => erros.push(String(e.message)));
pagina.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
await pagina.setViewportSize({ width: 1366, height: 900 });
await pagina.goto(`${BASE}/telas/dashboard.html?period=this_year`, { waitUntil: "load" });
await pagina.waitForFunction(() => document.querySelectorAll(".client-entries-table tbody .q-badge:not(.q-vazio)").length > 0, { timeout: 15000 }).catch(() => {});

// 1) Linha com CNPJ: abre a ficha com dados do RD e da Receita.
const linhaCnpj = await pagina.evaluate(() => {
  const trs = [...document.querySelectorAll('.client-entries-table tbody tr[data-deal]')];
  // deals pares têm CNPJ no mock: o dealId termina com o número 1000+i
  const tr = trs.find((t) => Number(t.dataset.deal.slice(-12)) % 2 === 0);
  return tr ? tr.dataset.deal : null;
});
ok(!!linhaCnpj, "há linha de cliente com CNPJ na tabela");
await pagina.click(`.client-entries-table tr[data-deal="${linhaCnpj}"] .client-primary`);
await pagina.waitForSelector("dialog.ficha-cliente[open]", { timeout: 5000 }).catch(() => {});
await pagina.waitForFunction(() => !document.querySelector("#ficha-receita"), { timeout: 5000 }).catch(() => {});
await pagina.waitForTimeout(300); // fim da animação de entrada
const ficha = await pagina.evaluate(() => {
  const d = document.querySelector("dialog.ficha-cliente");
  if (!d || !d.open) return null;
  const r = d.getBoundingClientRect();
  return { texto: d.innerText, centroX: r.left + r.width / 2, centroY: r.top + r.height / 2, vw: innerWidth, vh: innerHeight, rd: !!d.querySelector('a[href*="crm.rdstation.com"]') };
});
ok(!!ficha, "clicar no cliente abre a ficha");
if (ficha) {
  ok(Math.abs(ficha.centroX - ficha.vw / 2) < 4 && Math.abs(ficha.centroY - ficha.vh / 2) < 4, "ficha aparece no meio da tela");
  ok(ficha.texto.includes("11.222.333/0001-81"), "CNPJ formatado");
  ok(/Empresa \d+ Ltda/.test(ficha.texto), "nome da empresa do RD");
  ok(ficha.texto.includes("(61) 99876-5432"), "telefone do contato formatado");
  ok(/contato\d+@exemplo\.com\.br/.test(ficha.texto), "e-mail do contato");
  ok(ficha.texto.includes("Troca de Contabilidade"), "serviço contratado");
  ok(ficha.texto.includes("Facebook Ads"), "campanha / origem");
  ok(ficha.texto.includes("EMPRESA TESTE LTDA") && ficha.texto.includes("ATIVA") && ficha.texto.includes("Simples Nacional"), "dados da Receita Federal");
  ok(ficha.rd, "link para a negociação no RD Station");
}
if (process.env.SHOT) await pagina.screenshot({ path: process.env.SHOT });

// 2) Esc fecha.
await pagina.keyboard.press("Escape");
ok(await pagina.evaluate(() => !document.querySelector("dialog.ficha-cliente")?.open), "Esc fecha a ficha");

// 3) Linha sem CNPJ: abre pelo teclado e avisa, sem consultar a Receita.
const antes = consultasCnpj;
const linhaSem = await pagina.evaluate(() => {
  const tr = [...document.querySelectorAll('.client-entries-table tbody tr[data-deal]')].find((t) => Number(t.dataset.deal.slice(-12)) % 2 === 1);
  return tr ? tr.dataset.deal : null;
});
await pagina.focus(`.client-entries-table tr[data-deal="${linhaSem}"]`);
await pagina.keyboard.press("Enter");
await pagina.waitForSelector("dialog.ficha-cliente[open]", { timeout: 5000 }).catch(() => {});
const texto2 = await pagina.evaluate(() => document.querySelector("dialog.ficha-cliente")?.innerText || "");
ok(/CNPJ não informado|constituição/i.test(texto2), "sem CNPJ: aviso no lugar da Receita");
ok(consultasCnpj === antes, "sem CNPJ: não consulta a Receita");

// 4) Clicar fora (no fundo) fecha.
await pagina.mouse.click(5, 5);
ok(await pagina.evaluate(() => !document.querySelector("dialog.ficha-cliente")?.open), "clicar fora fecha a ficha");

// 5) Celular: cabe na tela.
await pagina.setViewportSize({ width: 390, height: 800 });
await pagina.click(`.client-entries-table tr[data-deal="${linhaCnpj}"] .client-primary`);
await pagina.waitForSelector("dialog.ficha-cliente[open]", { timeout: 5000 }).catch(() => {});
const larg = await pagina.evaluate(() => { const r = document.querySelector("dialog.ficha-cliente").getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
ok(larg.l >= 0 && larg.r <= larg.w, "no celular a ficha cabe na largura da tela");
if (process.env.SHOT_MOBILE) await pagina.screenshot({ path: process.env.SHOT_MOBILE });

const semErro = erros.filter((e) => !/favicon|Failed to load resource/i.test(e));
ok(semErro.length === 0, `sem erros de JavaScript ${semErro.slice(0, 2).join(" | ")}`);

await navegador.close();
servidor.close();
console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
