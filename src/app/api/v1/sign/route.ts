import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("sign_requests")
    .select("id, doc_token, recipient_email, recipient_name, doc_title, status, signed_at, created_at, expires_at")
    .eq("user_id", session.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: CreateSignPayload = await req.json().catch(() => null);
  if (!body?.recipientEmail || !body?.docTitle || !body?.docContent) {
    return NextResponse.json(
      { error: "recipientEmail, docTitle, and docContent are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const id = `sr_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const docToken = crypto.randomUUID().replace(/-/g, "");
  const expiryDays = body.expiryDays ?? 14;
  const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
  const now = new Date().toISOString();

  await supabase.from("sign_requests").insert({
    id,
    doc_token: docToken,
    user_id: session.id,
    sender_name: session.name,
    recipient_email: body.recipientEmail.trim().toLowerCase(),
    recipient_name: body.recipientName ?? "",
    doc_title: body.docTitle,
    doc_content: body.docContent,
    message: body.message ?? "",
    status: "pending",
    expires_at: expiresAt,
    created_at: now,
  });

  if (body.provider) {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://dockaro.com";
    const msg = `${session.name} has requested your signature on "${body.docTitle}".\n\n${body.message ?? ""}\n\nClick the button below to review and sign the document.`;
    const html = buildHtmlEmail(msg, session.name, body.recipientEmail, { signerToken: docToken });
    const text = buildTextEmail(
      msg + `\n\nSign here: ${base}/sign/${docToken}`,
      session.name,
      body.recipientEmail
    );
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
    } catch {
      // Don't fail the create if email fails
    }
  }

  return NextResponse.json({ id, docToken }, { status: 201 });
}
