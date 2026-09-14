// ---------------------------------------------------------------------------
// Confere a ORGANIZAÇÃO das pastas (14/09/2026).
//
// As telas foram para telas/, os SQL para banco/ e os manuais para docs/. Com
// isso as telas passaram a morar um degrau abaixo de css/, js/ e assets/, e
// todo caminho relativo dentro delas teve de subir um nível (../).
//
// Esse tipo de erro é traiçoeiro: a página ABRE do mesmo jeito, só que sem
// estilo, sem gráfico ou sem logo — e nenhum teste que só olha o texto
// percebe. Este teste olha o que o navegador realmente conseguiu baixar:
// qualquer arquivo que volte 404 reprova.
//
// Rodar: node test/verify-estrutura.mjs
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

const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg" };
const naoAchados = [];
const servidor = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html";
  const arq = path.join(RAIZ, rel);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) {
    naoAchados.push("/" + rel);
    return res.writeHead(404).end("404");
  }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" });
  res.end(fs.readFileSync(arq));
});
await new Promise((r) => servidor.listen(0, r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

const navegador = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const contexto = await navegador.newContext();
// As bibliotecas de fora não interessam aqui — o que se testa é a nossa pasta.
await contexto.route("**/cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: "/**/" }));
await contexto.route("**/fonts.googleapis.com/**", (r) => r.fulfill({ contentType: "text/css", body: "/**/" }));
await contexto.addInitScript(() => {
  // Sem banco: o objetivo é só ver quais ARQUIVOS a página busca.
  window.supabase = { createClient: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }) } }) };
});

// ---- 1) A porta de entrada leva para dentro de telas/ -----------------------
const pagina = await contexto.newPage();
await pagina.goto(`${BASE}/`, { waitUntil: "load" });
await pagina.waitForURL(/telas\/login\.html$/, { timeout: 10000 }).catch(() => {});
ok(/\/telas\/login\.html$/.test(pagina.url()), `abrir a raiz leva ao login dentro de telas/ (foi para "${pagina.url().replace(BASE, "")}")`);

// ---- 2) Nenhuma tela pede arquivo que não existe ----------------------------
const TELAS = ["login.html", "dashboard.html", "funil.html", "ligacoes.html", "reunioes.html", "vendas.html", "metas.html", "ranking.html", "relatorios.html"];
for (const tela of TELAS) {
  naoAchados.length = 0;
  await pagina.goto(`${BASE}/telas/${tela}`, { waitUntil: "load" });
  await pagina.waitForTimeout(150);
  const nossos = naoAchados.filter((u) => /\.(css|js|png|jpg)$/.test(u));
  ok(nossos.length === 0, `telas/${tela}: todos os arquivos foram encontrados${nossos.length ? " — faltou " + nossos.join(", ") : ""}`);
}

// ---- 3) As pastas estão onde deveriam --------------------------------------
const existe = (p) => fs.existsSync(path.join(RAIZ, p));
ok(existe("index.html"), "index.html continua na raiz (é a porta de entrada do site)");
ok(fs.readdirSync(path.join(RAIZ, "banco")).filter((f) => f.endsWith(".sql")).length >= 16, "banco/ tem as migrações");
const MANUAIS = ["GUIA.md", "DEPLOY.md", "INTEGRACAO_GOOGLE_CALENDAR.md", "HOSPEDAGEM.md"];
const emDocs = fs.readdirSync(path.join(RAIZ, "docs"));
const faltamManuais = MANUAIS.filter((m) => !emDocs.includes(m));
ok(faltamManuais.length === 0, `docs/ tem os manuais${faltamManuais.length ? " — faltou " + faltamManuais.join(", ") : ""}`);
ok(existe("supabase/functions/sync-rd-station/index.ts"), "supabase/functions/ ficou no lugar (o nome é exigido pelo Supabase)");
ok(!fs.readdirSync(RAIZ).some((f) => f.endsWith(".sql")), "não sobrou SQL solto na raiz");
const htmlNaRaiz = fs.readdirSync(RAIZ).filter((f) => f.endsWith(".html")).sort();
ok(
  htmlNaRaiz.join(",") === "404.html,index.html",
  `na raiz só moram index.html (porta de entrada) e 404.html (erro da hospedagem) — veio "${htmlNaRaiz.join(", ")}"`
);
ok(fs.existsSync(path.join(RAIZ, "netlify.toml")), "netlify.toml está na raiz (é ele que bloqueia banco/, docs/, test/ e supabase/ no ar)");

await navegador.close();
servidor.close();
console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
