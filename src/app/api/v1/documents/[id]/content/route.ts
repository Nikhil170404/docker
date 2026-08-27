import { NextRequest, NextResponse } from "next/server";
import {
  ensureDocument,
  getContent,
  isValidDocumentId,
  saveContent,
} from "@/lib/server/document-repository";

/**
 * The editor's own load/save endpoint.
 *
 * Deliberately not behind the API key: this is called by the editor running
 * in the browser, where a key could not be kept secret anyway. Putting one in
 * the page would leak it to every viewer while protecting nothing. Document
 * ids are the capability, exactly as they are for an unlisted link, and the
 * host chooses whether to make them guessable.
 *
 * Real per-user authorisation belongs here once accounts exist — this is the
 * seam it plugs into, and the only one.
 */

/** A snapshot large enough to be a denial-of-service rather than a document. */
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;

const badId = () =>
  NextResponse.json(
    { error: { code: "invalid_request", message: "Invalid document id." } },
    { status: 400 },
  );

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidDocumentId(id)) return badId();

  const content = await getContent(id);
  // A document that exists but has never been saved is not an error — it is
  // a new document, and the editor should start empty rather than complain.
  return NextResponse.json({ content }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidDocumentId(id)) return badId();

  const raw = await req.text();
  if (raw.length > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: "payload_too_large",
          message: `Document exceeds the ${MAX_CONTENT_BYTES} byte limit.`,
        },
      },
      { status: 413 },
    );
  }

  let body: { content?: unknown; title?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Body must be JSON." } },
      { status: 400 },
    );
  }

  if (!body.content || typeof body.content !== "object") {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "Expected { content: object, title?: string }.",
        },
      },
      { status: 400 },
    );
  }

  // The embed mounts against an id its host chose, so the first save is also
  // what brings the document into existence.
  await ensureDocument(id, {
    title: typeof body.title === "string" ? body.title : undefined,
  });

  const meta = await saveContent(
    id,
    body.content as Record<string, unknown>,
    typeof body.title === "string" ? body.title : undefined,
  );
  if (!meta) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No such document." } },
      { status: 404 },
    );
  }

  return NextResponse.json({ id: meta.id, updatedAt: meta.updatedAt });
}
