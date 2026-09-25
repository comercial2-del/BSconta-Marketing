// Acesso a dados (Supabase). Busca os dados "crus"; os cálculos de KPI,
// funil, ranking e relatório ficam em calc.js, igual à versão anterior.
//
// Observação: o Postgrest do Supabase tem um limite de linhas por
// requisição (definido em Project Settings > Data API > "Max rows",
// e independente de qualquer .limit() pedido pelo cliente). Para não
// depender desse valor nem correr o risco de truncar dados silenciosamente
// se a base crescer, fetchDeals/fetchActivities/fetchSales paginam com
// .range() até a página voltar vazia (ou menor que o tamanho da página).

const PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// VELOCIDADE — só o que a tela usa
//
// Antes: select("*"). Isso trazia colunas que NENHUMA tela lê e que são as
// mais pesadas da base — `deals.rd_deal_id` (65 kB) e `activities.external_id`
// + `notes` (85 kB) são controle interno da sincronização, não informação de
// tela. Somando origem, datas previstas, anotações e afins, quase um terço do
// que o navegador baixava era desperdício: descia pela rede, era convertido em
// objeto, ia para o cache e voltava de lá — de graça.
//
// Cada lista abaixo é exatamente o que as telas consomem. Se um dia uma tela
// precisar de um campo novo, é só acrescentar aqui.
// ---------------------------------------------------------------------------
const COLS = {
  // external_id fica: calc.js usa para não contar a mesma reunião duas vezes
  // (o mesmo evento aparece na agenda do organizador e de cada convidado).
  activities:
    "id,type,subtype,source,external_id,deal_id,seller_id,title,scheduled_at,status,meeting_confirmed,meeting_confirmed_at,deleted_at",
  deals: "id,client_name,company_name,seller_id,stage_id,value,status,probability,origin,created_at,closed_at,is_recurring,updated_at,deleted_at,last_interaction_at",
  sales: "id,deal_id,seller_id,value,margin,is_recurring,closed_at",
};
// sellers (4 linhas, 589 bytes), stages (25 linhas, 2,6 kB) e goals continuam
// com select("*"): a economia seria irrelevante e `order` é palavra reservada
// no Postgres — não vale arriscar um erro de sintaxe para poupar 3 kB.

/**
 * Busca todas as linhas de uma tabela.
 *
 * VELOCIDADE — a paginação era em SÉRIE: pedia as linhas 0-999, esperava a
 * resposta, pedia 1000-1999, esperava... Com 2.647 negociações isso é uma fila
 * de 3 idas e voltas ao servidor, ~250 ms cada, ~800 ms só de espera antes de
 * qualquer coisa aparecer na tela.
 *
 * Agora a primeira requisição já pergunta QUANTAS linhas existem (o Postgrest
 * responde isso no cabeçalho Content-Range, sem custo extra) e as páginas
 * restantes são pedidas TODAS DE UMA VEZ, em paralelo. Três esperas viram uma.
 */
async function fetchAllRows(table) {
  const cols = COLS[table] || "*";
  const primeira = await sb.from(table).select(cols, { count: "exact" }).range(0, PAGE_SIZE - 1);
  if (primeira.error) throw primeira.error;

  const linhas = primeira.data || [];
  const total = primeira.count;

  // Cabe tudo na primeira página: acabou (o caso normal das tabelas menores).
  if (linhas.length < PAGE_SIZE) return linhas;

  // Sem contagem (servidor antigo/config diferente): volta ao modo seguro em
  // série, que nunca trunca — melhor lento do que faltar dado.
  if (typeof total !== "number" || !Number.isFinite(total)) {
    let todas = linhas.slice();
    let de = PAGE_SIZE;
    while (true) {
      const { data, error } = await sb.from(table).select(cols).range(de, de + PAGE_SIZE - 1);
      if (error) throw error;
      todas = todas.concat(data || []);
      if (!data || data.length < PAGE_SIZE) break;
      de += PAGE_SIZE;
    }
    return todas;
  }

  const faltam = [];
  for (let de = PAGE_SIZE; de < total; de += PAGE_SIZE) faltam.push(de);
  const paginas = await Promise.all(
    faltam.map(async (de) => {
      const { data, error } = await sb.from(table).select(cols).range(de, de + PAGE_SIZE - 1);
      if (error) throw error;
      return data || [];
    })
  );
  return linhas.concat(...paginas);
}

async function fetchSellers() {
  const { data, error } = await sb.from("sellers").select("*").order("name");
  if (error) throw error;
  return data;
}

async function fetchStages() {
  const { data, error } = await sb.from("stages").select("*").order("order");
  if (error) throw error;
  return data;
}

async function fetchDeals() {
  return fetchAllRows("deals");
}

async function fetchActivities() {
  return fetchAllRows("activities");
}

async function fetchSales() {
  return fetchAllRows("sales");
}

async function fetchGoals() {
  const { data, error } = await sb.from("goals").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

async function insertGoal(goal) {
  const { data, error } = await sb.from("goals").insert(goal).select().single();
  if (error) throw error;
  return data;
}

/** Muda o alvo de uma meta que já existe (só ADMIN — ver a política do banco). */
async function updateGoal(id, campos) {
  const { data, error } = await sb.from("goals").update(campos).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

/** Apaga uma meta.
 *  Meta não é histórico, é um alvo: quando deixa de valer, o certo é sumir da
 *  tela — diferente de ligação, reunião ou venda, que nunca são apagadas de
 *  verdade (aquelas só recebem deleted_at). */
async function deleteGoal(id) {
  const { error } = await sb.from("goals").delete().eq("id", id);
  if (error) throw error;
}

async function insertActivity(activity) {
  const { data, error } = await sb.from("activities").insert(activity).select().single();
  if (error) throw error;
  return data;
}

/**
 * Confirma manualmente (Sim/Não) se uma reunião realmente aconteceu.
 * Passa por uma função no banco (security definer) em vez de um update
 * direto: assim o próprio vendedor consegue confirmar as reuniões DELE
 * mesmo sem ser admin, mas não consegue mexer em reunião de outro vendedor
 * nem em nenhum outro campo da atividade. Veja 09_meeting_confirmation.sql.
 */
async function setMeetingConfirmation(activityId, confirmed) {
  const { error } = await sb.rpc("set_meeting_confirmation", {
    p_activity_id: activityId,
    p_confirmed: confirmed,
  });
  if (error) throw error;
}

/**
 * Busca tudo de uma vez (usado no carregamento de cada página).
 * Datas vêm como strings ISO do Postgres — convertidas para Date aqui.
 */
// ---------------------------------------------------------------------------
// Cache de sessão — o que deixa a troca de abas rápida
//
// Cada tela chamava loadAll(), que faz 6 consultas ao Supabase (deals,
// activities e sales paginadas de 1.000 em 1.000). Trocar de aba refazia tudo
// isso, e é daí que vinha a lentidão.
//
// Agora o resultado fica guardado no sessionStorage por um tempo curto: dentro
// da validade, trocar de aba não faz nenhuma consulta — lê da memória do
// navegador e desenha na hora. Passado o prazo (ou depois de uma
// sincronização, ou de qualquer gravação), busca do banco de novo.
//
// sessionStorage e não localStorage de propósito: o cache morre quando a aba
// é fechada, então nunca fica um dado velho de ontem escondido.
// ---------------------------------------------------------------------------
const STORE_CACHE_KEY = "sgcmp:store:v5"; // v5: deals.last_interaction_at (tela Leads) // v3: guarda menos colunas (ver COLS)
const STORE_CACHE_TTL_MS = 60_000; // dentro disso, nem consulta o banco
// Acima do TTL, o cache ainda serve para DESENHAR A TELA NA HORA, enquanto os
// dados novos vêm por trás. Meia hora é o limite do que vale mostrar antes de
// preferir a tela de carregamento.
const STORE_CACHE_MAX_AGE_MS = 30 * 60_000;
const STORE_CACHE_MAX_CHARS = 3_500_000; // acima disso nem tenta guardar (limite do navegador)

// JSON não guarda Date — estes são os campos que voltam a virar Date.
// Só entram aqui os campos que as telas realmente usam (ver COLS acima):
// converter data que ninguém lê é trabalho jogado fora — são milhares de
// objetos Date criados a cada carregamento.
const STORE_DATE_FIELDS = {
  deals: ["created_at", "closed_at", "updated_at", "last_interaction_at"],
  activities: ["scheduled_at", "meeting_confirmed_at"],
  sales: ["closed_at"],
  goals: ["period_start", "created_at"],
};

function hydrateStore(raw) {
  const out = { sellers: raw.sellers || [], stages: raw.stages || [] };
  for (const [table, fields] of Object.entries(STORE_DATE_FIELDS)) {
    out[table] = (raw[table] || []).map((row) => {
      const copy = { ...row };
      for (const f of fields) copy[f] = row[f] ? new Date(row[f]) : null;
      return copy;
    });
  }
  return out;
}

/** @param {number} idadeMaximaMs até que idade o cache ainda serve */
function readStoreCache(idadeMaximaMs = STORE_CACHE_TTL_MS) {
  try {
    const txt = sessionStorage.getItem(STORE_CACHE_KEY);
    if (!txt) return null;
    const { at, raw } = JSON.parse(txt);
    if (!at || Date.now() - at > idadeMaximaMs) return null;
    return hydrateStore(raw);
  } catch {
    return null; // cache corrompido ou armazenamento bloqueado: busca do banco
  }
}

function writeStoreCache(raw) {
  try {
    const txt = JSON.stringify({ at: Date.now(), raw });
    if (txt.length > STORE_CACHE_MAX_CHARS) return;
    sessionStorage.setItem(STORE_CACHE_KEY, txt);
  } catch {
    /* sem espaço/sem permissão: segue sem cache, só mais lento */
  }
}

/** Descarta o cache — obrigatório depois de QUALQUER gravação. */
function invalidateStoreCache() {
  try {
    sessionStorage.removeItem(STORE_CACHE_KEY);
  } catch {
    /* nada a fazer */
  }
}

/**
 * Carrega tudo o que as telas usam.
 * @param {{fresh?: boolean}} opts fresh = true ignora o cache e vai ao banco
 *   (usado depois de uma sincronização ou de uma gravação).
 */
async function loadAll(opts = {}) {
  if (!opts.fresh) {
    const cached = readStoreCache();
    if (cached) return cached;
  }

  const [sellers, stages, dealsBrutos, activitiesBrutas, salesRaw, goalsRaw] = await Promise.all([
    fetchSellers(),
    fetchStages(),
    fetchDeals(),
    fetchActivities(),
    fetchSales(),
    fetchGoals(),
  ]);

  // Registros apagados na origem (reunião removida da Agenda, card removido do
  // RD) recebem `deleted_at` na sincronização. Eles continuam guardados no
  // banco — nada é perdido — mas somem de TODAS as telas, contadores e
  // gráficos, porque saem aqui, num único ponto, antes de qualquer cálculo.
  // Se a coluna ainda não existir no banco, o campo vem indefinido e este
  // filtro simplesmente não tira nada.
  const semExcluidos = (linhas) => (linhas || []).filter((r) => !r.deleted_at);
  const dealsRaw = semExcluidos(dealsBrutos);
  const activitiesRaw = semExcluidos(activitiesBrutas);

  writeStoreCache({ sellers, stages, deals: dealsRaw, activities: activitiesRaw, sales: salesRaw, goals: goalsRaw });

  // Uma única rotina de conversão de datas, a mesma usada ao ler do cache —
  // antes havia duas listas de campos que precisavam ser mantidas iguais na
  // mão, e é assim que um campo some sem ninguém perceber.
  return hydrateStore({ sellers, stages, deals: dealsRaw, activities: activitiesRaw, sales: salesRaw, goals: goalsRaw });
}

/**
 * Carrega os dados para desenhar a tela AGORA.
 *
 * VELOCIDADE — este é o ponto que mais muda a sensação de rapidez.
 *
 * Antes, abrir qualquer tela (ou trocar de aba com o cache vencido) parava
 * tudo em uma tela de carregamento até o banco responder: ~1 segundo de
 * espera, toda vez, para ver números que quase nunca mudaram no último minuto.
 *
 * Agora, se existe uma cópia recente na memória do navegador, a tela é
 * desenhada IMEDIATAMENTE com ela e a busca no banco acontece por trás. Quando
 * os dados novos chegam (menos de um segundo depois), a tela se atualiza
 * sozinha. Na prática: a navegação fica instantânea sem nunca mostrar dado
 * velho por mais do que um piscar de olhos.
 *
 * @param {(store:any)=>void} aoAtualizar chamado se os dados novos chegarem
 *        e forem diferentes do que já está na tela.
 * @returns {Promise<any>} o store para desenhar já.
 */
async function loadAllInstantaneo(aoAtualizar) {
  const doCache = readStoreCache(STORE_CACHE_MAX_AGE_MS);
  if (!doCache) return loadAll(); // primeira vez na sessão: não há atalho

  // Recente a ponto de nem valer consultar o banco.
  if (readStoreCache(STORE_CACHE_TTL_MS)) return doCache;

  // Serve o que temos e atualiza por trás, sem travar a tela.
  loadAll({ fresh: true })
    .then((novo) => {
      if (typeof aoAtualizar === "function") aoAtualizar(novo);
    })
    .catch((err) => console.warn("[dados] atualização em segundo plano falhou:", err));

  return doCache;
}
