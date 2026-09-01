import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import nodemailer from "nodemailer";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.smtp?.host || !body?.smtp?.user) {
    return NextResponse.json({ error: "smtp.host and smtp.user are required" }, { status: 400 });
  }

  const { smtp } = body;

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port || 587,
      secure: smtp.secure ?? false,
      auth: { user: smtp.user, pass: smtp.pass },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
    return NextResponse.json({ ok: true, message: "SMTP connection successful" });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
