"use client";
import { useState } from "react";
import DashboardNav from "@/components/DashboardNav";
import type { SessionUser } from "@/lib/auth";

interface SignRequest {
  id: string;
  doc_token: string;
  recipient_email: string;
  recipient_name: string;
  doc_title: string;
  status: string;
  signed_at: string | null;
  created_at: string;
  expires_at: string;
}

interface Props {
  session: SessionUser;
  requests: SignRequest[];
}

function StatusBadge({ status, expires_at }: { status: string; expires_at: string }) {
  const expired = status === "pending" && new Date(expires_at) < new Date();
  const label = expired ? "expired" : status;
  const colors: Record<string, { bg: string; text: string }> = {
    signed:  { bg: "#dcfce7", text: "#166534" },
    pending: { bg: "#fef9c3", text: "#854d0e" },
    expired: { bg: "#fee2e2", text: "#991b1b" },
  };
  const c = colors[label] ?? { bg: "#f1f5f9", text: "#475569" };
  return (
    <span style={{ background: c.bg, color: c.text, fontSize: 11, padding: "2px 8px", borderRadius: 999, fontWeight: 600 }}>
      {label}
    </span>
  );
}

const base = typeof window !== "undefined" ? window.location.origin : "";

export default function SignaturesClient({ session, requests }: Props) {
  const [search, setSearch] = useState("");

  const filtered = requests.filter((r) =>
    !search ||
    r.recipient_email.toLowerCase().includes(search.toLowerCase()) ||
    r.doc_title.toLowerCase().includes(search.toLowerCase()) ||
    r.recipient_name.toLowerCase().includes(search.toLowerCase())
  );

  const total = requests.length;
  const signed = requests.filter((r) => r.status === "signed").length;
  const pending = requests.filter((r) => r.status === "pending" && new Date(r.expires_at) >= new Date()).length;

  function copyLink(token: string) {
    const url = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(url).then(() => alert("Signing link copied!")).catch(() => {});
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <DashboardNav session={session} />
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 }}>E-Signatures</h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>Track and manage all your signature requests</p>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
          {[
            { label: "Total Sent", value: total, color: "#3b82f6" },
            { label: "Signed", value: signed, color: "#16a34a" },
            { label: "Pending", value: pending, color: "#d97706" },
          ].map((s) => (
            <div key={s.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "20px 24px" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
            <input
              type="text"
              placeholder="Search by name, email or document..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none" }}
            />
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "48px 24px", textAlign: "center", color: "#94a3b8" }}>
              {search ? "No results match your search." : "No signature requests yet. Create one from the Mail Merge page."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Recipient", "Document", "Sent", "Expires", "Status", ""].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 600, borderBottom: "1px solid #e2e8f0" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ fontSize: 14, color: "#1e293b", fontWeight: 500 }}>{r.recipient_name || r.recipient_email}</div>
                        {r.recipient_name && <div style={{ fontSize: 12, color: "#94a3b8" }}>{r.recipient_email}</div>}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 13, color: "#475569" }}>{r.doc_title}</td>
                      <td style={{ padding: "12px 16px", fontSize: 12, color: "#94a3b8" }}>
                        {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 12, color: "#94a3b8" }}>
                        {new Date(r.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <StatusBadge status={r.status} expires_at={r.expires_at} />
                        {r.signed_at && (
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                            {new Date(r.signed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <button
                          onClick={() => copyLink(r.doc_token)}
                          style={{ fontSize: 12, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                        >
                          Copy link
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
