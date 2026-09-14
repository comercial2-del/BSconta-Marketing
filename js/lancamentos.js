// ---------------------------------------------------------------------------
// Lançamento manual de ligações — dia a dia, feito pelo Marlon.
//
// O PROBLEMA QUE ISTO RESOLVE
// Os números de ligações vinham só do RD Station, e o RD não tem tudo: quem
// liga sem abrir tarefa some da conta. A tela mostrava Dayane e Gabriel
// zerados, o que não é a realidade do dia deles.
//
// A REGRA
// Uma linha por vendedor e por dia. No período que a tela mostra:
//   - dia COM lançamento  -> vale o número lançado (o do RD é ignorado)
//   - dia SEM lançamento  -> vale o que veio do RD/Agenda
// O número do período é a soma dos dois. Semana e mês são a soma dos dias,
// então dá para consultar o histórico por qualquer recorte, para trás.
//
// Ver banco/18_ligacoes_manuais.sql — a trava de quem pode escrever está lá,
// no banco. Esconder o botão na tela não impede ninguém de chamar a API.
// ---------------------------------------------------------------------------

/** Antes desta data o sistema só conhece o que veio do RD. */
const LANCAMENTOS_INICIO = "2026-09-14";

/** Quem lança à mão. Para liberar outra pessoa, some o e-mail dela AQUI e
 *  na função pode_editar_ligacoes() do banco — os dois lados, sempre. */
const EMAILS_EDITAM_LIGACOES = ["comercial2@bsconta.com.br"];

function podeEditarLigacoes(user) {
  const email = (user?.email || "").trim().toLowerCase();
  return EMAILS_EDITAM_LIGACOES.includes(email);
}

/** O período selecionado é um único dia? Só nesse caso dá para lançar. */
function ehUmDiaSo(range) {
  return isoDate(range.start) === isoDate(range.end);
}

/** Esse dia já pode receber lançamento? */
function diaLancavel(iso) {
  return iso >= LANCAMENTOS_INICIO;
}

async function carregarLancamentos(range) {
  const { data, error } = await sb
    .from("call_entries")
    .select("id,seller_id,entry_date,sales_calls,scheduling_calls,scheduled,updated_by_name,updated_at")
    .gte("entry_date", isoDate(range.start))
    .lte("entry_date", isoDate(range.end));
  if (error) {
    // Banco ainda sem a tabela (migração 18 não rodada): a tela continua
    // funcionando só com o RD, em vez de quebrar inteira.
    console.warn("[lançamentos] não foi possível carregar:", error.message);
    return [];
  }
  return data || [];
}

async function salvarLancamento({ sellerId, dia, vendas, agendamento, agendamentos, autor }) {
  const linha = {
    seller_id: sellerId,
    entry_date: dia,
    sales_calls: Math.max(0, Number(vendas) || 0),
    scheduling_calls: Math.max(0, Number(agendamento) || 0),
    scheduled: Math.max(0, Number(agendamentos) || 0),
    updated_by_name: autor || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb
    .from("call_entries")
    .upsert(linha, { onConflict: "seller_id,entry_date" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function apagarLancamento(sellerId, dia) {
  const { error } = await sb.from("call_entries").delete().eq("seller_id", sellerId).eq("entry_date", dia);
  if (error) throw error;
}

/**
 * Junta o que foi lançado à mão com o que veio do RD, aplicando a regra de
 * substituição por dia. Devolve os quatro números da linha do colaborador.
 *
 * @param {Array} automaticas  ligações do período vindas do RD/Agenda (já classificadas)
 * @param {Array} lancamentos  linhas de call_entries — PODEM SER DE QUALQUER DATA
 * @param {string} sellerId    nulo = todos os vendedores somados
 * @param {{start:Date,end:Date}} range  o período que a tela está mostrando
 *
 * O `range` não é opcional por um motivo que já custou um bug: a tela carrega
 * uma janela larga de lançamentos de uma vez (para não ir ao banco uma vez por
 * período no gráfico de evolução). Sem recortar aqui, o lançamento de um dia
 * entrava na conta de todos os outros dias.
 */
function juntarComLancamentos(automaticas, lancamentos, sellerId, range) {
  const de = isoDate(range.start);
  const ate = isoDate(range.end);
  const meus = (lancamentos || []).filter(
    (l) => (!sellerId || l.seller_id === sellerId) && l.entry_date >= de && l.entry_date <= ate
  );

  // Os dias que a mão já cobriu. A chave inclui o vendedor porque um dia pode
  // estar lançado para o Marlon e não para a Dayane.
  const cobertos = new Set(meus.map((l) => `${l.seller_id}|${l.entry_date}`));
  const sobraramDoRd = (automaticas || []).filter((a) => !cobertos.has(`${a.seller_id}|${isoDate(a.scheduled_at)}`));

  const feitas = sobraramDoRd.filter((a) => a.status === "DONE");
  const futuras = sobraramDoRd.filter((a) => a.status !== "DONE" && a.status !== "CANCELED");
  const deVendas = feitas.filter(isSalesCall).length;

  const soma = (campo) => meus.reduce((t, l) => t + (Number(l[campo]) || 0), 0);

  const vendas = deVendas + soma("sales_calls");
  const agendamento = feitas.length - deVendas + soma("scheduling_calls");
  return {
    vendas,
    agendamento,
    total: vendas + agendamento,
    agendamentos: futuras.length + soma("scheduled"),
    diasLancados: meus.length,
  };
}

/** O lançamento de um vendedor num dia específico, se existir. */
function lancamentoDoDia(lancamentos, sellerId, dia) {
  return (lancamentos || []).find((l) => l.seller_id === sellerId && l.entry_date === dia) || null;
}

// ---------------------------------------------------------------------------
// FONTE ÚNICA dos números de ligações
//
// Por que isto existe (14/09/2026): a Visão geral calculava as ligações por
// conta própria, direto das atividades do RD, e não sabia dos lançamentos
// manuais. Resultado: a mesma semana aparecia como 4 numa tela e 14 na outra.
// Duas telas com dois números para a mesma coisa é pior do que um número
// errado — ninguém sabe em qual acreditar.
//
// Agora as duas chamam daqui.
// ---------------------------------------------------------------------------

/** Os quatro números de UM vendedor (ou de um vendedor específico). */
function numerosDeLigacoes(store, lancamentos, range, sellerId) {
  const acts = store.activities.filter(
    (a) => inRange(a.scheduled_at, range) && (!sellerId || a.seller_id === sellerId)
  );
  const calls = classifyActivities(acts, store.sellers, sellerId).calls;
  return juntarComLancamentos(calls, lancamentos, sellerId, range);
}

/**
 * Os quatro números da equipe inteira.
 *
 * Soma vendedor a vendedor em vez de usar a lista já deduplicada: o lançamento
 * manual é por pessoa, e passar pela deduplicação descartaria o número de
 * alguém.
 */
function numerosDeLigacoesGeral(store, lancamentos, range) {
  const zero = { vendas: 0, agendamento: 0, total: 0, agendamentos: 0, diasLancados: 0 };
  return (store.sellers || []).reduce((acc, s) => {
    const n = numerosDeLigacoes(store, lancamentos, range, s.id);
    return {
      vendas: acc.vendas + n.vendas,
      agendamento: acc.agendamento + n.agendamento,
      total: acc.total + n.total,
      agendamentos: acc.agendamentos + n.agendamentos,
      diasLancados: acc.diasLancados + n.diasLancados,
    };
  }, zero);
}
