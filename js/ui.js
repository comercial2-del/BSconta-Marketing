// Componentes de interface compartilhados: barra lateral, cartões de KPI,
// filtro de período, tabelas simples. Sem framework — DOM puro.

const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  funnel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16l-6 8v6l-4 2v-8z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
  meeting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8M15 7h6v6"/></svg>',
  ranking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21V10M16 21V3M12 21v-6"/></svg>',
  goal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h1"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  handshake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12 3 7l3.5-3.5L11 8h3l2.5-2.5L20 9l-5 5"/><path d="M8 12l3 3 2-2M13 15l2 2 3-3"/></svg>',
  userCheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11l2 2 4-4"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 5-5"/></svg>',
  dollarSign: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5.5c-.8-1-2.5-1.8-5-1.8-3 0-5 1.5-5 3.8s2 3.2 5 3.8c3 .6 5 1.7 5 3.9 0 2.3-2 3.8-5 3.8-2.5 0-4.2-.8-5-1.8"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
  userPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M7.5 10V7a4.5 4.5 0 0 1 9 0v3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a17.5 17.5 0 0 1-2.94 3.9M6.1 6.1A17.5 17.5 0 0 0 2 11s3.5 7 10 7a10.9 10.9 0 0 0 4.24-.85M9.9 9.9a3 3 0 1 0 4.2 4.2"/><path d="M2 2l20 20"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 3.5V11c0 5-3.4 8.5-8 9.5-4.6-1-8-4.5-8-9.5V5.5z"/><path d="M8.5 12l2.5 2.5L15.5 9.5"/></svg>',
  phoneOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/><path d="M17.5 2l5 5M22.5 2l-5 5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
  xCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 8v.01"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
};

// `curto` é o nome usado na barra de baixo do celular, onde cada item tem
// pouco mais de 70 px: "Visão geral" não caberia sem cortar no meio.
const NAV_ITEMS = [
  { href: "dashboard.html", label: "Visão geral", curto: "Geral", icon: ICONS.overview },
  { href: "marketing.html", label: "Marketing", curto: "Marketing", icon: ICONS.overview },
  { href: "sdr.html", label: "SDR", curto: "SDR", icon: ICONS.userCheck },
  { href: "leads.html", label: "Leads", curto: "Leads", icon: ICONS.userPlus },
  { href: "graficos.html", label: "Gráficos", curto: "Gráficos", icon: ICONS.ranking, navClass: "nav-subitem" },
  { href: "ligacoes.html", label: "Ligações", curto: "Ligações", icon: ICONS.phone },
  { href: "reunioes.html", label: "Reuniões", curto: "Reuniões", icon: ICONS.meeting },
  { href: "vendas.html", label: "Vendas", curto: "Vendas", icon: ICONS.sales },
  { href: "metas.html", label: "Metas", curto: "Metas", icon: ICONS.goal },
  { href: "onboarding.html", label: "Onboarding", curto: "Onboard.", icon: ICONS.handshake },
];

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function renderShell(profile) {
  const current = window.location.pathname.split("/").pop();
  const navHtml = NAV_ITEMS.map(
    (item) => `<a href="${item.href}" class="${item.href === current ? "active" : ""}">${item.icon}<span>${item.label}</span></a>`
  ).join("");

  // A MESMA navegação, em formato de barra inferior para o celular. Sem isto
  // o menu lateral simplesmente sumia abaixo de 860 px e não havia como sair
  // da tela em que se estava — no celular o sistema virava uma página só.
  const navCelularHtml = NAV_ITEMS.map(
    (item) =>
      `<a href="${item.href}" class="${item.href === current ? "active" : ""}"${item.href === current ? ' aria-current="page"' : ""}>` +
      `${item.icon}<span>${item.curto}</span></a>`
  ).join("");

  const roleBadge = profile.role === "ADMIN"
    ? `<span class="badge badge-admin">Administrador</span>`
    : `<span class="badge badge-viewer">Visualizador</span>`;

  document.getElementById("app-header").innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-row">
          <img class="logo-mark" src="../assets/bsconta-logo.jpg" alt="BSconta+" />
          <div>
            <h1>BSconta<sup>+</sup></h1>
            <p>Contabilidade Digital</p>
          </div>
        </div>
      </div>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-foot">
        <div class="sidebar-user">
          <div class="avatar">${initials(profile.name)}</div>
          <div>
            <p class="sidebar-user-name">${esc(profile.name || "")}</p>
            <p class="sidebar-user-role">${profile.role === "ADMIN" ? "Administrador" : "Visualizador"}</p>
          </div>
          <span class="chevron">${ICONS.chevronDown}</span>
        </div>
        <div class="sidebar-promo">
          <div class="brand-row">
            <img class="logo-mark" src="../assets/bsconta-logo.jpg" alt="BSconta+" />
            <strong>BSconta<sup>+</sup></strong>
          </div>
          <p>Transformando números em resultados.</p>
          <span class="promo-icon">${ICONS.sales}</span>
        </div>
        <button class="btn-logout" id="btn-logout">${ICONS.logout} Sair</button>
      </div>
    </aside>
    <div class="mobile-topbar">
      <div class="brand-row">
        <img class="logo-mark" style="width:28px;height:28px" src="../assets/bsconta-logo.jpg" alt="BSconta+" />
        <strong style="font-size:0.85rem">BSconta+ — SGCMP</strong>
      </div>
      <div style="display:flex;align-items:center;gap:0.5rem">
        ${roleBadge}
        <button class="btn-logout" id="btn-logout-mobile" style="width:auto">Sair</button>
      </div>
    </div>
    <nav class="mobile-nav" aria-label="Navegação principal">${navCelularHtml}</nav>
  `;
  document.getElementById("btn-logout").addEventListener("click", logout);
  document.getElementById("btn-logout-mobile")?.addEventListener("click", logout);
}

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "this_week", label: "Esta semana" },
  { value: "last_week", label: "Semana passada" },
  { value: "this_month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
];

/**
 * Renderiza o filtro de período + vendedor dentro de `container` (elemento
 * DOM). Ao mudar, atualiza a URL (?period=&sellerId=) e chama onChange().
 */
function renderPeriodFilter(container, sellers, onChange, opts = {}) {
  const params = new URLSearchParams(window.location.search);
  const period = params.get("period") || opts.defaultPeriod || "this_week";
  // sellerId: se o parâmetro não existe na URL (primeira carga da página),
  // usa opts.defaultSellerId (quando informado). Se existe mas está vazio
  // (usuário escolheu "Todos os vendedores" explicitamente), respeita isso
  // e NÃO volta a aplicar o default — por isso o "!== null" abaixo.
  const sellerParam = params.get("sellerId");
  const sellerId = sellerParam !== null ? sellerParam : (opts.defaultSellerId || "");

  const periodOptions = opts.periods || PERIODS;
  const buttonsHtml = periodOptions.map(
    (p) => `<button type="button" data-period="${p.value}" class="${p.value === period ? "active" : ""}">${p.label}</button>`
  ).join("");

  // Quando o período veio do calendário (period=custom), mostra um chip com o
  // intervalo escolhido ao lado dos botões fixos — clicar reabre o calendário.
  const customRange = period === "custom" ? customRangeFromUrl() : null;
  const customChipHtml = customRange
    ? `<button type="button" class="active cal-chip" data-open-calendar title="Alterar período no calendário">${ICONS.meeting}<span>${rangeLabel(customRange)}</span></button>`
    : `<button type="button" class="cal-open" data-open-calendar title="Selecionar um intervalo de datas">${ICONS.meeting}<span>Personalizado</span></button>`;

  const sellerOptionsHtml = sellers
    .map((s) => `<option value="${s.id}" ${s.id === sellerId ? "selected" : ""}>${s.name}</option>`)
    .join("");

  const showSellerFilter = opts.showSellerFilter !== false;

  container.innerHTML = `
    <div class="period-filter">
      <div class="period-buttons">${buttonsHtml}${customChipHtml}</div>
      ${showSellerFilter ? `<select id="seller-filter"><option value="" ${sellerId === "" ? "selected" : ""}>Todos os vendedores</option>${sellerOptionsHtml}</select>` : ""}
    </div>
  `;

  container.querySelectorAll("button[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = new URLSearchParams(window.location.search);
      p.set("period", btn.dataset.period);
      // Sai de um período do calendário ao voltar para um botão fixo.
      p.delete("start");
      p.delete("end");
      window.history.replaceState(null, "", `?${p.toString()}`);
      onChange();
    });
  });

  const sellerSelect = container.querySelector("#seller-filter");
  if (sellerSelect) {
    sellerSelect.addEventListener("change", () => {
      const p = new URLSearchParams(window.location.search);
      // Sempre grava o parâmetro (mesmo vazio), para diferenciar "usuário
      // escolheu Todos os vendedores" de "página recém-aberta, sem escolha".
      p.set("sellerId", sellerSelect.value);
      window.history.replaceState(null, "", `?${p.toString()}`);
      onChange();
    });
  }

  return { period, sellerId: sellerId || undefined };
}

// ---------------------------------------------------------------------------
// Calendário: escolher um dia ou uma semana inteira e filtrar o sistema
//
// O botão de calendário do cabeçalho (aria-label="Calendário") abre este
// seletor. Escolher um dia/semana grava ?period=custom&start=&end= na URL e
// chama o render() da página — a tela atualiza na hora, sem recarregar.
// resolvePeriod("custom") lê esse intervalo da URL (ver calc.js).
// ---------------------------------------------------------------------------
const CAL_MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const CAL_WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"]; // semana começa na segunda

function isoDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function shortDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Rótulo do intervalo escolhido, com ano para não gerar ambiguidade. */
function rangeLabel(range) {
  const fmt = (d) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  return sameDay(range.start, range.end) ? fmt(range.start) : `${fmt(range.start)} – ${fmt(range.end)}`;
}

const calState = { viewMonth: null, mode: "week", onChange: null, anchor: null };

function calPopoverEl() {
  let el = document.getElementById("calendar-popover");
  if (!el) {
    el = document.createElement("div");
    el.id = "calendar-popover";
    el.className = "cal-pop";
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => e.stopPropagation());
  }
  return el;
}

function closeCalendar() {
  const el = document.getElementById("calendar-popover");
  if (el) el.hidden = true;
}

function renderCalendar() {
  const el = calPopoverEl();
  const selected = customRangeFromUrl();
  const today = new Date();
  const view = calState.viewMonth || (selected ? new Date(selected.start) : today);
  calState.viewMonth = view;

  const gridStart = startOfWeek(startOfMonth(view));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      days.push(new Date(gridStart.getTime() + (w * 7 + d) * 86400000));
    }
    weeks.push(days);
  }

  const inSelection = (d) => selected && d >= startOfDay(selected.start) && d <= endOfDay(selected.end);

  const weeksHtml = weeks
    .map((days) => {
      const cells = days
        .map((d) => {
          const classes = [
            "cal-day",
            d.getMonth() === view.getMonth() ? "" : "muted",
            sameDay(d, today) ? "today" : "",
            inSelection(d) ? "selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `<button type="button" class="${classes}" data-date="${isoDate(d)}">${d.getDate()}</button>`;
        })
        .join("");
      return `<div class="cal-week" data-week="${isoDate(days[0])}">${cells}</div>`;
    })
    .join("");

  const customStart = selected ? isoDate(selected.start) : "";
  const customEnd = selected ? isoDate(selected.end) : "";
  const customHtml = calState.mode === "custom" ? `
    <div class="cal-custom-form">
      <label>Data inicial<input id="cal-start" type="date" value="${customStart}" /></label>
      <label>Data final<input id="cal-end" type="date" value="${customEnd}" /></label>
      <button type="button" class="cal-apply" data-apply-custom>Aplicar período</button>
      <p class="cal-custom-hint" data-custom-hint>Selecione uma data inicial e uma data final.</p>
    </div>` : "";

  el.innerHTML = `
    <div class="cal-head">
      ${calState.mode === "custom" ? `<span class="cal-title">Período personalizado</span>` : `<button type="button" class="cal-nav" data-nav="-1" aria-label="Mês anterior">${ICONS.chevronLeft}</button><span class="cal-title">${CAL_MONTHS[view.getMonth()]} ${view.getFullYear()}</span><button type="button" class="cal-nav" data-nav="1" aria-label="Próximo mês">${ICONS.chevronRight}</button>`}
    </div>
    <div class="cal-modes">
      <button type="button" class="${calState.mode === "day" ? "active" : ""}" data-mode="day">Dia</button>
      <button type="button" class="${calState.mode === "week" ? "active" : ""}" data-mode="week">Semana</button>
      <button type="button" class="${calState.mode === "custom" ? "active" : ""}" data-mode="custom">Personalizado</button>
    </div>
    ${calState.mode === "custom" ? `${customHtml}<div class="cal-foot"><span class="cal-hint">O período será aplicado em todas as métricas da tela.</span><button type="button" class="cal-clear" data-clear>Limpar</button></div>` : `
      <div class="cal-grid ${calState.mode === "week" ? "mode-week" : "mode-day"}">
        <div class="cal-week cal-dow">${CAL_WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
        ${weeksHtml}
      </div>
      <div class="cal-foot">
        <span class="cal-hint">${calState.mode === "week" ? "Clique para filtrar a semana inteira" : "Clique para filtrar o dia"}</span>
        <button type="button" class="cal-clear" data-clear>Limpar</button>
      </div>`}
  `;

  el.querySelectorAll("[data-nav]").forEach((b) =>
    b.addEventListener("click", () => {
      calState.viewMonth = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.nav), 1);
      renderCalendar();
    })
  );
  el.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      calState.mode = b.dataset.mode;
      renderCalendar();
    })
  );
  el.querySelectorAll("[data-date]").forEach((b) =>
    b.addEventListener("click", () => {
      const d = new Date(`${b.dataset.date}T00:00:00`);
      if (calState.mode === "week") applyCalendarRange(startOfWeek(d), endOfWeek(d));
      else if (calState.mode === "day") applyCalendarRange(startOfDay(d), endOfDay(d));
    })
  );
  el.querySelector("[data-apply-custom]")?.addEventListener("click", () => {
    const start = el.querySelector("#cal-start")?.value;
    const end = el.querySelector("#cal-end")?.value;
    const hint = el.querySelector("[data-custom-hint]");
    if (!start || !end) {
      if (hint) hint.textContent = "Informe a data inicial e a data final.";
      return;
    }
    if (end < start) {
      if (hint) hint.textContent = "A data final deve ser igual ou posterior à data inicial.";
      return;
    }
    applyCalendarRange(new Date(`${start}T00:00:00`), new Date(`${end}T23:59:59.999`));
  });
  el.querySelector("[data-clear]")?.addEventListener("click", () => {
    const p = new URLSearchParams(window.location.search);
    p.delete("start");
    p.delete("end");
    p.set("period", "this_week");
    window.history.replaceState(null, "", `?${p.toString()}`);
    closeCalendar();
    calState.onChange?.();
  });
}

function applyCalendarRange(start, end) {
  const p = new URLSearchParams(window.location.search);
  p.set("period", "custom");
  p.set("start", isoDate(start));
  p.set("end", isoDate(end));
  window.history.replaceState(null, "", `?${p.toString()}`);
  closeCalendar();
  calState.onChange?.();
}

function openCalendar(anchor) {
  const el = calPopoverEl();
  calState.anchor = anchor;
  calState.viewMonth = null;
  renderCalendar();
  el.hidden = false;
  // Posiciona abaixo do botão, sem sair da janela.
  const r = anchor.getBoundingClientRect();
  const width = el.offsetWidth || 280;
  const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
  el.style.top = `${r.bottom + window.scrollY + 8}px`;
  el.style.left = `${left + window.scrollX}px`;
}

/**
 * Liga todos os botões de calendário da página (e o chip do período
 * personalizado) ao seletor. Chame depois de renderizar o conteúdo.
 */
function setupCalendarPicker(onChange) {
  calState.onChange = onChange;
  document.querySelectorAll('button[aria-label="Calendário"], [data-open-calendar]').forEach((btn) => {
    if (btn.dataset.calWired === "1") return;
    btn.dataset.calWired = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const el = document.getElementById("calendar-popover");
      if (el && !el.hidden && calState.anchor === btn) closeCalendar();
      else openCalendar(btn);
    });
  });
  if (!window.__calGlobalWired) {
    window.__calGlobalWired = true;
    document.addEventListener("click", closeCalendar);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCalendar();
    });
    window.addEventListener("resize", closeCalendar);
  }
}

function currentPeriodFromUrl(defaultPeriod = "this_week", defaultSellerId) {
  const params = new URLSearchParams(window.location.search);
  const sellerParam = params.get("sellerId");
  const sellerId = sellerParam !== null ? sellerParam : (defaultSellerId || undefined);
  return { period: params.get("period") || defaultPeriod, sellerId: sellerId || undefined };
}

function kpiCardHtml({ label, value, change, format = "number", tone = "blue", sub, icon }) {
  const displayValue =
    format === "currency" ? brl(value) : format === "percent" ? `${Number(value).toFixed(0)}%` : Number(value).toLocaleString("pt-BR");
  const hasChange = change !== undefined;
  const isUp = (change ?? 0) >= 0;
  const changeClass = change == null ? "neutral" : isUp ? "up" : "down";
  const changeText = change == null ? "sem período anterior para comparar" : `${isUp ? "↑" : "↓"} ${Math.abs(change).toFixed(0)}% vs. período anterior`;
  // `sub` são linhas extras opcionais (ex.: o valor em R$ de uma etapa do
  // funil, ao lado da contagem) — quando informado, substitui a linha de
  // variação percentual. Aceita um texto ou uma lista de textos: o cartão de
  // Perdas manda uma linha por etapa.
  const subLinhas = sub == null || sub === "" ? [] : (Array.isArray(sub) ? sub : [sub]).filter(Boolean);
  const changeHtml = subLinhas.length
    ? subLinhas.map((t) => `<p class="kpi-change neutral">${esc(t)}</p>`).join("")
    : hasChange
      ? `<p class="kpi-change ${changeClass}">${changeText}</p>`
      : "";

  // Quando um ícone é informado, usa o selo colorido (visual do mockup
  // BSconta+); páginas que ainda não passam `icon` mantêm o cartão clássico
  // com faixa colorida à esquerda, sem qualquer mudança visual.
  if (icon) {
    return `
      <div class="kpi-card kpi-card--icon tone-${tone}">
        <div class="kpi-card-top">
          <div class="kpi-icon tone-${tone}">${icon}</div>
          <p class="kpi-label">${label}</p>
        </div>
        <p class="kpi-value">${displayValue}</p>
        ${changeHtml}
      </div>
    `;
  }

  return `
    <div class="kpi-card tone-${tone}">
      <p class="kpi-label">${label}</p>
      <p class="kpi-value">${displayValue}</p>
      ${changeHtml}
    </div>
  `;
}

function renderKpiGrid(container, cards, cols5) {
  container.className = cols5 ? "kpi-grid cols-5" : "kpi-grid";
  container.innerHTML = cards.map(kpiCardHtml).join("");
}

/**
 * Cartão largo (linha de baixo do dashboard, valores em R$ em destaque),
 * com ícone à esquerda e, opcionalmente, um selo de variação % à direita.
 */
function kpiWideCardHtml({ label, value, change, tone = "blue", icon }) {
  const hasChange = change !== undefined;
  const isUp = (change ?? 0) >= 0;
  const changeClass = change == null ? "neutral" : isUp ? "up" : "down";
  return `
    <div class="kpi-wide-card">
      <div class="kpi-icon tone-${tone}">${icon}</div>
      <div class="kpi-wide-body">
        <p class="kpi-label">${label}</p>
        <p class="kpi-value tone-${tone}">${brl(value)}</p>
      </div>
      ${
        hasChange
          ? `<div class="kpi-wide-trend">
               <span class="amount ${changeClass}">${change == null ? "—" : `${isUp ? "↑" : "↓"} ${Math.abs(change).toFixed(0)}%`}</span>
               <span class="sub">vs. período anterior</span>
             </div>`
          : ""
      }
    </div>
  `;
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Rótulo legível do tipo de reunião (o banco guarda códigos em inglês). */
function meetingTypeLabel(m) {
  const labels = {
    COMMERCIAL_MEETING: "Comercial",
    PROPOSAL_MEETING: "Proposta",
    CONFIRMED_MEETING: "Confirmada",
    DISCOVERY: "Diagnóstico",
    FOLLOW_UP: "Follow-up",
    OTHER: "Reunião",
  };
  return labels[m.subtype] || "Reunião";
}

function statusBadgeHtml(status) {
  const labels = { DONE: "Realizada", SCHEDULED: "Agendada", CANCELED: "Cancelada", NO_SHOW: "Não compareceu", RESCHEDULED: "Remarcada", DECLINED: "Recusada" };
  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
}

function loadingHtml() {
  return `<div class="loading-wrap"><div class="spinner"></div></div>`;
}

/**
 * Substitui a página inteira por uma tela de erro clara — usado quando
 * requireAuth()/loadAll() falham (ex.: js/config.js ainda com valores de
 * exemplo, ou sem conexão com o Supabase). Evita que a tela fique presa
 * em "Carregando..." para sempre sem nenhuma explicação.
 */
function showFatalError(err) {
  const isConfig = !!(err && err.isConfigError);
  const title = isConfig ? "Configuração pendente" : "Não foi possível conectar";
  const message = isConfig
    ? (err && err.message) || "O arquivo js/config.js ainda não foi configurado com a URL e a chave do Supabase."
    : "Não foi possível conectar ao Supabase. Verifique sua internet e tente novamente em instantes.";
  const detail = !isConfig && err && err.message ? esc(err.message) : "";

  document.body.innerHTML = `
    <div class="fatal-error-wrap">
      <div class="card fatal-error-card">
        <div class="fatal-error-icon">${isConfig ? ICONS.goal : ICONS.report}</div>
        <h1>${esc(title)}</h1>
        <p>${esc(message)}</p>
        ${detail ? `<p class="fatal-error-detail">Detalhe técnico: ${detail}</p>` : ""}
        ${isConfig ? `<p class="fatal-error-hint">Edite o arquivo <code>js/config.js</code> com a URL e a chave (anon key) do seu projeto Supabase — veja o Passo 5 do <code>GUIA.md</code>.</p>` : ""}
        <button type="button" class="btn-primary" id="fatal-error-retry">Tentar novamente</button>
      </div>
    </div>
  `;
  document.getElementById("fatal-error-retry")?.addEventListener("click", () => window.location.reload());
}

/**
 * Confirmação de ação destrutiva, em lugar do confirm() do navegador.
 *
 * O confirm() nativo é uma caixa cinza do sistema operacional: não diz O QUE
 * vai ser apagado (só "Apagar esta meta?"), não combina com nada da tela, e
 * em alguns navegadores o botão de confirmar vem em primeiro, no caminho do
 * clique distraído. Aqui o nome do item aparece em destaque, o botão perigoso
 * é vermelho e fica à direita, e o foco começa no "Cancelar" — para o Enter
 * apressado não apagar nada.
 *
 * Usa <dialog> nativo porque ele já resolve o que uma div não resolve sozinha:
 * Esc fecha, o foco fica preso dentro do diálogo e o fundo trava.
 *
 * Devolve uma Promise que resolve true (confirmou) ou false (desistiu).
 */
function confirmarAcao({ titulo, item, texto, confirmar = "Apagar", cancelar = "Cancelar" }) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "confirmacao";
    dlg.innerHTML = `
      <div class="confirmacao-icone">${ICONS.trash}</div>
      <p class="confirmacao-titulo">${esc(titulo)}</p>
      ${item ? `<p class="confirmacao-item">${esc(item)}</p>` : ""}
      ${texto ? `<p class="confirmacao-texto">${esc(texto)}</p>` : ""}
      <div class="confirmacao-acoes">
        <button type="button" class="btn-ghost" data-resposta="nao">${esc(cancelar)}</button>
        <button type="button" class="btn-perigo" data-resposta="sim">${esc(confirmar)}</button>
      </div>
    `;
    document.body.appendChild(dlg);

    let respondido = false;
    const fechar = (resposta) => {
      if (respondido) return;
      respondido = true;
      dlg.classList.add("saindo");
      // Espera a animação de saída antes de tirar do DOM: sumir no meio do
      // movimento fica pior do que não animar.
      setTimeout(() => {
        dlg.close();
        dlg.remove();
        resolve(resposta);
      }, 120);
    };

    dlg.querySelectorAll("[data-resposta]").forEach((b) =>
      b.addEventListener("click", () => fechar(b.dataset.resposta === "sim"))
    );
    // Esc e clique no fundo escuro = desistiu.
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); fechar(false); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) fechar(false); });

    dlg.showModal();
    dlg.querySelector('[data-resposta="nao"]').focus();
  });
}
