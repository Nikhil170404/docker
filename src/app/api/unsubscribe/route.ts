import { NextRequest, NextResponse } from "next/server";
import { parseUnsubToken, markUnsubscribed } from "@/lib/email";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return new NextResponse("Invalid link", { status: 400 });

  const email = parseUnsubToken(token);
  if (!email) return new NextResponse("Invalid or expired link", { status: 400 });

  await markUnsubscribed(email, "system");

  return new NextResponse(
    `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#374151">
    <h2 style="color:#1f2937">You've been unsubscribed</h2>
    <p><strong>${email}</strong> will not receive any more emails from DocKaro senders.</p>
    <p style="font-size:13px;color:#9ca3af;margin-top:32px">If this was a mistake, contact the sender directly.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
