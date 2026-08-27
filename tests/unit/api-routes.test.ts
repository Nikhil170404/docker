import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

// Documents are on disk now, so the routes get a throwaway directory rather
// than writing into the working tree.
const DATA_DIR = mkdtempSync(join(tmpdir(), "dockaro-api-"));
process.env.DOCKARO_DATA_DIR = DATA_DIR;
import { GET, POST } from "@/app/api/v1/documents/route";
import {
  DELETE as DELETE_ONE,
  GET as GET_ONE,
  PATCH as PATCH_ONE,
} from "@/app/api/v1/documents/[id]/route";
import { __resetUsage } from "@/lib/api-usage";

const KEY = "dk_test_51H7x9pQwErTyUiOpAsDfGh";
const URL_BASE = "http://localhost/api/v1/documents";

function req(
  url: string,
  init: { method?: string; body?: unknown; key?: string | null } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init.key !== null) headers.set("Authorization", `Bearer ${init.key ?? KEY}`);
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  __resetUsage();
  for (const name of readdirSync(DATA_DIR)) rmSync(join(DATA_DIR, name), { force: true });
});

afterAll(() => rmSync(DATA_DIR, { recursive: true, force: true }));

describe("authentication", () => {
  it("rejects a request with no key", async () => {
    const res = await GET(req(URL_BASE, { key: null }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("rejects an unknown key", async () => {
    const res = await GET(req(URL_BASE, { key: "dk_live_not_a_real_key" }));
    expect(res.status).toBe(401);
  });

  it("does not meter a request it refused", async () => {
    await GET(req(URL_BASE, { key: null }));
    const res = await GET(req(URL_BASE));
    // An unauthorised call must not consume the caller's quota.
    expect(res.headers.get("X-DocKaro-Loads-Used")).toBe("1");
  });
});

describe("usage headers", () => {
  it("attaches them to a successful list", async () => {
    const res = await GET(req(URL_BASE));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-DocKaro-Overage-Billing")).toBe("none");
    expect(res.headers.get("X-DocKaro-Loads-Limit")).toBe("5000");
  });

  it("attaches them to a validation failure too", async () => {
    const res = await POST(
      req(URL_BASE, { method: "POST", body: { type: "nope", title: 1 } }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("X-DocKaro-Loads-Used")).toBeTruthy();
  });

  it("counts each call once, in order", async () => {
    const a = await GET(req(URL_BASE));
    const b = await GET(req(URL_BASE));
    expect(a.headers.get("X-DocKaro-Loads-Used")).toBe("1");
    expect(b.headers.get("X-DocKaro-Loads-Used")).toBe("2");
  });
});

describe("document lifecycle", () => {
  it("creates, reads, renames and deletes", async () => {
    const created = await POST(
      req(URL_BASE, { method: "POST", body: { type: "docx", title: "Invoice #1" } }),
    );
    expect(created.status).toBe(201);
    const doc = await created.json();
    expect(doc.id).toMatch(/^doc_/);
    expect(doc.editUrl).toContain(`/e/${doc.id}`);

    const read = await GET_ONE(req(`${URL_BASE}/${doc.id}`), params(doc.id));
    expect(read.status).toBe(200);
    expect((await read.json()).title).toBe("Invoice #1");

    const renamed = await PATCH_ONE(
      req(`${URL_BASE}/${doc.id}`, { method: "PATCH", body: { title: "Invoice #2" } }),
      params(doc.id),
    );
    expect((await renamed.json()).title).toBe("Invoice #2");

    const removed = await DELETE_ONE(
      req(`${URL_BASE}/${doc.id}`, { method: "DELETE" }),
      params(doc.id),
    );
    expect(removed.status).toBe(204);

    const gone = await GET_ONE(req(`${URL_BASE}/${doc.id}`), params(doc.id));
    expect(gone.status).toBe(404);
  });

  it("rejects an unsupported document type", async () => {
    const res = await POST(
      req(URL_BASE, { method: "POST", body: { type: "pptx", title: "Deck" } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("rejects a malformed body without throwing", async () => {
    const request = new NextRequest(URL_BASE, {
      method: "POST",
      headers: new Headers({ Authorization: `Bearer ${KEY}` }),
      body: "{ not json",
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("404s an unknown id on every verb", async () => {
    const id = "doc_does_not_exist";
    expect((await GET_ONE(req(`${URL_BASE}/${id}`), params(id))).status).toBe(404);
    expect(
      (await PATCH_ONE(req(`${URL_BASE}/${id}`, { method: "PATCH", body: { title: "x" } }), params(id))).status,
    ).toBe(404);
    expect(
      (await DELETE_ONE(req(`${URL_BASE}/${id}`, { method: "DELETE" }), params(id))).status,
    ).toBe(404);
  });

  it("keeps usage headers on a 404", async () => {
    const res = await GET_ONE(req(`${URL_BASE}/doc_missing`), params("doc_missing"));
    expect(res.headers.get("X-DocKaro-Overage-Billing")).toBe("none");
  });
});
