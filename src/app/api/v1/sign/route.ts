import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { sendEmail, buildHtmlEmail, buildTextEmail } from "@/lib/email";
import type { EmailProvider } from "@/lib/email";

interface CreateSignPayload {
  recipientEmail: string;
  recipientName?: string;
  docTitle: string;
  docContent: string;
  message?: string;
  expiryDays?: number;
  provider?: EmailProvider;
  subject?: string;
}

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, doc_token, recipient_email, recipient_name, doc_title, status, signed_at, created_at, expires_at FROM sign_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
    )
    .all(session.id);

  return NextResponse.json({ requests: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: CreateSignPayload = await req.json().catch(() => null);
  if (!body?.recipientEmail || !body?.docTitle || !body?.docContent) {
    return NextResponse.json({ error: "recipientEmail, docTitle, and docContent are required" }, { status: 400 });
  }

  const db = getDb();
  const id = `sr_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const docToken = crypto.randomUUID().replace(/-/g, "");
  const expiryDays = body.expiryDays ?? 14;
  const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO sign_requests (id, doc_token, user_id, sender_name, recipient_email, recipient_name, doc_title, doc_content, message, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    id, docToken, session.id, session.name,
    body.recipientEmail.trim().toLowerCase(),
    body.recipientName ?? "",
    body.docTitle, body.docContent,
    body.message ?? "", expiresAt, now
  );

  // Send signing email if provider supplied
  if (body.provider) {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://dockaro.com";
    const signUrl = `${base}/sign/${docToken}`;
    const msg = `${session.name} has requested your signature on "${body.docTitle}".\n\n${body.message ?? ""}\n\nClick the button below to review and sign the document.`;
    const html = buildHtmlEmail(msg, session.name, body.recipientEmail, { signerToken: docToken });
    const text = buildTextEmail(msg + `\n\nSign here: ${signUrl}`, session.name, body.recipientEmail);
    try {
      await sendEmail({
        provider: body.provider,
        from: session.name,
        to: body.recipientEmail.trim().toLowerCase(),
        toName: body.recipientName,
        subject: body.subject ?? `Signature Request: ${body.docTitle}`,
        html,
        text,
      });
    } catch (_e) {
      // Don't fail the create if email fails
    }
  }

  return NextResponse.json({ id, docToken }, { status: 201 });
}
