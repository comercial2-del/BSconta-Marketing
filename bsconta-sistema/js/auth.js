// Sessão / autenticação — usa o Supabase Auth (e-mail + senha).
// Toda página do dashboard chama requireAuth() no início; a tela de login
// chama apenas o fluxo de login.

// VELOCIDADE — o perfil (nome, papel, vendedor) era buscado no banco em TODA
// abertura de tela, e o carregamento dos dados só começava depois. Era uma ida
// e volta ao servidor (~250 ms) parada no caminho crítico, para buscar três
// campos que não mudam durante o expediente.
// Agora fica guardado na sessão do navegador: a primeira tela busca, as
// seguintes leem da memória. Some quando a aba é fechada ou no logout.
const PROFILE_CACHE_KEY = "sgcmp:perfil:v1";

function lerPerfilCache(userId) {
  try {
    const txt = sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!txt) return null;
    const guardado = JSON.parse(txt);
    return guardado && guardado.id === userId ? guardado : null;
  } catch {
    return null;
  }
}

function gravarPerfilCache(perfil) {
  try {
    sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(perfil));
  } catch {
    /* sem armazenamento: só fica mais lento */
  }
}

async function getProfile(userId) {
  const doCache = lerPerfilCache(userId);
  if (doCache) return doCache;

  const { data, error } = await sb.from("profiles").select("id,name,role,seller_id").eq("id", userId).single();
  if (error) {
    console.error("Erro ao carregar perfil:", error);
    return null;
  }
  if (data) gravarPerfilCache(data);
  return data;
}

/**
 * Garante que existe uma sessão válida; se não houver, manda para /login.html.
 * Retorna { user, profile } quando autenticado.
 */
async function requireAuth() {
  if (window.SGCMP_CONFIG_MISSING) {
    const err = new Error("O arquivo js/config.js ainda não foi configurado com a URL e a chave do Supabase (veja o Passo 5 do GUIA.md).");
    err.isConfigError = true;
    throw err;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  const profile = await getProfile(session.user.id);
  if (!profile) {
    // Perfil ainda não foi criado (gatilho pode não ter rodado) — trata como VIEWER.
    return { user: session.user, profile: { id: session.user.id, name: session.user.email, role: "VIEWER", seller_id: null } };
  }
  return { user: session.user, profile };
}

async function logout() {
  try {
    sessionStorage.removeItem(PROFILE_CACHE_KEY);
    // O cache de dados vive no data.js, que a tela de login não carrega —
    // por isso a checagem antes de usar a constante.
    if (typeof STORE_CACHE_KEY === "string") sessionStorage.removeItem(STORE_CACHE_KEY);
  } catch {
    /* nada a fazer */
  }
  await sb.auth.signOut();
  window.location.href = "login.html";
}

async function login(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
