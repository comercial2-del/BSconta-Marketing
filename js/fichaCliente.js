// Ficha do cliente (17/11/2026).
//
// Clicar numa linha de venda abre um card no meio da tela com os dados
// básicos do cliente: empresa, CNPJ, contato (telefone/e-mail), a venda e,
// quando há CNPJ, a situação na Receita Federal. Usado na Visão geral
// (tabela "Clientes das vendas realizadas") e na tela Vendas.
//
// Tudo vem de deals.rd_details — o mesmo quadro "Negociação" do RD que a tela
// Onboarding usa, gravado pelo sync-rd-station. Nada novo no banco.
//
// Precisa de: ui.js (esc, initials), calc.js (brl), qualificacao.js
// (qualifCampo, qualifDoDeal, QUALIF_NIVEIS) e o cliente `sb` do Supabase.
//
// Como usar numa tela:
//   1. cada <tr> de venda ganha data-deal="<id da negociação>" e
//      tabindex="0" (para abrir também pelo teclado);
//   2. FichaCliente.ligar("seletor das linhas", (dealId) => linhasDoCliente)
//      — a função devolve as linhas (uma por produto) daquele cliente, no
//      formato de getClientEntries: clientName, companyName, sellerName,
//      enteredAt, value, produto, quantidade, tipo, recorrencia, campaign.

const FichaCliente = (() => {
  // Quadro do RD por negociação: dealId → rd_details + rd_deal_id.
  const detalhes = new Map();

  async function carregarDetalhes(ids) {
    const faltam = [...new Set(ids)].filter((id) => id && !detalhes.has(id));
    for (let i = 0; i < faltam.length; i += 100) {
      const lote = faltam.slice(i, i + 100);
      const { data, error } = await sb.from("deals").select("id, rd_deal_id, rd_details").in("id", lote);
      if (error) { console.warn("Detalhes do RD indisponíveis:", error.message); return; }
      for (const id of lote) detalhes.set(id, {});
      for (const r of data || []) detalhes.set(r.id, { ...(r.rd_details || {}), rd_deal_id: r.rd_deal_id });
    }
  }

  // --- Formatação ---------------------------------------------------------
  const soDigitos = (v) => String(v || "").replace(/\D/g, "");
  function formatarCnpj(v) {
    const d = soDigitos(v);
    return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : String(v || "");
  }
  function formatarTelefone(v) {
    let d = soDigitos(v);
    if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
    if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
    if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
    return String(v || "").trim();
  }
  function campoRd(det, ...rotulos) {
    for (const rotulo of rotulos) {
      const v = qualifCampo(det && det.campos, rotulo);
      if (v) return v;
    }
    return "";
  }
  const dataIsoBr = (v) => { const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (v || ""); };
  const dataHora = (d) => {
    const x = d ? new Date(d) : null;
    return x && !Number.isNaN(x.getTime()) ? x.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  };
  const tipoHtml = (l) => l.tipo === "RECORRENTE"
    ? `<span class="tipo-venda tipo-venda-recorrente">Recorrente${l.recorrencia && l.recorrencia !== "Recorrente" ? ` · ${esc(l.recorrencia)}` : ""}</span>`
    : `<span class="tipo-venda tipo-venda-unico">Único</span>`;

  // --- Receita Federal (BrasilAPI, a mesma da tela Onboarding) -------------
  // Uma consulta por CNPJ por sessão. A BrasilAPI às vezes falha por um
  // instante (limite de acessos), então tenta de novo sozinha antes de
  // desistir; erro não fica guardado, para tentar de novo ao reabrir.
  const cacheCnpj = new Map();
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  async function buscarBrasilApi(d) {
    let ultimo = null;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      if (tentativa) await espera(1200 * tentativa);
      try {
        const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
        if (r.status === 404) return { naoExiste: true };
        if (r.ok) return { j: await r.json() };
        ultimo = new Error(`HTTP ${r.status}`);
      } catch (e) { ultimo = e; }
    }
    throw ultimo || new Error("falhou");
  }
  function consultarCnpj(d) {
    if (cacheCnpj.has(d)) return cacheCnpj.get(d);
    const p = buscarBrasilApi(d)
      .then(({ j, naoExiste }) => {
        if (naoExiste) return { erro: "CNPJ não encontrado na Receita Federal. Confira o número no RD." };
        return {
          razao: j.razao_social || "",
          fantasia: j.nome_fantasia || "",
          situacao: j.descricao_situacao_cadastral || "",
          abertura: dataIsoBr(j.data_inicio_atividade),
          porte: j.porte || "",
          natureza: j.natureza_juridica || "",
          cnae: [j.cnae_fiscal, j.cnae_fiscal_descricao].filter(Boolean).join(" — "),
          cidadeUf: [j.municipio, j.uf].filter(Boolean).join("/"),
          regime: j.opcao_pelo_mei ? "MEI" : j.opcao_pelo_simples ? "Simples Nacional" : j.opcao_pelo_simples === false ? "Não optante pelo Simples" : "",
          socios: (j.qsa || []).length,
        };
      })
      .catch(() => { cacheCnpj.delete(d); return { erro: "Não foi possível consultar a Receita agora. Feche e abra a ficha de novo em instantes.", falhou: true }; });
    cacheCnpj.set(d, p);
    return p;
  }

  // --- Visual --------------------------------------------------------------
  const CSS = `
    [data-ficha-linha]{cursor:pointer}
    [data-ficha-linha]:focus-visible{outline:2px solid var(--indigo-500);outline-offset:-2px}
    dialog.ficha-cliente{border:1px solid var(--border);border-radius:18px;padding:0;width:min(94vw,40rem);max-height:min(90vh,52rem);background:var(--surface);color:var(--text);box-shadow:0 24px 60px rgba(15,23,42,.24);overflow:hidden;animation:ficha-entra .16s ease-out}
    dialog.ficha-cliente[open]{display:flex;flex-direction:column}
    dialog.ficha-cliente::backdrop{background:rgba(15,23,42,.45);backdrop-filter:blur(2px)}
    @keyframes ficha-entra{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
    @media (prefers-reduced-motion:reduce){dialog.ficha-cliente{animation:none}}
    .ficha-topo{display:flex;align-items:flex-start;gap:.85rem;padding:1.15rem 1.25rem 1rem;border-bottom:1px solid var(--border);background:linear-gradient(90deg,var(--indigo-50),var(--surface))}
    .ficha-avatar{flex:none;width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:var(--indigo-600);color:#fff;font-weight:800;font-size:.95rem}
    .ficha-titulo{flex:1;min-width:0}
    .ficha-titulo h2{margin:0;font-size:1.08rem;line-height:1.25;overflow-wrap:anywhere}
    .ficha-titulo p{margin:.15rem 0 0;font-size:.78rem;color:var(--text-soft)}
    .ficha-selos{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.55rem}
    .ficha-cliente .f-selo{display:inline-flex;align-items:center;border-radius:999px;padding:.22rem .6rem;font-size:.68rem;font-weight:800;white-space:nowrap}
    .ficha-cliente .f-ganho,.ficha-cliente .f-a,.ficha-cliente .f-sim{background:var(--emerald-100);color:var(--emerald-700)}
    .ficha-cliente .f-b{background:var(--blue-50);color:#1d4ed8}
    .ficha-cliente .f-c{background:var(--red-100);color:var(--red-700)}
    .ficha-cliente .f-nao,.ficha-cliente .f-troca{background:var(--amber-100);color:var(--amber-700)}
    .ficha-cliente .f-const{background:var(--indigo-100);color:var(--indigo-700)}
    .ficha-fechar{flex:none;border:none;background:transparent;color:var(--text-soft);width:34px;height:34px;border-radius:9px;font-size:1.35rem;line-height:1;cursor:pointer}
    .ficha-fechar:hover{background:var(--surface-2);color:var(--text)}
    /* Sem barra de rolagem visível: continua rolando com o mouse, o toque e o teclado. */
    .ficha-corpo{padding:1rem 1.25rem 1.1rem;overflow:auto;display:flex;flex-direction:column;gap:1.05rem;scrollbar-width:none;-ms-overflow-style:none}
    .ficha-corpo::-webkit-scrollbar{display:none;width:0;height:0}
    .ficha-secao h3{margin:0 0 .55rem;font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-faint);font-weight:800;display:flex;justify-content:space-between;gap:.5rem}
    .ficha-secao h3 small{font-size:.62rem;text-transform:none;letter-spacing:0;font-weight:600}
    .ficha-grade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem .9rem}
    .ficha-item{min-width:0;padding:.5rem .65rem;border:1px solid var(--surface-2);background:var(--surface-2);border-radius:10px}
    .ficha-item.largo{grid-column:1/-1}
    .ficha-rotulo{font-size:.64rem;color:var(--text-faint);font-weight:700;text-transform:uppercase;letter-spacing:.03em}
    .ficha-valor{font-size:.84rem;font-weight:600;margin-top:.1rem;overflow-wrap:anywhere;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
    .ficha-valor.vazio{color:var(--text-faint);font-weight:500;font-style:italic}
    .ficha-valor a{color:var(--indigo-600);text-decoration:none}
    .ficha-valor a:hover{text-decoration:underline}
    .ficha-copiar{border:1px solid var(--border);background:var(--surface);border-radius:7px;padding:.12rem .45rem;font-size:.66rem;font-weight:700;color:var(--text-soft);cursor:pointer}
    .ficha-copiar:hover{color:var(--indigo-600);border-color:var(--indigo-100)}
    .ficha-aviso{font-size:.76rem;color:var(--text-soft);padding:.6rem .7rem;border-radius:10px;background:var(--surface-2)}
    .ficha-situacao-ativa{color:var(--emerald-700)}
    .ficha-situacao-alerta{color:var(--red-600)}
    .ficha-rodape{display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.8rem 1.25rem;border-top:1px solid var(--border);background:var(--surface-2)}
    .ficha-rodape a{font-size:.8rem;font-weight:700;color:var(--indigo-600);text-decoration:none}
    .ficha-rodape a:hover{text-decoration:underline}
    .ficha-rodape button{border:1px solid var(--border);background:var(--surface);border-radius:9px;padding:.45rem .95rem;font-weight:700;font-size:.82rem;cursor:pointer;color:var(--text)}
    @media (max-width:560px){.ficha-grade{grid-template-columns:1fr}.ficha-topo,.ficha-corpo,.ficha-rodape{padding-left:1rem;padding-right:1rem}}
  `;
  function instalarCss() {
    if (document.getElementById("ficha-cliente-css")) return;
    const st = document.createElement("style");
    st.id = "ficha-cliente-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function item(rotulo, valorHtml, { largo = false } = {}) {
    const vazio = valorHtml == null || valorHtml === "";
    return `<div class="ficha-item${largo ? " largo" : ""}"><div class="ficha-rotulo">${esc(rotulo)}</div><div class="ficha-valor${vazio ? " vazio" : ""}">${vazio ? "Não informado" : valorHtml}</div></div>`;
  }

  function dialogo() {
    let dlg = document.getElementById("ficha-cliente");
    if (dlg) return dlg;
    instalarCss();
    dlg = document.createElement("dialog");
    dlg.id = "ficha-cliente";
    dlg.className = "ficha-cliente";
    dlg.setAttribute("aria-labelledby", "ficha-cliente-titulo");
    document.body.appendChild(dlg);
    // Fecha clicando fora do card (no fundo escurecido) ou no "×"/"Fechar".
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.closest("[data-ficha-fechar]")) { dlg.close(); return; }
      const copiar = e.target.closest("[data-copiar]");
      if (copiar) {
        navigator.clipboard?.writeText(copiar.dataset.copiar).then(() => {
          copiar.textContent = "Copiado!";
          setTimeout(() => { copiar.textContent = "Copiar"; }, 1500);
        }).catch(() => {});
      }
    });
    return dlg;
  }

  async function abrir(dealId, linhas) {
    if (!dealId || !linhas || !linhas.length) return;
    const dlg = dialogo();
    dlg.dataset.deal = dealId;
    if (!detalhes.has(dealId)) {
      desenhar(dlg, linhas, null, true);
      if (!dlg.open) dlg.showModal();
      await carregarDetalhes([dealId]).catch(() => {});
      if (dlg.dataset.deal !== dealId || !dlg.open) return;
    }
    desenhar(dlg, linhas, detalhes.get(dealId) || {}, false);
    if (!dlg.open) dlg.showModal();
  }

  function desenhar(dlg, linhas, det, carregando) {
    const r = linhas[0];
    const q = qualifDoDeal(det && det.campos);
    const contatos = (det && det.contatos) || [];
    const contato = contatos[0] || {};
    const empresa = campoRd(det, "Nome da empresa") || (r.companyName && r.companyName !== "—" ? r.companyName : "");
    const nomeCliente = r.clientName || contato.nome || "Cliente sem nome";
    const titulo = empresa || nomeCliente;
    const cnpjBruto = campoRd(det, "CNPJ");
    const cnpjDig = soDigitos(cnpjBruto);
    const cnpj = cnpjBruto ? formatarCnpj(cnpjBruto) : "";
    const servico = campoRd(det, "Serviço contratado", "Serviço contratado (antigo)");
    const telefones = [...new Set(contatos.flatMap((c) => c.telefones || []).map(formatarTelefone).filter(Boolean))];
    const emails = [...new Set([
      ...contatos.flatMap((c) => c.emails || []),
      ...((det && det.campos) || []).filter((c) => /e-?mail/i.test(c.label || "")).map((c) => c.value),
    ].map((e) => String(e || "").trim().toLowerCase()).filter((e) => e.includes("@")))];
    const total = linhas.reduce((s, l) => s + (Number(l.value) || 0), 0);
    const produtos = linhas.map((l) => `${l.produto ? esc(l.produto) + (l.quantidade > 1 ? ` × ${l.quantidade}` : "") + " · " : ""}${tipoHtml(l)} <span>${brl(l.value)}</span>`).join("<br>");
    const origem = [det && det.fonte, det && det.campanha].filter(Boolean).join(" · ") || (r.campaign && r.campaign !== "Não informado" ? r.campaign : "");
    const nivel = q.qualidade ? QUALIF_NIVEIS[q.qualidade] : null;

    const selos = [
      `<span class="f-selo f-ganho">Ganho</span>`,
      nivel ? `<span class="f-selo f-${q.qualidade.toLowerCase()}" title="${esc(nivel.desc)}">Qualidade ${q.qualidade}</span>` : "",
      q.entrada ? `<span class="f-selo ${q.entrada === "Constituição" ? "f-const" : "f-troca"}">${esc(q.entrada)}</span>` : "",
      q.contaAzul ? `<span class="f-selo ${q.contaAzul === "Sim" ? "f-sim" : "f-nao"}">Conta Azul: ${esc(q.contaAzul)}</span>` : "",
    ].join("");

    const cnpjHtml = cnpj
      ? `${esc(cnpj)} <button type="button" class="ficha-copiar" data-copiar="${esc(cnpjDig || cnpj)}">Copiar</button>`
      : (carregando ? "Carregando…" : "");
    const telHtml = telefones.map((t) => {
      const d = soDigitos(t);
      return d.length >= 10 ? `<a href="https://wa.me/55${d}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${esc(t)}</a>` : esc(t);
    }).join(", ");
    const emailHtml = emails.map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(", ");

    let receitaHtml;
    if (carregando) receitaHtml = `<div class="ficha-aviso">Carregando dados do RD Station…</div>`;
    else if (cnpjDig.length === 14) receitaHtml = `<div class="ficha-aviso" id="ficha-receita">Consultando o CNPJ na Receita Federal…</div>`;
    else if (cnpj) receitaHtml = `<div class="ficha-aviso">O CNPJ informado no RD (${esc(cnpj)}) não tem 14 dígitos. Confira o cadastro.</div>`;
    else if (q.entrada === "Constituição") receitaHtml = `<div class="ficha-aviso">Empresa em constituição — o CNPJ ainda não existe ou não foi informado no RD.</div>`;
    else receitaHtml = `<div class="ficha-aviso">CNPJ não informado no RD Station. Preencha o campo "CNPJ" na negociação para ver os dados da Receita aqui.</div>`;

    const rdLink = det && det.rd_deal_id
      ? `<a href="https://crm.rdstation.com/app/deals/${encodeURIComponent(det.rd_deal_id)}" target="_blank" rel="noopener">Abrir negociação no RD Station ↗</a>`
      : `<span></span>`;

    dlg.innerHTML = `
      <div class="ficha-topo">
        <div class="ficha-avatar" aria-hidden="true">${esc(initials(titulo))}</div>
        <div class="ficha-titulo">
          <h2 id="ficha-cliente-titulo">${esc(titulo)}</h2>
          <p>${empresa && nomeCliente !== empresa ? `Contato: ${esc(nomeCliente)} · ` : ""}Vendedor: ${esc(r.sellerName || "—")}</p>
          <div class="ficha-selos">${selos}</div>
        </div>
        <button type="button" class="ficha-fechar" data-ficha-fechar aria-label="Fechar">×</button>
      </div>
      <div class="ficha-corpo">
        <section class="ficha-secao">
          <h3>Dados do cliente</h3>
          <div class="ficha-grade">
            ${item("Nome / contato", esc(contato.nome || nomeCliente))}
            ${item("Empresa", esc(empresa))}
            ${item("CNPJ", cnpjHtml)}
            ${item("Cargo", esc(contato.cargo || ""))}
            ${item("Telefone", carregando ? "Carregando…" : telHtml)}
            ${item("E-mail", carregando ? "Carregando…" : emailHtml)}
          </div>
        </section>
        <section class="ficha-secao">
          <h3>Venda</h3>
          <div class="ficha-grade">
            ${item("Data da venda", dataHora(r.enteredAt))}
            ${item("Valor total", brl(total))}
            ${item("Serviço contratado", esc(servico))}
            ${item("Campanha / origem", esc(origem))}
            ${item(linhas.length > 1 ? "Produtos" : "Produto / cobrança", produtos, { largo: true })}
            ${nivel ? item("Qualidade do cliente", `<b>${q.qualidade}</b> — ${esc(nivel.desc)}`, { largo: true }) : ""}
          </div>
        </section>
        <section class="ficha-secao">
          <h3>Receita Federal ${cnpjDig.length === 14 && !carregando ? "<small>fonte: BrasilAPI</small>" : ""}</h3>
          ${receitaHtml}
        </section>
      </div>
      <div class="ficha-rodape">${rdLink}<button type="button" data-ficha-fechar>Fechar</button></div>
    `;

    if (!carregando && cnpjDig.length === 14) {
      const dealId = dlg.dataset.deal;
      consultarCnpj(cnpjDig).then((rf) => {
        const box = dlg.querySelector("#ficha-receita");
        if (!box || dlg.dataset.deal !== dealId) return;
        if (rf.erro) { box.textContent = rf.erro; return; }
        const ativa = /ativa/i.test(rf.situacao);
        const div = document.createElement("div");
        div.className = "ficha-grade";
        div.innerHTML = [
          item("Razão social", esc(rf.razao), { largo: true }),
          item("Nome fantasia", esc(rf.fantasia)),
          item("Situação cadastral", rf.situacao ? `<span class="${ativa ? "ficha-situacao-ativa" : "ficha-situacao-alerta"}">${esc(rf.situacao)}</span>` : ""),
          item("Abertura", esc(rf.abertura)),
          item("Cidade / UF", esc(rf.cidadeUf)),
          item("Porte", esc(rf.porte)),
          item("Regime", esc(rf.regime)),
          item("Natureza jurídica", esc(rf.natureza)),
          item("Sócios", rf.socios ? String(rf.socios) : ""),
          item("Atividade principal (CNAE)", esc(rf.cnae), { largo: true }),
        ].join("");
        box.replaceWith(div);
      });
    }
  }

  // Um único ouvinte por página: as tabelas são redesenhadas a cada filtro,
  // então não dá para prender o clique em cada linha.
  function ligar(seletor, linhasDoCliente) {
    instalarCss();
    const linha = (e) => {
      const tr = e.target.closest(seletor);
      return tr && tr.dataset.deal ? tr : null;
    };
    document.addEventListener("click", (e) => {
      const tr = linha(e);
      if (tr && !e.target.closest("a, button")) abrir(tr.dataset.deal, linhasDoCliente(tr.dataset.deal));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const tr = linha(e);
      if (tr && e.target === tr) { e.preventDefault(); abrir(tr.dataset.deal, linhasDoCliente(tr.dataset.deal)); }
    });
  }

  /** Atributos para colocar no <tr> de uma venda. */
  function attrsLinha(dealId, nome) {
    if (!dealId) return "";
    return ` data-deal="${esc(dealId)}" data-ficha-linha tabindex="0" title="Ver ficha de ${esc(nome || "cliente")}"`;
  }

  return { ligar, abrir, attrsLinha, detalhes, carregarDetalhes };
})();
