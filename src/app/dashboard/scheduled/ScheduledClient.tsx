"use client";
import { useState } from "react";
import { CalendarClock, CheckCircle2, Clock, XCircle, AlertCircle } from "lucide-react";
import DashboardNav from "@/components/DashboardNav";
import type { SessionUser } from "@/lib/auth";

interface Row {
  id: string;
  template_title: string;
  recipient_count: number;
  scheduled_for: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "sent") return (
    <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
      <CheckCircle2 size={10} /> Sent
    </span>
  );
  if (status === "pending") return (
    <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
      <Clock size={10} /> Pending
    </span>
  );
  if (status === "failed") return (
    <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
      <AlertCircle size={10} /> Failed
    </span>
  );
  return (
    <span className="flex items-center gap-1 rounded-full bg-border px-2 py-0.5 text-xs font-medium text-muted">
      <XCircle size={10} /> Cancelled
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function ScheduledClient({ session, rows: initialRows }: { session: SessionUser; rows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function cancel(id: string) {
    setCancelling(id);
    const res = await fetch(`/api/v1/scheduled/${id}`, { method: "DELETE" });
    if (res.ok) setRows((prev) => prev.map((r) => r.id === id ? { ...r, status: "cancelled" } : r));
    setCancelling(null);
  }

  const pending = rows.filter((r) => r.status === "pending").length;
  const sent = rows.filter((r) => r.status === "sent").length;

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav session={session} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Scheduled Sends</h1>
          <p className="mt-1 text-sm text-muted">
            Emails scheduled from Mail Merge will appear here and send automatically at the chosen time.
          </p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-3 gap-3">
          {[
            { label: "Total", value: rows.length, cls: "text-foreground" },
            { label: "Pending", value: pending, cls: "text-amber-400" },
            { label: "Sent", value: sent, cls: "text-green-400" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
              <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
              <p className="mt-1 text-xs text-muted">{s.label}</p>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <CalendarClock size={40} className="mb-4 text-muted/40" />
            <p className="text-sm text-muted">No scheduled sends</p>
            <p className="mt-1 text-xs text-muted/60">Set a future send date in Mail Merge to schedule a batch</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="px-4 py-3 text-left font-medium">Template</th>
                    <th className="px-4 py-3 text-left font-medium">Recipients</th>
                    <th className="px-4 py-3 text-left font-medium">Scheduled For</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium text-foreground">{r.template_title || "—"}</td>
                      <td className="px-4 py-3 text-muted">{r.recipient_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-muted">{fmtDate(r.scheduled_for)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                        {r.error && <p className="mt-0.5 max-w-xs truncate text-xs text-red-400">{r.error}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {r.status === "pending" && (
                          <button
                            onClick={() => cancel(r.id)}
                            disabled={cancelling === r.id}
                            className="text-xs text-red-400 transition-opacity hover:opacity-70 disabled:opacity-40"
                          >
                            {cancelling === r.id ? "Cancelling…" : "Cancel"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
