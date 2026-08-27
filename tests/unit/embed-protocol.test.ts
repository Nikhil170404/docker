import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMBED_MODE,
  EMBED_MESSAGE_NAMESPACE,
  EMBED_MODES,
  isEmbedEnvelope,
  parseEmbedMode,
} from "@/lib/embed/protocol";

describe("parseEmbedMode", () => {
  it("accepts every published mode", () => {
    for (const mode of EMBED_MODES) {
      expect(parseEmbedMode(mode)).toBe(mode);
    }
  });

  it("falls back to the default for anything else", () => {
    // The mode arrives from a query string, so it is attacker-controlled and
    // must never widen into something unexpected.
    for (const bad of ["", "DOCUMENT", "richtext ", "../admin", null, undefined]) {
      expect(parseEmbedMode(bad)).toBe(DEFAULT_EMBED_MODE);
    }
  });

  it("defaults to rich text, the safer of the two for an unknown host", () => {
    expect(DEFAULT_EMBED_MODE).toBe("richtext");
  });
});

describe("isEmbedEnvelope", () => {
  it("accepts a well-formed envelope", () => {
    expect(
      isEmbedEnvelope({
        namespace: EMBED_MESSAGE_NAMESPACE,
        direction: "event",
        event: { type: "ready", mode: "richtext", version: 1 },
      }),
    ).toBe(true);
  });

  it("rejects traffic from anything else on the page", () => {
    // A host page may have several iframes and its own postMessage chatter;
    // none of it should be mistaken for ours.
    for (const notOurs of [
      null,
      undefined,
      "hello",
      42,
      {},
      { namespace: "some-other-widget", direction: "event" },
      { direction: "request", id: "1" },
    ]) {
      expect(isEmbedEnvelope(notOurs)).toBe(false);
    }
  });
});
