"use client";

import { useEffect, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

type EditorApi = {
  ready: Promise<unknown>;
  getHTML: () => Promise<string>;
  getDocx: () => Promise<Blob>;
  loadDocx: (file: File) => Promise<{ warnings: string[] }>;
  destroy: () => void;
};

declare global {
  interface Window {
    DocKaro?: {
      mount: (
        target: string | Element,
        options?: Record<string, unknown>,
      ) => EditorApi;
    };
  }
}

const SNIPPET = `<div id="editor"></div>
<script src="https://dockaro.com/dockaro.js"></script>
<script>
  const editor = DocKaro.mount('#editor', {
    mode: 'richtext',        // or 'document'
    onChange: (e) => console.log(e.wordCount),
  });

  await editor.ready;
  await editor.loadDocx(file);           // open an existing .docx
  const html = await editor.getHTML();   // an HTML fragment
  const docx = await editor.getDocx();   // a real .docx Blob
</script>`;

export default function EmbedDemoPage() {
  const [mode, setMode] = useState<"richtext" | "document">("richtext");
  const [output, setOutput] = useState("");
  const [words, setWords] = useState(0);
  const [status, setStatus] = useState("loading SDK…");
  const editorRef = useRef<EditorApi | null>(null);

  useEffect(() => {
    let cancelled = false;

    const boot = () => {
      if (cancelled || !window.DocKaro) return;
      editorRef.current?.destroy();
      setOutput("");
      setStatus("mounting…");

      const editor = window.DocKaro.mount("#dockaro-editor", {
        mode,
        baseUrl: window.location.origin,
        documentId: `demo-${mode}`,
        height: mode === "document" ? "620px" : "340px",
        onChange: (e: { wordCount: number }) => setWords(e.wordCount),
      });
      editorRef.current = editor;
      editor.ready.then(() => !cancelled && setStatus("ready"));
    };

    if (window.DocKaro) {
      boot();
    } else {
      const script = document.createElement("script");
      script.src = "/dockaro.js";
      script.onload = boot;
      script.onerror = () => setStatus("failed to load SDK");
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
    };
  }, [mode]);

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="border-b border-border px-6 py-16 text-center">
          <h1 className="text-balance mx-auto max-w-3xl text-4xl font-semibold tracking-tight">
            One editor. Both jobs.
          </h1>
          <p className="text-balance mx-auto mt-4 max-w-2xl text-muted">
            The same embed does the rich-text field CKEditor and TinyMCE give
            you, and the paginated document editor they cannot. Flip the mode
            and watch the same integration change shape.
          </p>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex rounded-lg border border-border bg-surface p-1 text-sm">
              {(["richtext", "document"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-4 py-2 transition-colors ${
                    mode === m ? "bg-white text-black" : "text-muted hover:text-foreground"
                  }`}
                >
                  {m === "richtext" ? "Rich text (HTML out)" : "Document (.docx out)"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">
              <span data-testid="embed-status">{status}</span> · {words} words
            </p>
          </div>

          <div id="dockaro-editor" className="mt-6" />

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={async () => {
                const html = await editorRef.current!.getHTML();
                setOutput(html);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface"
            >
              getHTML()
            </button>
            <label className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface">
              loadDocx()
              <input
                type="file"
                accept=".docx"
                className="hidden"
                data-testid="embed-load-docx"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const { warnings } = await editorRef.current!.loadDocx(file);
                  setOutput(
                    `Loaded ${file.name}` +
                      (warnings.length ? ` — ${warnings.join("; ")}` : ""),
                  );
                }}
              />
            </label>
            <button
              onClick={async () => {
                const blob = await editorRef.current!.getDocx();
                setOutput(
                  `.docx Blob — ${blob.size.toLocaleString()} bytes, type "${blob.type}"`,
                );
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface"
            >
              getDocx()
            </button>
          </div>

          {output && (
            <pre
              data-testid="embed-output"
              className="mt-4 max-h-64 overflow-auto rounded-xl border border-border bg-surface p-4 text-xs leading-relaxed text-muted"
            >
              {output}
            </pre>
          )}

          <h2 className="mt-14 text-xl font-semibold tracking-tight">
            The whole integration
          </h2>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-border bg-[#0c0c0e] p-5 text-xs leading-relaxed text-muted">
            {SNIPPET}
          </pre>
          <p className="mt-4 text-sm text-muted">
            No licence key, no banner in front of your users, and the same
            script works against your own deployment via{" "}
            <code className="text-foreground">baseUrl</code>.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
