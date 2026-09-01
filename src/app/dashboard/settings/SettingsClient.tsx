"use client";
import { useState } from "react";
import DashboardNav from "@/components/DashboardNav";
import type { SessionUser } from "@/lib/auth";

interface ApiKey {
  id: string;
  label: string;
  revoked: number;
  created_at: string;
}

interface Props {
  session: SessionUser;
  apiKeys: ApiKey[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "24px 28px", marginBottom: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#0f172a", marginBottom: 20 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const btnPrimary: React.CSSProperties = {
  padding: "9px 20px",
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

export default function SettingsClient({ session, apiKeys: initialKeys }: Props) {
  const [name, setName] = useState(session.name);
  const [profileMsg, setProfileMsg] = useState("");

  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");

  const [keys, setKeys] = useState(initialKeys.filter((k) => !k.revoked));
  const [keyLabel, setKeyLabel] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [keyMsg, setKeyMsg] = useState("");

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg("");
    const res = await fetch("/api/v1/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    setProfileMsg(res.ok ? "Profile updated." : "Failed to update.");
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg("");
    const res = await fetch("/api/v1/settings/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }) });
    if (res.ok) {
      setPwdMsg("Password changed successfully.");
      setCurPwd(""); setNewPwd("");
    } else {
      const j = await res.json().catch(() => ({}));
      setPwdMsg(j.error ?? "Failed to change password.");
    }
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setKeyMsg(""); setNewKeyValue(null);
    const res = await fetch("/api/v1/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: keyLabel || "API Key" }) });
    if (res.ok) {
      const j = await res.json();
      setNewKeyValue(j.key);
      setKeys((prev) => [{ id: j.id, label: j.label, revoked: 0, created_at: j.created_at }, ...prev]);
      setKeyLabel("");
    } else {
      setKeyMsg("Failed to create API key.");
    }
  }

  async function revokeKey(id: string) {
    const res = await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
    if (res.ok) setKeys((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <DashboardNav session={session} />
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 }}>Settings</h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>Manage your profile and API access</p>
        </div>

        {/* Profile */}
        <Section title="Profile">
          <form onSubmit={saveProfile}>
            <Field label="Name">
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Email">
              <input style={{ ...inputStyle, background: "#f9fafb", color: "#94a3b8" }} value={session.email} disabled />
            </Field>
            <button type="submit" style={btnPrimary}>Save Profile</button>
            {profileMsg && <span style={{ marginLeft: 12, fontSize: 13, color: profileMsg.includes("updated") ? "#16a34a" : "#dc2626" }}>{profileMsg}</span>}
          </form>
        </Section>

        {/* Password */}
        <Section title="Change Password">
          <form onSubmit={changePassword}>
            <Field label="Current Password">
              <input style={inputStyle} type="password" value={curPwd} onChange={(e) => setCurPwd(e.target.value)} required />
            </Field>
            <Field label="New Password">
              <input style={inputStyle} type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} minLength={8} required placeholder="At least 8 characters" />
            </Field>
            <button type="submit" style={btnPrimary}>Change Password</button>
            {pwdMsg && <span style={{ marginLeft: 12, fontSize: 13, color: pwdMsg.includes("success") ? "#16a34a" : "#dc2626" }}>{pwdMsg}</span>}
          </form>
        </Section>

        {/* API Keys */}
        <Section title="API Keys">
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
            Use API keys to send emails programmatically. The key is shown <strong>once</strong> — copy it immediately.
          </p>
          <form onSubmit={createKey} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Key label (e.g. Production)"
              value={keyLabel}
              onChange={(e) => setKeyLabel(e.target.value)}
            />
            <button type="submit" style={btnPrimary}>Create Key</button>
          </form>
          {keyMsg && <p style={{ fontSize: 13, color: "#dc2626" }}>{keyMsg}</p>}
          {newKeyValue && (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#166534", fontWeight: 600, marginBottom: 6 }}>New API Key — copy now, it won't be shown again</div>
              <div style={{ fontFamily: "monospace", fontSize: 13, wordBreak: "break-all", color: "#15803d" }}>{newKeyValue}</div>
              <button
                onClick={() => navigator.clipboard.writeText(newKeyValue!)}
                style={{ marginTop: 8, fontSize: 12, color: "#16a34a", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                Copy to clipboard
              </button>
            </div>
          )}
          {keys.length === 0 ? (
            <p style={{ fontSize: 13, color: "#94a3b8" }}>No active API keys.</p>
          ) : (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
              {keys.map((k, i) => (
                <div
                  key={k.id}
                  style={{
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: i < keys.length - 1 ? "1px solid #f1f5f9" : "none",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#1e293b" }}>{k.label}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>
                      Created {new Date(k.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </div>
                  </div>
                  <button
                    onClick={() => revokeKey(k.id)}
                    style={{ fontSize: 12, color: "#dc2626", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </main>
    </div>
  );
}
