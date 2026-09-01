import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function LpPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: portal } = await admin
    .from("lp_portals")
    .select("email, user_id, name")
    .eq("token", token)
    .single();

  if (!portal) notFound();

  const { data: logs } = await admin
    .from("send_logs")
    .select("subject, sent_at, status")
    .eq("user_id", portal.user_id)
    .eq("recipient", portal.email)
    .order("sent_at", { ascending: false })
    .limit(50);

  const { data: sender } = await admin
    .from("profiles")
    .select("name")
    .eq("id", portal.user_id)
    .single();

  const safePortal = { email: portal.email, name: portal.name };
  const safeSender = sender?.name ?? null;
  const safeLogs = (logs ?? []) as { subject: string; sent_at: string; status: string }[];

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased; }
      `}</style>
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13 }}>D</div>
            <span style={{ fontWeight: 600, fontSize: 14, color: "#1e293b" }}>DocKaro</span>
          </div>
          <span style={{ fontSize: 12, color: "#94a3b8", background: "#f1f5f9", padding: "3px 10px", borderRadius: 999, fontWeight: 500 }}>Investor Portal</span>
        </div>

        <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 20px 80px" }}>
          <div style={{ background: "linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)", borderRadius: 16, padding: "32px 36px", marginBottom: 28, color: "#fff" }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "#93c5fd", textTransform: "uppercase", marginBottom: 10 }}>Your Portfolio</div>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>{safePortal.name || safePortal.email}</div>
            {safeSender && (
              <div style={{ marginTop: 6, fontSize: 13, color: "#bfdbfe" }}>Managed by {safeSender}</div>
            )}
            <div style={{ marginTop: 20, display: "flex", gap: 24 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{safeLogs.length}</div>
                <div style={{ fontSize: 11, color: "#93c5fd", marginTop: 2 }}>Communications</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{safeLogs.filter((l) => l.status === "sent").length}</div>
                <div style={{ fontSize: 11, color: "#93c5fd", marginTop: 2 }}>Delivered</div>
              </div>
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>Communications &amp; Documents</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>{safeLogs.length} item{safeLogs.length !== 1 ? "s" : ""}</div>
            </div>

            {safeLogs.length === 0 ? (
              <div style={{ padding: "60px 24px", textAlign: "center", color: "#94a3b8" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>No documents yet</div>
                <div style={{ fontSize: 13 }}>Your fund manager will share updates here shortly.</div>
              </div>
            ) : (
              safeLogs.map((log, i) => (
                <div key={i} style={{ padding: "16px 24px", borderBottom: i < safeLogs.length - 1 ? "1px solid #f8fafc" : "none", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>📄</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.subject}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                      {new Date(log.sent_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999, background: log.status === "sent" ? "#dcfce7" : "#fef9c3", color: log.status === "sent" ? "#166534" : "#854d0e", flexShrink: 0 }}>
                    {log.status === "sent" ? "Received" : log.status}
                  </span>
                </div>
              ))
            )}
          </div>

          <div style={{ marginTop: 32, textAlign: "center", fontSize: 12, color: "#cbd5e1" }}>
            Secure investor portal powered by{" "}
            <a href="https://dockaro.com" style={{ color: "#3b82f6", textDecoration: "none" }}>DocKaro</a>
            {" "}· Your data stays private
          </div>
        </div>
      </div>
    </>
  );
}
