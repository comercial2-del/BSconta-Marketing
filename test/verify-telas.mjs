// ---------------------------------------------------------------------------
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
const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
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

const TELAS = ["dashboard.html", "funil.html", "ligacoes.html", "reunioes.html", "vendas.html", "metas.html", "ranking.html", "relatorios.html"];

for (const tela of TELAS) {
  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(String(e.message)));
  pagina.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });

  const t0 = Date.now();
  await pagina.goto(`${BASE}/telas/${tela}`, { waitUntil: "load" });
  // Espera a tela sair do estado "carregando".
  await pagina.waitForFunction(() => {
    const c = document.getElementById("content");
    return c && !c.querySelector(".spinner") && c.textContent.trim().length > 40;
  }, { timeout: 15000 }).catch(() => {});
  const ms = Date.now() - t0;

  const conteudo = await pagina.evaluate(() => {
    const c = document.getElementById("content");
    return { texto: c ? c.textContent.trim().length : 0, aindaCarregando: !!(c && c.querySelector(".spinner")), menu: !!document.querySelector("#app-header nav, #app-header a") };
  });

  const semErro = erros.filter((e) => !/favicon|Failed to load resource/i.test(e));
  ok(
    conteudo.texto > 40 && !conteudo.aindaCarregando && semErro.length === 0,
    `${tela.padEnd(16)} desenhou (${conteudo.texto} chars, ${ms} ms)${semErro.length ? " ERROS: " + semErro.slice(0, 2).join(" | ") : ""}`,
  );
  await pagina.close();
}

// --- O caminho do cache: segunda abertura tem que ser instantânea ----------
{
  const pagina = await contexto.newPage();
  await pagina.goto(`${BASE}/telas/dashboard.html`, { waitUntil: "load" });
  await pagina.waitForFunction(() => document.getElementById("content")?.textContent.trim().length > 40, { timeout: 15000 });
  const temCache = await pagina.evaluate(() => !!sessionStorage.getItem("sgcmp:store:v3"));
  ok(temCache, "a primeira abertura deixa a cópia na memória da sessão");

  // Segunda tela, mesma sessão: deve pintar sem esperar o banco.
  const t0 = Date.now();
  await pagina.goto(`${BASE}/telas/vendas.html`, { waitUntil: "load" });
  await pagina.waitForFunction(() => document.getElementById("content")?.textContent.trim().length > 40, { timeout: 15000 });
  const ms = Date.now() - t0;
  ok(ms < 3000, `trocar de tela com a cópia na memória levou ${ms} ms`);

  const perfil = await pagina.evaluate(() => !!sessionStorage.getItem("sgcmp:perfil:v1"));
  ok(perfil, "o perfil também fica guardado (uma ida ao servidor a menos por tela)");
  await pagina.close();
}

await navegador.close();
servidor.close();
console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
