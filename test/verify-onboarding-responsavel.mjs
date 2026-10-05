// ---------------------------------------------------------------------------
// Onboarding: responsável atual no card + filtro por responsável (01/10/2026).
//
// Etapa 01 (Handoff) é do vendedor (Uriel). Concluída a etapa 01, o card
// passa a mostrar o Gustavo (etapas 02 a 10), a não ser que a etapa atual
// tenha outro responsável preenchido. O filtro separa os cards por responsável.
//
// Rodar: node test/verify-onboarding-responsavel.mjs
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
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
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

// --- Dados fixos (formato do Postgrest) ------------------------------------
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (diasAtras) => new Date(Date.now() - diasAtras * 86400000).toISOString();

const USUARIOS = {
  bsconta: { id: uuid(11), name: "BSconta", role: "ADMIN", email: "comercial2@bsconta.com.br" },
  gustavo: { id: uuid(12), name: "Gustavo", role: "ADMIN", email: "gustavo@bsconta.com.br" },
  terceiro: { id: uuid(13), name: "Terceiro", role: "SELLER", email: "terceiro@bsconta.com.br" },
  antigo: { id: uuid(14), name: "Navegador antigo", role: "SELLER", email: "antigo@bsconta.com.br" },
};
const sellers = [{ id: uuid(1), name: "Uriel Souza", email: "comercial@bsconta.com.br" }];
const stages = [{ id: uuid(100), name: "Venda Realizada", funnel_name: "Vendas", order: 1, is_won: true, is_lost: false, rd_stage_id: "rd0", created_at: iso(400) }];
const deals = [0, 1, 2].map((i) => ({
  id: uuid(1000 + i), rd_deal_id: `rd_deal_${i}`, client_name: `Contato ${i}`, company_name: `Empresa ${i}`,
  seller_id: sellers[0].id, stage_id: stages[0].id, value: 1000 + i, status: "WON", probability: 100,
  closed_at: iso(10 - i), is_recurring: false, updated_at: iso(1), deleted_at: null, rd_details: null,
}));
// Venda de agosto/2026: fica fora do Onboarding (só setembro/2026 em diante).
// É a mais antiga, então é a #0001; as de setembro são #0002, #0003 e #0004.
deals.push({ ...deals[0], id: uuid(1999), rd_deal_id: "rd_deal_agosto", company_name: "Empresa Agosto", closed_at: "2026-08-15T15:00:00.000Z" });
const sales = deals.map((d, i) => ({ id: uuid(9000 + i), deal_id: d.id, seller_id: d.seller_id, value: d.value, margin: 0, is_recurring: false, closed_at: d.closed_at }));
const FIXAS = {
  sellers, stages, deals, sales, activities: [], goals: [], onboarding_notas: [], onboarding_anexos: [],
  profiles: Object.values(USUARIOS).map((u) => ({ id: u.id, name: u.name, role: u.role, seller_id: null })),
};

// --- Banco compartilhado: public.onboarding_etapas --------------------------
const etapasDb = new Map(); // deal_id -> { deal_id, dados, atualizado_em, atualizado_por }
const log = []; // cada gravação: { usuario, deal_id, ignoreDuplicates }
let relogio = Date.now();
function executarEtapas(usuario, op) {
  if (op.tipo === "select") return { data: [...etapasDb.values()].map((r) => JSON.parse(JSON.stringify(r))), error: null };
  if (op.tipo === "upsert") {
    const linhas = Array.isArray(op.linha) ? op.linha : [op.linha];
    const gravadas = [];
    for (const l of linhas) {
      log.push({ usuario, deal_id: l.deal_id, ignoreDuplicates: !!op.opcoes?.ignoreDuplicates });
      if (etapasDb.has(l.deal_id) && op.opcoes?.ignoreDuplicates) continue;
      // atualizado_em sempre cresce (evita empate de milissegundos entre navegadores)
      relogio = Math.max(relogio + 1, Date.now());
      const r = { deal_id: l.deal_id, dados: l.dados, atualizado_em: new Date(relogio).toISOString(), atualizado_por: l.atualizado_por || usuario };
      etapasDb.set(l.deal_id, r);
      gravadas.push(r);
    }
    return { data: JSON.parse(JSON.stringify(gravadas)), error: null };
  }
  return { data: null, error: { message: "operação não suportada" } };
}

// --- Navegador -------------------------------------------------------------
const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });

async function abrir(nomeUsuario, localStorageInicial = null) {
  const u = USUARIOS[nomeUsuario];
  const contexto = await navegador.newContext(); // navegador separado: localStorage próprio
  await contexto.route("**/cdn.jsdelivr.net/**", (rota) => rota.fulfill({ contentType: "text/javascript", body: "/* substituido pelo teste */" }));
  await contexto.exposeBinding("__bancoEtapas", (_src, op) => executarEtapas(u.id, op));
  await contexto.addInitScript(({ TAB, user, ls }) => {
    if (ls && !sessionStorage.getItem("__lsPronto")) {
      for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
      sessionStorage.setItem("__lsPronto", "1");
    }
    window.alert = (m) => { (window.__alertas = window.__alertas || []).push(String(m)); };
    function consulta(tabela) {
      const st = { tipo: "select", filtros: [], unico: null, limite: null, linha: null, opcoes: null };
      const executar = async () => {
        let res;
        if (tabela === "onboarding_etapas") {
          res = await window.__bancoEtapas({ tipo: st.tipo, linha: st.linha, opcoes: st.opcoes });
        } else {
          let linhas = (TAB[tabela] || []).slice();
          for (const f of st.filtros) linhas = linhas.filter(f);
          res = { data: st.tipo === "select" ? linhas : [], error: null };
        }
        if (res.error) return { data: null, error: res.error };
        let data = res.data || [];
        if (st.limite != null) data = data.slice(0, st.limite);
        if (st.unico === "single") return data[0] ? { data: data[0], error: null } : { data: null, error: { message: "sem linhas" } };
        if (st.unico === "maybe") return { data: data[0] || null, error: null };
        return { data, error: null, count: data.length };
      };
      const api = {
        select(_c, o) { return api; },
        eq(c, v) { st.filtros.push((r) => r[c] === v); return api; },
        in(c, vs) { st.filtros.push((r) => vs.includes(r[c])); return api; },
        gte(c, v) { st.filtros.push((r) => String(r[c]) >= v); return api; },
        lte(c, v) { st.filtros.push((r) => String(r[c]) <= v); return api; },
        is() { return api; },
        order() { return api; },
        limit(n) { st.limite = n; return api; },
        upsert(linha, opcoes) { st.tipo = "upsert"; st.linha = linha; st.opcoes = opcoes || {}; return api; },
        insert() { st.tipo = "insert"; return api; },
        update() { st.tipo = "update"; return api; },
        delete() { st.tipo = "delete"; return api; },
        single() { st.unico = "single"; return executar(); },
        maybeSingle() { st.unico = "maybe"; return executar(); },
        range(de, ate) { return executar().then((r) => ({ ...r, data: (r.data || []).slice(de, ate + 1) })); },
        then(ok, erro) { return executar().then(ok, erro); },
      };
      return api;
    }
    window.supabase = {
      createClient: () => ({
        from: consulta,
        rpc: () => Promise.resolve({ data: null, error: null }),
        storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }), upload: () => Promise.resolve({ error: null }), remove: () => Promise.resolve({ error: null }) }) },
        auth: {
          getSession: () => Promise.resolve({ data: { session: { access_token: "fake", user: { id: user.id, email: user.email } } } }),
          getUser: () => Promise.resolve({ data: { user: { id: user.id, email: user.email } } }),
          signOut: () => Promise.resolve({}),
          signInWithPassword: () => Promise.resolve({ error: null }),
        },
      }),
    };
    const fetchOriginal = window.fetch;
    window.fetch = (url, opts) =>
      String(url).includes("/functions/v1/")
        ? Promise.resolve(new Response(JSON.stringify({ ok: true, registros: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
        : fetchOriginal(url, opts);
  }, { TAB: FIXAS, user: u, ls: localStorageInicial });

  const pagina = await contexto.newPage();
  pagina.on("dialog", (d) => d.accept().catch(() => {})); // confirmação do verde (fluxo do Handoff, 05/10/2026)
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(String(e.message)));
  await pagina.goto(`${BASE}/telas/onboarding.html`, { waitUntil: "load" });
  await pagina.waitForSelector(".sale-card .onboarding-title", { timeout: 15000 });
  await pagina.waitForTimeout(400); // carregarDetalhesRd + migração
  return { contexto, pagina, erros, nome: nomeUsuario };
}

// Estado do Card de uma venda (pelo número dela, como aparece na tela)
async function card(p, numero) {
  return p.pagina.evaluate((numero) => {
    const c = [...document.querySelectorAll(".sale-card")].find((x) => x.querySelector(".sale-id")?.textContent.includes(numero));
    if (!c) return null;
    const m = (i) => c.querySelectorAll(".stage-marker")[i]?.className || "";
    return {
      titulo: c.querySelector(".onboarding-title")?.textContent.trim(),
      proximo: c.querySelector(".onboarding-next-main")?.textContent.trim(),
      m1: m(0), m2: m(1), m3: m(2),
    };
  }, numero);
}
async function concluirEtapa(p, numero, indice) {
  await p.pagina.evaluate(({ numero, indice }) => {
    const c = [...document.querySelectorAll(".sale-card")].find((x) => x.querySelector(".sale-id")?.textContent.includes(numero));
    c.querySelectorAll('[data-action="toggle-stage"]')[indice].click();
  }, { numero, indice });
  await p.pagina.selectOption('#onboardingAlertBody select[data-action="stage-status"]', "done");
  await p.pagina.waitForTimeout(300); // upsert
  await p.pagina.click("#closeOnboardingAlert");
}
async function atualizar(p) {
  await p.pagina.evaluate(() => window.__onbAtualizarRemoto());
  await p.pagina.waitForTimeout(200);
}
const VENDA = "#0002"; // venda mais antiga de setembro (deal 1000)

const numeros = (p) => p.pagina.evaluate(() => [...document.querySelectorAll("#salesGrid .sale-card .sale-id")].map((x) => x.textContent.trim().slice(-4)));
async function vista(p, v) { await p.pagina.selectOption("#situacaoFilter", v); await p.pagina.waitForTimeout(100); }
async function acao(p, numero, a) {
  await p.pagina.evaluate(({ numero, a }) => {
    const c = [...document.querySelectorAll(".sale-card")].find((x) => x.querySelector(".sale-id")?.textContent.includes(numero));
    c.querySelector(`[data-card-acao="${a}"]`).click();
  }, { numero, a });
  await p.pagina.waitForTimeout(300);
}

const resp = (p) => p.pagina.evaluate(() => Object.fromEntries([...document.querySelectorAll("#salesGrid .sale-card")].map((c) => [c.querySelector(".sale-id").textContent.trim().slice(-4), c.querySelector(".badges .b-neutral").textContent.trim()])));
const opcoes = (p) => p.pagina.$$eval("#respFilter option", (o) => o.map((x) => x.textContent));
async function filtrar(p, v) { await p.pagina.selectOption("#respFilter", v); await p.pagina.waitForTimeout(100); }

const a = await abrir("bsconta");
const V = "0002";
let r = await resp(a);
ok(Object.values(r).length === 3 && Object.values(r).every((n) => n === "Uriel"), "etapa 01 pendente: card mostra o vendedor (Uriel)");
ok((await opcoes(a)).join("|") === "Todos os responsáveis|Uriel", "filtro começa com Todos os responsáveis e Uriel");

await concluirEtapa(a, V, 0);
r = await resp(a);
ok(r[V] === "Gustavo", "etapa 01 concluída: card passa a mostrar Gustavo");
ok(r["0003"] === "Uriel" && r["0004"] === "Uriel", "os outros cards continuam com o Uriel");
ok((await opcoes(a)).join("|") === "Todos os responsáveis|Gustavo|Uriel", "filtro lista Gustavo e Uriel");

const emAndamento = (p) => p.pagina.evaluate(() => [document.getElementById("kpiActive").textContent.trim(), document.getElementById("kpiActiveFoot").textContent.trim()].join(" | "));
ok((await emAndamento(a)) === "3 | Vendas ainda em operação", "Em andamento sem filtro: total de vendas");
await filtrar(a, "Gustavo");
ok((await numeros(a)).join() === V, "filtro Gustavo mostra só o card dele");
ok((await emAndamento(a)) === "1 | Gustavo tem 1 processo", "Em andamento mostra quantos processos estão com o Gustavo");
await filtrar(a, "Uriel");
ok((await numeros(a)).sort().join() === "0003,0004", "filtro Uriel mostra só os cards do Uriel");
ok((await emAndamento(a)) === "2 | Uriel tem 2 processos", "Em andamento mostra quantos processos estão com o Uriel");
await filtrar(a, "");
ok((await numeros(a)).length === 3, "Todos os responsáveis mostra tudo");
ok((await emAndamento(a)) === "3 | Vendas ainda em operação", "sem filtro volta ao texto normal");

// Responsável preenchido na etapa atual (02) tem prioridade
await a.pagina.evaluate((V) => {
  const c = [...document.querySelectorAll(".sale-card")].find((x) => x.querySelector(".sale-id")?.textContent.includes(V));
  c.querySelectorAll('[data-action="toggle-stage"]')[1].click();
}, V);
await a.pagina.fill('#onboardingAlertBody input[data-action="stage-responsible"]', "Nádia");
await a.pagina.press('#onboardingAlertBody input[data-action="stage-responsible"]', "Tab");
await a.pagina.waitForTimeout(400);
await a.pagina.click("#closeOnboardingAlert");
r = await resp(a);
ok(r[V] === "Nádia", "responsável preenchido na etapa atual aparece no card");

await a.pagina.fill("#search", "nádia");
await a.pagina.waitForTimeout(100);
ok((await numeros(a)).join() === V, "busca encontra pelo responsável");
await a.pagina.fill("#search", "");

const g = await abrir("gustavo");
ok((await resp(g))[V] === "Nádia", "outro usuário vê o mesmo responsável (vem do banco)");
ok(g.erros.length === 0, "sem erros de JavaScript (Gustavo)");
await g.contexto.close();
ok(a.erros.length === 0, "sem erros de JavaScript"); if (a.erros.length) console.log(a.erros);

await navegador.close();
servidor.close();
console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
if (falhas) process.exit(1);
