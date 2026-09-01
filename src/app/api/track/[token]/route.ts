import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const GIF_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (token) {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const row = db
        .prepare("SELECT id, view_count, first_viewed_at FROM email_views WHERE view_token = ?")
        .get(token) as { id: string; view_count: number; first_viewed_at: string | null } | undefined;
      if (row) {
        db.prepare(
          "UPDATE email_views SET view_count = view_count + 1, last_viewed_at = ?, first_viewed_at = COALESCE(first_viewed_at, ?) WHERE view_token = ?"
        ).run(now, now, token);
      }
    } catch {
      // never fail on tracking errors
    }
  }
  return new NextResponse(GIF_1X1, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
