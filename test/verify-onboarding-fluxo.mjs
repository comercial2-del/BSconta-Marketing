// ---------------------------------------------------------------------------
// Onboarding: fluxo do Handoff (05/10/2026, fase de teste) — baseado no teste do e-mail.
//
// O envio é feito no servidor (gatilho do SQL 25 + Edge Function
// notificar-transferencia). Aqui conferimos a tela: a janela da etapa 01
// concluída mostra o status do e-mail e, se falhou, o botão "Tentar de novo",
// que chama a função com { id, manual: true } e a sessão do usuário.
//
// Rodar: node test/verify-onboarding-email.mjs
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
  onboarding_transferencias: [
    { id: uuid(7000), deal_id: uuid(1001), email_status: "erro", email_erro: "Gmail do remetente ainda não foi conectado", email_destinatarios: null, email_tentativas: 1, email_enviado_em: null, transferido_em: iso(0) },
    { id: uuid(7001), deal_id: uuid(1000), email_status: "enviado", email_erro: null, email_destinatarios: ["gustavo@bsconta.com.br", "izadora@bsconta.com.br"], email_tentativas: 1, email_enviado_em: iso(0), transferido_em: iso(0) },
  ],
  onboarding_config: [{ chave: "responsavel_proxima_etapa", valor: "Gustavo" }],
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
    window.__chamadas = [];
    window.fetch = (url, opts) => {
      if (String(url).includes("/functions/v1/notificar-transferencia")) {
        window.__chamadas.push({ url: String(url), body: opts && opts.body, auth: opts && opts.headers && opts.headers.Authorization });
        return Promise.resolve(new Response(JSON.stringify({ ok: true, resultados: [{ status: "enviado" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return String(url).includes("/functions/v1/")
        ? Promise.resolve(new Response(JSON.stringify({ ok: true, registros: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }))
        : fetchOriginal(url, opts);
    };
  }, { TAB: FIXAS, user: u, ls: localStorageInicial });

  const pagina = await contexto.newPage();
  await pagina.addInitScript(() => { new MutationObserver(() => { const b = document.querySelector('#onbDialogo [data-dlg="' + (window.__dlgResposta || "sim") + '"]'); if (b && !b.__clicado) { b.__clicado = true; window.__dlgResposta = undefined; b.click(); } }).observe(document, { childList: true, subtree: true }); }); // confirmação personalizada (06/10/2026)
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

const VENDA = "#0003"; // deal 1001: nenhuma etapa gravada no banco
const D = uuid(1001);
async function abrirEtapa(p, numero, indice) {
  await p.pagina.evaluate(({ numero, indice }) => {
    const c = [...document.querySelectorAll(".sale-card")].find((x) => x.querySelector(".sale-id")?.textContent.includes(numero));
    c.querySelectorAll('[data-action="toggle-stage"]')[indice].click();
  }, { numero, indice });
}
async function status(p, numero, indice, valor) {
  await abrirEtapa(p, numero, indice);
  await p.pagina.selectOption('#onboardingAlertBody select[data-action="stage-status"]', valor);
  await p.pagina.waitForTimeout(300);
  await p.pagina.click("#closeOnboardingAlert");
}
const estado = (p, numero) => p.pagina.evaluate((numero) => {
  const c = [...document.querySelectorAll(".sale-card")].find((x) => x.querySelector(".sale-id")?.textContent.includes(numero));
  return { classe: c.className, fluxo: c.querySelector("[data-fluxo]")?.dataset.fluxo || "", rotulo: c.querySelector("[data-fluxo]")?.textContent || "", m1: c.querySelectorAll(".stage-marker")[0].className, m2: c.querySelectorAll(".stage-marker")[1].className, titulo: c.querySelector(".onboarding-title").textContent };
}, numero);
const dados = () => etapasDb.get(D)?.dados;

const u = await abrir("bsconta");
// 1) Vendida: 01 vermelha/bloqueada
let e = await estado(u, VENDA);
ok(/blocked/.test(e.m1), "venda nova: bolinha 01 vermelha (blocked)");
ok(e.fluxo === "bloqueado" && /fluxo-bloqueado/.test(e.classe), `card marcado em vermelho (${e.rotulo})`);

// 2) Bloqueada: não avança
await abrirEtapa(u, VENDA, 1);
ok(await u.pagina.evaluate(() => document.querySelector("#onboardingAlertBody .stage-body").classList.contains("travada")), "etapa 02 travada enquanto a 01 está vermelha");
await u.pagina.evaluate(() => { const s = document.querySelector('#onboardingAlertBody select[data-action="stage-status"]'); s.value = "progress"; s.dispatchEvent(new Event("change", { bubbles: true })); });
await u.pagina.waitForTimeout(300);
await u.pagina.click("#closeOnboardingAlert");
e = await estado(u, VENDA);
ok(!/in-progress/.test(e.m2) && e.fluxo === "bloqueado", "tentar avançar a 02 com a 01 vermelha não muda nada");
ok(!dados() || dados().stages[0].status !== "done", "nada gravado como verde (o gatilho do e-mail não tem o que disparar)");

// 3) A 01 só tem Bloqueado e Verde
await abrirEtapa(u, VENDA, 0);
const opcoes = await u.pagina.$$eval('#onboardingAlertBody select[data-action="stage-status"] option', (o) => o.map((x) => x.value).join("|"));
ok(opcoes === "blocked|done", `01 · Handoff só tem Bloqueado e Verde (${opcoes})`);
await u.pagina.click("#closeOnboardingAlert");

// 4) Cancelar a confirmação mantém bloqueado
await u.pagina.evaluate(() => { window.__dlgResposta = "nao"; });
await status(u, VENDA, 0, "done");
ok((await estado(u, VENDA)).fluxo === "bloqueado", "cancelando a confirmação, continua vermelho");

// 5) Verde: libera, grava (dispara o gatilho do e-mail) e direciona ao Gustavo (cinza)
await status(u, VENDA, 0, "done");
e = await estado(u, VENDA);
ok(/done/.test(e.m1), "01 verde (done)");
ok(dados()?.stages[0].status === "done", "verde gravado no banco (é o que dispara o e-mail no gatilho)");
ok(dados()?.stages[1].responsible === "Gustavo" && dados()?.stages[1].status === "pending", "etapa 02 direcionada ao Gustavo, aguardando início");
ok(e.fluxo === "aguardando" && /fluxo-aguardando/.test(e.classe) && /aguardando/.test(e.m2), `card cinza (${e.rotulo})`);
ok((await u.pagina.textContent("#toast")).includes("E-mail de Handoff disparado"), "aviso de liberação + e-mail");
ok(dados().auditHistory.some((h) => h.title === "Venda liberada"), "histórico registra a liberação");

// 6) Filtro de responsável continua funcionando
const opcResp = await u.pagina.$$eval("#respFilter option", (o) => o.map((x) => x.value));
ok(opcResp.includes("Gustavo"), "filtro de responsável tem o Gustavo");

// 7) Gustavo assume: azul/em andamento
const g = await abrir("gustavo");
e = await estado(g, VENDA);
ok(e.fluxo === "aguardando", "Gustavo vê a venda cinza aguardando ele");
await status(g, VENDA, 1, "progress");
e = await estado(g, VENDA);
ok(e.fluxo === "andamento" && /fluxo-andamento/.test(e.classe) && /in-progress/.test(e.m2), `card azul (${e.rotulo})`);
ok(dados()?.stages[1].status === "progress", "em andamento gravado no banco");

// 8) Com a 02 iniciada, a 01 não volta para vermelho
await status(g, VENDA, 0, "blocked");
ok(dados()?.stages[0].status === "done", "não dá para bloquear de novo depois que o Gustavo iniciou");

// 9) Cards que já existiam com a 01 em andamento passam a aparecer bloqueados
etapasDb.set(uuid(1002), { deal_id: uuid(1002), dados: { stages: Array.from({ length: 10 }, (_, i) => ({ status: i === 0 ? "progress" : "pending", substeps: [] })), auditHistory: [] }, atualizado_em: new Date().toISOString() });
const t = await abrir("terceiro");
ok((await estado(t, "#0004")).fluxo === "bloqueado", "card antigo com a 01 em andamento aparece vermelho/bloqueado");

ok(!u.erros.length && !g.erros.length && !t.erros.length, "sem erros de JavaScript");
await navegador.close();
servidor.close();
console.log(falhas ? `\n${falhas} teste(s) falharam.` : "\nTodos os testes passaram.");
process.exit(falhas ? 1 : 0);
