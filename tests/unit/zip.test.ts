import { describe, expect, it } from "vitest";
import { createZipBlob, textToBytes } from "@/lib/univer/docx/zip";
import { readZip, readZipText } from "@/lib/univer/docx/unzip";

/**
 * The writer and the reader are the two halves of the same format, so the
 * cheapest real test is to put something through both. A .docx that fails
 * here would fail in Word for the same reason.
 */
describe("zip round trip", () => {
  it("reads back every entry a writer produced", async () => {
    const entries = [
      { name: "[Content_Types].xml", data: textToBytes("<Types/>") },
      { name: "word/document.xml", data: textToBytes("<w:document>hello</w:document>") },
      { name: "_rels/.rels", data: textToBytes("<Relationships/>") },
    ];

    const blob = createZipBlob(entries, "application/zip");
    const archive = await readZip(await blob.arrayBuffer());

    expect([...archive.files.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
    ]);
    expect(readZipText(archive, "word/document.xml")).toBe(
      "<w:document>hello</w:document>",
    );
  });

  it("preserves UTF-8 content exactly", async () => {
    const text = "Ünïcødé — ₹9,500 — 日本語 —  nbsp";
    const blob = createZipBlob(
      [{ name: "word/document.xml", data: textToBytes(text) }],
      "application/zip",
    );
    const archive = await readZip(await blob.arrayBuffer());
    expect(readZipText(archive, "word/document.xml")).toBe(text);
  });

  it("handles an empty entry without throwing", async () => {
    const blob = createZipBlob(
      [{ name: "word/empty.xml", data: textToBytes("") }],
      "application/zip",
    );
    const archive = await readZip(await blob.arrayBuffer());
    expect(readZipText(archive, "word/empty.xml")).toBe("");
  });

  it("returns null for a part the archive does not contain", async () => {
    const blob = createZipBlob(
      [{ name: "word/document.xml", data: textToBytes("<x/>") }],
      "application/zip",
    );
    const archive = await readZip(await blob.arrayBuffer());
    expect(readZipText(archive, "word/styles.xml")).toBeNull();
  });

  it("rejects a file that is not a zip at all", async () => {
    const notAZip = textToBytes("this is plainly not a zip archive").buffer;
    await expect(readZip(notAZip as ArrayBuffer)).rejects.toThrow(/not a valid \.docx/i);
  });

  it("survives a large entry (many local headers, real offsets)", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
      name: `word/part${i}.xml`,
      data: textToBytes(`<p>${"x".repeat(500)}${i}</p>`),
    }));
    const blob = createZipBlob(entries, "application/zip");
    const archive = await readZip(await blob.arrayBuffer());

    expect(archive.files.size).toBe(60);
    expect(readZipText(archive, "word/part59.xml")).toContain("</p>");
    expect(readZipText(archive, "word/part59.xml")).toContain("59");
  });
});
