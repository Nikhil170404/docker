import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createDocument, listDocuments } from "@/lib/document-store";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ data: await listDocuments(session.id) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !["docx", "xlsx"].includes(body.type)) {
    return NextResponse.json(
      { error: "Expected { type: 'docx' | 'xlsx', title: string }" },
      { status: 400 }
    );
  }

  const doc = await createDocument(session.id, {
    type: body.type,
    title: body.title,
    content: body.content,
  });
  return NextResponse.json(doc, { status: 201 });
}
