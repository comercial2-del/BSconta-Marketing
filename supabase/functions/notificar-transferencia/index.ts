// ---------------------------------------------------------------------------
// SGCMP — BSconta — Edge Function: notificar-transferencia (01/10/2026)
//
// Envia o e-mail "Nova notificação no SGCMP — BSconta" quando um processo sai
// da 1ª etapa (Uriel) e vai para o Gustavo. Quem cria a transferência é o
// gatilho public.onb_detectar_transferencia (SQL 25); esta função só lê a fila
// public.onboarding_transferencias e envia o que estiver pendente.
//
// Chamadas:
//   { "id": "<uuid>" }            -> gatilho (logo após a transferência)
//   { "reprocessar": true }        -> cron de 10 em 10 min (pendentes/erros, até 5 tentativas)
//   { "id": "<uuid>", "manual": true } + Authorization: Bearer <sessão> -> botão "Tentar de novo"
//
// Sem duplicidade: cada linha é "reservada" (pendente/erro -> enviando) com
// trava otimista antes do envio; linha já "enviado" nunca é reenviada.
//
// Envio: Gmail API do remetente (EMAIL_REMETENTE, padrão comercial@bsconta.com.br),
// com o refresh_token gravado pela função gmail-conectar. Nenhuma chave vai
// para o navegador.
//
// Secrets (Edge Functions > Secrets):
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — já existem (Agenda)
//   EMAIL_REMETENTE   — opcional (padrão comercial@bsconta.com.br)
//   EMAIL_COPIA       — opcional, separado por vírgula (padrão izadora@bsconta.com.br)
// verify_jwt = false (o gatilho/cron chamam sem chave; a função só processa a fila).
// ---------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type SB = any;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const LINK_SISTEMA = "https://comercial2-del.github.io/BSconta-Marketing/telas/login.html";
const MAX_TENTATIVAS = 5;

function env(nome: string, padrao?: string): string {
  const v = Deno.env.get(nome) ?? padrao;
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---- utilidades de MIME -----------------------------------------------------
const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64utf8 = (t: string) => b64(new TextEncoder().encode(t));
const linhas76 = (t: string) => t.replace(/(.{76})/g, "$1\r\n");
const cabecalho = (t: string) => `=?UTF-8?B?${b64utf8(t)}?=`;
const esc = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const LOGO_JPG_B64 = "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";

type Transf = {
  id: string; cliente: string; responsavel_anterior: string; novo_responsavel: string;
  etapa_anterior: string; nova_etapa: string; transferido_em: string;
  email_status: string; email_tentativas: number; email_atualizado_em: string;
};

function montarEmail(t: Transf) {
  const quando = dataHora(t.transferido_em);
  const itens: [string, string][] = [
    ["Responsável anterior", t.responsavel_anterior],
    ["Novo responsável", t.novo_responsavel],
    ["Etapa anterior", t.etapa_anterior],
    ["Nova etapa", t.nova_etapa],
    ["Data e hora", quando],
    ["Cliente/Processo", t.cliente],
  ];
  const texto = [
    `Olá, ${t.novo_responsavel}!`, "",
    "Você tem uma nova notificação no sistema SGCMP — BSconta.",
    "Sistema de Gestão Comercial, Marketing e Performance", "",
    `O processo de ${t.cliente} avançou da 1ª etapa e foi encaminhado para você.`, "",
    "Informações da transferência:",
    ...itens.map(([k, v]) => `* ${k}: ${v}`), "",
    "Para visualizar os detalhes e dar continuidade ao processo, acesse:",
    LINK_SISTEMA, "",
    "Atenciosamente,", "SGCMP — BSconta", "Sistema de Gestão Comercial, Marketing e Performance", "",
    "Esta é uma mensagem automática. Não é necessário responder a este e-mail.",
  ].join("\r\n");

  const linhasTabela = itens.map(([k, v], i) => `
              <tr>
                <td style="padding:10px 14px;font-size:13px;color:#64748b;width:44%;${i ? "border-top:1px solid #e2e8f0;" : ""}">${esc(k)}</td>
                <td style="padding:10px 14px;font-size:13px;color:#0f172a;font-weight:600;${i ? "border-top:1px solid #e2e8f0;" : ""}">${esc(v)}</td>
              </tr>`).join("");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova notificação no SGCMP — BSconta</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="display:none;max-height:0;overflow:hidden">O processo de ${esc(t.cliente)} avançou da 1ª etapa e foi encaminhado para você.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
        <tr><td style="background:#1e3a8a;height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>
        <tr><td align="center" style="padding:26px 28px 6px">
          <img src="cid:logo-bsconta" width="88" height="88" alt="BSconta+" style="display:block;border:0;width:88px;height:88px">
        </td></tr>
        <tr><td align="center" style="padding:0 28px 20px">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;font-weight:700">SGCMP — BSconta</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Sistema de Gestão Comercial, Marketing e Performance</div>
        </td></tr>
        <tr><td style="padding:0 28px">
          <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;color:#0f172a">Olá, ${esc(t.novo_responsavel)}!</h1>
          <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155">Você tem uma nova notificação no sistema <strong>SGCMP — BSconta</strong>.</p>
          <div style="background:#eff6ff;border-left:4px solid #2563eb;border-radius:8px;padding:12px 14px;font-size:14px;line-height:1.55;color:#1e3a8a">
            O processo de <strong>${esc(t.cliente)}</strong> avançou da 1ª etapa e foi encaminhado para você.
          </div>
          <h2 style="margin:22px 0 8px;font-size:14px;color:#0f172a">Informações da transferência</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;overflow:hidden">${linhasTabela}
          </table>
          <p style="margin:22px 0 14px;font-size:14px;line-height:1.6;color:#334155">Para visualizar os detalhes e dar continuidade ao processo, acesse:</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#2563eb">
            <a href="${LINK_SISTEMA}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">Acessar o SGCMP</a>
          </td></tr></table>
          <p style="margin:10px 0 0;font-size:12px;color:#64748b;word-break:break-all"><a href="${LINK_SISTEMA}" style="color:#2563eb">${LINK_SISTEMA}</a></p>
          <p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#334155">Atenciosamente,<br><strong>SGCMP — BSconta</strong><br><span style="color:#64748b;font-size:13px">Sistema de Gestão Comercial, Marketing e Performance</span></p>
        </td></tr>
        <tr><td style="padding:22px 28px 26px">
          <div style="border-top:1px solid #e2e8f0;padding-top:14px;font-size:11px;line-height:1.5;color:#94a3b8;text-align:center">Esta é uma mensagem automática. Não é necessário responder a este e-mail.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { texto, html };
}

function montarMime(de: string, para: string[], assunto: string, texto: string, html: string, idTransf: string) {
  const f1 = "sgcmp_rel_" + crypto.randomUUID().replace(/-/g, "");
  const f2 = "sgcmp_alt_" + crypto.randomUUID().replace(/-/g, "");
  return [
    `From: ${cabecalho("SGCMP — BSconta")} <${de}>`,
    `To: ${para.join(", ")}`,
    `Subject: ${cabecalho(assunto)}`,
    "MIME-Version: 1.0",
    `X-SGCMP-Transferencia: ${idTransf}`,
    `Content-Type: multipart/related; boundary="${f1}"`,
    "",
    `--${f1}`,
    `Content-Type: multipart/alternative; boundary="${f2}"`,
    "",
    `--${f2}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    linhas76(b64utf8(texto)),
    `--${f2}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    linhas76(b64utf8(html)),
    `--${f2}--`,
    `--${f1}`,
    "Content-Type: image/jpeg; name=\"bsconta.jpg\"",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <logo-bsconta>",
    "Content-Disposition: inline; filename=\"bsconta.jpg\"",
    "",
    linhas76(LOGO_JPG_B64),
    `--${f1}--`,
    "",
  ].join("\r\n");
}

async function accessTokenGmail(sb: SB, remetente: string) {
  const { data, error } = await sb.from("email_remetente_gmail").select("refresh_token").eq("email", remetente).maybeSingle();
  if (error) throw new Error(`Erro ao ler o token do Gmail: ${error.message}`);
  if (!data) throw new Error(`Gmail do remetente ${remetente} ainda não foi conectado (abra a função gmail-conectar).`);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: data.refresh_token, grant_type: "refresh_token",
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Google recusou o token (${res.status}): ${j.error_description || j.error || "sem detalhe"}. Reconecte o Gmail em gmail-conectar.`);
  return j.access_token as string;
}

// Destinatários: e-mail cadastrado do Gustavo (Supabase Auth) + cópias.
async function destinatarios(sb: SB) {
  const lista: string[] = [];
  const { data: perfis } = await sb.from("profiles").select("id, name").ilike("name", "gustavo%");
  for (const p of perfis || []) {
    const { data } = await sb.auth.admin.getUserById(p.id);
    if (data?.user?.email) lista.push(data.user.email);
  }
  if (!lista.length) lista.push("gustavo@bsconta.com.br"); // segurança: cadastro não encontrado
  for (const e of env("EMAIL_COPIA", "izadora@bsconta.com.br").split(",")) if (e.trim()) lista.push(e.trim());
  return [...new Set(lista.map((e) => e.toLowerCase()))];
}

async function processar(sb: SB, t: Transf, manual: boolean) {
  // Reserva a linha (trava otimista): evita envio duplicado em chamadas simultâneas.
  const podeTentar = t.email_status === "pendente" || t.email_status === "erro" ||
    (manual && t.email_status === "enviando" && Date.now() - new Date(t.email_atualizado_em).getTime() > 15 * 60_000);
  if (!podeTentar) return { id: t.id, status: t.email_status, ignorado: true };
  if (!manual && t.email_tentativas >= MAX_TENTATIVAS) return { id: t.id, status: t.email_status, ignorado: true };
  const { data: reservada } = await sb.from("onboarding_transferencias")
    .update({ email_status: "enviando", email_tentativas: t.email_tentativas + 1, email_atualizado_em: new Date().toISOString() })
    .eq("id", t.id).eq("email_status", t.email_status).eq("email_tentativas", t.email_tentativas)
    .select("id").maybeSingle();
  if (!reservada) return { id: t.id, ignorado: true }; // outra chamada pegou primeiro

  let para: string[] = [];
  try {
    const remetente = env("EMAIL_REMETENTE", "comercial@bsconta.com.br");
    para = await destinatarios(sb);
    const { texto, html } = montarEmail(t);
    const mime = montarMime(remetente, para, "Nova notificação no SGCMP — BSconta", texto, html, t.id);
    const token = await accessTokenGmail(sb, remetente);
    const raw = b64(new TextEncoder().encode(mime)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gmail recusou o envio (${res.status}): ${j?.error?.message || "sem detalhe"}`);
    await sb.from("onboarding_transferencias").update({
      email_status: "enviado", email_enviado_em: new Date().toISOString(), email_erro: null,
      email_destinatarios: para, email_mensagem_id: j.id || null, email_atualizado_em: new Date().toISOString(),
    }).eq("id", t.id);
    return { id: t.id, status: "enviado", para };
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500);
    console.error("notificar-transferencia:", t.id, msg);
    await sb.from("onboarding_transferencias").update({
      email_status: "erro", email_erro: msg, email_destinatarios: para.length ? para : null, email_atualizado_em: new Date().toISOString(),
    }).eq("id", t.id);
    return { id: t.id, status: "erro", erro: msg };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);
  try {
    const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const corpo = await req.json().catch(() => ({}));
    const campos = "id, cliente, responsavel_anterior, novo_responsavel, etapa_anterior, nova_etapa, transferido_em, email_status, email_tentativas, email_atualizado_em";

    let manual = false;
    if (corpo.manual) {
      // "Tentar de novo" no sistema: só usuário logado.
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data } = token ? await sb.auth.getUser(token) : { data: null };
      if (!data?.user) return json({ error: "Faça login para reenviar." }, 401);
      manual = true;
    }

    let linhas: Transf[] = [];
    if (corpo.id) {
      const { data, error } = await sb.from("onboarding_transferencias").select(campos).eq("id", String(corpo.id)).maybeSingle();
      if (error) throw error;
      if (data) linhas = [data as Transf];
    } else if (corpo.reprocessar) {
      const { data, error } = await sb.from("onboarding_transferencias").select(campos)
        .in("email_status", ["pendente", "erro"]).lt("email_tentativas", MAX_TENTATIVAS)
        .order("transferido_em").limit(20);
      if (error) throw error;
      linhas = (data || []) as Transf[];
    } else {
      return json({ error: "Informe id ou reprocessar." }, 400);
    }

    const resultados = [];
    for (const t of linhas) resultados.push(await processar(sb, t, manual));
    return json({ ok: true, resultados });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
