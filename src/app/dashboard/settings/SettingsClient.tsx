"use client";
import { useState } from "react";
import { KeyRound, User, Lock, Eye, EyeOff, Trash2, Plus } from "lucide-react";
import DashboardNav from "@/components/DashboardNav";
import type { SessionUser } from "@/lib/auth";

interface ApiKey {
  id: string;
  label: string;
  revoked: number;
  created_at: string;
}

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
const labelCls = "block text-sm font-medium text-foreground mb-1.5";
const btnPrimary = "rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50";

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-6 mb-4">
      <div className="mb-5 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Icon size={15} />
        </div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function SettingsClient({ session, apiKeys: initialKeys }: { session: SessionUser; apiKeys: ApiKey[] }) {
  const [name, setName] = useState(session.name);
  const [profileMsg, setProfileMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [savingPwd, setSavingPwd] = useState(false);

  const [keys, setKeys] = useState(initialKeys.filter((k) => !k.revoked));
  const [keyLabel, setKeyLabel] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await fetch("/api/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setProfileMsg(res.ok ? { text: "Profile updated.", ok: true } : { text: "Failed to update profile.", ok: false });
    setSavingProfile(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPwd(true);
    setPwdMsg(null);
    const res = await fetch("/api/v1/settings/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }),
    });
    if (res.ok) {
      setPwdMsg({ text: "Password changed successfully.", ok: true });
      setCurPwd(""); setNewPwd("");
    } else {
      const j = await res.json().catch(() => ({}));
      setPwdMsg({ text: j.error ?? "Failed to change password.", ok: false });
    }
    setSavingPwd(false);
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setCreatingKey(true);
    setKeyMsg(null);
    setNewKeyValue(null);
    const res = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: keyLabel || "API Key" }),
    });
    if (res.ok) {
      const j = await res.json();
      setNewKeyValue(j.key);
      setKeys((prev) => [{ id: j.id, label: j.label, revoked: 0, created_at: j.created_at }, ...prev]);
      setKeyLabel("");
    } else {
      setKeyMsg("Failed to create API key.");
    }
    setCreatingKey(false);
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;
    const res = await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
    if (res.ok) setKeys((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav session={session} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted">Manage your profile, password and API access</p>
        </div>

        {/* Profile */}
        <Section icon={User} title="Profile">
          <form onSubmit={saveProfile} className="flex flex-col gap-4">
            <div>
              <label className={labelCls}>Full name</label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className={labelCls}>Email address</label>
              <input className={`${inputCls} cursor-not-allowed opacity-50`} value={session.email} disabled />
              <p className="mt-1 text-xs text-muted">Email cannot be changed.</p>
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={savingProfile} className={btnPrimary}>
                {savingProfile ? "Saving…" : "Save profile"}
              </button>
              {profileMsg && (
                <span className={`text-sm ${profileMsg.ok ? "text-green-400" : "text-red-400"}`}>{profileMsg.text}</span>
              )}
            </div>
          </form>
        </Section>

        {/* Password */}
        <Section icon={Lock} title="Change Password">
          <form onSubmit={changePassword} className="flex flex-col gap-4">
            <div>
              <label className={labelCls}>Current password</label>
              <div className="relative">
                <input
                  className={inputCls}
                  type={showCur ? "text" : "password"}
                  value={curPwd}
                  onChange={(e) => setCurPwd(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCur((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                  tabIndex={-1}
                >
                  {showCur ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className={labelCls}>New password</label>
              <div className="relative">
                <input
                  className={inputCls}
                  type={showNew ? "text" : "password"}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  minLength={8}
                  required
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button type="submit" disabled={savingPwd} className={btnPrimary}>
                {savingPwd ? "Saving…" : "Change password"}
              </button>
              {pwdMsg && (
                <span className={`text-sm ${pwdMsg.ok ? "text-green-400" : "text-red-400"}`}>{pwdMsg.text}</span>
              )}
            </div>
          </form>
        </Section>

        {/* API Keys */}
        <Section icon={KeyRound} title="API Keys">
          <p className="mb-4 text-sm text-muted">
            Use API keys to authenticate requests to the DocKaro API. Keys are shown <strong className="text-foreground">once</strong> at creation — copy it immediately.
          </p>

          <form onSubmit={createKey} className="mb-4 flex gap-2">
            <input
              className={`${inputCls} flex-1`}
              placeholder="Key label (e.g. Production, CI)"
              value={keyLabel}
              onChange={(e) => setKeyLabel(e.target.value)}
            />
            <button type="submit" disabled={creatingKey} className={`${btnPrimary} flex shrink-0 items-center gap-1.5`}>
              <Plus size={13} /> {creatingKey ? "Creating…" : "Create"}
            </button>
          </form>

          {keyMsg && <p className="mb-3 text-sm text-red-400">{keyMsg}</p>}

          {newKeyValue && (
            <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
              <p className="mb-2 text-xs font-semibold text-green-400">New key — copy it now, it won&apos;t be shown again</p>
              <code className="block break-all rounded bg-black/30 px-3 py-2 font-mono text-xs text-green-300">
                {newKeyValue}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(newKeyValue!)}
                className="mt-2 text-xs text-green-400 underline hover:opacity-70"
              >
                Copy to clipboard
              </button>
            </div>
          )}

          {keys.length === 0 ? (
            <p className="text-sm text-muted">No active API keys. Create one above.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              {keys.map((k, i) => (
                <div
                  key={k.id}
                  className={`flex items-center justify-between gap-4 px-4 py-3 ${i < keys.length - 1 ? "border-b border-border" : ""}`}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{k.label}</p>
                    <p className="text-xs text-muted">
                      Created {new Date(k.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeKey(k.id)}
                    className="flex items-center gap-1 text-xs text-red-400 transition-opacity hover:opacity-70"
                  >
                    <Trash2 size={11} /> Revoke
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
