"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Sheet, Plus, Trash2, Pencil, Clock } from "lucide-react";
import DashboardNav from "@/components/DashboardNav";
import type { SessionUser } from "@/lib/auth";
import type { DocKaroDocument } from "@/lib/document-store";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  session: SessionUser;
  initialDocs: DocKaroDocument[];
}

export default function DashboardClient({ session, initialDocs }: Props) {
  const router = useRouter();
  const [docs, setDocs] = useState(initialDocs);
  const [creating, setCreating] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  async function createDoc(type: "docx" | "xlsx") {
    setCreating(true);
    try {
      const res = await fetch("/api/v1/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title: type === "docx" ? "Untitled document" : "Untitled spreadsheet" }),
      });
      const doc = await res.json();
      router.push(`/editor/${type === "docx" ? "docs" : "sheets"}/${doc.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function deleteDoc(id: string) {
    if (!confirm("Delete this document?")) return;
    await fetch(`/api/v1/documents/${id}`, { method: "DELETE" });
    setDocs((d) => d.filter((x) => x.id !== id));
  }

  async function saveRename(id: string) {
    if (!renameValue.trim()) return;
    const res = await fetch(`/api/v1/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: renameValue.trim() }),
    });
    const updated = await res.json();
    setDocs((d) => d.map((x) => (x.id === id ? updated : x)));
    setRenameId(null);
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav session={session} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            Welcome back, {session.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {docs.length === 0 ? "Create your first document to get started." : `You have ${docs.length} document${docs.length === 1 ? "" : "s"}.`}
          </p>
        </div>

        <div className="mb-8 flex flex-wrap gap-3">
          <button
            onClick={() => createDoc("docx")}
            disabled={creating}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:opacity-50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <FileText size={16} />
            </span>
            New document
            <Plus size={14} className="ml-1 text-muted" />
          </button>
          <button
            onClick={() => createDoc("xlsx")}
            disabled={creating}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:opacity-50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 text-green-400">
              <Sheet size={16} />
            </span>
            New spreadsheet
            <Plus size={14} className="ml-1 text-muted" />
          </button>
        </div>

        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <FileText size={40} className="mb-4 text-muted/40" />
            <p className="text-sm text-muted">No documents yet</p>
            <p className="mt-1 text-xs text-muted/60">Click "New document" above to create one</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      doc.type === "docx" ? "bg-blue-500/10 text-blue-400" : "bg-green-500/10 text-green-400"
                    }`}
                  >
                    {doc.type === "docx" ? <FileText size={16} /> : <Sheet size={16} />}
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => { setRenameId(doc.id); setRenameValue(doc.title); }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                      title="Rename"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => deleteDoc(doc.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex-1">
                  {renameId === doc.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(doc.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(doc.id);
                        if (e.key === "Escape") setRenameId(null);
                      }}
                      className="w-full rounded border border-accent bg-transparent px-1 py-0.5 text-sm font-medium text-foreground focus:outline-none"
                    />
                  ) : (
                    <Link
                      href={`/editor/${doc.type === "docx" ? "docs" : "sheets"}/${doc.id}`}
                      className="line-clamp-2 text-sm font-medium text-foreground hover:text-accent"
                    >
                      {doc.title}
                    </Link>
                  )}
                </div>

                <div className="mt-3 flex items-center gap-1 text-xs text-muted/60">
                  <Clock size={11} />
                  {timeAgo(doc.updatedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
