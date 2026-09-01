"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2, LogOut, Merge, Tag } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

interface Template {
  id: string;
  title: string;
  description: string;
  fields: string[];
  createdAt: string;
  updatedAt: string;
}

const NAV_TABS = [
  { href: "/dashboard", label: "Documents" },
  { href: "/dashboard/templates", label: "Templates" },
];

export default function TemplatesClient({
  session,
  initialTemplates,
}: {
  session: SessionUser;
  initialTemplates: Template[];
}) {
  const router = useRouter();
  const [templates, setTemplates] = useState(initialTemplates);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newFields, setNewFields] = useState("");
  const [creating, setCreating] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function createTemplate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    const fields = newFields.split(",").map((f) => f.trim()).filter(Boolean);
    const res = await fetch("/api/v1/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, description: newDesc, fields }),
    });
    const tpl = await res.json();
    setTemplates((t) => [tpl, ...t]);
    setNewTitle(""); setNewDesc(""); setNewFields("");
    setShowCreate(false);
    setCreating(false);
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/v1/templates/${id}`, { method: "DELETE" });
    setTemplates((t) => t.filter((x) => x.id !== id));
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-white">D</span>
            DocKaro
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-muted sm:block">{session.email}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex gap-6 text-sm">
            {NAV_TABS.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`border-b-2 py-3 transition-colors ${
                  tab.href === "/dashboard/templates"
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Templates</h1>
            <p className="mt-1 text-sm text-muted">Reusable documents with merge fields for mail merge</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} /> New template
          </button>
        </div>

        {showCreate && (
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Create template</h2>
            <div className="flex flex-col gap-3">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Template name (e.g. Invoice, Offer letter)"
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <input
                value={newFields}
                onChange={(e) => setNewFields(e.target.value)}
                placeholder="Merge fields, comma-separated (e.g. first_name, company, amount)"
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={createTemplate}
                  disabled={creating || !newTitle.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <FileText size={40} className="mb-4 text-muted/40" />
            <p className="text-sm text-muted">No templates yet</p>
            <p className="mt-1 text-xs text-muted/60">Create a template to use with mail merge</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => (
              <div key={tpl.id} className="group relative rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                    <FileText size={16} />
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Link
                      href={`/dashboard/merge?template=${tpl.id}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                      title="Mail merge"
                    >
                      <Merge size={13} />
                    </Link>
                    <button
                      onClick={() => deleteTemplate(tpl.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-sm font-medium text-foreground">{tpl.title}</p>
                  {tpl.description && <p className="mt-1 text-xs text-muted">{tpl.description}</p>}
                  {tpl.fields.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tpl.fields.map((f) => (
                        <span key={f} className="flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                          <Tag size={9} />
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
