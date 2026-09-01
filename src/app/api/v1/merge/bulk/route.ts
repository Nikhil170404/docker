import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  sendEmail,
  buildHtmlEmail,
  buildTextEmail,
  isUnsubscribed,
  type EmailProvider,
} from "@/lib/email";

export interface BulkSendPayload {
  provider: EmailProvider;
  fromName: string;
  fromEmail?: string;
  subject: string;
  mergedText: string;
  recipientEmail: string;
  recipientName?: string;
  pdfBase64?: string;
  pdfFilename?: string;
  templateId?: string;
}

export const maxDuration = 60; // Vercel: max 60s per request for free tier

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: BulkSendPayload = await req.json().catch(() => null);
  if (!body?.recipientEmail || !body?.provider) {
    return NextResponse.json({ error: "Missing recipientEmail or provider" }, { status: 400 });
  }

  const email = body.recipientEmail.trim().toLowerCase();

  // Honour unsubscribes
  if (isUnsubscribed(email)) {
    return NextResponse.json({ skipped: true, reason: "unsubscribed" });
  }

  const html = buildHtmlEmail(body.mergedText, body.fromName, email);
  const text = buildTextEmail(body.mergedText, body.fromName, email);

  const attachments = body.pdfBase64
    ? [{ filename: body.pdfFilename ?? "document.pdf", content: Buffer.from(body.pdfBase64, "base64"), contentType: "application/pdf" }]
    : undefined;

  await sendEmail({
    provider: body.provider,
    from: body.fromName,
    fromEmail: body.fromEmail,
    to: email,
    toName: body.recipientName,
    subject: body.subject,
    html,
    text,
    attachments,
  });

  // Log the send
  const db = getDb();
  const id = `log_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  db.prepare(
    "INSERT INTO send_logs (id, user_id, template_id, recipient, subject, status, provider, sent_at) VALUES (?, ?, ?, ?, ?, 'sent', ?, ?)"
  ).run(id, session.id, body.templateId ?? null, email, body.subject, body.provider.type, new Date().toISOString());

  return NextResponse.json({ ok: true });
}
