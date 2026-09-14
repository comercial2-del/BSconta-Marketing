// ---------------------------------------------------------------------------
// SGCMP — BSconta — Edge Function: google-oauth-callback
//
// Recebe o retorno do Google após o vendedor aceitar (ou recusar) a
// conexão da Agenda, troca o "code" por tokens, e grava o refresh_token
// em `calendar_tokens` (nunca exposto ao navegador).
//
// Configuração necessária (Project Settings > Edge Functions > Secrets):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
//   (GOOGLE_REDIRECT_URI precisa ser cadastrada em "Authorized redirect
//   URIs" no Google Cloud Console, exatamente igual — inclusive https e
//   sem barra final.)
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

function html(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Conexão Google Agenda</title>
     <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#222}
     h1{font-size:1.25rem}</style></head><body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const sellerId = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return html(`<h1>Conexão cancelada</h1><p>O Google retornou: ${oauthError}. Você pode fechar esta aba e tentar novamente.</p>`, 400);
  }
  if (!code || !sellerId) {
    return html(`<h1>Link inválido</h1><p>Parâmetros ausentes (code/state). Peça um novo link de conexão.</p>`, 400);
  }

  try {
    const clientId = requireEnv("GOOGLE_CLIENT_ID");
    const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
    const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

    // 1) Troca o "code" por access_token + refresh_token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(`Google token endpoint respondeu ${tokenRes.status}: ${JSON.stringify(tokenJson).slice(0, 300)}`);
    }
    const { access_token, refresh_token, expires_in, scope } = tokenJson;
    if (!refresh_token) {
      // Acontece se o vendedor já tinha autorizado antes e o Google não reenviou
      // o refresh_token (prompt=consent deveria evitar isso, mas por garantia):
      throw new Error(
        "O Google não retornou um refresh_token. Revogue o acesso anterior em https://myaccount.google.com/permissions e tente conectar de novo.",
      );
    }

    // 2) Descobre o e-mail da conta Google conectada
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const userInfo = await userInfoRes.json().catch(() => ({}));
    const googleEmail: string | null = userInfo?.email ?? null;

    // 3) Grava no banco (service_role — bypassa RLS)
    const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const expiresAt = new Date(Date.now() + (Number(expires_in) || 3600) * 1000).toISOString();

    const { error: upsertError } = await supabase.from("calendar_tokens").upsert(
      {
        seller_id: sellerId,
        google_email: googleEmail,
        refresh_token,
        access_token,
        access_token_expires_at: expiresAt,
        scope,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "seller_id" },
    );
    if (upsertError) throw new Error(`Erro ao gravar calendar_tokens: ${upsertError.message}`);

    if (googleEmail) {
      await supabase.from("sellers").update({ calendar_account: googleEmail }).eq("id", sellerId);
    }

    return html(
      `<h1>✅ Agenda conectada com sucesso!</h1><p>Conta: ${googleEmail ?? "(e-mail não informado)"}</p><p>Pode fechar esta aba.</p>`,
    );
  } catch (err) {
    console.error("[google-oauth-callback] erro:", err);
    return html(`<h1>Erro ao conectar</h1><p>${err instanceof Error ? err.message : String(err)}</p>`, 500);
  }
});
