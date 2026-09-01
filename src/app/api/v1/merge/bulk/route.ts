import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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
  trackOpens?: boolean;
  lpPortal?: boolean;
}

export const maxDuration = 60;

function makeToken(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: BulkSendPayload = await req.json().catch(() => null);
  if (!body?.recipientEmail || !body?.provider) {
    return NextResponse.json({ error: "Missing recipientEmail or provider" }, { status: 400 });
  }

  const email = body.recipientEmail.trim().toLowerCase();

  if (await isUnsubscribed(email)) {
    return NextResponse.json({ skipped: true, reason: "unsubscribed" });
  }

  const supabase = await createClient();
  const logId = `log_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

  // Email open tracking token
  let trackingToken: string | undefined;
  if (body.trackOpens !== false) {
    trackingToken = makeToken("ev");
    const viewId = `ev_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await supabase.from("email_views").insert({
      id: viewId,
      log_id: logId,
      user_id: session.id,
      view_token: trackingToken,
      recipient: email,
    });
  }

  // LP portal token — create or reuse per email+user
  let lpPortalToken: string | undefined;
  if (body.lpPortal !== false) {
    const { data: existing } = await supabase
      .from("lp_portals")
      .select("token")
      .eq("email", email)
      .eq("user_id", session.id)
      .maybeSingle();
    if (existing) {
      lpPortalToken = existing.token;
    } else {
      lpPortalToken = makeToken("lp");
      await supabase.from("lp_portals").insert({
        token: lpPortalToken,
        email,
        user_id: session.id,
        name: body.recipientName ?? "",
        created_at: new Date().toISOString(),
      });
    }
  }

  const html = buildHtmlEmail(body.mergedText, body.fromName, email, {
    trackingToken,
    lpPortalToken,
  });
  const text = buildTextEmail(body.mergedText, body.fromName, email);

  const attachments = body.pdfBase64
    ? [
        {
          filename: body.pdfFilename ?? "document.pdf",
          content: Buffer.from(body.pdfBase64, "base64"),
          contentType: "application/pdf",
        },
      ]
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

  await supabase.from("send_logs").insert({
    id: logId,
    user_id: session.id,
    template_id: body.templateId ?? null,
    recipient: email,
    subject: body.subject,
    status: "sent",
    provider: body.provider.type,
    sent_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
