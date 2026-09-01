import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import SignClient from "./SignClient";

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: req } = await admin
    .from("sign_requests")
    .select("sender_name, recipient_name, doc_title, doc_content, message, status, expires_at")
    .eq("doc_token", token)
    .single();

  if (!req) notFound();

  const expired = new Date(req.expires_at) < new Date();
  const signed = req.status === "signed";

  return (
    <SignClient
      token={token}
      signerName={req.recipient_name}
      senderName={req.sender_name}
      docTitle={req.doc_title}
      docContent={req.doc_content}
      message={req.message}
      expired={expired}
      signed={signed}
    />
  );
}
