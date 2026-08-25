import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-auth";
import { deleteDocument, getDocument, updateDocument } from "@/lib/document-store";

const notFound = (headers: Record<string, string>) =>
  NextResponse.json(
    { error: { code: "not_found", message: "No such document." } },
    { status: 404, headers },
  );

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return notFound(auth.headers);

  return NextResponse.json(doc, { headers: auth.headers });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const doc = updateDocument(id, { title: body?.title });
  if (!doc) return notFound(auth.headers);

  return NextResponse.json(doc, { headers: auth.headers });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const ok = deleteDocument(id);
  if (!ok) return notFound(auth.headers);

  return new NextResponse(null, { status: 204, headers: auth.headers });
}
