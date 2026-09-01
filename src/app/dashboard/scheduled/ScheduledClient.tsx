"use client";
import { useState } from "react";
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

interface Props {
  session: SessionUser;
  rows: Row[];
}

const statusColors: Record<string, { bg: string; text: string }> = {
  pending:   { bg: "#fef9c3", text: "#854d0e" },
  sent:      { bg: "#dcfce7", text: "#166534" },
  failed:    { bg: "#fee2e2", text: "#991b1b" },
  cancelled: { bg: "#f1f5f9", text: "#64748b" },
};

export default function ScheduledClient({ session, rows: initialRows }: Props) {
  const [rows, setRows] = useState(initialRows);

  async function cancel(id: string) {
    const res = await fetch(`/api/v1/scheduled/${id}`, { method: "DELETE" });
    if (res.ok) {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "cancelled" } : r)));
    }
  }

  const pending = rows.filter((r) => r.status === "pending").length;
  const sent = rows.filter((r) => r.status === "sent").length;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <DashboardNav session={session} />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 }}>Scheduled Sends</h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>
            Schedule bulk emails from the Mail Merge page. They will be sent automatically at the chosen time.
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
          {[
            { label: "Total", value: rows.length },
            { label: "Pending", value: pending },
            { label: "Sent", value: sent },
          ].map((s) => (
            <div key={s.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "20px 24px" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#3b82f6" }}>{s.value}</div>
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          {rows.length === 0 ? (
            <div style={{ padding: "48px 24px", textAlign: "center", color: "#94a3b8" }}>
              No scheduled sends yet. Use the Mail Merge page to schedule a bulk send.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Template", "Recipients", "Scheduled For", "Status", ""].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const c = statusColors[r.status] ?? { bg: "#f1f5f9", text: "#64748b" };
                    return (
                      <tr key={r.id} style={{ borderBottom: i < rows.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                        <td style={{ padding: "12px 16px", fontSize: 14, color: "#1e293b", fontWeight: 500 }}>
                          {r.template_title || "—"}
                        </td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#475569" }}>{r.recipient_count}</td>
                        <td style={{ padding: "12px 16px", fontSize: 13, color: "#475569" }}>
                          {new Date(r.scheduled_for).toLocaleString("en-IN", {
                            day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                          })}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ background: c.bg, color: c.text, fontSize: 11, padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
                            {r.status}
                          </span>
                          {r.error && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 2 }}>{r.error}</div>}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          {r.status === "pending" && (
                            <button
                              onClick={() => cancel(r.id)}
                              style={{ fontSize: 12, color: "#dc2626", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
