import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import nodemailer from "nodemailer";

export interface MergeSendPayload {
  to: string;
  toName?: string;
  subject: string;
  bodyHtml: string;
  fromName: string;
  pdfBase64: string;
  pdfFilename: string;
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

  const { to, toName, subject, bodyHtml, fromName, pdfBase64, pdfFilename, smtp } = body;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.secure ?? false,
    auth: { user: smtp.user, pass: smtp.pass },
    tls: { rejectUnauthorized: false },
  });

  const pdfBuffer = Buffer.from(pdfBase64, "base64");

  await transporter.sendMail({
    from: `"${fromName}" <${smtp.from || smtp.user}>`,
    to: toName ? `"${toName}" <${to}>` : to,
    subject,
    html: bodyHtml,
    attachments: [
      {
        filename: pdfFilename,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return NextResponse.json({ ok: true });
}
