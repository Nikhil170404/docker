import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
      const admin = createAdminClient();
      const now = new Date().toISOString();
      const { data: row } = await admin
        .from("email_views")
        .select("id, view_count, first_viewed_at")
        .eq("view_token", token)
        .single();
      if (row) {
        await admin
          .from("email_views")
          .update({
            view_count: (row.view_count ?? 0) + 1,
            last_viewed_at: now,
            first_viewed_at: row.first_viewed_at ?? now,
          })
          .eq("view_token", token);
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
