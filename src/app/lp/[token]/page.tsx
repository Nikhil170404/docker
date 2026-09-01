import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";

interface SendLog {
  subject: string;
  sent_at: string;
  status: string;
}

export default async function LpPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = getDb();

  const portal = db
    .prepare("SELECT email, user_id, name FROM lp_portals WHERE token = ?")
    .get(token) as { email: string; user_id: string; name: string } | undefined;

  if (!portal) notFound();

  const logs = db
    .prepare(
      "SELECT subject, sent_at, status FROM send_logs WHERE user_id = ? AND recipient = ? ORDER BY sent_at DESC LIMIT 50"
    )
    .all(portal.user_id, portal.email) as SendLog[];

  const senderName = db
    .prepare("SELECT name FROM users WHERE id = ?")
    .get(portal.user_id) as { name: string } | undefined;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        {/* Header */}
        <div style={{ background: "#1e40af", borderRadius: 12, padding: "32px", marginBottom: 32, color: "#fff" }}>
          <div style={{ fontSize: 13, color: "#93c5fd", marginBottom: 8 }}>LP Investor Portal</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{portal.name || portal.email}</div>
          {senderName && (
            <div style={{ fontSize: 14, color: "#bfdbfe", marginTop: 4 }}>
              Managed by {senderName.name}
            </div>
          )}
        </div>

        {/* Documents */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#1e293b" }}>Communications &amp; Documents</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{logs.length} item{logs.length !== 1 ? "s" : ""}</div>
          </div>

          {logs.length === 0 ? (
            <div style={{ padding: "48px 24px", textAlign: "center", color: "#94a3b8" }}>
              No documents yet. Check back later.
            </div>
          ) : (
            <div>
              {logs.map((log, i) => (
                <div
                  key={i}
                  style={{
                    padding: "16px 24px",
                    borderBottom: i < logs.length - 1 ? "1px solid #f1f5f9" : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#1e293b" }}>{log.subject}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                      {new Date(log.sent_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: log.status === "sent" ? "#dcfce7" : "#fef9c3",
                      color: log.status === "sent" ? "#166534" : "#854d0e",
                      fontWeight: 600,
                    }}
                  >
                    {log.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 12, color: "#94a3b8" }}>
          Secure investor portal powered by{" "}
          <a href="https://dockaro.com" style={{ color: "#3b82f6", textDecoration: "none" }}>
            DocKaro
          </a>
        </div>
      </div>
    </div>
  );
}
