import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-auth";
import {
  deleteDocument,
  getDocument,
  updateDocument,
} from "@/lib/server/document-repository";

const notFound = (headers: Record<string, string>) =>
  NextResponse.json(
    { error: { code: "not_found", message: "No such document." } },
    { status: 404, headers },
  );

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  const doc = await getDocument((await params).id);
  if (!doc) return notFound(auth.headers);

  return NextResponse.json(doc, { headers: auth.headers });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const doc = await updateDocument((await params).id, { title: body?.title });
  if (!doc) return notFound(auth.headers);

  return NextResponse.json(doc, { headers: auth.headers });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  if (!(await deleteDocument((await params).id))) return notFound(auth.headers);
  return new NextResponse(null, { status: 204, headers: auth.headers });
}
