import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listDocuments } from "@/lib/document-store";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/dashboard");

  const docs = listDocuments(session.id);

  return <DashboardClient session={session} initialDocs={docs} />;
}
