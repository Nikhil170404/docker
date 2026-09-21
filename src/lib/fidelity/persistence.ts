import { loadSnapshot, saveSnapshot, clearSnapshot } from "@/lib/univer/persistence";

// Named wrappers around the existing generic localStorage snapshot helpers
// (src/lib/univer/persistence.ts), so the two new keys this feature needs
// live in one place rather than being repeated as string literals at every
// call site. Deliberately does not touch persistence.ts itself — that
// module's `docs-default` key/shape (the Univer snapshot) is untouched by
// any of this.

const MODE_KEY = "docs-mode";
const FIDELITY_DOC_KEY = "docs-fidelity-mode";

export type EditorMode = "univer" | "fidelity";

export interface FidelityDocSnapshot {
  html: string;
  name: string;
  savedAt: number;
}

/** Which editor a document is in. Defaults to "univer" for every existing
 * user, since this key never existed before this feature shipped. */
export function loadEditorMode(): EditorMode {
  return loadSnapshot<EditorMode>(MODE_KEY) ?? "univer";
}

export function saveEditorMode(mode: EditorMode) {
  saveSnapshot(MODE_KEY, mode);
}

export function loadFidelityDoc(): FidelityDocSnapshot | null {
  return loadSnapshot<FidelityDocSnapshot>(FIDELITY_DOC_KEY);
}

export function saveFidelityDoc(snapshot: FidelityDocSnapshot) {
  saveSnapshot(FIDELITY_DOC_KEY, snapshot);
}

export function clearFidelityDoc() {
  clearSnapshot(FIDELITY_DOC_KEY);
  clearSnapshot(MODE_KEY);
}
