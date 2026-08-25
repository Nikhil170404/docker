import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-auth";
import { createDocument, listDocuments } from "@/lib/document-store";

export async function GET(req: NextRequest) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ data: listDocuments() }, { headers: auth.headers });
}

export async function POST(req: NextRequest) {
  const auth = authorize(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);

  if (!body || typeof body.title !== "string" || !["docx", "xlsx"].includes(body.type)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "Expected { type: 'docx' | 'xlsx', title: string }.",
        },
      },
      { status: 400, headers: auth.headers },
    );
  }

  const doc = createDocument({ type: body.type, title: body.title });
  return NextResponse.json(doc, { status: 201, headers: auth.headers });
}
