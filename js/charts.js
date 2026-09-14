// Gráficos com Chart.js (via CDN) — equivalentes aos gráficos Recharts da
// versão anterior: pizza por etapa, barras por vendedor, rosca de reuniões.

const CHART_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777"];
const chartInstances = {};

function destroyIfExists(canvasId) {
  if (chartInstances[canvasId]) {
    chartInstances[canvasId].destroy();
    delete chartInstances[canvasId];
  }
}

/**
 * Preenche uma lista de legenda em HTML (bolinha colorida + nome + valor),
 * usada quando `legendId` é informado — visual do mockup BSconta+, com o
 * gráfico "puro" (sem legenda nativa do Chart.js) e a lista ao lado.
 */
function renderHtmlLegend(legendId, rows) {
  if (!legendId) return;
  const el = document.getElementById(legendId);
  if (!el) return;
  const total = rows.reduce((a, r) => a + r.value, 0);
  el.innerHTML = rows
    .map(
      (r) => `
        <div class="chart-legend-row">
          <span class="chart-legend-dot" style="background:${r.color}"></span>
          <span class="chart-legend-label">${esc(r.name)}</span>
          <span class="chart-legend-value">${r.value}${total > 0 ? ` (${Math.round((r.value / total) * 100)}%)` : ""}</span>
        </div>`
    )
    .join("");
}

function renderCallsTypeDonut(canvasId, { vendas, agendamento }, legendId, centerId) {
  const raw = [
    { name: "Ligações de vendas", value: vendas, color: "#2563eb" },
    { name: "Ligações de agendamento", value: agendamento, color: "#16a34a" },
  ].filter((d) => d.value > 0);
  const total = vendas + agendamento;

  const wrap = document.getElementById(canvasId).parentElement;
  destroyIfExists(canvasId);
  const centerEl = centerId ? document.getElementById(centerId) : null;

  if (raw.length === 0) {
    wrap.querySelector("canvas").style.display = "none";
    let empty = wrap.querySelector(".chart-empty");
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "chart-empty text-xs";
      wrap.appendChild(empty);
    }
    empty.textContent = "Sem ligações no período.";
    if (legendId && document.getElementById(legendId)) document.getElementById(legendId).innerHTML = "";
    if (centerEl) centerEl.innerHTML = "";
    return;
  }
  wrap.querySelector("canvas").style.display = "";
  const existingEmpty = wrap.querySelector(".chart-empty");
  if (existingEmpty) existingEmpty.remove();

  const ctx = document.getElementById(canvasId).getContext("2d");
  chartInstances[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: raw.map((d) => `${d.name}: ${d.value}`),
      datasets: [{ data: raw.map((d) => d.value), backgroundColor: raw.map((d) => d.color), borderWidth: 0 }],
    },
    options: {
      responsive: true,
      cutout: "72%",
      plugins: { legend: { display: false } },
    },
  });

  if (legendId) renderHtmlLegend(legendId, raw);
  if (centerEl) {
    centerEl.innerHTML = `<span class="num">${total}</span><span class="lbl">Total de ligações</span>`;
  }
}

/**
 * Barras agrupadas (vendas x agendamento) por período fixo — usado na
 * "Evolução de ligações" da página Ligações. `rows` é uma lista de
 * { label, vendas, agendamento } (uma por período). Mostra o valor de cada
 * barra no topo via chartjs-plugin-datalabels, quando disponível (script
 * carregado só nesta página; se ausente, o gráfico funciona normalmente,
 * apenas sem os rótulos numéricos).
 */
function renderCallsEvolutionChart(canvasId, rows) {
  const wrap = document.getElementById(canvasId).parentElement;
  destroyIfExists(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const hasDatalabels = typeof ChartDataLabels !== "undefined";
  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    plugins: hasDatalabels ? [ChartDataLabels] : [],
    data: {
      labels: rows.map((r) => r.label),
      datasets: [
        { label: "Ligações de vendas", data: rows.map((r) => r.vendas), backgroundColor: "#2563eb", borderRadius: 5, maxBarThickness: 34 },
        { label: "Ligações de agendamento", data: rows.map((r) => r.agendamento), backgroundColor: "#16a34a", borderRadius: 5, maxBarThickness: 34 },
      ],
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grace: "12%" }, x: { grid: { display: false } } },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 10, usePointStyle: true, font: { size: 12 } } },
        datalabels: hasDatalabels
          ? { anchor: "end", align: "top", offset: 2, font: { size: 11.5, weight: "700" }, color: "#475569", formatter: (v) => (v > 0 ? v : "") }
          : { display: false },
      },
    },
  });
}

/**
 * Linha com área preenchida (uma série só), usada nos cartões de tendência
 * da página "Reuniões" — mostra a distribuição por dia da semana (domingo a
 * sábado) das reuniões dentro do período selecionado, ao lado do KPI.
 */
const DOW_LABELS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

function renderTrendLineChart(canvasId, values, color) {
  destroyIfExists(canvasId);
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 160);
  gradient.addColorStop(0, `${color}3d`);
  gradient.addColorStop(1, `${color}00`);
  chartInstances[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: DOW_LABELS,
      datasets: [
        {
          data: values,
          borderColor: color,
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 4,
          pointBackgroundColor: color,
          pointBorderColor: "#fff",
          pointBorderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { display: false, beginAtZero: true, grace: "25%" },
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 11.5, weight: "600" }, color: "#94a3b8" } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderMeetingStatusDonut(canvasId, { done, canceled, noShow, scheduled }, legendId) {
  // Mesmas cores dos outros gráficos: verde para o que deu certo, rosa para o
  // que se perdeu, âmbar para o que falhou por falta de comparecimento, índigo
  // para o que ainda está por vir.
  const raw = [
    { name: "Realizadas", value: done, color: "#059669" },
    { name: "Não compareceu", value: noShow, color: "#f59e0b" },
    { name: "Canceladas", value: canceled, color: "#e11d48" },
    { name: "Agendadas (futuras)", value: scheduled, color: "#4f46e5" },
  ].filter((d) => d.value > 0);

  if (raw.length === 0) {
    if (legendId && document.getElementById(legendId)) document.getElementById(legendId).innerHTML = "";
    return mensagemVazia(canvasId, "Sem reuniões no período.");
  }
  if (!limparVazio(canvasId)) return;
  destroyIfExists(canvasId);

  const total = raw.reduce((a, d) => a + d.value, 0);
  const ctx = document.getElementById(canvasId).getContext("2d");
  chartInstances[canvasId] = new Chart(ctx, {
    type: "doughnut",
    // O total no meio do buraco: é o número que se procura primeiro, e sem ele
    // a rosquinha obriga a somar a legenda de cabeça.
    plugins: [totalNoCentro(total, "reuniões")],
    data: {
      labels: raw.map((d) => d.name),
      datasets: [
        {
          data: raw.map((d) => d.value),
          backgroundColor: raw.map((d) => d.color),
          borderWidth: 0,
          // Fatia levemente separada da vizinha: sem isso, duas cores próximas
          // viram um borrão só na beirada.
          spacing: 2,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: {
        legend: legendId ? { display: false } : { position: "bottom", labels: { boxWidth: 8, usePointStyle: true, pointStyle: "circle", padding: 14, font: { size: 12 }, color: "#475569" } },
        datalabels: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: "rgba(15,23,42,0.92)",
          padding: { x: 10, y: 8 },
          cornerRadius: 8,
          titleFont: { size: 12, weight: "600" },
          bodyFont: { size: 12 },
          bodyColor: "#cbd5e1",
          caretSize: 5,
          callbacks: {
            label: (c) => `${c.parsed.toLocaleString("pt-BR")} de ${total} (${Math.round((c.parsed / total) * 100)}%)`,
          },
        },
      },
    },
  });

  if (legendId) renderHtmlLegend(legendId, raw);
}

/**
 * Escreve o total no vazio do meio da rosquinha. Plugin local e não um texto
 * em HTML por cima porque assim o número acompanha o tamanho real do desenho,
 * sem depender de posicionamento absoluto que desalinha quando o cartão muda
 * de largura.
 */
const totalNoCentro = (total, legenda) => ({
  id: "totalNoCentro",
  afterDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const arco = meta && meta.data && meta.data[0];
    if (!arco) return;
    const { ctx } = chart;
    const { x, y } = arco;
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 22px Inter, system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(total.toLocaleString("pt-BR"), x, y + 2);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 10.5px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(legenda, x, y + 8);
    ctx.restore();
  },
});

/**
 * Evolução da satisfação da carteira, mês a mês (barras empilhadas).
 *
 * Os dados vêm de evolucaoSatisfacao() (js/clientes.js), que reconstrói a foto
 * de cada mês a partir das mudanças de situação gravadas na linha do tempo —
 * ninguém precisa anotar nada além de trocar a cor do cliente quando muda.
 */
function renderSatisfacaoEvolucaoChart(canvasId, linhas) {
  destroyIfExists(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  const series = [
    { chave: "GREEN", nome: "Satisfeito", cor: "#10b981" },
    { chave: "BLUE", nome: "Oportunidade", cor: "#6366f1" },
    { chave: "YELLOW", nome: "Atenção", cor: "#f59e0b" },
    { chave: "RED", nome: "Com problema", cor: "#ef4444" },
  ];
  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: linhas.map((l) => l.mes),
      datasets: series.map((s) => ({
        label: s.nome,
        data: linhas.map((l) => l[s.chave]),
        backgroundColor: s.cor,
        borderRadius: 4,
        maxBarThickness: 36,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grace: "10%" },
      },
      plugins: {
        legend: { position: "top", align: "end", labels: { boxWidth: 10, usePointStyle: true, font: { size: 11.5 } } },
        datalabels: { display: false },
      },
    },
  });
}

/** Rosca da carteira por situação — a foto de agora, ao lado da evolução. */
function renderCarteiraDonut(canvasId, porSituacao, legendId, centerId) {
  destroyIfExists(canvasId);
  const linhas = HEALTH_ORDEM.map((k) => ({ name: HEALTH[k].curto, value: porSituacao[k] || 0, color: HEALTH[k].cor })).filter(
    (l) => l.value > 0
  );
  const total = linhas.reduce((a, l) => a + l.value, 0);
  if (centerId) {
    const el = document.getElementById(centerId);
    if (el) el.innerHTML = `<strong>${total}</strong><span>cliente${total === 1 ? "" : "s"}</span>`;
  }
  renderHtmlLegend(legendId, linhas);
  const ctx = document.getElementById(canvasId).getContext("2d");
  chartInstances[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: linhas.map((l) => l.name),
      datasets: [{ data: linhas.map((l) => l.value), backgroundColor: linhas.map((l) => l.color), borderWidth: 0, cutout: "68%" }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: { display: false } },
    },
  });
}

// ---------------------------------------------------------------------------
// GRÁFICOS ACRESCENTADOS EM 14/09/2026
//
// Levantamento feito antes de escrever qualquer coisa: das 9 telas do sistema,
// só Visão geral, Ligações e Reuniões tinham gráfico. Funil, Vendas, Ranking e
// Relatórios nunca tiveram nenhum — e são justamente as telas que a diretoria
// abre primeiro. Não era defeito: era ausência.
//
// Três decisões que valem registrar, porque não são gosto pessoal:
//
// 1. TODOS SÃO DE UMA SÉRIE SÓ. Um gráfico responde uma pergunta. Misturar
//    ligações, reuniões e faturamento no mesmo desenho exigiria dois eixos de
//    escalas diferentes — o erro mais comum em painel comercial, porque deixa
//    comparar visualmente coisas que não são comparáveis.
//
// 2. SÓ DUAS CORES NO SISTEMA INTEIRO: índigo para contagem, verde para
//    dinheiro. As duas foram conferidas por medição (não no olho) contra o
//    fundo das telas e entre si, inclusive para os tipos mais comuns de
//    daltonismo. Como cada gráfico tem uma série só, a cor nunca precisa
//    distinguir nada — quem distingue é o rótulo.
//
// 3. O VALOR VAI ESCRITO EM CIMA DA BARRA. Gráfico sem número obriga a
//    estimar pelo tamanho. Quem quiser o número exato não deveria precisar
//    passar o mouse.
// ---------------------------------------------------------------------------

const COR_CONTAGEM = "#4f46e5"; // índigo — quantidades
const COR_DINHEIRO = "#059669"; // verde  — valores em reais
const COR_ENTRADA = "#4f46e5";     // índigo — leads que chegaram
const COR_PERDA = "#e11d48";       // rosa   — leads perdidos

/**
 * Escreve o valor na ponta de cada barra. É um plugin local de propósito: a
 * alternativa seria mais uma biblioteca vinda da internet em cada página, e
 * isso é rede e espera a troco de um texto simples.
 */
const rotulosNaPonta = (formatar, horizontal) => ({
  id: "rotulosNaPonta",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#1e293b";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((ds, i) => {
      // Série desligada na legenda não desenha rótulo. Sem esta linha, o
      // número continuava na tela na última posição que a barra teve — e,
      // como a barra some, ele aparecia solto no meio do gráfico, encostado
      // na barra da OUTRA série. Era esse o número perdido no meio da barra.
      if (!chart.isDatasetVisible(i)) return;
      chart.getDatasetMeta(i).data.forEach((barra, j) => {
        if (barra.hidden || barra.skip) return;
        const valor = ds.data[j];
        if (!valor) return; // zero não precisa de rótulo: a barra já não existe
        const texto = formatar(valor);
        if (horizontal) {
          ctx.textAlign = "left";
          ctx.fillText(texto, barra.x + 12, barra.y);
        } else {
          ctx.textAlign = "center";
          ctx.fillText(texto, barra.x, barra.y - 9);
        }
      });
    });
    ctx.restore();
  },
});

/**
 * Trilho cinza atrás de cada barra horizontal. Serve de régua: a barra passa a
 * significar "quanto do máximo", e não só um comprimento solto. Também é o que
 * deixa a barra fina bonita — sem o trilho, ela parece um fiapo perdido no
 * branco.
 */
const trilhoDasBarras = {
  id: "trilhoDasBarras",
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data.length) return;

    ctx.save();
    ctx.fillStyle = "rgba(15,23,42,0.055)";
    for (const barra of meta.data) {
      const altura = barra.height || 10;
      const raio = altura / 2;
      const x = chartArea.left;
      const y = barra.y - altura / 2;
      const largura = Math.max(chartArea.right - chartArea.left, altura);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, largura, altura, raio);
      } else {
        // Navegador antigo sem roundRect: desenha a pílula na mão.
        ctx.moveTo(x + raio, y);
        ctx.lineTo(x + largura - raio, y);
        ctx.arc(x + largura - raio, y + raio, raio, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(x + raio, y + altura);
        ctx.arc(x + raio, y + raio, raio, Math.PI / 2, -Math.PI / 2);
      }
      ctx.fill();
    }
    ctx.restore();
  },
};

/**
 * Valor escrito DEPOIS do trilho, numa coluna alinhada. Alinhado e não colado
 * na ponta da barra porque assim os números ficam um embaixo do outro e dá
 * para comparar lendo em linha reta — e nenhum rótulo cai em cima do trilho.
 */
const rotulosAlinhados = (formatar) => ({
  id: "rotulosAlinhados",
  afterDatasetsDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    ctx.save();
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#1e293b";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const ds = chart.data.datasets[0];
    chart.getDatasetMeta(0).data.forEach((barra, j) => {
      const valor = ds.data[j];
      // Zero TAMBÉM ganha rótulo: "0" é informação. Só fica sem rótulo o que
      // não tem dado nenhum (null) — trilho vazio sem número não deixa claro
      // se é zero ou se o número não chegou.
      if (valor === null || valor === undefined) return;
      ctx.fillText(formatar(valor), chartArea.right + 10, barra.y);
    });
    ctx.restore();
  },
});

const EIXO_DISCRETO = {
  grid: { color: "rgba(15,23,42,0.05)", drawTicks: false },
  border: { display: false },
  ticks: { font: { size: 11.5 }, color: "#6b6d85", padding: 6 },
};

function mensagemVazia(canvasId, texto) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return true;
  const wrap = canvas.parentElement;
  destroyIfExists(canvasId);
  canvas.style.display = "none";
  let vazio = wrap.querySelector(".chart-empty");
  if (!vazio) {
    vazio = document.createElement("p");
    vazio.className = "chart-empty text-xs";
    wrap.appendChild(vazio);
  }
  vazio.textContent = texto;
  return true;
}

function limparVazio(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return false;
  canvas.style.display = "";
  const vazio = canvas.parentElement.querySelector(".chart-empty");
  if (vazio) vazio.remove();
  return true;
}

/**
 * FUNIL — barras horizontais, uma por etapa, na ordem do funil.
 *
 * Horizontal e não vertical por um motivo prático: os nomes das etapas são
 * longos ("Reagendamento Comercial", "Provável Fechamento") e em barras
 * verticais eles sairiam inclinados ou cortados.
 */
function renderFunilBarras(canvasId, linhas) {
  const dados = (linhas || []).filter((l) => l.count > 0);
  if (dados.length === 0) return mensagemVazia(canvasId, "Nenhuma oportunidade no funil ainda.");
  if (!limparVazio(canvasId)) return;
  destroyIfExists(canvasId);

  const ctx = document.getElementById(canvasId).getContext("2d");
  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    plugins: [rotulosNaPonta((v) => v.toLocaleString("pt-BR"), true)],
    data: {
      labels: dados.map((l) => l.stage),
      datasets: [
        {
          data: dados.map((l) => l.count),
          backgroundColor: COR_CONTAGEM,
          borderRadius: { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 },
          borderSkipped: false,
          maxBarThickness: 22,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 42 } }, // espaço para o número na ponta
      scales: {
        x: { display: false, beginAtZero: true, grace: "14%" },
        y: { ...EIXO_DISCRETO, grid: { display: false } },
      },
      plugins: {
        legend: { display: false }, // uma série só: o título já diz o que é
        datalabels: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const l = dados[c.dataIndex];
              return `${l.count} oportunidade${l.count === 1 ? "" : "s"} · ${brl(l.value)}`;
            },
          },
        },
      },
    },
  });
}

/**
 * BARRAS HORIZONTAIS POR PESSOA — usado em "Vendas por vendedor" e no Ranking.
 *
 * Uma medida por gráfico: misturar ligações, reuniões e faturamento no mesmo
 * desenho exigiria escalas diferentes no mesmo eixo, e aí a comparação visual
 * mente.
 *
 * DESENHO: barra fina em formato de pílula, sobre um trilho cinza que vai de
 * ponta a ponta. O trilho é o que dá a leitura rápida: sem ele, uma barra
 * curta não diz se é pouco em relação a quê. Com ele, a barra é literalmente
 * "quanto do máximo" — e barra fina fica elegante em vez de pesada.
 */
function renderBarrasPorPessoa(canvasId, linhas, opts = {}) {
  const { dinheiro = false, vazio = "Sem dados no período." } = opts;
  const dados = (linhas || []).filter((l) => l.valor > 0).sort((a, b) => b.valor - a.valor);
  if (dados.length === 0) return mensagemVazia(canvasId, vazio);
  if (!limparVazio(canvasId)) return;
  destroyIfExists(canvasId);

  const formatar = dinheiro ? (v) => brl(v) : (v) => v.toLocaleString("pt-BR");
  const base = dinheiro ? COR_DINHEIRO : COR_CONTAGEM;
  const claro = dinheiro ? "#34d399" : "#818cf8"; // ponta mais clara do degradê
  const ctx = document.getElementById(canvasId).getContext("2d");

  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    plugins: [trilhoDasBarras, rotulosAlinhados(formatar)],
    data: {
      labels: dados.map((l) => l.nome),
      datasets: [
        {
          data: dados.map((l) => l.valor),
          // Degradê da esquerda para a direita: a barra "acende" conforme
          // cresce. Função e não cor fixa porque a largura da área só existe
          // depois do primeiro desenho.
          backgroundColor: (c) => {
            const area = c.chart.chartArea;
            if (!area) return base;
            const g = c.chart.ctx.createLinearGradient(area.left, 0, area.right, 0);
            g.addColorStop(0, base);
            g.addColorStop(1, claro);
            return g;
          },
          hoverBackgroundColor: claro,
          borderRadius: 999, // pílula
          borderSkipped: false,
          barThickness: 10,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: "easeOutQuart" },
      layout: { padding: { right: dinheiro ? 90 : 46, top: 2, bottom: 2 } },
      scales: {
        // Sem folga no eixo: quem está em primeiro enche o trilho, e cada
        // barra passa a ser "quanto do líder". A leitura fica imediata.
        x: { display: false, beginAtZero: true },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 12, weight: "500" }, color: "#475569", padding: 10 },
        },
      },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: "rgba(15,23,42,0.92)",
          padding: { x: 10, y: 8 },
          cornerRadius: 8,
          titleFont: { size: 12, weight: "600" },
          bodyFont: { size: 12 },
          bodyColor: "#cbd5e1",
          caretSize: 5,
          callbacks: {
            label: (c) => {
              const l = dados[c.dataIndex];
              return l.detalhe ? `${formatar(l.valor)} · ${l.detalhe}` : formatar(l.valor);
            },
          },
        },
      },
    },
  });
}

/**
 * LEADS DO PERÍODO — chegaram x perdidos, duas barras.
 *
 * Duas barras e não uma rosquinha: rosquinha é para partes de um todo, e estes
 * dois não formam um todo — um lead perdido no período pode ter chegado meses
 * antes. Lado a lado, a leitura é a que interessa: a entrada está dando conta
 * da perda?
 */
function renderLeadsChegaramPerdidos(canvasId, { chegaram, perdidos }) {
  // Período sem lead continua desenhando as duas pistas com 0, em vez de
  // trocar o gráfico por uma frase: assim o cartão mantém a forma e a tela
  // não muda de layout quando o número aparece.
  if (!limparVazio(canvasId)) return;
  destroyIfExists(canvasId);

  const ctx = document.getElementById(canvasId).getContext("2d");
  chartInstances[canvasId] = new Chart(ctx, {
    type: "bar",
    plugins: [trilhoDasBarras, rotulosAlinhados((v) => v.toLocaleString("pt-BR"))],
    data: {
      labels: ["Chegaram", "Perdidos"],
      datasets: [
        {
          data: [Number(chegaram) || 0, Number(perdidos) || 0],
          backgroundColor: (c) => (c.raw ? [COR_ENTRADA, COR_PERDA][c.dataIndex] : "transparent"),
          borderRadius: 999,
          borderSkipped: false,
          barThickness: 14,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: "easeOutQuart" },
      layout: { padding: { right: 52, top: 2, bottom: 2 } },
      scales: {
        // Sem folga no eixo: a barra maior enche o trilho, e a menor vira
        // "quanto daquela" na hora — que é a comparação que o cartão existe
        // para fazer.
        // `suggestedMax` só age quando os dois são 0: sem ele o eixo fica sem
        // escala, e sem escala o trilho não é desenhado — sobrariam os
        // rótulos soltos no branco.
        x: { display: false, beginAtZero: true, suggestedMax: chegaram || perdidos ? undefined : 1 },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 12, weight: "500" }, color: "#475569", padding: 12 },
        },
      },
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          displayColors: false,
          backgroundColor: "rgba(15,23,42,0.92)",
          padding: { x: 10, y: 8 },
          cornerRadius: 8,
          titleFont: { size: 12, weight: "600" },
          bodyFont: { size: 12 },
          bodyColor: "#cbd5e1",
          caretSize: 5,
          callbacks: {
            title: (i) => (i[0].label === "Chegaram" ? "Leads que chegaram" : "Leads perdidos"),
            label: (c) => `${c.parsed.x.toLocaleString("pt-BR")} no período`,
          },
        },
      },
    },
  });
}
