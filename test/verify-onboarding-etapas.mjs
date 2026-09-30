// ---------------------------------------------------------------------------
// Onboarding: o andamento das 10 etapas é o MESMO para todos os usuários.
//
// Por que este teste existe (30/09/2026): o andamento ficava só no
// localStorage do navegador. O bsconta marcava a 01 como "Concluído" e via
// 1/10 · 10%, mas o Gustavo (ADMIN) e o resto da equipe continuavam vendo 0/10.
// Agora fica em public.onboarding_etapas.
//
// Aqui abrimos TRÊS navegadores separados (cada um com o próprio localStorage)
// ligados a um único banco de mentira, compartilhado na memória deste processo:
//   1. bsconta conclui a 01 -> Gustavo e um terceiro usuário veem 01 verde, 1/10.
//   2. Gustavo conclui a 02 -> bsconta vê 2/10 (pela atualização automática).
//   3. Um navegador com marcações antigas no localStorage envia essas marcações
//      ao banco UMA única vez, sem sobrescrever o que já estava lá.
//
// Rodar: node test/verify-onboarding-etapas.mjs   (ou npm run teste:onboarding)
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
const VENDA = "#0001"; // venda mais antiga (deal 1000)

// --- 1. bsconta conclui a 01 -> todos veem --------------------------------
const bsconta = await abrir("bsconta");
const gustavo = await abrir("gustavo");
const terceiro = await abrir("terceiro");

let g0 = await card(gustavo, VENDA);
ok(g0 && g0.titulo.startsWith("0/10"), `Gustavo começa em 0/10 (${g0?.titulo})`);

await concluirEtapa(bsconta, VENDA, 0);
const b1 = await card(bsconta, VENDA);
ok(b1.titulo.includes("1/10") && b1.titulo.includes("10%") && /\bdone\b/.test(b1.m1), `bsconta vê 01 verde e ${b1.titulo}`);
ok(etapasDb.has(deals[0].id), "a conclusão foi gravada em public.onboarding_etapas");
ok(etapasDb.get(deals[0].id)?.atualizado_por === USUARIOS.bsconta.id, "atualizado_por = bsconta");

// Gustavo: sem recarregar (atualização automática de 60 s)
await atualizar(gustavo);
const g1 = await card(gustavo, VENDA);
ok(g1.titulo.includes("1/10") && g1.titulo.includes("10%"), `Gustavo vê ${g1.titulo} sem recarregar`);
ok(/\bdone\b/.test(g1.m1), "Gustavo vê a bolinha 01 verde (done)");
ok(/\bcurrent\b/.test(await gustavo.pagina.evaluate((n) => [...document.querySelectorAll(".sale-card")].find((x) => x.querySelector(".sale-id")?.textContent.includes(n)).querySelectorAll(".onboarding-stage")[1].className, VENDA)), "Gustavo vê a 02 como etapa atual (roxa)");
ok(g1.proximo.startsWith("Primeiro contato realizado"), `próximo passo para o Gustavo: ${g1.proximo}`);

// Terceiro usuário: recarregando a página
await terceiro.pagina.reload({ waitUntil: "load" });
await terceiro.pagina.waitForSelector(".sale-card .onboarding-title");
await terceiro.pagina.waitForTimeout(400);
const t1 = await card(terceiro, VENDA);
ok(t1.titulo.includes("1/10") && /\bdone\b/.test(t1.m1), `terceiro usuário vê 01 verde e ${t1.titulo}`);

// --- 2. Gustavo conclui a 02 -> bsconta vê 2/10 ---------------------------
await concluirEtapa(gustavo, VENDA, 1);
ok((await card(gustavo, VENDA)).titulo.includes("2/10"), "Gustavo vê 2/10 depois de concluir a 02");
await atualizar(bsconta);
const b2 = await card(bsconta, VENDA);
ok(b2.titulo.includes("2/10") && b2.titulo.includes("20%") && /\bdone\b/.test(b2.m2), `bsconta vê ${b2.titulo}`);
await atualizar(terceiro);
ok((await card(terceiro, VENDA)).titulo.includes("2/10"), "terceiro usuário também vê 2/10");

// Outras vendas continuam intactas
ok((await card(gustavo, "#0002")).titulo.startsWith("0/10"), "as demais vendas continuam em 0/10");

// --- 3. Migração do localStorage antigo -----------------------------------
// Um navegador com marcações antigas: 3 etapas concluídas na venda #0002
// (ainda não está no banco) e marcações na #0001 (que JÁ está no banco).
const agora = new Date().toISOString();
const ETAPAS_TITULOS = ["Handoff", "Início do Onboarding", "1ª Reunião", "Configuração / Implantação", "2ª Reunião", "Acompanhamento", "Onboarding Concluído", "Pesquisa de Satisfação", "Avaliação no Google", "Indicação"];
const antigo = (feitas) => ({
  stages: ETAPAS_TITULOS.map((title, i) => ({ title, status: i < feitas ? "done" : "pending", responsible: i === 0 ? "Uriel" : "", notes: "", dueDate: "", createdAt: agora, startedAt: agora, completedAt: i < feitas ? agora : null, updatedAt: agora })),
  nextStep: ETAPAS_TITULOS[feitas],
  auditHistory: [{ at: agora, title: "Timeline de onboarding criada", text: "" }, { at: agora, title: "Handoff — Concluído", text: "" }],
});
const lsAntigo = { bsconta_onboarding_timeline_v1: JSON.stringify({ [`sale_${sales[1].id}`]: antigo(3), [`sale_${sales[0].id}`]: antigo(5) }) };
const antes0001 = JSON.stringify(etapasDb.get(deals[0].id));
const velho = await abrir("antigo", lsAntigo);
const migr = log.filter((l) => l.usuario === USUARIOS.antigo.id);
ok(migr.length === 1 && migr[0].deal_id === deals[1].id && migr[0].ignoreDuplicates, `migração enviou só a venda que faltava no banco, com ignoreDuplicates (${migr.length} envio)`);
ok(JSON.stringify(etapasDb.get(deals[0].id)) === antes0001, "a migração NÃO sobrescreveu a #0001 que já estava no banco");
ok((await card(velho, VENDA)).titulo.includes("2/10"), "no navegador antigo a #0001 mostra o banco (2/10), não o localStorage (5/10)");
ok((await card(velho, "#0002")).titulo.includes("3/10"), "no navegador antigo a #0002 mostra as marcações migradas (3/10)");

// Recarregar não envia de novo
await velho.pagina.reload({ waitUntil: "load" });
await velho.pagina.waitForSelector(".sale-card .onboarding-title");
await velho.pagina.waitForTimeout(500);
ok(log.filter((l) => l.usuario === USUARIOS.antigo.id).length === 1, "recarregando, a migração não é enviada de novo");

// E agora todos veem a #0002 migrada
await atualizar(gustavo);
ok((await card(gustavo, "#0002")).titulo.includes("3/10"), "Gustavo vê a #0002 migrada (3/10)");

// --- Sem erros de JavaScript nem alertas de falha --------------------------
for (const p of [bsconta, gustavo, terceiro, velho]) {
  const alertas = await p.pagina.evaluate(() => window.__alertas || []);
  ok(p.erros.length === 0 && alertas.length === 0, `${p.nome}: sem erros de JavaScript nem alerta de falha${p.erros.length ? " — " + p.erros.slice(0, 2).join(" | ") : ""}${alertas.length ? " — " + alertas[0] : ""}`);
}

// --- Falha ao gravar mostra alerta ----------------------------------------
{
  // simula o banco recusando a gravação só para o terceiro
  const antesLog = log.length;
  await terceiro.pagina.evaluate(() => {
    const from = sb.from.bind(sb);
    sb.from = (t) => {
      const q = from(t);
      if (t !== "onboarding_etapas") return q;
      const up = q.upsert;
      q.upsert = (...a) => { up(...a); return { select: () => ({ single: () => Promise.resolve({ data: null, error: { message: "permission denied" } }) }) }; };
      return q;
    };
  });
  await concluirEtapa(terceiro, VENDA, 2);
  const alertas = await terceiro.pagina.evaluate(() => window.__alertas || []);
  ok(alertas.length === 1 && /Não foi possível salvar/.test(alertas[0]), "se a gravação falhar, o usuário recebe um alerta");
  ok(log.length === antesLog, "nada foi gravado no banco nessa falha");
}

await navegador.close();
servidor.close();
console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
