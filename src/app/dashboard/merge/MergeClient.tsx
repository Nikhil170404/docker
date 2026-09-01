"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Upload, Download, Merge } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

interface Template {
  id: string;
  title: string;
  description: string;
  fields: string[];
}

interface Props {
  session: SessionUser;
  templates: Template[];
  selectedTemplateId: string | null;
  initialContent: string | null;
  initialFields: string[];
}

const NAV_TABS = [
  { href: "/dashboard", label: "Documents" },
  { href: "/dashboard/templates", label: "Templates" },
  { href: "/dashboard/merge", label: "Mail Merge" },
];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
}

function applyMerge(template: string, row: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => row[key] ?? `{{${key}}}`);
}

export default function MergeClient({ session, templates, selectedTemplateId, initialContent, initialFields }: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(selectedTemplateId ?? "");
  const [csvText, setCsvText] = useState("");
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState("");

  const currentTemplate = templates.find((t) => t.id === selectedId);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      const rows = parseCSV(text);
      setCsvRows(rows);
      setMergeError(rows.length === 0 ? "No data rows found in CSV" : "");
    };
    reader.readAsText(file);
  }

  async function handleSelectTemplate(id: string) {
    setSelectedId(id);
    router.push(`/dashboard/merge?template=${id}`);
  }

  function runPreview() {
    if (!currentTemplate || csvRows.length === 0) return;
    const content = initialContent ?? `Dear {{first_name}},\n\n{{message}}\n\nRegards,\n{{sender}}`;
    setPreview(applyMerge(content, csvRows[0]));
  }

  function downloadAll() {
    if (!currentTemplate || csvRows.length === 0) return;
    const content = initialContent ?? "";
    csvRows.forEach((row, i) => {
      const merged = applyMerge(content, row);
      const blob = new Blob([merged], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentTemplate.title}_${i + 1}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });
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
            <button onClick={logout} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-foreground">
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex gap-6 text-sm">
            {NAV_TABS.map((tab) => (
              <Link key={tab.href} href={tab.href} className={`border-b-2 py-3 transition-colors ${tab.href === "/dashboard/merge" ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Mail Merge</h1>
          <p className="mt-1 text-sm text-muted">Generate personalised documents from a template + CSV data</p>
        </div>

        {/* Step 1: pick template */}
        <div className="mb-6 rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">1. Choose a template</h2>
          {templates.length === 0 ? (
            <p className="text-sm text-muted">
              No templates yet.{" "}
              <Link href="/dashboard/templates" className="text-accent hover:underline">Create one</Link>.
            </p>
          ) : (
            <select
              value={selectedId}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none"
            >
              <option value="">— Select a template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          )}
          {currentTemplate && currentTemplate.fields.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-xs text-muted">Fields:</span>
              {currentTemplate.fields.map((f) => (
                <code key={f} className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">{`{{${f}}}`}</code>
              ))}
            </div>
          )}
        </div>

        {/* Step 2: upload CSV */}
        <div className="mb-6 rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">2. Upload CSV data</h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted transition-colors hover:border-accent/50 hover:text-foreground">
            <Upload size={16} />
            {csvRows.length > 0 ? `${csvRows.length} row${csvRows.length === 1 ? "" : "s"} loaded` : "Click to upload a CSV file"}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvUpload} />
          </label>
          {mergeError && <p className="mt-2 text-xs text-red-400">{mergeError}</p>}
          {csvRows.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-surface text-muted">
                  <tr>
                    {Object.keys(csvRows[0]).map((col) => (
                      <th key={col} className="px-3 py-2 text-left font-medium">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-3 py-2 text-foreground">{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvRows.length > 5 && (
                <p className="px-3 py-2 text-xs text-muted">…and {csvRows.length - 5} more rows</p>
              )}
            </div>
          )}
        </div>

        {/* Step 3: actions */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={runPreview}
            disabled={!selectedId || csvRows.length === 0}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:opacity-40"
          >
            <Merge size={15} /> Preview first row
          </button>
          <button
            onClick={downloadAll}
            disabled={!selectedId || csvRows.length === 0}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Download size={15} /> Download all ({csvRows.length})
          </button>
        </div>

        {preview && (
          <div className="mt-6 rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Preview — row 1</h2>
            <pre className="whitespace-pre-wrap text-sm text-foreground">{preview}</pre>
          </div>
        )}
      </main>
    </div>
  );
}
