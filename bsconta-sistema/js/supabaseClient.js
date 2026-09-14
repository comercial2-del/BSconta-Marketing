// Cliente único do Supabase, usado por todas as páginas.
// Depende do supabase-js (CDN) já carregado antes deste arquivo, e de
// window.SGCMP_CONFIG (config.js) já carregado antes deste arquivo.

window.SGCMP_CONFIG_MISSING =
  !window.SGCMP_CONFIG ||
  !window.SGCMP_CONFIG.SUPABASE_URL ||
  !window.SGCMP_CONFIG.SUPABASE_ANON_KEY ||
  window.SGCMP_CONFIG.SUPABASE_URL.includes("COLE_AQUI") ||
  window.SGCMP_CONFIG.SUPABASE_ANON_KEY.includes("COLE_AQUI");

if (!window.SGCMP_CONFIG_MISSING) {
  try {
    window.sb = supabase.createClient(window.SGCMP_CONFIG.SUPABASE_URL, window.SGCMP_CONFIG.SUPABASE_ANON_KEY);
  } catch (e) {
    window.SGCMP_CONFIG_MISSING = true;
    console.error("Falha ao criar o cliente Supabase — confira js/config.js:", e);
  }
}
