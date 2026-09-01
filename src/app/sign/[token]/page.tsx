import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import SignClient from "./SignClient";

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();

  const req = db
    .prepare(
      "SELECT id, sender_name, recipient_email, recipient_name, doc_title, doc_content, message, status, expires_at FROM sign_requests WHERE doc_token = ?"
    )
    .get(token) as {
    id: string;
    sender_name: string;
    recipient_email: string;
    recipient_name: string;
    doc_title: string;
    doc_content: string;
    message: string;
    status: string;
    expires_at: string;
  } | undefined;

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
