// ---------------------------------------------------------------------------
// Sincronização ao carregar a página
//
// Sempre que o usuário abre uma tela (ou aperta Ctrl+R), o sistema pede uma
// sincronização com o RD Station e com a Agenda. O agendamento automático
// (5 min / 1 min) continua rodando normalmente por trás — isto aqui é só o
// "atalho" para quem acabou de mexer no RD e quer ver na hora.
//
// Três cuidados importantes:
//   1. NÃO trava a tela. A página carrega e mostra os dados atuais na hora;
//      quando a sincronização termina, os dados são recarregados sozinhos e
//      a tela se atualiza. Ninguém fica olhando para uma tela em branco
//      esperando o RD responder (que pode levar até ~100s).
//   2. Nunca falha em silêncio. Se a função não estiver publicada, se não
//      houver internet ou se o RD estiver fora do ar, aparece um aviso com a
//      fonte e o motivo — e clicando nele dá para ver o erro técnico. A tela
//      continua funcionando com os dados já gravados no banco.
//   3. Tem um limite de disparo (throttle). Apertar F5 cinco vezes seguidas
//      não dispara cinco sincronizações. Do lado do servidor ainda existe a
//      trava anti-sobreposição, então nada roda em duplicidade.
// ---------------------------------------------------------------------------

const SYNC_FUNCTIONS = ["sync-calendar", "sync-rd-station"];
const SYNC_THROTTLE_MS = 60_000; // não redispara se acabou de disparar
// VELOCIDADE: eram 15s. Como CADA troca de aba dispara a sincronização, com
// 15s praticamente toda navegação chamava as duas funções do servidor (~12s de
// RD) e recarregava tudo de novo em seguida. Com 60s a navegação normal não
// dispara nada, e quem mexeu no RD e voltou para ver ainda dispara. O
// agendamento automático (5 min / 1 min) continua rodando por trás de qualquer
// forma, então nada deixa de chegar — só para de chegar em duplicidade.
const SYNC_STORAGE_KEY = "sgcmp:ultimoDisparoSync";

function lastSyncTrigger() {
  try {
    return Number(localStorage.getItem(SYNC_STORAGE_KEY)) || 0;
  } catch {
    return 0; // navegador com armazenamento bloqueado: só não tem throttle
  }
}

function markSyncTrigger() {
  try {
    localStorage.setItem(SYNC_STORAGE_KEY, String(Date.now()));
  } catch {
    /* sem armazenamento: segue sem throttle */
  }
}

const SYNC_CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const SYNC_ALERT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5M12 16.5v.01"/></svg>';

// Quanto tempo cada aviso fica na tela. O de erro fica mais tempo, para dar
// chance de ler; de qualquer forma dá para fechar clicando nele.
const SYNC_TOAST_MS = { ok: 3000, warn: 7000, error: 9000 };

/**
 * Avisozinho no canto da tela:
 *   loading -> "Sincronizando..."   (neutro, com rodinha)
 *   ok      -> "Sucesso"            (verde)
 *   warn    -> "Sincronização parcial" (âmbar — uma das fontes falhou)
 *   error   -> "Falha ao sincronizar" (vermelho — nenhuma respondeu)
 * `detail` vira uma segunda linha menor com o motivo.
 */
function syncToast(text, state, detail, tecnico) {
  let el = document.getElementById("sync-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "sync-toast";
    document.body.appendChild(el);
    // Clicar num aviso de problema mostra o detalhe técnico completo (para
    // diagnóstico); clicar num aviso normal só fecha.
    el.addEventListener("click", () => {
      if (el._tecnico && !el.classList.contains("expanded")) {
        el.classList.add("expanded");
        clearTimeout(el._hideTimer);
        el.querySelector(".sync-tech")?.removeAttribute("hidden");
        return;
      }
      el.classList.remove("show", "expanded");
    });
  }
  el._tecnico = tecnico || "";
  el.title = tecnico ? "Clique para ver o detalhe técnico" : "";
  el.className = `sync-toast show ${state || ""}`;
  const prefix =
    state === "loading"
      ? '<span class="sync-spinner"></span>'
      : state === "ok"
      ? `<span class="sync-check">${SYNC_CHECK_ICON}</span>`
      : state === "warn" || state === "error"
      ? `<span class="sync-check alert">${SYNC_ALERT_ICON}</span>`
      : "";
  const body =
    `<span class="sync-text"><strong>${esc(text)}</strong>` +
    (detail ? `<small>${esc(detail)}</small>` : "") +
    (tecnico ? `<small class="sync-more">Clique para ver detalhes</small><pre class="sync-tech" hidden>${esc(tecnico)}</pre>` : "") +
    `</span>`;
  el.classList.remove("expanded");
  el.innerHTML = prefix + body;
  clearTimeout(el._hideTimer);
  // Aviso de problema NÃO desaparece sozinho: fica até o usuário fechar, para
  // não sumir sem explicação (foi exatamente a reclamação).
  if (state !== "loading" && state !== "error" && state !== "warn") {
    el._hideTimer = setTimeout(() => el.classList.remove("show"), SYNC_TOAST_MS[state] || 3000);
  }
}

function hideSyncToast() {
  const el = document.getElementById("sync-toast");
  if (el) el.classList.remove("show");
}

// Nomes que o usuário entende, para as mensagens na tela.
const SYNC_LABELS = { "sync-calendar": "Agenda", "sync-rd-station": "RD Station" };

/** Traduz falhas técnicas para algo acionável. */
function explainSyncError(msg) {
  const m = String(msg || "");
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "sem resposta (função publicada? internet?)";
  if (/\b404\b/.test(m)) return "função não encontrada (falta publicar no Supabase)";
  if (/\b401\b|\b403\b/.test(m)) return "acesso negado (chave/sessão)";
  if (/\b5\d\d\b/.test(m)) return "erro interno na função";
  if (/CORS/i.test(m)) return "bloqueado pelo navegador (CORS) — republique a função";
  return m.slice(0, 160);
}

const SYNC_REQUEST_TIMEOUT_MS = 60_000;

async function callSyncFunction(name, token) {
  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${window.SGCMP_CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
  } catch (err) {
    // fetch só rejeita por rede/CORS — a mensagem do navegador é vaga, então
    // deixamos claro o que costuma ser.
    if (err?.name === "AbortError") throw new Error(`tempo limite de ${Math.round(SYNC_REQUEST_TIMEOUT_MS / 1000)}s excedido`);
    throw new Error(`Failed to fetch (${err?.message || "rede/CORS"})`);
  } finally {
    clearTimeout(timer);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ? `${res.status}: ${body.error}` : `${name} respondeu ${res.status}`);
  return body;
}

/**
 * Dispara a sincronização e, conforme cada fonte termina, recarrega os dados
 * e redesenha a tela. `reload` deve recarregar o store e chamar o render()
 * da página.
 */
async function startPageLoadSync(reload) {
  if (window.SGCMP_CONFIG_MISSING) return;
  if (Date.now() - lastSyncTrigger() < SYNC_THROTTLE_MS) {
    syncToast("Sincronização recente ✓", "ok", "Os dados já foram atualizados nos últimos 60 segundos");
    return;
  }
  markSyncTrigger();

  let token = window.SGCMP_CONFIG.SUPABASE_ANON_KEY;
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.access_token) token = data.session.access_token;
  } catch {
    /* sem sessão: tenta com a chave pública mesmo */
  }

  syncToast("Sincronizando...", "loading", "Buscando dados do RD Station e da Agenda");

  // Evita duas recargas simultâneas quando as duas fontes terminam juntas.
  let reloading = false;
  const safeReload = async () => {
    if (reloading) return;
    reloading = true;
    try {
      // NÃO apagar o cache aqui. Era o que se fazia, e criava um buraco: entre
      // o apagar e o fim da recarga (~1 segundo) o cache ficava vazio, então
      // quem trocasse de tela nesse instante caía no carregamento completo —
      // justamente durante a sincronização, que acontece ao abrir a página.
      // `loadAll({ fresh: true })` já ignora o cache e o reescreve no fim, que
      // é exatamente o efeito desejado, sem o buraco.
      await reload();
    } catch (err) {
      console.warn("[sync] falha ao recarregar os dados:", err);
    } finally {
      reloading = false;
    }
  };

  // Mantém o aviso de andamento informando o que ainda falta.
  const pendentes = new Set(SYNC_FUNCTIONS.map((n) => SYNC_LABELS[n] || n));
  const mostrarAndamento = () => {
    const concluidas = SYNC_FUNCTIONS.length - pendentes.size;
    if (pendentes.size > 0) {
      syncToast("Sincronizando...", "loading", `${concluidas}/${SYNC_FUNCTIONS.length} concluída${concluidas === 1 ? "" : "s"} · Aguardando ${[...pendentes].join(" e ")}`);
    }
  };
  mostrarAndamento();

  const results = await Promise.allSettled(
    SYNC_FUNCTIONS.map(async (name) => {
      try {
        const body = await callSyncFunction(name, token);
        return body;
      } finally {
        pendentes.delete(SYNC_LABELS[name] || name);
        mostrarAndamento();
      }
    })
  );

  // Uma única recarga após as duas fontes terminarem evita duas consultas
  // completas ao Supabase durante a sincronização e acelera o fluxo.
  await safeReload();

  // ---------------------------------------------------------------------
  // Resultado: nada é escondido. Sucesso mostra quantos registros vieram;
  // falha mostra a fonte e o motivo; falha parcial avisa que só uma das
  // fontes respondeu. O detalhe técnico completo fica no console e no
  // atributo title do aviso (passar o mouse mostra).
  // ---------------------------------------------------------------------
  const falhas = [];
  const avisos = [];
  let registros = 0;

  results.forEach((r, i) => {
    const fonte = SYNC_LABELS[SYNC_FUNCTIONS[i]] || SYNC_FUNCTIONS[i];
    if (r.status === "rejected") {
      const bruto = r.reason?.message || String(r.reason);
      console.error(`[sync] ${fonte} falhou:`, bruto);
      falhas.push({ fonte, bruto, motivo: explainSyncError(bruto) });
      return;
    }
    const body = r.value || {};
    registros += Number(body.registros) || 0;
    // A função respondeu, mas relatou problemas próprios (ex.: vendas que não
    // gravaram por falta do índice único). Isso NÃO pode passar em branco.
    (body.errors || []).forEach((e) => {
      console.warn(`[sync] ${fonte} avisou:`, e);
      avisos.push({ fonte, bruto: String(e), motivo: explainSyncError(e) });
    });
    if (body.partial) avisos.push({ fonte, bruto: "sincronização parcial (tempo)", motivo: "parcial: continua na próxima" });
  });

  const detalheTecnico = [...falhas, ...avisos].map((f) => `${f.fonte}: ${f.bruto}`).join("\n");

  if (falhas.length === SYNC_FUNCTIONS.length) {
    // Nenhuma fonte respondeu. A tela segue com o que já estava no banco.
    syncToast("Não foi possível sincronizar ✕", "error", falhas.map((f) => `${f.fonte}: ${f.motivo}`).join(" · "), detalheTecnico);
    return;
  }

  if (falhas.length > 0 || avisos.length > 0) {
    const partes = [...falhas, ...avisos].map((f) => `${f.fonte}: ${f.motivo}`);
    syncToast("Sincronização parcial ⚠", "warn", partes.join(" · "), detalheTecnico);
    return;
  }

  syncToast("Sincronização concluída com sucesso ✓", "ok", registros > 0 ? `${registros} registro${registros === 1 ? "" : "s"} atualizado${registros === 1 ? "" : "s"}` : "Nenhuma novidade");
}
