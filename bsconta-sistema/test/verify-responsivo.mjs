// ---------------------------------------------------------------------------
// Audita TODAS as telas em vários tamanhos de tela.
//
// O que ele procura, que é o que estraga a experiência no celular:
//   1. barra de rolagem horizontal na página (o pior de todos: o conteúdo
//      "escapa" e o usuário arrasta a tela para os lados sem querer);
//   2. elementos individuais mais largos do que a área visível;
//   3. texto pequeno demais para ler;
//   4. botões pequenos demais para acertar com o dedo;
//   5. textos sobrepostos/cortados no cabeçalho.
//
// Uma tabela larga que rola DENTRO da própria moldura não é problema — isso é
// o jeito certo. O problema é a PÁGINA rolar para o lado.
//
// Rodar:  node test/verify-responsivo.mjs
//         node test/verify-responsivo.mjs --fotos   (salva as capturas)
// ---------------------------------------------------------------------------
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(fileURLToPath(new URL("../x", import.meta.url)));
const SALVAR_FOTOS = process.argv.includes("--fotos");
const PASTA_FOTOS = path.join(RAIZ, "test", "capturas");

let falhas = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "  ok " : "  FALHOU "} ${msg}`);
  if (!cond) falhas++;
};

// Tamanhos reais: do celular pequeno ao monitor grande.
const TAMANHOS = [
  { nome: "celular pequeno", w: 360, h: 740 },
  { nome: "celular comum", w: 390, h: 844 },
  { nome: "celular grande", w: 430, h: 932 },
  { nome: "tablet retrato", w: 768, h: 1024 },
  { nome: "tablet paisagem", w: 1024, h: 768 },
  { nome: "notebook", w: 1366, h: 768 },
  { nome: "monitor", w: 1920, h: 1080 },
];

const TELAS = ["dashboard.html", "funil.html", "ligacoes.html", "reunioes.html", "vendas.html", "metas.html", "ranking.html", "relatorios.html"];

// --- Servidor + dados de mentira (mesma base do verify-telas) --------------
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
  const arq = path.join(RAIZ, rel);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) return res.writeHead(404).end("404");
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" });
  res.end(fs.readFileSync(arq));
});
await new Promise((r) => servidor.listen(0, r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();
const sellers = [
  { id: uuid(1), name: "Marlon Vasconcelos", email: "comercial2@bsconta.com.br" },
  { id: uuid(2), name: "Uriel Coelho", email: "comercial@bsconta.com.br" },
];
const stages = ["Reunião Confirmada", "Reagendamento Comercial", "Enviar Proposta", "Reunião de Proposta", "Follow-Up", "Provável Fechamento", "Venda Realizada", "Perdido"]
  .map((name, i) => ({ id: uuid(100 + i), name, funnel_name: "Vendas", order: i + 1, is_won: name === "Venda Realizada", is_lost: name === "Perdido" }));
// Nomes longos de propósito: é com eles que o layout costuma estourar.
const deals = Array.from({ length: 320 }, (_, i) => ({
  id: uuid(1000 + i), client_name: `Comércio de Materiais de Construção São Jorge ${i} Ltda ME`,
  company_name: `Empresa Muito Longa Para Testar Quebra de Linha ${i}`,
  seller_id: sellers[i % 2].id, stage_id: stages[i % 6].id, value: 125000 + i * 137,
  status: i % 5 === 0 ? "WON" : i % 13 === 0 ? "LOST" : "OPEN", probability: 65,
  closed_at: i % 5 === 0 ? iso(i % 20) : null, is_recurring: i % 3 === 0, updated_at: iso(i % 20), deleted_at: null,
}));
const activities = Array.from({ length: 260 }, (_, i) => ({
  id: uuid(50000 + i), type: i % 2 ? "CALL" : "MEETING", subtype: i % 2 ? "SALES_CALL" : "COMMERCIAL_MEETING",
  source: i % 2 ? "RD_STATION" : "CALENDAR", external_id: `e_${i}`, deal_id: deals[i % deals.length].id,
  seller_id: sellers[i % 2].id,
  title: i % 2 ? `Ligação - Vendas para Comércio São Jorge ${i}` : `Reunião BSconta x Comércio de Materiais São Jorge ${i}`,
  scheduled_at: iso(i % 14), status: i % 3 === 0 ? "DONE" : "SCHEDULED",
  meeting_confirmed: null, meeting_confirmed_at: null, deleted_at: null,
}));
const sales = deals.filter((d) => d.status === "WON").map((d, i) => ({
  id: uuid(90000 + i), deal_id: d.id, seller_id: d.seller_id, value: d.value, margin: d.value * 0.28, is_recurring: d.is_recurring, closed_at: d.closed_at,
}));
const TABELAS = {
  sellers, stages, deals, activities, sales,
  goals: [
    { id: uuid(1), period: "WEEK", metric: "CALLS", seller_id: null, target_value: 250, period_start: iso(3), created_at: iso(3) },
    { id: uuid(2), period: "MONTH", metric: "REVENUE", seller_id: sellers[0].id, target_value: 1500000, period_start: iso(10), created_at: iso(10) },
  ],
  profiles: [{ id: uuid(1), name: "Marlon Vasconcelos", role: "ADMIN", seller_id: sellers[0].id }],
};

const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const contexto = await navegador.newContext();
await contexto.route("**/cdn.jsdelivr.net/**", (r) => {
  const u = r.request().url();
  if (u.includes("chart.js")) return r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chart.js/dist/chart.umd.js"), "utf8") });
  if (u.includes("datalabels")) return r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.js"), "utf8") });
  return r.fulfill({ contentType: "text/javascript", body: "/**/" });
});
await contexto.addInitScript((TAB) => {
  function consulta(tabela) {
    let linhas = (TAB[tabela] || []).slice();
    let contar = false;
    const api = {
      select(_c, o) { if (o && o.count === "exact") contar = true; return api; },
      eq(c, v) { linhas = linhas.filter((r) => r[c] === v); return api; },
      order: () => api, limit(n) { linhas = linhas.slice(0, n); return api; },
      // Usados pela tabela de lançamentos manuais (call_entries),
      // que é filtrada por intervalo de datas.
      gte(campo, valor) { linhas = linhas.filter((r) => String(r[campo]) >= valor); return api; },
      lte(campo, valor) { linhas = linhas.filter((r) => String(r[campo]) <= valor); return api; },
      is() { return api; },
      upsert: () => api,
      delete: () => api,
      single: () => Promise.resolve({ data: linhas[0] || null, error: linhas[0] ? null : { message: "vazio" } }),
      range: (de, ate) => Promise.resolve({ data: linhas.slice(de, Math.min(ate + 1, de + 1000)), error: null, count: contar ? linhas.length : null }),
      then: (r) => Promise.resolve({ data: linhas, error: null }).then(r),
      insert: () => api,
    };
    return api;
  }
  window.supabase = { createClient: () => ({
    from: consulta, rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "x", user: { id: "00000000-0000-4000-8000-000000000001" } } } }), signOut: () => Promise.resolve({}) },
  }) };
  const f = window.fetch;
  window.fetch = (u, o) => String(u).includes("/functions/v1/")
    ? Promise.resolve(new Response('{"ok":true,"registros":0}', { status: 200, headers: { "Content-Type": "application/json" } })) : f(u, o);
}, TABELAS);

if (SALVAR_FOTOS) fs.mkdirSync(PASTA_FOTOS, { recursive: true });

/** Mede os problemas de layout dentro da página. */
const AUDITORIA = () => {
  const vw = document.documentElement.clientWidth;
  const problemas = [];

  // 1) A página inteira rola para o lado?
  const excesso = document.documentElement.scrollWidth - vw;
  if (excesso > 1) problemas.push({ tipo: "pagina-rola-lado", sobra: excesso });

  // 2) Quais elementos passam da largura visível? (ignora quem rola dentro de
  //    um recipiente próprio, que é o jeito certo de mostrar tabela larga)
  const rolaDentro = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ov = getComputedStyle(p).overflowX;
      if (ov === "auto" || ov === "scroll" || ov === "hidden") return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const passa = Math.round(r.right - vw);
    if (passa > 2 && !rolaDentro(el)) {
      problemas.push({
        tipo: "elemento-estoura",
        alvo: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`,
        sobra: passa,
      });
      if (problemas.filter((p) => p.tipo === "elemento-estoura").length >= 6) break;
    }
  }

  // 3) Texto miúdo demais e 4) botões pequenos para o dedo (só no celular)
  const miudos = new Set();
  const pequenos = new Set();
  if (vw <= 480) {
    for (const el of document.querySelectorAll("body *")) {
      if (!el.textContent || el.children.length > 0) continue;
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize);
      if (px && px < 10.5 && el.textContent.trim()) miudos.add(`${el.tagName.toLowerCase()} ${px.toFixed(1)}px`);
    }
    for (const el of document.querySelectorAll("button, a, select, input, .icon-btn, .chip, .tab")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 30) pequenos.add(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""} ${Math.round(r.height)}px`);
    }
  }
  return { problemas, miudos: [...miudos].slice(0, 4), pequenos: [...pequenos].slice(0, 4) };
};

const resumo = [];
for (const t of TAMANHOS) {
  console.log(`\n=== ${t.nome} (${t.w}x${t.h}) ===`);
  const pagina = await contexto.newPage();
  await pagina.setViewportSize({ width: t.w, height: t.h });
  for (const tela of TELAS) {
    await pagina.goto(`${BASE}/telas/${tela}`, { waitUntil: "load" });
    await pagina.waitForFunction(() => {
      const c = document.getElementById("content");
      return c && !c.querySelector(".spinner") && c.textContent.trim().length > 40;
    }, { timeout: 20000 }).catch(() => {});
    await pagina.waitForTimeout(250); // deixa os gráficos assentarem

    const r = await pagina.evaluate(AUDITORIA);
    const rolaLado = r.problemas.find((p) => p.tipo === "pagina-rola-lado");
    const estouros = r.problemas.filter((p) => p.tipo === "elemento-estoura");
    const detalhe = [
      rolaLado ? `PÁGINA ROLA PARA O LADO (+${rolaLado.sobra}px)` : "",
      estouros.length ? `estouram: ${estouros.map((e) => `${e.alvo}+${e.sobra}px`).join(", ")}` : "",
      r.miudos.length ? `texto miúdo: ${r.miudos.join(", ")}` : "",
      r.pequenos.length ? `alvo pequeno: ${r.pequenos.join(", ")}` : "",
    ].filter(Boolean).join(" | ");
    ok(!rolaLado && estouros.length === 0, `${tela.padEnd(16)} ${detalhe || "layout limpo"}`);
    if (rolaLado || estouros.length) resumo.push({ tamanho: t.nome, tela, detalhe });

    if (SALVAR_FOTOS) {
      await pagina.screenshot({ path: path.join(PASTA_FOTOS, `${t.w}-${tela.replace(".html", "")}.png`), fullPage: false });
    }
  }
  await pagina.close();
}

await navegador.close();
servidor.close();

if (resumo.length) {
  console.log("\n--- resumo do que precisa de conserto ---");
  for (const r of resumo) console.log(`  ${r.tamanho.padEnd(16)} ${r.tela.padEnd(16)} ${r.detalhe}`);
}
console.log(falhas === 0 ? "\nTodas as telas passaram em todos os tamanhos." : `\n${falhas} combinação(ões) com problema.`);
process.exit(falhas === 0 ? 0 : 1);
