import type { IDocumentData } from "@univerjs/core";
import { loadSnapshot, saveSnapshot } from "./persistence";

/**
 * Document storage that survives the browser.
 *
 * localStorage alone meant a document lived in exactly one browser profile:
 * clearing site data lost it, and an embedded editor could never show a host's
 * user the document they saved yesterday on another machine. This talks to the
 * server instead, and keeps localStorage as a cache underneath so a failed
 * request or an offline moment degrades to the old behaviour rather than to
 * an empty page.
 *
 * The server is the source of truth when it answers; the local copy wins only
 * when it cannot.
 */

export interface RemoteDocumentStore {
  load: () => Promise<IDocumentData | null>;
  save: (snapshot: IDocumentData) => void;
  /** Flush any pending save immediately — used on unload. */
  flush: () => void;
}

const contentUrl = (documentId: string) =>
  `/api/v1/documents/${encodeURIComponent(documentId)}/content`;

/**
 * A store that reads and writes one document.
 *
 * `documentId` null means "no server document" — the standalone editor
 * opened without one — and everything falls back to the local cache.
 */
export function createDocumentStore(
  documentId: string | null,
  localKey: string,
  options: { saveDelayMs?: number } = {},
): RemoteDocumentStore {
  const saveDelayMs = options.saveDelayMs ?? 800;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: IDocumentData | null = null;
  /** Guards against an older save landing after a newer one. */
  let sequence = 0;

  const writeRemote = async (snapshot: IDocumentData, id: string) => {
    const mine = ++sequence;
    try {
      const response = await fetch(contentUrl(id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: snapshot, title: snapshot.title }),
        keepalive: true,
      });
      if (!response.ok && mine === sequence) {
        console.warn("[DocKaro] Server save failed; keeping the local copy.");
      }
    } catch {
      // Offline, or the server is down. The local cache below already has
      // this snapshot, so the work is not lost — it just is not shared yet.
    }
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!pending) return;
    const snapshot = pending;
    pending = null;
    saveSnapshot(localKey, snapshot);
    if (documentId) void writeRemote(snapshot, documentId);
  };

  return {
    async load() {
      const cached = loadSnapshot<IDocumentData>(localKey);
      if (!documentId) return cached;

      try {
        const response = await fetch(contentUrl(documentId), { cache: "no-store" });
        if (response.ok) {
          const { content } = (await response.json()) as {
            content: IDocumentData | null;
          };
          // A document the server knows nothing about yet falls back to the
          // local cache, so a first-time save is not lost by a reload.
          if (content) {
            saveSnapshot(localKey, content);
            return content;
          }
        }
      } catch {
        // Unreachable server: the cache is the best available answer.
      }
      return cached;
    },

    save(snapshot: IDocumentData) {
      pending = snapshot;
      // Write the local copy on every change so a crash never loses more than
      // the keystrokes since the last one; the network write is debounced.
      saveSnapshot(localKey, snapshot);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, saveDelayMs);
    },

    flush,
  };
}
