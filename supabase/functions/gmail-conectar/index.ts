// ---------------------------------------------------------------------------
// SGCMP — BSconta — Edge Function: gmail-conectar (01/10/2026)
//
// Conecta (uma vez) o Gmail que envia as notificações do sistema.
// Abra no navegador, logado na conta do remetente (comercial@bsconta.com.br):
//   https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/gmail-conectar
// O Google pede permissão para "enviar e-mail em seu nome"; ao aceitar, o
// refresh_token fica em public.email_remetente_gmail (só o servidor lê).
//
// Só aceita a conta definida em EMAIL_REMETENTE (padrão comercial@bsconta.com.br):
// ninguém consegue trocar o remetente conectando outra conta.
//
// Google Cloud (mesmo cliente OAuth da Agenda):
//   - Gmail API ativada
//   - URI de redirecionamento autorizado:
//       https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/gmail-conectar
// verify_jwt = false (é aberta direto no navegador, com redirecionamento do Google).
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"].join(" ");

function env(nome: string, padrao?: string): string {
  const v = Deno.env.get(nome) ?? padrao;
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}
const pagina = (titulo: string, texto: string, ok: boolean, status = 200) =>
  new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
<body style="margin:0;font-family:Segoe UI,Roboto,Arial,sans-serif;background:#f1f5f9;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px">
<div style="max-width:460px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;text-align:center">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:700">SGCMP — BSconta</div>
<h1 style="font-size:20px;margin:10px 0;color:${ok ? "#0f172a" : "#b91c1c"}">${titulo}</h1>
<p style="font-size:14px;line-height:1.6;color:#334155;margin:0">${texto}</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const remetente = env("EMAIL_REMETENTE", "comercial@bsconta.com.br").toLowerCase();
  const redirectUri = env("GMAIL_REDIRECT_URI", `${env("SUPABASE_URL")}/functions/v1/gmail-conectar`);
  const clientId = env("GOOGLE_CLIENT_ID");

  const erroGoogle = url.searchParams.get("error");
  if (erroGoogle) return pagina("Conexão cancelada", `O Google respondeu: ${erroGoogle}. Abra o link de novo para tentar.`, false, 400);

  const code = url.searchParams.get("code");
  if (!code) {
    // 1º passo: manda para a tela de consentimento do Google.
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", clientId);
    auth.searchParams.set("redirect_uri", redirectUri);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("scope", SCOPES);
    auth.searchParams.set("login_hint", remetente);
    return Response.redirect(auth.toString(), 302);
  }

  try {
    // 2º passo: troca o code pelos tokens.
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tok = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google recusou (${res.status}): ${tok.error_description || tok.error || "sem detalhe"}`);
    if (!tok.refresh_token) throw new Error("O Google não devolveu o refresh_token. Remova o acesso em https://myaccount.google.com/permissions e abra o link de novo.");
    if (!String(tok.scope || "").includes("gmail.send")) throw new Error("A permissão de envio de e-mail não foi concedida. Abra o link de novo e marque a opção de enviar e-mail.");

    const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json()).catch(() => ({}));
    const email = String(info.email || "").toLowerCase();
    if (email !== remetente) {
      return pagina("Conta errada", `Você entrou com <strong>${email || "outra conta"}</strong>. Entre com <strong>${remetente}</strong> e abra o link de novo.`, false, 403);
    }

    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const { error } = await sb.from("email_remetente_gmail").upsert({ email, refresh_token: tok.refresh_token, scope: tok.scope, conectado_em: new Date().toISOString() });
    if (error) throw new Error(`Erro ao gravar: ${error.message}`);

    // Destrava e-mails que falharam por falta de conexão.
    await sb.from("onboarding_transferencias").update({ email_status: "pendente", email_tentativas: 0 }).eq("email_status", "erro");
    fetch(`${env("SUPABASE_URL")}/functions/v1/notificar-transferencia`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"reprocessar":true}' }).catch(() => {});

    return pagina("Gmail conectado ✓", `As notificações do SGCMP serão enviadas por <strong>${email}</strong>. Pode fechar esta página.`, true);
  } catch (e) {
    return pagina("Não foi possível conectar", String((e as Error)?.message || e), false, 500);
  }
});
