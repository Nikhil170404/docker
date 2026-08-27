import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Where documents actually live.
 *
 * The API used to hold them in a Map that emptied on every restart, which
 * meant nothing an embedded editor saved could be reloaded — the single
 * reason the embed could not be used in production. This is a real store:
 * one JSON file per document under DOCKARO_DATA_DIR, written atomically.
 *
 * A filesystem rather than a database on purpose. It is durable, it needs no
 * service to run beside the app, and every operation below is the same shape
 * a Postgres table would expose — so swapping the four functions at the
 * bottom for SQL is a contained change rather than a rewrite. It does assume
 * a persistent disk and a single writer: on a serverless host or behind
 * several instances, that is the point to move to a database.
 *
 * The build warns that reading this directory "causes tracing of the whole
 * project" — that is inherent to listing files at runtime and harmless for a
 * Node server; it would matter if these routes were bundled for a serverless
 * target, which is another reason that deployment shape wants a database.
 */

export type DocumentType = "docx" | "xlsx";

export interface DocumentMeta {
  id: string;
  type: DocumentType;
  title: string;
  createdAt: string;
  updatedAt: string;
  editUrl: string;
}

/** The editor's own snapshot. Opaque here — only the editor interprets it. */
export type DocumentContent = Record<string, unknown>;

interface StoredDocument {
  meta: DocumentMeta;
  content: DocumentContent | null;
}

/**
 * Read per call rather than captured at module load: a value frozen at import
 * time cannot be pointed at a scratch directory by anything that imports this
 * module, which makes the store awkward to test and surprising to configure.
 */
const dataDirectory = () =>
  process.env.DOCKARO_DATA_DIR ?? join(process.cwd(), ".data", "documents");

const siteUrl = () => process.env.DOCKARO_SITE_URL ?? "https://dockaro.com";

/**
 * Document ids reach the filesystem, so the shape is a hard allow-list:
 * letters, digits, underscore and hyphen only. No dot and no separator means
 * no traversal, no hidden files, and no device names — while still letting a
 * host choose its own id (`DocKaro.mount({ documentId: 'invoice-1042' })`)
 * rather than being forced to store ours.
 */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidDocumentId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function pathFor(id: string): string {
  if (!isValidDocumentId(id)) {
    // Belt and braces: every caller validates, but a traversal reaching the
    // filesystem would be the worst bug in this file, so it cannot compile
    // down to a path join on unvalidated input.
    throw new Error(`Refusing to build a path for invalid document id: ${id}`);
  }
  return join(dataDirectory(), `${id}.json`);
}

async function ensureDir(): Promise<void> {
  await mkdir(dataDirectory(), { recursive: true });
}

async function read(id: string): Promise<StoredDocument | null> {
  try {
    return JSON.parse(await readFile(pathFor(id), "utf8")) as StoredDocument;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Writes through a temporary file and renames it into place. A crash midway
 * through a large save would otherwise leave a truncated JSON file, and a
 * document that cannot be parsed is worse than one that is slightly stale.
 */
async function write(doc: StoredDocument): Promise<void> {
  await ensureDir();
  const target = pathFor(doc.meta.id);
  const temp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(doc), "utf8");
  await rename(temp, target);
}

/* ------------------------------------------------------------------ */
/* The operations a database would expose                              */
/* ------------------------------------------------------------------ */

export async function createDocument(input: {
  type: DocumentType;
  title: string;
  content?: DocumentContent;
}): Promise<DocumentMeta> {
  const id = `doc_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();
  const meta: DocumentMeta = {
    id,
    type: input.type,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    editUrl: `${siteUrl()}/e/${id}`,
  };
  await write({ meta, content: input.content ?? null });
  return meta;
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  await ensureDir();
  const names = (await readdir(dataDirectory())).filter(
    (name) => name.endsWith(".json") && isValidDocumentId(name.slice(0, -5)),
  );

  const docs = await Promise.all(names.map((name) => read(name.slice(0, -5))));
  return docs
    .filter((doc): doc is StoredDocument => doc !== null)
    .map((doc) => doc.meta)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getDocument(id: string): Promise<DocumentMeta | null> {
  if (!isValidDocumentId(id)) return null;
  return (await read(id))?.meta ?? null;
}

export async function updateDocument(
  id: string,
  patch: Partial<Pick<DocumentMeta, "title">>,
): Promise<DocumentMeta | null> {
  if (!isValidDocumentId(id)) return null;
  const existing = await read(id);
  if (!existing) return null;

  const meta: DocumentMeta = {
    ...existing.meta,
    ...(patch.title === undefined ? {} : { title: patch.title }),
    updatedAt: new Date().toISOString(),
  };
  await write({ ...existing, meta });
  return meta;
}

export async function deleteDocument(id: string): Promise<boolean> {
  if (!isValidDocumentId(id)) return false;
  try {
    await unlink(pathFor(id));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Content — the part that makes an embed usable in production         */
/* ------------------------------------------------------------------ */

export async function getContent(id: string): Promise<DocumentContent | null> {
  if (!isValidDocumentId(id)) return null;
  return (await read(id))?.content ?? null;
}

/**
 * Saves the editor's snapshot. Returns null when there is no such document,
 * so a save into a deleted id fails loudly rather than resurrecting it.
 */
export async function saveContent(
  id: string,
  content: DocumentContent,
  title?: string,
): Promise<DocumentMeta | null> {
  if (!isValidDocumentId(id)) return null;
  const existing = await read(id);
  if (!existing) return null;

  const meta: DocumentMeta = {
    ...existing.meta,
    ...(title ? { title } : {}),
    updatedAt: new Date().toISOString(),
  };
  await write({ meta, content });
  return meta;
}

/**
 * Creates a document at a caller-chosen id if it does not exist yet. The
 * embed mounts against an id the host picked, so the first save has to be
 * able to bring that document into being.
 */
export async function ensureDocument(
  id: string,
  input: { type?: DocumentType; title?: string } = {},
): Promise<DocumentMeta | null> {
  if (!isValidDocumentId(id)) return null;
  const existing = await read(id);
  if (existing) return existing.meta;

  const now = new Date().toISOString();
  const meta: DocumentMeta = {
    id,
    type: input.type ?? "docx",
    title: input.title ?? "Untitled document",
    createdAt: now,
    updatedAt: now,
    editUrl: `${siteUrl()}/e/${id}`,
  };
  await write({ meta, content: null });
  return meta;
}

/** The directory documents are stored in, for tooling and tests. */
export const dataDir = dataDirectory;
