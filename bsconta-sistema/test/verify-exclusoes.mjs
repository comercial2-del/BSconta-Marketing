// ---------------------------------------------------------------------------
// Testa a sincronização de EXCLUSÕES do lado da tela (js/data.js).
//
// A regra: um registro apagado na origem (reunião removida da Agenda, card
// removido do RD) ganha `deleted_at` no banco e precisa sumir de TODAS as
// telas — contadores, listas e gráficos — sem sumir do banco.
//
// A filtragem acontece num único ponto (loadAll, em js/data.js), de propósito:
// se estivesse espalhada por cada tela, bastaria esquecer uma para o número
// voltar errado. Este teste prova que o ponto único funciona, que o cache de
// sessão não guarda registro apagado, e que os KPIs em calc.js caem junto.
//
// Rodar: node test/verify-exclusoes.mjs
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";

let falhas = 0;
function ok(cond, msg) {
  console.log(`${cond ? "OK" : "FALHOU"}: ${msg}`);
  if (!cond) falhas++;
}

// --- Dados de teste: 4 reuniões, 1 apagada na Agenda -----------------------
const vendedor = { id: randomUUID(), name: "Marlon", email: "comercial2@bsconta.com.br" };
const etapa = { id: randomUUID(), name: "Reunião Confirmada", order: 1, is_won: false, is_lost: false };
const hoje = new Date();
const agora = () => new Date().toISOString();

function reuniao(titulo, deletedAt = null) {
  return {
    id: randomUUID(),
    type: "MEETING",
    subtype: "COMMERCIAL_MEETING",
    source: "CALENDAR",
    external_id: `gcal_${randomUUID()}`,
    seller_id: vendedor.id,
    deal_id: null,
    title: titulo,
    scheduled_at: hoje.toISOString(),
    status: "SCHEDULED",
    created_at: agora(),
    updated_at: agora(),
    meeting_confirmed_at: null,
    deleted_at: deletedAt,
  };
}

function card(nome, deletedAt = null) {
  return {
    id: randomUUID(),
    rd_deal_id: randomUUID(),
    client_name: nome,
    seller_id: vendedor.id,
    stage_id: etapa.id,
    value: 1000,
    status: "OPEN",
    closed_at: null,
    expected_close_date: null,
    last_interaction_at: null,
    next_activity_at: null,
    is_recurring: false,
    created_at: agora(),
    updated_at: agora(),
    deleted_at: deletedAt,
  };
}

const activitiesNoBanco = [
  reuniao("Reunião BSconta x Cliente A"),
  reuniao("Reunião BSconta x Cliente B"),
  reuniao("Reunião BSconta x Cliente C"),
  reuniao("Reunião BSconta x Cliente APAGADA", agora()), // removida da Agenda
];
const dealsNoBanco = [card("Cliente A"), card("Cliente APAGADO", agora())];

// --- Ambiente falso: Supabase e sessionStorage -----------------------------
const tabelas = {
  sellers: [vendedor],
  stages: [etapa],
  deals: dealsNoBanco,
  activities: activitiesNoBanco,
  sales: [],
  goals: [],
};

const sb = {
  from(tabela) {
    const linhas = tabelas[tabela] ?? [];
    const resultado = { data: linhas, error: null };
    const api = {
      select: () => api,
      order: () => Promise.resolve(resultado),
      range: (de) => Promise.resolve({ data: de === 0 ? linhas : [], error: null }),
      then: (r) => Promise.resolve(resultado).then(r),
    };
    return api;
  },
};

const memoria = new Map();
const sessionStorage = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, v),
  removeItem: (k) => memoria.delete(k),
};

const ctx = { sb, sessionStorage, console, Date, JSON, Promise, Math };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL("../js/data.js", import.meta.url), "utf8"), ctx);
vm.runInContext(readFileSync(new URL("../js/calc.js", import.meta.url), "utf8"), ctx);

const store = await ctx.loadAll({ fresh: true });

// --- Verificações ----------------------------------------------------------
ok(store.activities.length === 3, "reunião apagada na Agenda sai do store (3 de 4)");
ok(
  !store.activities.some((a) => a.title.includes("APAGADA")),
  "a reunião apagada não aparece em lugar nenhum do store",
);
ok(store.deals.length === 1, "card apagado no RD sai do store (1 de 2)");

const { meetings } = ctx.classifyActivities(store.activities, store.sellers, null);
ok(meetings.length === 3, "contador de reuniões cai de 4 para 3");

const funil = ctx.getFunnel(store, null);
const naEtapa = funil.find((f) => f.stage === etapa.name);
ok(naEtapa && naEtapa.count === 1, "funil conta 1 card em vez de 2");

// O cache de sessão não pode guardar o que foi apagado — senão o registro
// voltaria a aparecer na próxima troca de aba, dentro do minuto de validade.
const bruto = JSON.parse(memoria.get("sgcmp:store:v3")).raw;
ok(bruto.activities.length === 3 && bruto.deals.length === 1, "o cache de sessão também sai limpo");

const doCache = await ctx.loadAll();
ok(doCache.activities.length === 3, "recarregar do cache continua sem o registro apagado");

// Registro restaurado na origem (deleted_at volta a nulo) reaparece.
activitiesNoBanco[3].deleted_at = null;
ctx.invalidateStoreCache();
const restaurado = await ctx.loadAll({ fresh: true });
ok(restaurado.activities.length === 4, "evento recriado na Agenda reaparece sozinho");

// Banco sem a coluna (SQL 15 ainda não rodado): nada pode quebrar.
for (const a of activitiesNoBanco) delete a.deleted_at;
for (const d of dealsNoBanco) delete d.deleted_at;
ctx.invalidateStoreCache();
const semColuna = await ctx.loadAll({ fresh: true });
ok(
  semColuna.activities.length === 4 && semColuna.deals.length === 2,
  "banco sem a coluna deleted_at: funciona como antes, não esconde nada",
);

console.log(falhas === 0 ? "\nTodos os testes passaram." : `\n${falhas} teste(s) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
