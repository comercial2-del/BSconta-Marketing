// ---------------------------------------------------------------------------
// Onboarding: aviso por e-mail ao Gustavo na 1ª etapa (01/10/2026).
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

const a = await abrir("bsconta");
const aviso = () => a.pagina.evaluate(() => document.getElementById("onbEmailAviso")?.textContent.replace(/\s+/g, " ").trim() || null);
async function abrirEtapa(numero, indice) {
  await a.pagina.evaluate(({ numero, indice }) => {
    const c = [...document.querySelectorAll(".sale-card")].find((x) => x.querySelector(".sale-id")?.textContent.includes(numero));
    c.querySelectorAll('[data-action="toggle-stage"]')[indice].click();
  }, { numero, indice });
  await a.pagina.waitForTimeout(300);
}

// Etapa 01 ainda não concluída: sem aviso
await abrirEtapa("0003", 0);
ok((await aviso()) === null, "etapa 01 pendente não mostra aviso de e-mail");
await a.pagina.click("#closeOnboardingAlert");

// Venda #0003 (deal 1001): conclui a 01 -> mostra o e-mail com erro + Tentar de novo
await concluirEtapa(a, "0003", 0);
await abrirEtapa("0003", 0);
let t = await aviso();
ok(t && t.includes("Falhou") && t.includes("Gmail do remetente"), "etapa 01 concluída mostra o status 'Falhou' e o erro");
ok(!!(await a.pagina.$("#onbEmailAviso [data-reenviar-email]")), "e-mail com erro tem o botão Tentar de novo");
await a.pagina.click("#onbEmailAviso [data-reenviar-email]");
await a.pagina.waitForTimeout(400);
const ch = await a.pagina.evaluate(() => window.__chamadas);
ok(ch.length === 1, "Tentar de novo chama a função uma vez só");
ok(ch[0] && JSON.parse(ch[0].body).manual === true && JSON.parse(ch[0].body).id === "00000000-0000-4000-8000-000000007000", "chamada manual leva o id da transferência");
ok(ch[0] && ch[0].auth === "Bearer fake", "chamada manual leva a sessão do usuário (sem chave no navegador)");
ok((await a.pagina.textContent("#toast")).includes("E-mail enviado"), "aviso de sucesso aparece");
await a.pagina.click("#closeOnboardingAlert");

// Venda #0002 (deal 1000): já enviado -> mostra Enviado e os destinatários, sem botão
await concluirEtapa(a, "0002", 0);
await abrirEtapa("0002", 0);
t = await aviso();
ok(t && t.includes("Enviado") && t.includes("gustavo@bsconta.com.br") && t.includes("izadora@bsconta.com.br"), "e-mail enviado mostra status e destinatários");
ok(!(await a.pagina.$("#onbEmailAviso [data-reenviar-email]")), "e-mail enviado não tem Tentar de novo");
await a.pagina.click("#closeOnboardingAlert");

// Remontagem do board (atualização) não duplica o clique
await a.pagina.evaluate(() => window.__onbAtualizarRemoto());
await a.pagina.waitForTimeout(300);
ok(a.erros.length === 0, "sem erros de JavaScript"); if (a.erros.length) console.log(a.erros);

await navegador.close();
servidor.close();
console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
if (falhas) process.exit(1);
