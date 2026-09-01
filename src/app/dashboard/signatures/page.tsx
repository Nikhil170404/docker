import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import SignaturesClient from "./SignaturesClient";

export default async function SignaturesPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard/signatures");

  const supabase = await createClient();
  const { data } = await supabase
    .from("sign_requests")
    .select("id, doc_token, recipient_email, recipient_name, doc_title, status, signed_at, created_at, expires_at")
    .eq("user_id", session.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return <SignaturesClient session={session} requests={data ?? []} />;
}
