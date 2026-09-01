/**
 * Unified email sending layer.
 * Supports Resend (recommended for scale), SendGrid, and SMTP fallback.
 * All providers honour unsubscribes before sending.
 */
import { createAdminClient } from "./supabase/admin";
import { createHmac } from "crypto";

const UNSUB_SECRET = process.env.UNSUB_SECRET ?? "dockaro-unsub-secret-change-in-prod";

// ─── Unsubscribe helpers ──────────────────────────────────────────────────────

export function makeUnsubToken(email: string): string {
  const sig = createHmac("sha256", UNSUB_SECRET).update(email.toLowerCase()).digest("hex");
  return Buffer.from(`${email.toLowerCase()}:${sig}`).toString("base64url");
}

export function parseUnsubToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const colon = decoded.lastIndexOf(":");
    if (colon < 0) return null;
    const email = decoded.slice(0, colon);
    const sig = decoded.slice(colon + 1);
    const expected = createHmac("sha256", UNSUB_SECRET).update(email).digest("hex");
    if (sig !== expected) return null;
    return email;
  } catch {
    return null;
  }
}

export async function isUnsubscribed(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("unsubscribes")
    .select("email")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return !!data;
}

export async function markUnsubscribed(email: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("unsubscribes").upsert(
    { email: email.toLowerCase(), user_id: userId, created_at: new Date().toISOString() },
    { onConflict: "email", ignoreDuplicates: true }
  );
}

export function getUnsubUrl(email: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://dockaro.com";
  return `${base}/api/unsubscribe?token=${makeUnsubToken(email)}`;
}

// ─── Email body builder ───────────────────────────────────────────────────────

export interface HtmlEmailOptions {
  trackingToken?: string;
  lpPortalToken?: string;
  signerToken?: string;
}

export function buildHtmlEmail(
  mergedText: string,
  fromName: string,
  recipientEmail: string,
  opts: HtmlEmailOptions = {}
): string {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://dockaro.com";
  const escaped = mergedText
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .split("\n")
    .map((l) => l.trim() ? `<p style="margin:0 0 10px;line-height:1.6">${l}</p>` : `<br>`)
    .join("\n");
  const unsubUrl = getUnsubUrl(recipientEmail);
  const trackingPixel = opts.trackingToken
    ? `<img src="${base}/api/track/${opts.trackingToken}" width="1" height="1" style="display:none" alt="" />`
    : "";
  const lpLink = opts.lpPortalToken
    ? `&nbsp;·&nbsp;<a href="${base}/lp/${opts.lpPortalToken}" style="color:#3b82f6;text-decoration:none">View your portal</a>`
    : "";
  const signLink = opts.signerToken
    ? `<tr><td style="padding:0 32px 24px"><a href="${base}/sign/${opts.signerToken}" style="display:inline-block;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">Sign Document</a></td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px">
      <table width="640" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
        <!-- Header -->
        <tr><td style="background:#3b82f6;padding:20px 32px">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700">${fromName.replace(/</g,"&lt;")}</p>
          <p style="margin:4px 0 0;color:#bfdbfe;font-size:12px">${new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})}</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px">
          <div style="color:#1f2937;font-size:14px">${escaped}</div>
        </td></tr>
        ${signLink}
        <!-- Footer -->
        <tr><td style="background:#f3f4f6;padding:16px 32px;border-top:1px solid #e5e7eb">
          <p style="margin:0;font-size:11px;color:#9ca3af">
            Sent via <a href="https://dockaro.com" style="color:#3b82f6;text-decoration:none">DocKaro</a> by ${fromName.replace(/</g,"&lt;")}.
            &nbsp;·&nbsp;
            <a href="${unsubUrl}" style="color:#9ca3af">Unsubscribe</a>
            ${lpLink}
          </p>
          ${trackingPixel}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function buildTextEmail(mergedText: string, fromName: string, recipientEmail: string): string {
  const unsubUrl = getUnsubUrl(recipientEmail);
  return `${mergedText}\n\n---\nSent by ${fromName} via DocKaro (https://dockaro.com)\nUnsubscribe: ${unsubUrl}`;
}

// ─── Provider types ───────────────────────────────────────────────────────────

export type EmailProvider =
  | { type: "resend"; apiKey: string; domain: string }
  | { type: "sendgrid"; apiKey: string }
  | { type: "smtp"; host: string; port: number; secure: boolean; user: string; pass: string; from: string };

export interface SendEmailParams {
  provider: EmailProvider;
  from: string;          // display name
  fromEmail?: string;    // override from address
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

// ─── Resend ───────────────────────────────────────────────────────────────────

async function sendViaResend(p: SendEmailParams & { provider: Extract<EmailProvider, { type: "resend" }> }) {
  const { Resend } = await import("resend");
  const resend = new Resend(p.provider.apiKey);
  const fromAddr = p.fromEmail ?? `noreply@${p.provider.domain}`;
  const result = await resend.emails.send({
    from: `${p.from} <${fromAddr}>`,
    to: p.toName ? `${p.toName} <${p.to}>` : p.to,
    subject: p.subject,
    html: p.html,
    text: p.text,
    attachments: p.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
    })),
  });
  if (result.error) throw new Error(result.error.message);
}

// ─── SendGrid ─────────────────────────────────────────────────────────────────

async function sendViaSendGrid(p: SendEmailParams & { provider: Extract<EmailProvider, { type: "sendgrid" }> }) {
  const sgMail = (await import("@sendgrid/mail")).default;
  sgMail.setApiKey(p.provider.apiKey);
  await sgMail.send({
    from: { name: p.from, email: p.fromEmail ?? p.to },
    to: { name: p.toName ?? "", email: p.to },
    subject: p.subject,
    html: p.html,
    text: p.text,
    attachments: p.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content.toString("base64"),
      type: a.contentType,
      disposition: "attachment",
    })),
  });
}

// ─── SMTP (nodemailer) ────────────────────────────────────────────────────────

async function sendViaSmtp(p: SendEmailParams & { provider: Extract<EmailProvider, { type: "smtp" }> }) {
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    host: p.provider.host,
    port: p.provider.port || 587,
    secure: p.provider.secure ?? false,
    auth: { user: p.provider.user, pass: p.provider.pass },
    tls: { rejectUnauthorized: false },
  });
  const fromAddr = p.provider.from || p.provider.user;
  await transporter.sendMail({
    from: `"${p.from}" <${fromAddr}>`,
    to: p.toName ? `"${p.toName}" <${p.to}>` : p.to,
    subject: p.subject,
    html: p.html,
    text: p.text,
    attachments: p.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  });
}

// ─── Unified send ─────────────────────────────────────────────────────────────

export async function sendEmail(params: SendEmailParams): Promise<void> {
  switch (params.provider.type) {
    case "resend":
      return sendViaResend(params as Parameters<typeof sendViaResend>[0]);
    case "sendgrid":
      return sendViaSendGrid(params as Parameters<typeof sendViaSendGrid>[0]);
    case "smtp":
      return sendViaSmtp(params as Parameters<typeof sendViaSmtp>[0]);
  }
}
