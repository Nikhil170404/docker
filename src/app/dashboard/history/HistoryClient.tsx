"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, SkipForward, Search, Mail } from "lucide-react";
import DashboardNav from "@/components/DashboardNav";
import type { SessionUser } from "@/lib/auth";

interface LogEntry {
  id: string;
  templateId: string | null;
  recipient: string;
  subject: string;
  status: string;
  provider: string;
  sentAt: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  resend: "Resend",
  sendgrid: "SendGrid",
  smtp: "SMTP",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "sent") return (
    <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
      <CheckCircle2 size={10} /> Sent
    </span>
  );
  if (status === "skipped") return (
    <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
      <SkipForward size={10} /> Skipped
    </span>
  );
  return (
    <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
      <XCircle size={10} /> Failed
    </span>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function HistoryClient({ session, logs }: { session: SessionUser; logs: LogEntry[] }) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? logs.filter(
        (l) =>
          l.recipient.includes(query.toLowerCase()) ||
          l.subject.toLowerCase().includes(query.toLowerCase())
      )
    : logs;

  const totalSent = logs.filter((l) => l.status === "sent").length;
  const totalSkipped = logs.filter((l) => l.status === "skipped").length;
  const totalFailed = logs.filter((l) => l.status !== "sent" && l.status !== "skipped").length;

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav session={session} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Send History</h1>
          <p className="mt-1 text-sm text-muted">Last 500 emails sent from your account</p>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-border bg-surface p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{totalSent}</p>
            <p className="mt-1 text-xs text-muted">Delivered</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{totalSkipped}</p>
            <p className="mt-1 text-xs text-muted">Unsubscribed / Skipped</p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{totalFailed}</p>
            <p className="mt-1 text-xs text-muted">Failed</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email or subject…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>

        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <Mail size={40} className="mb-4 text-muted/40" />
            <p className="text-sm text-muted">No sends yet</p>
            <p className="mt-1 text-xs text-muted/60">Use Mail Merge to send your first batch</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No results for "{query}"</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-xs text-muted">
                  <th className="px-4 py-3 text-left font-medium">Recipient</th>
                  <th className="px-4 py-3 text-left font-medium">Subject</th>
                  <th className="px-4 py-3 text-left font-medium">Provider</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Sent at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-white/2">
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{log.recipient}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-foreground">{log.subject}</td>
                    <td className="px-4 py-3 text-muted">{PROVIDER_LABELS[log.provider] ?? log.provider}</td>
                    <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
                    <td className="px-4 py-3 text-xs text-muted">{fmt(log.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
