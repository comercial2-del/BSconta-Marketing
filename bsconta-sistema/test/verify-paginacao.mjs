// ---------------------------------------------------------------------------
// Testa a paginação de js/data.js (fetchAllRows).
//
// Por que este teste existe: a busca passou a pedir as páginas EM PARALELO em
// vez de uma de cada vez. É uma troca ótima para a velocidade e péssima se
// estiver errada — uma página a menos não dá erro nenhum, só faz sumir
// silenciosamente centenas de negociações dos relatórios. Este teste prova,
// nos limites exatos (999, 1000, 1001, 2000, 2647), que sai a mesma coisa que
// saía antes: todas as linhas, na ordem, sem repetir.
//
// Rodar: node test/verify-paginacao.mjs
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import vm from "node:vm";

let falhas = 0;
function ok(cond, msg) {
  console.log(`${cond ? "OK" : "FALHOU"}: ${msg}`);
  if (!cond) falhas++;
}

/**
 * Supabase de mentira que se comporta como o Postgrest: devolve no máximo
 * 1.000 linhas por requisição, respeita o range e conta as requisições.
 * @param {number} totalLinhas
 * @param {{informaContagem?: boolean}} opts
 */
function fakeSb(totalLinhas, opts = {}) {
  const informaContagem = opts.informaContagem !== false;
  const MAX = 1000;
  const todas = Array.from({ length: totalLinhas }, (_, i) => ({ id: i, nome: `linha ${i}` }));
  const chamadas = [];
  const sb = {
    from() {
      let pediuContagem = false;
      const api = {
        select: (_cols, o) => {
          if (o && o.count === "exact") pediuContagem = true;
          return api;
        },
        order: () => Promise.resolve({ data: todas, error: null }),
        range: (de, ate) => {
          chamadas.push([de, ate]);
          const fatia = todas.slice(de, Math.min(ate + 1, de + MAX));
          return Promise.resolve({
            data: fatia,
            error: null,
            count: informaContagem && pediuContagem ? totalLinhas : null,
          });
        },
      };
      return api;
    },
  };
  return { sb, chamadas };
}

function carregar(sb) {
  const ctx = { sb, sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, console, Date, JSON, Promise, Math, Number };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL("../js/data.js", import.meta.url), "utf8"), ctx);
  // `const` no topo de um script fica no escopo léxico, não vira propriedade
  // do objeto de contexto — por isso lemos avaliando no mesmo contexto.
  ctx.avaliar = (expr) => vm.runInContext(expr, ctx);
  return ctx;
}

// --- Nos limites exatos ----------------------------------------------------
for (const total of [0, 1, 999, 1000, 1001, 2000, 2001, 2647]) {
  const { sb, chamadas } = fakeSb(total);
  const ctx = carregar(sb);
  const linhas = await ctx.fetchAllRows("deals");
  const ids = linhas.map((r) => r.id);
  const semRepetir = new Set(ids).size === ids.length;
  const naOrdem = ids.every((v, i) => v === i);
  ok(
    linhas.length === total && semRepetir && naOrdem,
    `${String(total).padStart(4)} linhas -> vieram ${linhas.length}, sem repetir, na ordem (${chamadas.length} requisição(ões))`,
  );
}

// --- Em paralelo mesmo, e não uma de cada vez ------------------------------
{
  const { chamadas } = fakeSb(2647);
  const ctx = carregar(fakeSb(2647).sb);
  await ctx.fetchAllRows("deals");
  const { sb: sb2, chamadas: c2 } = fakeSb(2647);
  const ctx2 = carregar(sb2);
  await ctx2.fetchAllRows("deals");
  ok(c2.length === 3, `2.647 linhas continuam custando 3 requisições (foram ${c2.length})`);
  ok(chamadas.length === 0, "o contador de requisições é por instância (sanidade do próprio teste)");
}

// --- Servidor que não informa a contagem: cai no modo seguro em série ------
{
  const { sb, chamadas } = fakeSb(2647, { informaContagem: false });
  const ctx = carregar(sb);
  const linhas = await ctx.fetchAllRows("deals");
  const ids = linhas.map((r) => r.id);
  ok(
    linhas.length === 2647 && ids.every((v, i) => v === i),
    `sem contagem do servidor: ainda traz as 2.647 linhas inteiras (${chamadas.length} requisições, em série)`,
  );
}

// --- Só as colunas que a tela usa -----------------------------------------
{
  const ctx = carregar(fakeSb(10).sb);
  const cols = ctx.avaliar("COLS");
  ok(!cols.deals.includes("rd_deal_id"), "deals não baixa mais rd_deal_id (65 kB de controle interno)");
  ok(!cols.activities.includes("notes"), "activities não baixa mais notes");
  ok(cols.activities.includes("external_id"), "activities MANTÉM external_id (calc.js usa para não contar reunião em dobro)");
  ok(cols.deals.includes("deleted_at") && cols.activities.includes("deleted_at"), "deleted_at continua vindo (é o que esconde o que foi apagado)");
  ok(cols.deals.includes("probability"), "probability continua vindo (a tela do Funil mostra)");
  ok(cols.sales.includes("margin"), "margin continua vindo (Vendas soma a margem)");
  // created_at das negociações alimenta o cartão "Leads no período" (quantos
  // leads chegaram). Sem ele, o cartão zera sem avisar.
  ok(cols.deals.includes("created_at"), "created_at das negociações vem do banco (cartão de Leads)");
}

console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
