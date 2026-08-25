// Reading the other half of the format `zip.ts` writes. A .docx is a ZIP of
// XML parts, so opening one means walking the central directory and
// inflating the entries we care about.
//
// No JSZip: browsers ship `DecompressionStream("deflate-raw")`, which is
// exactly the codec ZIP's method 8 uses, so the whole reader is ~100 lines
// and adds nothing to the bundle. `zip.ts` writes stored (method 0)
// entries; Word writes deflated ones, so both paths are handled.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
/** Max size of the end-of-central-directory record plus its comment. */
const EOCD_MAX_SCAN = 66_000;

export interface ZipArchive {
  /** Entry path (e.g. `word/document.xml`) to its uncompressed bytes. */
  files: Map<string, Uint8Array>;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Finds the end-of-central-directory record, which ZIP puts last. */
function findEocd(view: DataView, bytes: Uint8Array): number {
  const start = Math.max(0, bytes.length - EOCD_MAX_SCAN);
  for (let i = bytes.length - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

export async function readZip(buffer: ArrayBuffer): Promise<ZipArchive> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const eocd = findEocd(view, bytes);
  if (eocd < 0) {
    throw new Error("Not a valid .docx file — no ZIP directory found.");
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);

  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) break;

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    // The local header repeats the name and extra fields, and its extra
    // field length can differ from the central one — so the data offset has
    // to be read from the local header, never computed from the central.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    // Directory entries have no content and would fail to inflate.
    if (!name.endsWith("/")) {
      try {
        files.set(name, method === 0 ? raw.slice() : await inflateRaw(raw));
      } catch {
        // One unreadable part (an odd image, a vendor extension) must not
        // sink the whole import — document.xml is what actually matters.
      }
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return { files };
}

/** Reads one entry as UTF-8 text, or null when the archive has no such part. */
export function readZipText(archive: ZipArchive, path: string): string | null {
  const bytes = archive.files.get(path);
  return bytes ? new TextDecoder().decode(bytes) : null;
}
