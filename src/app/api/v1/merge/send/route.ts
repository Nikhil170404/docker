import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUnsubscribed, buildHtmlEmail, buildTextEmail } from "@/lib/email";
import nodemailer from "nodemailer";

export interface MergeSendPayload {
  to: string;
  toName?: string;
  subject: string;
  mergedText?: string;
  bodyHtml?: string;
  fromName: string;
  pdfBase64?: string;
  pdfFilename?: string;
  templateId?: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: MergeSendPayload = await req.json().catch(() => null);
  if (!body?.to || !body?.smtp?.host) {
    return NextResponse.json({ error: "Missing required fields (to, smtp.host)" }, { status: 400 });
  }

  const email = body.to.trim().toLowerCase();

  if (await isUnsubscribed(email)) {
    return NextResponse.json({ skipped: true, reason: "unsubscribed" });
  }

  const { toName, subject, fromName, pdfBase64, pdfFilename, smtp } = body;

  const html = body.mergedText
    ? buildHtmlEmail(body.mergedText, fromName, email)
    : (body.bodyHtml ?? "");
  const text = body.mergedText ? buildTextEmail(body.mergedText, fromName, email) : "";

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.secure ?? false,
    auth: { user: smtp.user, pass: smtp.pass },
    tls: { rejectUnauthorized: false },
  });

  const attachments = pdfBase64
    ? [
        {
          filename: pdfFilename ?? "document.pdf",
          content: Buffer.from(pdfBase64, "base64"),
          contentType: "application/pdf",
        },
      ]
    : [];

  await transporter.sendMail({
    from: `"${fromName}" <${smtp.from || smtp.user}>`,
    to: toName ? `"${toName}" <${email}>` : email,
    subject,
    html,
    text,
    attachments,
  });

  const supabase = await createClient();
  const id = `log_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  await supabase.from("send_logs").insert({
    id,
    user_id: session.id,
    template_id: body.templateId ?? null,
    recipient: email,
    subject,
    status: "sent",
    provider: "smtp",
    sent_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
