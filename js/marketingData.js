// Dados-base da planilha "Controle Gestão Marketing.xlsx".
// Esta visão usa a planilha como fonte histórica/estrutural e não altera os
// indicadores operacionais do dashboard comercial existente.
const MARKETING_SDR_DATA = [
  { period: "2025-05", label: "Mai/25", investimento: 1155.71, impressoes: 48031, cliques: 440, leads: 53, qualificados: 50, reunioes: 6, contratos: 1 },
  { period: "2025-06", label: "Jun/25", investimento: 2168.76, impressoes: 82289, cliques: 434, leads: 65, qualificados: 61, reunioes: 13, contratos: 3 },
  { period: "2025-07", label: "Jul/25", investimento: 2189.97, impressoes: 102316, cliques: 545, leads: 86, qualificados: 83, reunioes: 14, contratos: 2 },
  { period: "2025-08", label: "Ago/25", investimento: 2919.74, impressoes: 123663, cliques: 582, leads: 56, qualificados: 48, reunioes: 17, contratos: 5 },
  { period: "2025-09", label: "Set/25", investimento: 2775.88, impressoes: 129546, cliques: 926, leads: 92, qualificados: 69, reunioes: 24, contratos: 5 },
  { period: "2025-10", label: "Out/25", investimento: 3178.30, impressoes: 219352, cliques: 1467, leads: 114, qualificados: 110, reunioes: 22, contratos: 4 },
  { period: "2025-11", label: "Nov/25", investimento: 3526.40, impressoes: 126906, cliques: 1178, leads: 117, qualificados: 99, reunioes: 30, contratos: 4 },
  { period: "2025-12", label: "Dez/25", investimento: 3046.64, impressoes: 169744, cliques: 1632, leads: 184, qualificados: 155, reunioes: 51, contratos: 6 },
  { period: "2026-01", label: "Jan/26", investimento: 3118.22, impressoes: 215198, cliques: 2369, leads: 256, qualificados: 229, reunioes: 40, contratos: 5 },
  { period: "2026-02", label: "Fev/26", investimento: 2786.72, impressoes: 171742, cliques: 1895, leads: 254, qualificados: 236, reunioes: 30, contratos: 3 },
  { period: "2026-03", label: "Mar/26", investimento: 3727.21, impressoes: 204054, cliques: 1866, leads: 223, qualificados: 183, reunioes: 44, contratos: 6 },
  { period: "2026-04", label: "Abr/26", investimento: 3656.18, impressoes: 179187, cliques: 1560, leads: 141, qualificados: 128, reunioes: 24, contratos: 4 },
  { period: "2026-05", label: "Mai/26", investimento: 3210.25, impressoes: 143270, cliques: 1189, leads: 113, qualificados: 113, reunioes: 21, contratos: 5 },
  { period: "2026-06", label: "Jun/26", investimento: 3027.05, impressoes: 94411, cliques: 945, leads: 106, qualificados: 106, reunioes: 24, contratos: 4 },
  { period: "2026-07", label: "Jul/26", investimento: 2616.09, impressoes: 64697, cliques: 757, leads: 93, qualificados: 93, reunioes: 12, contratos: 5 },
  // Na planilha, agosto/2026 ainda não tinha os números de reuniões/contratos
  // preenchidos; preservar como 0 evita inventar dados.
  { period: "2026-08", label: "Ago/26", investimento: 2391.55, impressoes: 52451, cliques: 757, leads: 73, qualificados: 73, reunioes: 0, contratos: 0 },
];
// Recortes de campanhas estruturados a partir do bloco de campanhas da planilha.
// A ordenação da "melhor campanha" prioriza conversão de reuniões em contratos,
// depois quantidade de contratos e reuniões como desempate.
const MARKETING_CAMPAIGN_DATA = [
  { period: "2026-07", campaign: "Inbound-Moonflag", investimento: 2616.09, impressoes: 64697, cliques: 757, leads: 93, qualificados: 93, reunioes: 12, contratos: 5 },
  { period: "2026-07", campaign: "Outbound-Speddio", investimento: 0, impressoes: 0, cliques: 0, leads: 0, qualificados: 0, reunioes: 0, contratos: 0 },
  { period: "2026-07", campaign: "Indicação", investimento: 0, impressoes: 0, cliques: 0, leads: 0, qualificados: 0, reunioes: 4, contratos: 3 },
  { period: "2026-07", campaign: "Parceiros", investimento: 0, impressoes: 0, cliques: 0, leads: 0, qualificados: 0, reunioes: 0, contratos: 0 },
  { period: "2026-07", campaign: "Site", investimento: 0, impressoes: 0, cliques: 0, leads: 0, qualificados: 0, reunioes: 4, contratos: 1 },
  { period: "2026-08", campaign: "Inbound-Moonflag", investimento: 2391.55, impressoes: 52451, cliques: 757, leads: 73, qualificados: 73, reunioes: 0, contratos: 0 },
  { period: "2026-08", campaign: "Outbound-Speddio", investimento: 0, impressoes: 0, cliques: 0, leads: 0, qualificados: 0, reunioes: 0, contratos: 0 },
  { period: "2026-08", campaign: "Indicação", investimento: 0, impressoes: 0, cliques: 0, leads: 0, qualificados: 0, reunioes: 4, contratos: 3 },
  { period: "2026-08", campaign: "Parceiros", investimento: 0, impressoes: 0, cliques: 0, leads: 0, qualificados: 0, reunioes: 0, contratos: 0 },
  { period: "2026-08", campaign: "Site", investimento: 0, impressoes: 0, cliques: 0, leads: 0, qualificados: 0, reunioes: 4, contratos: 1 },
];

