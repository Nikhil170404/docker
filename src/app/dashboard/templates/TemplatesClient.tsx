"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Plus, Trash2, Merge, Tag, Zap } from "lucide-react";
import DashboardNav from "@/components/DashboardNav";
import type { SessionUser } from "@/lib/auth";

const ILPA_STARTERS = [
  {
    title: "ILPA Capital Call Notice",
    description: "ILPA v2.0 compliant capital call notice for LP investors",
    fields: ["lp_name", "call_amount", "due_date", "fund_name", "bank_account", "reference"],
    content: `Dear {{lp_name}},

We hereby issue a capital call notice pursuant to the Limited Partnership Agreement of {{fund_name}}.

Capital Call Amount: {{call_amount}}
Payment Due Date: {{due_date}}

Please remit payment to:
Bank Account: {{bank_account}}
Reference: {{reference}}

Drawdown Breakdown:
• Investment: [amount]
• Management Fee: [amount]
• Fund Expenses: [amount]

Please contact us if you have any questions regarding this notice.

Regards,
General Partner, {{fund_name}}`,
  },
  {
    title: "LP Quarterly Update — ILPA v2.0",
    description: "Quarterly portfolio update following ILPA Reporting Standard v2.0",
    fields: ["lp_name", "quarter", "year", "fund_name", "nav", "irr", "tvpi", "dpi", "rvpi"],
    content: `Dear {{lp_name}},

Please find below the quarterly update for {{fund_name}} for {{quarter}} {{year}}.

PERFORMANCE SUMMARY
───────────────────
Net IRR: {{irr}}
TVPI: {{tvpi}}
DPI: {{dpi}}
RVPI: {{rvpi}}
NAV: {{nav}}

PORTFOLIO HIGHLIGHTS
────────────────────
[Portfolio company updates — attach detailed report]

ESG METRICS (ILPA v2.0)
────────────────────────
[ESG reporting metrics as per ILPA Reporting Standard v2.0]

FEES & EXPENSES
───────────────
Management Fees: [amount]
Carried Interest: [amount]
Other Expenses: [amount]

A full detailed report is attached for your review.

Regards,
{{fund_name}} Investor Relations`,
  },
  {
    title: "LP Welcome Letter",
    description: "Onboarding welcome letter for new limited partners",
    fields: ["lp_name", "commitment_amount", "fund_name", "closing_date", "ir_contact", "ir_email"],
    content: `Dear {{lp_name}},

We are delighted to welcome you as a Limited Partner in {{fund_name}} with a commitment of {{commitment_amount}}, effective {{closing_date}}.

YOUR INVESTOR PORTAL
────────────────────
You now have access to a dedicated investor portal where you can find all fund documents, quarterly reports, capital call notices, and distribution notices.

WHAT TO EXPECT NEXT
────────────────────
• Onboarding documents for your records
• KYC/AML verification (if not already completed)
• First quarterly report within 45 days of quarter-end
• Capital call notices with a minimum of 10 business days' notice

KEY CONTACTS
────────────
Investor Relations: {{ir_contact}}
Email: {{ir_email}}

We look forward to a rewarding partnership.

Sincerely,
General Partner, {{fund_name}}`,
  },
  {
    title: "Annual Fund Update",
    description: "Annual letter summarising fund performance and outlook",
    fields: ["lp_name", "fund_name", "year", "fund_size", "deployed_capital", "portfolio_companies", "highlights"],
    content: `Dear {{lp_name}},

As we close {{year}}, we are pleased to share our annual update for {{fund_name}}.

YEAR IN REVIEW
──────────────
Fund Size: {{fund_size}}
Capital Deployed: {{deployed_capital}}
Active Portfolio Companies: {{portfolio_companies}}

KEY HIGHLIGHTS
──────────────
{{highlights}}

PORTFOLIO PERFORMANCE
─────────────────────
[Detailed performance data attached — ILPA standard report]

OUTLOOK
───────
[Market outlook and investment thesis for the coming year]

Thank you for your continued trust and partnership.

Warm regards,
General Partner, {{fund_name}}`,
  },
];

interface Template {
  id: string;
  title: string;
  description: string;
  fields: string[];
  createdAt: string;
  updatedAt: string;
}

export default function TemplatesClient({
  session,
  initialTemplates,
}: {
  session: SessionUser;
  initialTemplates: Template[];
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newFields, setNewFields] = useState("");
  const [creating, setCreating] = useState(false);
  const [addingStarter, setAddingStarter] = useState<string | null>(null);

  async function addStarter(starter: typeof ILPA_STARTERS[0]) {
    setAddingStarter(starter.title);
    const res = await fetch("/api/v1/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: starter.title,
        description: starter.description,
        fields: starter.fields,
        content: starter.content,
      }),
    });
    const tpl = await res.json();
    setTemplates((t) => [tpl, ...t]);
    setAddingStarter(null);
  }

  async function createTemplate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    const fields = newFields.split(",").map((f) => f.trim()).filter(Boolean);
    const res = await fetch("/api/v1/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle, description: newDesc, fields }),
    });
    const tpl = await res.json();
    setTemplates((t) => [tpl, ...t]);
    setNewTitle(""); setNewDesc(""); setNewFields("");
    setShowCreate(false);
    setCreating(false);
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/v1/templates/${id}`, { method: "DELETE" });
    setTemplates((t) => t.filter((x) => x.id !== id));
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav session={session} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Templates</h1>
            <p className="mt-1 text-sm text-muted">Reusable documents with merge fields for mail merge</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} /> New template
          </button>
        </div>

        {showCreate && (
          <div className="mb-6 rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-semibold text-foreground">Create template</h2>
            <div className="flex flex-col gap-3">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Template name (e.g. Invoice, Offer letter)"
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <input
                value={newFields}
                onChange={(e) => setNewFields(e.target.value)}
                placeholder="Merge fields, comma-separated (e.g. first_name, company, amount)"
                className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={createTemplate}
                  disabled={creating || !newTitle.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ILPA Quick-start templates */}
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <Zap size={14} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-foreground">ILPA Quick-Start Templates</h2>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">Fund-ready</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ILPA_STARTERS.map((s) => (
              <div key={s.title} className="rounded-xl border border-border bg-surface p-4">
                <p className="text-sm font-medium text-foreground">{s.title}</p>
                <p className="mt-1 text-xs text-muted">{s.description}</p>
                <div className="mt-2 mb-3 flex flex-wrap gap-1">
                  {s.fields.slice(0, 3).map((f) => (
                    <span key={f} className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                      {`{{${f}}}`}
                    </span>
                  ))}
                  {s.fields.length > 3 && (
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">+{s.fields.length - 3}</span>
                  )}
                </div>
                <button
                  onClick={() => addStarter(s)}
                  disabled={addingStarter === s.title}
                  className="w-full rounded-lg bg-accent/10 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white disabled:opacity-50"
                >
                  {addingStarter === s.title ? "Adding…" : "Add to my templates"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
            <FileText size={40} className="mb-4 text-muted/40" />
            <p className="text-sm text-muted">No templates yet</p>
            <p className="mt-1 text-xs text-muted/60">Create a template above or use an ILPA quick-start</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((tpl) => (
              <div key={tpl.id} className="group relative rounded-xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                    <FileText size={16} />
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Link
                      href={`/dashboard/merge?template=${tpl.id}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/10 hover:text-foreground"
                      title="Mail merge"
                    >
                      <Merge size={13} />
                    </Link>
                    <button
                      onClick={() => deleteTemplate(tpl.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-sm font-medium text-foreground">{tpl.title}</p>
                  {tpl.description && <p className="mt-1 text-xs text-muted">{tpl.description}</p>}
                  {tpl.fields.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tpl.fields.map((f) => (
                        <span key={f} className="flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">
                          <Tag size={9} />
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
