"use client";
import { useState } from "react";
import { PenLine, Copy, Search, CheckCircle2, Clock, XCircle } from "lucide-react";
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

function StatusBadge({ status, expires_at }: { status: string; expires_at: string }) {
  const expired = status === "pending" && new Date(expires_at) < new Date();
  if (status === "signed") return (
    <span className="flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
      <CheckCircle2 size={10} /> Signed
    </span>
  );
  if (expired) return (
    <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
      <XCircle size={10} /> Expired
    </span>
  );
  return (
    <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
      <Clock size={10} /> Pending
    </span>
  );
}

export default function SignaturesClient({ session, requests }: { session: SessionUser; requests: SignRequest[] }) {
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const filtered = search
    ? requests.filter((r) =>
        r.recipient_email.toLowerCase().includes(search.toLowerCase()) ||
        r.doc_title.toLowerCase().includes(search.toLowerCase()) ||
        r.recipient_name.toLowerCase().includes(search.toLowerCase())
      )
    : requests;

  const total = requests.length;
  const signed = requests.filter((r) => r.status === "signed").length;
  const pending = requests.filter((r) => r.status === "pending" && new Date(r.expires_at) >= new Date()).length;
  const expired = requests.filter((r) => r.status === "pending" && new Date(r.expires_at) < new Date()).length;

  function copyLink(token: string) {
    const url = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function fmt(iso: string) {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav session={session} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">E-Signatures</h1>
          <p className="mt-1 text-sm text-muted">Track and manage all your document signing requests</p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total", value: total, cls: "text-foreground" },
            { label: "Signed", value: signed, cls: "text-green-400" },
            { label: "Pending", value: pending, cls: "text-amber-400" },
            { label: "Expired", value: expired, cls: "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
              <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
              <p className="mt-1 text-xs text-muted">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or document…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>

        {requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <PenLine size={40} className="mb-4 text-muted/40" />
            <p className="text-sm text-muted">No signature requests yet</p>
            <p className="mt-1 text-xs text-muted/60">Create a signing request from the Mail Merge page</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No results for &quot;{search}&quot;</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="px-4 py-3 text-left font-medium">Recipient</th>
                    <th className="px-4 py-3 text-left font-medium">Document</th>
                    <th className="hidden px-4 py-3 text-left font-medium sm:table-cell">Sent</th>
                    <th className="hidden px-4 py-3 text-left font-medium md:table-cell">Expires</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{r.recipient_name || r.recipient_email}</p>
                        {r.recipient_name && <p className="text-xs text-muted">{r.recipient_email}</p>}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-3 text-muted">{r.doc_title}</td>
                      <td className="hidden px-4 py-3 text-xs text-muted sm:table-cell">{fmt(r.created_at)}</td>
                      <td className="hidden px-4 py-3 text-xs text-muted md:table-cell">{fmt(r.expires_at)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} expires_at={r.expires_at} />
                        {r.signed_at && (
                          <p className="mt-0.5 text-xs text-muted">{fmt(r.signed_at)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => copyLink(r.doc_token)}
                          className="flex items-center gap-1 text-xs text-accent transition-opacity hover:opacity-80"
                        >
                          <Copy size={11} />
                          {copied === r.doc_token ? "Copied!" : "Copy link"}
                        </button>
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
