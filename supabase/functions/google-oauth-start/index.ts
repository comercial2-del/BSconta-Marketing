// ---------------------------------------------------------------------------
// SGCMP — BSconta — Edge Function: google-oauth-start
//
// Ponto de partida da conexão da Agenda Google de um vendedor. Redireciona
// o navegador do vendedor para a tela de consentimento do Google.
//
// Como usar:
//   Abra (num navegador, logado com a conta Google que o vendedor usa para
//   a agenda comercial):
//     https://<project>.supabase.co/functions/v1/google-oauth-start?seller_id=<uuid>
//
// Configuração necessária (Project Settings > Edge Functions > Secrets):
//   GOOGLE_CLIENT_ID      — Client ID OAuth 2.0 (Google Cloud Console)
//   GOOGLE_CLIENT_SECRET  — Client Secret (não é usado aqui, mas precisa
//                           existir para o callback funcionar)
//   GOOGLE_REDIRECT_URI   — normalmente:
//     https://<project>.supabase.co/functions/v1/google-oauth-callback
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"].join(" ");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const sellerId = url.searchParams.get("seller_id");

  if (!sellerId) {
    return new Response("Parâmetro obrigatório ausente: seller_id", { status: 400 });
  }

  try {
    const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const { data: seller, error } = await supabase
      .from("sellers")
      .select("id, name")
      .eq("id", sellerId)
      .maybeSingle();

    if (error) throw new Error(`Erro ao consultar vendedor: ${error.message}`);
    if (!seller) return new Response(`Vendedor não encontrado: ${sellerId}`, { status: 404 });

    const clientId = requireEnv("GOOGLE_CLIENT_ID");
    const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("access_type", "offline"); // necessário para receber refresh_token
    authUrl.searchParams.set("prompt", "consent"); // força reenviar refresh_token mesmo se já autorizado antes
    authUrl.searchParams.set("scope", SCOPES);
    authUrl.searchParams.set("state", sellerId);

    return Response.redirect(authUrl.toString(), 302);
  } catch (err) {
    console.error("[google-oauth-start] erro:", err);
    return new Response(`Erro: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
  }
});
