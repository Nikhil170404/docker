import Link from "next/link";
import {
  FileText,
  Sheet,
  Mail,
  Code2,
  Check,
  X,
  Zap,
  ShieldCheck,
  ArrowRight,
  PenLine,
  Users,
  BarChart2,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const products = [
  {
    icon: FileText,
    name: "Docs",
    tagline: "Word-compatible document editor",
    desc: "Rich formatting, tables, styles, headers and footers. Full .docx import and export — not a stripped-down text box.",
    href: "/editor/docs",
    color: "bg-blue-500/10 text-blue-400",
  },
  {
    icon: Sheet,
    name: "Sheets",
    tagline: "Excel-compatible spreadsheets",
    desc: "Formulas, conditional formatting, data validation, filters and sort. The spreadsheets you already know, in the browser.",
    href: "/editor/sheets",
    color: "bg-green-500/10 text-green-400",
  },
  {
    icon: Mail,
    name: "Mail Merge",
    tagline: "Bulk personalised sends at scale",
    desc: "Upload a CSV, write once with merge fields, generate a personalised PDF per recipient and send to thousands — without hitting spam.",
    href: "/dashboard/merge",
    color: "bg-purple-500/10 text-purple-400",
  },
];

const fundFeatures = [
  {
    icon: PenLine,
    title: "E-Signature",
    desc: "Send documents for signature. Recipients sign on any device — no account needed. Signed documents are timestamped and stored.",
  },
  {
    icon: Users,
    title: "LP Investor Portal",
    desc: "Every LP gets a private, token-secured portal showing all fund communications sent to them. No login required.",
  },
  {
    icon: BarChart2,
    title: "Open Tracking",
    desc: "See who opened your emails and when. Real-time delivery and read receipts — not just sent counts.",
  },
  {
    icon: FileText,
    title: "ILPA Templates",
    desc: "One-click ILPA v2.0 compliant templates: Capital Call Notice, Quarterly Update, LP Welcome Letter, Annual Update.",
  },
  {
    icon: ShieldCheck,
    title: "Data Sovereignty",
    desc: "SQLite on your own server. LP data never leaves your infrastructure. No third-party cloud required.",
  },
  {
    icon: Zap,
    title: "Scheduled Sends",
    desc: "Queue bulk sends for off-hours or market-open windows. Cancel any time before the send fires.",
  },
];

const comparison = [
  { feature: "Word-compatible editor in browser", us: true, google: true, ms: false, oo: true },
  { feature: "Mail merge with personalised PDF", us: true, google: false, ms: false, oo: false },
  { feature: "LP investor portal", us: true, google: false, ms: false, oo: false },
  { feature: "E-signature built in", us: true, google: false, ms: false, oo: false },
  { feature: "Email open tracking", us: true, google: false, ms: false, oo: false },
  { feature: "ILPA report templates", us: true, google: false, ms: false, oo: false },
  { feature: "Self-hosted, data stays on your server", us: true, google: false, ms: false, oo: true },
  { feature: "No per-seat license", us: true, google: false, ms: false, oo: false },
];

const faqs = [
  {
    q: "Who is DocKaro for?",
    a: "Fund managers, VCs, AIFs, family offices, and accelerators who send LP communications at scale — quarterly reports, capital call notices, distribution notices, and investor updates — and need a single tool to draft, personalise, and deliver them.",
  },
  {
    q: "Is LP data safe?",
    a: "Yes. DocKaro uses a self-hosted SQLite database, so investor data stays on your own server. Nothing is sent to a third-party cloud. You control the data entirely.",
  },
  {
    q: "Can I open my existing Word files?",
    a: "Yes — upload a .docx file, edit it in the browser, and export back in the same format with formatting preserved.",
  },
  {
    q: "How does mail merge work at scale?",
    a: "Upload a CSV, write the email once with {{merge_fields}}, and DocKaro generates a personalised PDF and email for each row. It batches sends with proper delays, respects unsubscribes, and tracks opens.",
  },
  {
    q: "Do you have an API?",
    a: "Yes. The API plan includes REST endpoints and HMAC-signed keys to create documents, trigger sends, and embed the editor directly into your own product.",
  },
];

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        {/* Hero */}
        <section className="bg-grid relative overflow-hidden border-b border-border">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/10 via-transparent to-background" />
          <div className="relative mx-auto max-w-6xl px-6 py-24 text-center sm:py-32">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
              <Zap size={12} className="text-accent" />
              Built for fund managers · VCs · AIFs · Family offices
            </span>
            <h1 className="text-balance mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              Documents, mail merge
              <br />
              <span className="text-muted">and LP comms — in one place.</span>
            </h1>
            <p className="text-balance mx-auto mt-5 max-w-xl text-lg text-muted">
              Draft quarterly reports, generate personalised PDFs per LP, send
              to thousands without hitting spam, and get read receipts — all
              without leaving DocKaro.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Start free <ArrowRight size={15} />
              </Link>
              <Link
                href="/pricing"
                className="rounded-lg border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface"
              >
                See pricing
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted">No credit card · Free plan forever</p>
          </div>
        </section>

        {/* Products */}
        <section id="product" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Everything in one workspace</h2>
            <p className="mt-3 text-muted">Draft, personalise, send, track — no tool-switching.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {products.map((p) => (
              <Link
                key={p.name}
                href={p.href}
                className="group flex flex-col rounded-2xl border border-border bg-surface p-7 transition-colors hover:border-accent/50"
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${p.color}`}>
                  <p.icon size={20} />
                </div>
                <h3 className="mt-5 text-base font-semibold text-foreground">{p.name}</h3>
                <p className="text-sm text-accent">{p.tagline}</p>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">{p.desc}</p>
                <span className="mt-5 flex items-center gap-1 text-sm text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  Open <ArrowRight size={13} />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Fund features */}
        <section className="border-y border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
            <div className="mb-12 text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
                <ShieldCheck size={12} className="text-accent" /> Fund-service ready
              </span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                Built for how fund managers actually work
              </h2>
              <p className="mt-3 text-muted">
                Everything competitors don&apos;t have — in one product.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {fundFeatures.map((f) => (
                <div key={f.title} className="rounded-xl border border-border bg-surface p-6">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
                    <f.icon size={17} />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* API section */}
        <section id="api" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Code2 size={20} />
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight">
                Embed it inside your own product
              </h2>
              <p className="mt-4 text-muted">
                Every editor and the full merge pipeline are available as a REST API.
                Generate documents server-side or drop the editor into your own platform.
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                {[
                  "REST API — create, edit, export (.docx / .pdf)",
                  "HMAC-signed API keys, stored only as hash",
                  "Trigger bulk sends programmatically",
                  "Webhooks for document and send events",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-muted">
                    <Check size={15} className="mt-0.5 shrink-0 text-accent" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/api-docs"
                className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-accent"
              >
                View API reference <ArrowRight size={13} />
              </Link>
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-[#0c0c0e] shadow-2xl">
              <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
                <span className="ml-2 text-xs text-muted">terminal</span>
              </div>
              <pre className="overflow-x-auto p-5 text-xs leading-relaxed text-muted">{`# Send a personalised quarterly report to all LPs
curl -X POST https://dockaro.com/api/v1/merge/bulk \\
  -H "Authorization: Bearer dk_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "provider": { "type": "resend", "apiKey": "re_xxx", "domain": "fundname.com" },
    "fromName": "Sequoia Capital India",
    "subject": "Q3 2025 LP Update — {{fund_name}}",
    "mergedText": "Dear {{lp_name}},...",
    "recipientEmail": "lp@example.com",
    "trackOpens": true,
    "lpPortal": true
  }'

# → 200 OK { "ok": true }`}</pre>
            </div>
          </div>
        </section>

        {/* Comparison */}
        <section className="border-y border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-semibold tracking-tight">How DocKaro compares</h2>
              <p className="mt-3 text-muted">Features your existing tools don&apos;t have.</p>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left text-xs text-muted">
                    <th className="px-5 py-4 font-medium">Feature</th>
                    <th className="px-5 py-4 text-center font-semibold text-foreground">DocKaro</th>
                    <th className="px-5 py-4 text-center font-medium">Google Workspace</th>
                    <th className="px-5 py-4 text-center font-medium">Microsoft 365</th>
                    <th className="px-5 py-4 text-center font-medium">ONLYOFFICE</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row, i) => (
                    <tr key={row.feature} className={i % 2 === 0 ? "" : "bg-surface/50"}>
                      <td className="px-5 py-3.5 text-sm text-muted">{row.feature}</td>
                      {[row.us, row.google, row.ms, row.oo].map((v, idx) => (
                        <td key={idx} className="px-5 py-3.5 text-center">
                          {v ? (
                            <Check size={15} className={`mx-auto ${idx === 0 ? "text-accent" : "text-muted/60"}`} />
                          ) : (
                            <X size={15} className="mx-auto text-muted/25" />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Frequently asked questions</h2>
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border">
            {faqs.map((f) => (
              <div key={f.q} className="p-6">
                <h3 className="font-medium text-foreground">{f.q}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="bg-grid relative overflow-hidden rounded-3xl border border-border px-8 py-16 text-center">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/15 via-transparent to-transparent" />
            <div className="relative">
              <h2 className="text-3xl font-semibold tracking-tight">
                Ready to send your first LP update?
              </h2>
              <p className="mx-auto mt-3 max-w-md text-muted">
                Free to start. No credit card. No sales call. Set up in under a minute.
              </p>
              <Link
                href="/signup"
                className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Start free <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
