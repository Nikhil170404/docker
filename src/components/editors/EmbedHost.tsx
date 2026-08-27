"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { DocsEditorHandle, WordDocumentStatus } from "@/components/editors/DocsEditor";
import { toDocxBlob, toHtmlFragment } from "@/lib/univer/doc-export";
import {
  EMBED_MESSAGE_NAMESPACE,
  EMBED_PROTOCOL_VERSION,
  isEmbedEnvelope,
  type EmbedEvent,
  type EmbedMode,
  type EmbedRequest,
} from "@/lib/embed/protocol";

const DocsEditor = dynamic(() => import("@/components/editors/DocsEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-word-muted">
      Loading editor…
    </div>
  ),
});

/**
 * Where replies and events are posted. The parent frame already has the
 * content it put in here, so echoing it back to that same origin leaks
 * nothing — but posting to "*" would hand it to any window that later
 * framed us, so the referrer's origin is the default target and requests
 * are always answered on the origin they arrived from.
 */
function parentOrigin(): string {
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    // A malformed referrer is not worth failing the whole embed over.
  }
  return "*";
}

/** Must match the key DocsEditor is mounted with, below. */
const storageKeyFor = (documentId: string, mode: EmbedMode) =>
  `embed:${documentId}:${mode}`;

export default function EmbedHost({
  documentId,
  mode,
}: {
  documentId: string;
  mode: EmbedMode;
}) {
  const apiRef = useRef<DocsEditorHandle | null>(null);
  const originRef = useRef<string>("*");
  const [status, setStatus] = useState<WordDocumentStatus | null>(null);
  const statusRef = useRef<WordDocumentStatus | null>(null);

  const post = useCallback((payload: object, origin?: string) => {
    if (window.parent === window) return; // Opened directly, not framed.
    window.parent.postMessage(payload, origin ?? originRef.current);
  }, []);

  const emit = useCallback(
    (event: EmbedEvent) => {
      post({
        namespace: EMBED_MESSAGE_NAMESPACE,
        direction: "event",
        event,
      });
    },
    [post],
  );

  /** Run one host→editor call and hand back a structured-cloneable result. */
  const handleRequest = useCallback(async (request: EmbedRequest): Promise<unknown> => {
    const api = apiRef.current;
    if (!api) throw new Error("Editor is not ready yet.");

    switch (request.type) {
      case "getHTML": {
        const snapshot = api.getSnapshot();
        if (!snapshot) throw new Error("No document loaded.");
        return toHtmlFragment(snapshot);
      }
      case "getDocx": {
        const snapshot = api.getSnapshot();
        if (!snapshot) throw new Error("No document loaded.");
        const blob = await toDocxBlob(snapshot);
        // An ArrayBuffer clones everywhere; Blob support across frames is
        // less uniform, so the SDK rebuilds the Blob on its own side.
        return {
          buffer: await blob.arrayBuffer(),
          mimeType: blob.type,
          filename: `${snapshot.title || "document"}.docx`,
        };
      }
      case "loadDocx": {
        const { importDocx } = await import("@/lib/univer/docx/import");
        const { document: imported, warnings } = await importDocx(
          request.buffer,
          request.fileName,
        );
        // The editor's own replace path: it suppresses the autosave that
        // would otherwise write the outgoing document back over the import
        // during the reload. Deferred a tick so this call's response reaches
        // the host before the frame navigates — otherwise the caller's
        // promise never settles.
        setTimeout(() => api.replaceDocument(imported), 0);
        return { warnings };
      }
      case "getSnapshot":
        return api.getSnapshot();
      case "setName":
        api.setName(request.name);
        return null;
      case "focus":
        window.focus();
        return null;
    }
  }, []);

  useEffect(() => {
    originRef.current = parentOrigin();

    const onMessage = async (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isEmbedEnvelope(event.data) || event.data.direction !== "request") return;

      // Answer on the origin the call arrived from, not a remembered one.
      const replyOrigin = event.origin === "null" ? "*" : event.origin;
      const { id, request } = event.data;

      try {
        const result = await handleRequest(request);
        post(
          { namespace: EMBED_MESSAGE_NAMESPACE, direction: "response", id, result },
          replyOrigin,
        );
      } catch (error) {
        post(
          {
            namespace: EMBED_MESSAGE_NAMESPACE,
            direction: "response",
            id,
            error: error instanceof Error ? error.message : String(error),
          },
          replyOrigin,
        );
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleRequest, post]);

  // `ready` has to wait for the editor handle, not just this component:
  // a host that calls getHTML() the instant it sees `ready` must not race
  // the dynamic import.
  useEffect(() => {
    if (!status) return;
    if (statusRef.current === null) {
      emit({ type: "ready", mode, version: EMBED_PROTOCOL_VERSION });
    } else {
      emit({
        type: "change",
        wordCount: status.wordCount,
        pageCount: status.pageCount,
      });
    }
    statusRef.current = status;
  }, [status, mode, emit]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-word-canvas text-word-text">
      <DocsEditor
        apiRef={apiRef}
        onStatusChange={setStatus}
        options={{
          mode,
          // Each embedded document gets its own autosave slot, so two
          // editors on one page never overwrite each other.
          storageKey: storageKeyFor(documentId, mode),
          // Exactly the id the host mounted with — no suffix. A document
          // created through the API and then embedded by its own id has to
          // load and save as itself, and the two modes are two renderings of
          // one document, not two documents. The local cache key below still
          // carries the mode, since that is a per-rendering cache.
          documentId,
          wordChrome: mode === "document",
        }}
      />
    </div>
  );
}
