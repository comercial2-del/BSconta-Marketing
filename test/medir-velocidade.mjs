// ---------------------------------------------------------------------------
// Mede o ganho de velocidade, com números — não com impressão.
//
// Mesma página, mesmos dados, mesma latência simulada de rede (250 ms por
// ida e volta, que foi o valor medido contra o Supabase real). A única coisa
// que muda entre as duas medições é o caminho do código:
//
//   ANTES  = paginação em série + perfil buscado no banco a cada tela
//   DEPOIS = paginação em paralelo + perfil e dados na memória da sessão
//
// Rodar: node test/medir-velocidade.mjs
// ---------------------------------------------------------------------------
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(fileURLToPath(new URL("../x", import.meta.url)));
const LATENCIA_MS = 250; // medido contra o Supabase real (São Paulo)

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
const sellers = [{ id: uuid(1), name: "Marlon", email: "a@b.c" }, { id: uuid(2), name: "Uriel", email: "d@e.f" }];
const stages = ["Reunião Confirmada", "Enviar Proposta", "Reunião de Proposta", "Follow-Up", "Provável Fechamento", "Venda Realizada", "Perdido"]
  .map((name, i) => ({ id: uuid(100 + i), name, funnel_name: "Vendas", order: i + 1, is_won: name === "Venda Realizada", is_lost: name === "Perdido" }));
// 2.647 negociações: o tamanho real da base do BSconta hoje.
const deals = Array.from({ length: 2647 }, (_, i) => ({
  id: uuid(1000 + i), rd_deal_id: `rd_${i}`, client_name: `Cliente ${i}`, company_name: null,
  seller_id: sellers[i % 2].id, stage_id: stages[i % 5].id, value: 1000 + i,
  status: i % 7 === 0 ? "WON" : "OPEN", probability: 50, closed_at: i % 7 === 0 ? iso(i % 20) : null,
  is_recurring: false, updated_at: iso(i % 30), deleted_at: null,
}));
const activities = Array.from({ length: 1598 }, (_, i) => ({
  id: uuid(50000 + i), type: i % 2 ? "CALL" : "MEETING", subtype: i % 2 ? "SALES_CALL" : "COMMERCIAL_MEETING",
  source: i % 2 ? "RD_STATION" : "CALENDAR", external_id: `e_${i}`, deal_id: deals[i].id, seller_id: sellers[i % 2].id,
  title: i % 2 ? `Ligação - Vendas ${i}` : `Reunião BSconta x Cliente ${i}`, scheduled_at: iso(i % 25),
  status: i % 3 === 0 ? "DONE" : "SCHEDULED", meeting_confirmed: null, meeting_confirmed_at: null, deleted_at: null,
}));
const sales = deals.filter((d) => d.status === "WON").map((d, i) => ({ id: uuid(90000 + i), deal_id: d.id, seller_id: d.seller_id, value: d.value, margin: 0, is_recurring: false, closed_at: d.closed_at }));
const TABELAS = { sellers, stages, deals, activities, sales, goals: [], profiles: [{ id: uuid(1), name: "Marlon", role: "ADMIN", seller_id: sellers[0].id }] };

const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });

/**
 * @param {boolean} informaContagem false = caminho antigo (páginas em série)
 * @param {boolean} usarCache       false = simula não ter nada na memória
 */
async function medir(informaContagem, usarCache) {
  const contexto = await navegador.newContext();
  await contexto.route("**/cdn.jsdelivr.net/**", (r) =>
    r.request().url().includes("chart.js")
      ? r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chart.js/dist/chart.umd.js"), "utf8") })
      : r.fulfill({ contentType: "text/javascript", body: "/**/" }));

  await contexto.addInitScript(({ TAB, LAT, contagem }) => {
    const espera = () => new Promise((r) => setTimeout(r, LAT));
    function consulta(tabela) {
      let linhas = (TAB[tabela] || []).slice();
      let contar = false;
      window.__idas = (window.__idas || 0);
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
        async single() { window.__idas++; await espera(); return { data: linhas[0] || null, error: linhas[0] ? null : { message: "vazio" } }; },
        async range(de, ate) {
          window.__idas++; await espera();
          return { data: linhas.slice(de, Math.min(ate + 1, de + 1000)), error: null, count: contagem && contar ? linhas.length : null };
        },
        then(res) { window.__idas++; return espera().then(() => ({ data: linhas, error: null })).then(res); },
      };
      return api;
    }
    window.supabase = { createClient: () => ({
      from: consulta, rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "x", user: { id: "00000000-0000-4000-8000-000000000001" } } } }) },
    }) };
    const f = window.fetch;
    window.fetch = (u, o) => String(u).includes("/functions/v1/")
      ? Promise.resolve(new Response('{"ok":true,"registros":0}', { status: 200, headers: { "Content-Type": "application/json" } }))
      : f(u, o);

    // Marca o INSTANTE em que a tela realmente mostrou conteúdo. Sem isto o
    // contador pega também o que roda depois (a sincronização em segundo
    // plano), e o número sai maior do que a espera de verdade.
    document.addEventListener("DOMContentLoaded", () => {
      const alvo = document.getElementById("content");
      if (!alvo) return;
      const conferir = () => {
        if (window.__pintou) return;
        if (!alvo.querySelector(".spinner") && alvo.textContent.trim().length > 40) {
          window.__pintou = Math.round(performance.now());
          window.__idasAtePintar = window.__idas || 0;
        }
      };
      new MutationObserver(conferir).observe(alvo, { childList: true, subtree: true, characterData: true });
      conferir();
    });
  }, { TAB: TABELAS, LAT: LATENCIA_MS, contagem: informaContagem });

  const pagina = await contexto.newPage();
  if (usarCache) {
    // Aquece: abre uma vez para deixar a cópia na memória da sessão.
    await pagina.goto(`${BASE}/telas/dashboard.html`, { waitUntil: "load" });
    await pagina.waitForFunction(() => document.getElementById("content")?.textContent.trim().length > 40, { timeout: 30000 });
  }
  await pagina.goto(`${BASE}/telas/${usarCache ? "vendas.html" : "dashboard.html"}`, { waitUntil: "commit" });
  await pagina.waitForFunction(() => window.__pintou, { timeout: 30000 });
  const r = await pagina.evaluate(() => ({ ms: window.__pintou, idas: window.__idasAtePintar }));
  await contexto.close();
  return r;
}

console.log(`Latência simulada: ${LATENCIA_MS} ms por ida e volta (medida contra o Supabase real)`);
console.log(`Base: ${deals.length} negociações, ${activities.length} atividades, ${sales.length} vendas\n`);

const antes = await medir(false, false);
const depois = await medir(true, false);
const comCache = await medir(true, true);

const linha = (nome, r) => console.log(`${nome.padEnd(42)} ${String(r.ms).padStart(5)} ms   (${r.idas} ida(s) ao servidor antes de pintar)`);
linha("ANTES  — 1ª tela, páginas em série", antes);
linha("DEPOIS — 1ª tela, páginas em paralelo", depois);
linha("DEPOIS — trocar de tela (cópia na memória)", comCache);
console.log(`\nPrimeira tela: ${antes.ms} ms -> ${depois.ms} ms  (${Math.round(100 * (antes.ms - depois.ms) / antes.ms)}% mais rápida)`);
console.log(`Trocar de tela: ${antes.ms} ms -> ${comCache.ms} ms  (${Math.round(100 * (antes.ms - comCache.ms) / antes.ms)}% mais rápida)`);

await navegador.close();
servidor.close();
