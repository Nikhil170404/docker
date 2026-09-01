import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import SignaturesClient from "./SignaturesClient";

export default async function SignaturesPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/signatures");

  const db = getDb();
  const requests = db
    .prepare(
      "SELECT id, doc_token, recipient_email, recipient_name, doc_title, status, signed_at, created_at, expires_at FROM sign_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
    )
    .all(session.id) as {
    id: string;
    doc_token: string;
    recipient_email: string;
    recipient_name: string;
    doc_title: string;
    status: string;
    signed_at: string | null;
    created_at: string;
    expires_at: string;
  }[];

  return <SignaturesClient session={session} requests={requests} />;
}
