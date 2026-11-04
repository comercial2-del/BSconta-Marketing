// Qualificação do lead preenchida pelo VENDEDOR no RD Station (04/11/2026).
//
// Pedido do Gabriel e do Uriel (WhatsApp, 28/10 e 03/11/2026): três campos
// personalizados novos na negociação do RD, nas colunas laterais do card:
//   - "Conta Azul"            → Sim / Não
//   - "Constituição ou Troca" → Constituição / Troca de contabilidade
//   - "Qualidade do Cliente"  → A / B / C
//       A = empresa maior, com funcionários e colaboradores, tudo em dia
//       B = empresa pequena, mas sem irregularidade
//       C = cheia de irregularidades ou com parcelamento
//
// Nenhuma mudança na sincronização foi necessária: o sync-rd-station já grava
// TODOS os campos personalizados em deals.rd_details.campos ([{label, value}]).
// Este arquivo só lê esses campos. Funções puras — nada aqui vai ao banco.

const QUALIF_CAMPOS = {
  contaAzul: "Conta Azul",
  entrada: "Constituição ou Troca",
  qualidade: "Qualidade do Cliente",
};

const QUALIF_NIVEIS = {
  A: { label: "A", desc: "Empresa maior, funcionários e colaboradores, tudo em dia", classe: "q-a" },
  B: { label: "B", desc: "Empresa pequena, sem irregularidade", classe: "q-b" },
  C: { label: "C", desc: "Irregularidades ou parcelamento", classe: "q-c" },
};

function qualifNorm(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Valor de um campo personalizado do RD pelo rótulo (sem diferenciar acento/maiúscula). */
function qualifCampo(campos, rotulo) {
  const alvo = qualifNorm(rotulo);
  const f = (campos || []).find((c) => qualifNorm(c && c.label) === alvo);
  if (!f || f.value == null) return "";
  const v = Array.isArray(f.value) ? f.value.join(", ") : String(f.value);
  return v.trim();
}

/** Lê os três campos de uma negociação e devolve valores já padronizados. */
function qualifDoDeal(campos) {
  const ca = qualifNorm(qualifCampo(campos, QUALIF_CAMPOS.contaAzul));
  const en = qualifNorm(qualifCampo(campos, QUALIF_CAMPOS.entrada));
  const q = qualifCampo(campos, QUALIF_CAMPOS.qualidade).toUpperCase().replace(/[^ABC]/g, "").charAt(0);
  return {
    contaAzul: ca.startsWith("s") ? "Sim" : ca.startsWith("n") ? "Não" : "",
    entrada: en.startsWith("const") ? "Constituição" : en.startsWith("troca") ? "Troca" : "",
    qualidade: QUALIF_NIVEIS[q] ? q : "",
  };
}

/** Resumo de uma lista de leads já qualificados: contagens por nível e por campo. */
function qualifResumo(lista) {
  const r = { total: lista.length, A: 0, B: 0, C: 0, semQualidade: 0, contaAzulSim: 0, contaAzulNao: 0, constituicao: 0, troca: 0 };
  for (const l of lista) {
    if (l.qualidade) r[l.qualidade]++;
    else r.semQualidade++;
    if (l.contaAzul === "Sim") r.contaAzulSim++;
    if (l.contaAzul === "Não") r.contaAzulNao++;
    if (l.entrada === "Constituição") r.constituicao++;
    if (l.entrada === "Troca") r.troca++;
  }
  return r;
}

if (typeof module !== "undefined") {
  module.exports = { qualifCampo, qualifDoDeal, qualifResumo, QUALIF_CAMPOS, QUALIF_NIVEIS };
}
