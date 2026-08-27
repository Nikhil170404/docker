import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The repository reads its directory once at module load, so the override has
// to be in place before the import.
const DATA_DIR = mkdtempSync(join(tmpdir(), "dockaro-repo-"));
process.env.DOCKARO_DATA_DIR = DATA_DIR;
process.env.DOCKARO_SITE_URL = "https://example.test";

const repo = await import("@/lib/server/document-repository");

function clear() {
  for (const name of readdirSync(DATA_DIR)) {
    rmSync(join(DATA_DIR, name), { force: true });
  }
}

beforeEach(clear);
afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));

describe("id validation", () => {
  it("accepts our own ids and host-chosen slugs", () => {
    for (const id of ["doc_abc123", "invoice-1042", "demo_document", "A1", "x".repeat(64)]) {
      expect(repo.isValidDocumentId(id), id).toBe(true);
    }
  });

  it("rejects anything that could escape the data directory", () => {
    // These ids become file names, so traversal and separators are the whole
    // risk surface of a filesystem-backed store.
    for (const id of [
      "../secret",
      "..",
      ".",
      "a/b",
      "a\\b",
      "doc.json",
      ".hidden",
      "",
      "with space",
      "x".repeat(65),
      "café",
    ]) {
      expect(repo.isValidDocumentId(id), id).toBe(false);
    }
  });

  it("never reads or writes through an invalid id", async () => {
    expect(await repo.getDocument("../escape")).toBeNull();
    expect(await repo.getContent("../escape")).toBeNull();
    expect(await repo.saveContent("../escape", { a: 1 })).toBeNull();
    expect(await repo.deleteDocument("../escape")).toBe(false);
    expect(await repo.ensureDocument("../escape")).toBeNull();
  });
});

describe("document lifecycle", () => {
  it("creates a document with a well-formed id and edit URL", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Invoice" });
    expect(repo.isValidDocumentId(doc.id)).toBe(true);
    expect(doc.editUrl).toBe(`https://example.test/e/${doc.id}`);
    expect(doc.title).toBe("Invoice");
  });

  it("reads a document back after it is written", async () => {
    const created = await repo.createDocument({ type: "docx", title: "Contract" });
    const read = await repo.getDocument(created.id);
    expect(read).toEqual(created);
  });

  it("lists newest first", async () => {
    const a = await repo.createDocument({ type: "docx", title: "First" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await repo.createDocument({ type: "docx", title: "Second" });

    const listed = await repo.listDocuments();
    expect(listed.map((d) => d.id)).toEqual([b.id, a.id]);
  });

  it("renames without touching content", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Draft" });
    await repo.saveContent(doc.id, { body: { dataStream: "hello" } });

    const renamed = await repo.updateDocument(doc.id, { title: "Final" });
    expect(renamed!.title).toBe("Final");
    expect(await repo.getContent(doc.id)).toEqual({ body: { dataStream: "hello" } });
  });

  it("deletes, and reports whether anything was there", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Temp" });
    expect(await repo.deleteDocument(doc.id)).toBe(true);
    expect(await repo.deleteDocument(doc.id)).toBe(false);
    expect(await repo.getDocument(doc.id)).toBeNull();
  });

  it("returns null for a document that never existed", async () => {
    expect(await repo.getDocument("nope")).toBeNull();
    expect(await repo.updateDocument("nope", { title: "x" })).toBeNull();
  });
});

describe("content", () => {
  it("survives being written and read back", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Doc" });
    const content = {
      body: { dataStream: "Master Services Agreement\r\n", paragraphs: [{ startIndex: 25 }] },
      documentStyle: { pageSize: { width: 794, height: 1123 } },
    };

    await repo.saveContent(doc.id, content);
    expect(await repo.getContent(doc.id)).toEqual(content);
  });

  it("is null for a document that has never been saved", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Empty" });
    expect(await repo.getContent(doc.id)).toBeNull();
  });

  it("refuses to resurrect a deleted document", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Gone" });
    await repo.deleteDocument(doc.id);
    expect(await repo.saveContent(doc.id, { a: 1 })).toBeNull();
  });

  it("updates the title alongside the content when given one", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Untitled" });
    const meta = await repo.saveContent(doc.id, { a: 1 }, "Renamed by editor");
    expect(meta!.title).toBe("Renamed by editor");
  });

  it("advances updatedAt on every save", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Doc" });
    await new Promise((r) => setTimeout(r, 5));
    const saved = await repo.saveContent(doc.id, { a: 1 });
    expect(saved!.updatedAt >= doc.updatedAt).toBe(true);
    expect(saved!.createdAt).toBe(doc.createdAt);
  });
});

describe("ensureDocument", () => {
  it("creates a document at a host-chosen id", async () => {
    const meta = await repo.ensureDocument("invoice-1042", { title: "Invoice 1042" });
    expect(meta!.id).toBe("invoice-1042");
    expect(await repo.getDocument("invoice-1042")).not.toBeNull();
  });

  it("is idempotent and never clobbers existing content", async () => {
    await repo.ensureDocument("shared-doc");
    await repo.saveContent("shared-doc", { body: { dataStream: "typed" } });

    await repo.ensureDocument("shared-doc", { title: "Should be ignored" });
    expect(await repo.getContent("shared-doc")).toEqual({
      body: { dataStream: "typed" },
    });
  });
});

describe("durability", () => {
  it("ignores files that are not documents", async () => {
    await repo.createDocument({ type: "docx", title: "Real" });
    writeFileSync(join(DATA_DIR, "notes.txt"), "stray file");
    writeFileSync(join(DATA_DIR, "..sneaky.json"), "{}");

    const listed = await repo.listDocuments();
    expect(listed).toHaveLength(1);
    expect(listed[0].title).toBe("Real");
  });

  it("leaves no temporary files behind after a write", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Doc" });
    await repo.saveContent(doc.id, { a: 1 });
    // Writes go through a temp file and a rename; a leftover .tmp would mean
    // the rename never happened and the document is only half-written.
    expect(readdirSync(DATA_DIR).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps a large document intact", async () => {
    const doc = await repo.createDocument({ type: "docx", title: "Big" });
    const content = { body: { dataStream: "x".repeat(200_000) } };
    await repo.saveContent(doc.id, content);
    expect(await repo.getContent(doc.id)).toEqual(content);
  });
});
