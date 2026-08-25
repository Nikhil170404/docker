/**
 * The contract between an embedded DocKaro editor and the page hosting it.
 *
 * One editor, two jobs. CKEditor and TinyMCE hand you an HTML fragment and
 * have no page model at all; ONLYOFFICE and Nutrient hand you a paginated
 * document and are priced for enterprises. A host that needs both today
 * integrates two vendors. Here it is one iframe and one `mode` flag:
 *
 *   - `richtext` — continuous flow, compact toolbar, HTML out. The comment
 *     box, the CMS field, the description editor.
 *   - `document` — real pages, margins, headers/footers, ruler, .docx out.
 *     The contract, the invoice, the offer letter.
 *
 * Both run the same engine over the same document model, which is why the
 * same content can come back as either an HTML fragment or a .docx.
 */

export const EMBED_MODES = ["richtext", "document"] as const;
export type EmbedMode = (typeof EMBED_MODES)[number];

export const DEFAULT_EMBED_MODE: EmbedMode = "richtext";

export function parseEmbedMode(value: string | null | undefined): EmbedMode {
  return EMBED_MODES.includes(value as EmbedMode)
    ? (value as EmbedMode)
    : DEFAULT_EMBED_MODE;
}

/** Version the wire format so an old cached SDK meets a new host loudly. */
export const EMBED_PROTOCOL_VERSION = 1;

/** Namespaced so a host with several iframes can tell our traffic apart. */
export const EMBED_MESSAGE_NAMESPACE = "dockaro-embed";

/* ---------------------------------------------------------------- */
/* Host → editor                                                     */
/* ---------------------------------------------------------------- */

export type EmbedRequest =
  | { type: "getHTML" }
  | { type: "getDocx" }
  | { type: "getSnapshot" }
  | { type: "setName"; name: string }
  | { type: "focus" };

export interface EmbedRequestEnvelope {
  namespace: typeof EMBED_MESSAGE_NAMESPACE;
  direction: "request";
  /** Correlates a reply with its call; the SDK resolves a promise on it. */
  id: string;
  request: EmbedRequest;
}

/* ---------------------------------------------------------------- */
/* Editor → host                                                     */
/* ---------------------------------------------------------------- */

export interface EmbedReadyEvent {
  type: "ready";
  mode: EmbedMode;
  version: number;
}

export interface EmbedChangeEvent {
  type: "change";
  wordCount: number;
  /** Always 1 in richtext mode — continuous flow has no page count. */
  pageCount: number;
}

export type EmbedEvent = EmbedReadyEvent | EmbedChangeEvent;

export interface EmbedEventEnvelope {
  namespace: typeof EMBED_MESSAGE_NAMESPACE;
  direction: "event";
  event: EmbedEvent;
}

export interface EmbedResponseEnvelope {
  namespace: typeof EMBED_MESSAGE_NAMESPACE;
  direction: "response";
  id: string;
  /** Present on success; `error` is present instead on failure. */
  result?: unknown;
  error?: string;
}

export type EmbedEnvelope =
  | EmbedRequestEnvelope
  | EmbedEventEnvelope
  | EmbedResponseEnvelope;

export function isEmbedEnvelope(value: unknown): value is EmbedEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { namespace?: unknown }).namespace === EMBED_MESSAGE_NAMESPACE
  );
}
