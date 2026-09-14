// ---------------------------------------------------------------------------
// Tela de Ligações — as regras pedidas em 14/09/2026.
//
//   1. O total de "ligações realizadas" só aparece para o Marlon.
//   2. Só o Marlon consegue editar; os demais veem os mesmos números, sem
//      nenhum botão.
//   3. A edição só abre quando o período é UM DIA e a partir de 14/09/2026.
//   4. O número lançado à mão SUBSTITUI o do RD naquele dia — e só naquele.
//   5. Semana e mês são a soma dos dias: dias lançados entram com o número
//      lançado, dias sem lançamento entram com o número do RD.
//   6. A seção "Ligações do período" não existe mais.
//
// A regra 4 é a que mais importa e a mais fácil de quebrar sem ninguém notar:
// se a substituição vazar para os dias vizinhos, o mês inteiro fica errado e a
// tela continua parecendo normal.
//
// Rodar: node test/verify-ligacoes.mjs
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
const URIEL = uuid(1);
const MARLON = uuid(2);

// Datas fixas, depois do início do lançamento manual (14/09/2026), para o
// teste não depender do dia em que for rodado.
const DIA_A = "2026-09-15"; // terá lançamento manual
const DIA_B = "2026-09-16"; // não terá — continua valendo o RD
const meioDia = (iso) => new Date(`${iso}T12:00:00`).toISOString();

function ligacao(id, titulo, iso, sellerId, status = "DONE") {
  return {
    id: uuid(id), type: "CALL", subtype: /venda/i.test(titulo) ? "SALES_CALL" : "GENERIC_CALL",
    source: "RD_STATION", external_id: `rd_${id}`, deal_id: null, seller_id: sellerId, title: titulo,
    scheduled_at: meioDia(iso), status, meeting_confirmed: null, meeting_confirmed_at: null, deleted_at: null,
  };
}

const TABELAS = {
  sellers: [
    { id: URIEL, name: "Uriel Coelho", email: "comercial@bsconta.com.br" },
    { id: MARLON, name: "Marlon", email: "comercial2@bsconta.com.br" },
  ],
  stages: [{ id: uuid(100), name: "Reunião Confirmada", funnel_name: "Vendas", order: 1, is_won: false, is_lost: false }],
  deals: [], sales: [], goals: [],
  activities: [
    // DIA_A — o RD conhece 2 ligações de vendas do Marlon...
    ligacao(1, "Ligação - Vendas", DIA_A, MARLON),
    ligacao(2, "Ligação - Vendas", DIA_A, MARLON),
    // ...e 1 de agendamento do Uriel no mesmo dia (não pode ser afetada pelo
    // lançamento do Marlon).
    ligacao(3, "Ligação de agendamento", DIA_A, URIEL),
    // DIA_B — 1 ligação de vendas do Marlon, sem lançamento manual.
    ligacao(4, "Ligação - Vendas", DIA_B, MARLON),
  ],
  // O Marlon lança 9 de vendas e 3 de agendamento no DIA_A. Deve SUBSTITUIR as
  // 2 que o RD trouxe naquele dia — e não encostar no DIA_B.
  call_entries: [
    { id: uuid(900), seller_id: MARLON, entry_date: DIA_A, sales_calls: 9, scheduling_calls: 3, scheduled: 4, updated_by_name: "marlon", updated_at: meioDia(DIA_A) },
  ],
  profiles: [{ id: uuid(1), name: "Marlon", role: "ADMIN", seller_id: MARLON }],
};

const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });

async function abrir(email, intervalo, tela = "ligacoes") {
  const contexto = await navegador.newContext();
  await contexto.route("**/cdn.jsdelivr.net/**", (r) => {
    const u = r.request().url();
    if (u.includes("chart.js"))
      return r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chart.js/dist/chart.umd.js"), "utf8") });
    if (u.includes("datalabels"))
      return r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(RAIZ, "node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.js"), "utf8") });
    return r.fulfill({ contentType: "text/javascript", body: "/**/" });
  });
  await contexto.addInitScript(
    ([TAB, quem]) => {
      function consulta(tabela) {
        let linhas = (TAB[tabela] || []).slice();
        let contar = false;
        const api = {
          select(_c, o) { if (o && o.count === "exact") contar = true; return api; },
          eq(c, v) { linhas = linhas.filter((r) => r[c] === v); return api; },
          gte(c, v) { linhas = linhas.filter((r) => String(r[c]) >= v); return api; },
          lte(c, v) { linhas = linhas.filter((r) => String(r[c]) <= v); return api; },
          is() { return api; },
          order: () => api,
          limit(n) { linhas = linhas.slice(0, n); return api; },
          single: () => Promise.resolve({ data: linhas[0] || null, error: linhas[0] ? null : { message: "vazio" } }),
          range: (de, ate) => Promise.resolve({ data: linhas.slice(de, Math.min(ate + 1, de + 1000)), error: null, count: contar ? linhas.length : null }),
          then: (r) => Promise.resolve({ data: linhas, error: null }).then(r),
          insert: () => api,
          upsert: () => api,
          delete: () => api,
        };
        return api;
      }
      window.supabase = {
        createClient: () => ({
          from: consulta,
          rpc: () => Promise.resolve({ data: null, error: null }),
          auth: {
            getSession: () => Promise.resolve({ data: { session: { access_token: "x", user: { id: "00000000-0000-4000-8000-000000000001", email: quem } } } }),
            signOut: () => Promise.resolve({}),
          },
        }),
      };
      const f = window.fetch;
      window.fetch = (u, o) =>
        String(u).includes("/functions/v1/")
          ? Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } }))
          : f(u, o);
    },
    [TABELAS, email]
  );

  const pagina = await contexto.newPage();
  const erros = [];
  pagina.on("pageerror", (e) => erros.push(String(e.message)));
  await pagina.goto(`${BASE}/telas/${tela}.html?period=custom&start=${intervalo.start}&end=${intervalo.end}`, { waitUntil: "load" });
  await pagina.waitForFunction(() => document.getElementById("content")?.textContent.trim().length > 40, { timeout: 20000 });
  await pagina.waitForTimeout(300);
  const dados = await pagina.evaluate(() => {
    const linhas = [...document.querySelectorAll("#corpo-colaboradores tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()));
    const kpis = {};
    document.querySelectorAll(".kpi-card").forEach((c) => {
      const rotulo = c.querySelector(".kpi-label")?.textContent.trim();
      const valor = c.querySelector(".kpi-value")?.textContent.trim();
      if (rotulo) kpis[rotulo] = valor;
    });
    return {
      kpis,
      texto: document.getElementById("content").textContent.replace(/\s+/g, " "),
      temHero: !!document.querySelector(".kpi-hero"),
      destaque: document.querySelector(".kpi-hero .kpi-value")?.textContent.trim() || null,
      botoesEditar: document.querySelectorAll(".btn-editar").length,
      linhas,
    };
  });
  await contexto.close();
  return { ...dados, erros };
}

const so = (iso) => ({ start: iso, end: iso });
const achar = (d, nome) => d.linhas.find((l) => l[0]?.includes(nome));

// ---- 1) O Marlon, no DIA_A (dia com lançamento) ---------------------------
const mA = await abrir("comercial2@bsconta.com.br", so(DIA_A));
ok(mA.erros.length === 0, `a tela abriu sem erro de JavaScript${mA.erros.length ? ": " + mA.erros[0] : ""}`);
ok(mA.temHero, "o Marlon vê o total de ligações realizadas");
const linhaMarlonA = achar(mA, "Marlon");
ok(linhaMarlonA?.[1] === "9", `o lançado SUBSTITUI o RD: 9 de vendas, não as 2 do RD (veio "${linhaMarlonA?.[1]}")`);
ok(linhaMarlonA?.[2] === "3", `agendamento veio do lançamento (veio "${linhaMarlonA?.[2]}")`);
ok(linhaMarlonA?.[3] === "12", `total é a soma das partes, 9+3 (veio "${linhaMarlonA?.[3]}")`);
ok(linhaMarlonA?.[4] === "4", `agendamentos veio do lançamento (veio "${linhaMarlonA?.[4]}")`);
const linhaUrielA = achar(mA, "Uriel");
ok(linhaUrielA?.[2] === "1", `o lançamento do Marlon NÃO encosta no Uriel: ele mantém a 1 do RD (veio "${linhaUrielA?.[2]}")`);
ok(mA.botoesEditar === 2, `há um botão Editar por colaborador (veio ${mA.botoesEditar})`);
ok(!/>manual</.test(mA.texto), "a linha NÃO carrega etiqueta \"manual\" ao lado do nome");

// ---- 2) O Marlon, no DIA_B (dia SEM lançamento) ---------------------------
const mB = await abrir("comercial2@bsconta.com.br", so(DIA_B));
ok(achar(mB, "Marlon")?.[1] === "1", `dia sem lançamento continua valendo o RD: 1 (veio "${achar(mB, "Marlon")?.[1]}")`);
ok(!/>manual</.test(mB.texto), "dia sem lançamento também não carrega etiqueta");

// ---- 3) A semana inteira: soma do dia lançado + do dia do RD --------------
const semana = await abrir("comercial2@bsconta.com.br", { start: "2026-09-14", end: "2026-09-20" });
ok(achar(semana, "Marlon")?.[1] === "10", `semana soma o dia lançado (9) com o dia do RD (1) = 10 (veio "${achar(semana, "Marlon")?.[1]}")`);
ok(achar(semana, "Uriel")?.[2] === "1", `Uriel na semana continua com a 1 do RD (veio "${achar(semana, "Uriel")?.[2]}")`);

// ---- 4) Outro usuário: vê os números, não vê o total nem edita ------------
const outro = await abrir("comercial@bsconta.com.br", so(DIA_A));
ok(outro.temHero, "todo mundo vê o total de ligações realizadas");
ok(outro.destaque === mA.destaque, `e vê o MESMO número que o Marlon (${mA.destaque} vs ${outro.destaque})`);
ok(!/é restrito/i.test(outro.texto), "o aviso de conteúdo restrito saiu da tela");
ok(outro.botoesEditar === 0, "mas quem não é o Marlon não tem nenhum botão de editar");
ok(achar(outro, "Marlon")?.[1] === "9", "mas continua vendo os números por colaborador");

// ---- 5) Fora do período de lançamento e em período longo ------------------
const antes = await abrir("comercial2@bsconta.com.br", so("2026-09-10"));
ok(antes.botoesEditar === 0, "antes de 14/09/2026 não dá para lançar");
ok(/a partir de/i.test(antes.texto), "e a tela explica por quê");
ok(semana.botoesEditar === 0, "num período de vários dias não dá para lançar");
ok(/único dia/i.test(semana.texto), "e a tela pede para escolher um dia");

// ---- 6) A seção removida --------------------------------------------------
ok(!/Ligações do período/i.test(mA.texto), 'a seção "Ligações do período" foi removida');

// ---- 7) A Visão geral tem que bater com a tela de Ligações ---------------
// Este é o teste mais importante do arquivo. A Visão geral calculava as
// ligações por conta própria, sem saber do lançamento manual — a mesma semana
// aparecia como 4 numa tela e 14 na outra. Dois números para a mesma coisa é
// pior do que um número errado: ninguém sabe em qual acreditar.
const visaoGeral = await abrir("comercial2@bsconta.com.br", so(DIA_A), "dashboard");
const cartao = visaoGeral.kpis["Ligações de agendamento"];
ok(cartao !== undefined, `a Visão geral tem o cartão "Ligações de agendamento" (rótulos: ${Object.keys(visaoGeral.kpis).join(", ")})`);
ok(
  cartao === linhaMarlonA?.[2] || cartao === String(Number(linhaMarlonA?.[2]) + Number(linhaUrielA?.[2])),
  `o cartão soma as ligações de agendamento da equipe, com o lançamento manual: Marlon ${linhaMarlonA?.[2]} + Uriel ${linhaUrielA?.[2]} (veio "${cartao}")`
);
ok(cartao !== "1", "o cartão NÃO ignora o lançamento manual (1 seria só o que o RD trouxe)");
ok(visaoGeral.erros.length === 0, `a Visão geral abriu sem erro${visaoGeral.erros.length ? ": " + visaoGeral.erros[0] : ""}`);

await navegador.close();
servidor.close();
console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
