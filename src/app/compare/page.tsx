import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, ArrowRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import EmbedCostCalculator from "@/components/EmbedCostCalculator";
import { COMPETITOR_DATA_AS_OF } from "@/lib/plans";

export const metadata: Metadata = {
  title: "DocKaro vs CKEditor and TinyMCE",
  description:
    "A straight comparison of DocKaro, CKEditor 5 and TinyMCE for embedding a rich editor — licensing, self-hosting, editor-load metering and what it actually costs at your volume.",
  alternates: { canonical: "/compare" },
};

/**
 * Every entry here traces to a public thread where developers raised the
 * problem in their own words. Keep the citations attached: the page is far
 * more persuasive when a reader can go check that we did not invent the
 * grievance, and it keeps us honest about only claiming what we fix.
 */
const painPoints = [
  {
    problem: "Overage that bills itself",
    theirs:
      "Both vendors meter editor loads and auto-charge for every additional block of 1,000 past your quota — reported at $30–$60 per block on CKEditor and $40 on TinyMCE. A traffic spike becomes an invoice you find out about later.",
    ours:
      "We meter the same unit and never auto-charge on it. You get an email at 80% and at 100%, a 20% grace band that keeps serving, and an upgrade link. Every API response carries X-DocKaro-Loads-Used and X-DocKaro-Overage-Billing: none, so consumption is visible on every call rather than at renewal.",
    source: {
      label: "TinyMCE discussion #9496",
      href: "https://github.com/tinymce/tinymce/discussions/9496",
    },
  },
  {
    problem: "Unbounded risk for self-hosted and open-source deployments",
    theirs:
      "If anyone can install the thing that loads your editor, you cannot control your own load count. Maintainers on the TinyMCE thread called load-based subscriptions 'unlimited risk' for exactly this reason.",
    ours:
      "Self-hosted deployments are licensed per deployment, not per load. Install it on ten thousand machines; the number that matters is the one you bought.",
    source: {
      label: "TinyMCE discussion #9496",
      href: "https://github.com/tinymce/tinymce/discussions/9496",
    },
  },
  {
    problem: "A licence-key banner inside your product",
    theirs:
      "Self-hosted TinyMCE requires a licence key in the config, and upgrading across major versions on the CDN has surfaced 'A TinyMCE license key has not been provided' in front of end users on editors that were working the day before.",
    ours:
      "There is no licence-key field and no nag banner. An invalid key on our side is our billing problem to raise with you over email — never a banner rendered to the people using your product.",
    source: {
      label: "TinyMCE licence key docs",
      href: "https://www.tiny.cloud/docs/tinymce/latest/license-key/",
    },
  },
  {
    problem: "GPL you cannot actually take",
    theirs:
      "TinyMCE went LGPL → MIT → GPL 2+ at v7; CKEditor 5 ships GPL 2+ or commercial. Projects built on permissively-licensed dependencies cannot absorb a copyleft dependency, and developers report sales and compliance teams pressing the point.",
    ours:
      "The embeddable client bundle is MIT. Link it from a proprietary product, a permissively-licensed one, or a GPL one — none of those choices become our licensing conversation.",
    source: {
      label: "What happened to TinyMCE's license? (#9453)",
      href: "https://github.com/tinymce/tinymce/issues/9453",
    },
  },
  {
    problem: "Self-hosting means talking to sales",
    theirs:
      "Cloud plans are self-serve; commercial self-hosted licences are 'contact us'. As one maintainer put it, that is a high price and, either way, a hurdle — now you have to interact with people before you can evaluate.",
    ours:
      "Self-hosting is on every tier including Free, and the Scale tier's self-host licence has a price printed on the pricing page. You can buy it at 2am without meeting anyone.",
    source: {
      label: "TinyMCE discussion #9496",
      href: "https://github.com/tinymce/tinymce/discussions/9496",
    },
  },
  {
    problem: "No room for non-commercial projects",
    theirs:
      "Developers asked for a way for clearly non-commercial FOSS to get the core editor free, without a formal agreement. The free tiers on both products carry 1,000 editor loads a month, which a modest open-source project clears in a week.",
    ours:
      "The free tier carries 5,000 loads with the full feature set — no gated plugins — and registered non-commercial open-source projects get it unmetered on request, by email, with no agreement to sign.",
    source: {
      label: "TinyMCE discussion #9496",
      href: "https://github.com/tinymce/tinymce/discussions/9496",
    },
  },
  {
    problem: "Features that used to be open, now upsells",
    theirs:
      "Both products split the editor into a core and a premium plugin catalogue, and plugins have moved from the open build into the commercial one across major versions.",
    ours:
      "One build, every feature. Tables, track changes, comments, spell check, export — the tier changes your volume and your support response time, never which buttons render.",
    source: {
      label: "CKEditor licensing thread (#14314)",
      href: "https://github.com/ckeditor/ckeditor5/issues/14314",
    },
  },
];

type Cell = boolean | string;

/**
 * Every row is phrased so that a tick always means "good for the buyer".
 * Mixing polarities (a tick for "licence key required") makes the table
 * actively misleading to anyone scanning it rather than reading it.
 */
const matrix: { feature: string; us: Cell; ck: Cell; tiny: Cell }[] = [
  { feature: "Free tier editor loads / month", us: "5,000", ck: "1,000", tiny: "1,000" },
  { feature: "No auto-charged overage", us: true, ck: "$30–$60 / 1k", tiny: "$40 / 1k" },
  { feature: "Client bundle licence", us: "MIT", ck: "GPL 2+ / commercial", tiny: "GPL 2+ / commercial" },
  { feature: "Self-host on a published plan", us: true, ck: false, tiny: false },
  { feature: "No licence key to paste into config", us: true, ck: false, tiny: false },
  { feature: "No licence banner shown to end users", us: true, ck: false, tiny: false },
  { feature: "All features in every tier", us: true, ck: false, tiny: false },
  { feature: "Buy without a sales call", us: true, ck: "Cloud only", tiny: "Cloud only" },
  { feature: "INR pricing for India", us: true, ck: false, tiny: false },
];

function CellValue({ value, emphasis }: { value: Cell; emphasis?: boolean }) {
  if (typeof value === "string") {
    return (
      <span className={emphasis ? "text-foreground" : "text-muted"}>{value}</span>
    );
  }
  return value ? (
    <Check size={16} className={`mx-auto ${emphasis ? "text-accent" : "text-muted"}`} />
  ) : (
    <X size={16} className="mx-auto text-muted/40" />
  );
}

export default function ComparePage() {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <section className="bg-grid border-b border-border px-6 py-20 text-center">
          <h1 className="text-balance mx-auto max-w-3xl text-4xl font-semibold tracking-tight">
            DocKaro vs CKEditor and TinyMCE
          </h1>
          <p className="text-balance mx-auto mt-4 max-w-2xl text-muted">
            Both are good editors. The complaints developers keep raising are
            not about the editing — they are about metering, licensing and
            having to call someone. This page is about those.
          </p>
        </section>

        {/* Cost calculator */}
        <section className="mx-auto max-w-5xl px-6 py-20">
          <EmbedCostCalculator />
        </section>

        {/* Pain points */}
        <section className="mx-auto max-w-4xl px-6 pb-20">
          <h2 className="text-2xl font-semibold tracking-tight">
            What developers complain about, and what we do instead
          </h2>
          <p className="mt-3 text-sm text-muted">
            Each one links to the public thread it came from.
          </p>

          <div className="mt-10 space-y-5">
            {painPoints.map((p) => (
              <div
                key={p.problem}
                className="rounded-2xl border border-border bg-surface p-7"
              >
                <h3 className="font-medium">{p.problem}</h3>
                <div className="mt-5 grid gap-6 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      Today
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {p.theirs}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-accent">
                      On DocKaro
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {p.ours}
                    </p>
                  </div>
                </div>
                <a
                  href={p.source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex items-center gap-1 text-xs text-muted underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  {p.source.label} <ArrowRight size={12} />
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* Matrix */}
        <section className="mx-auto max-w-5xl px-6 pb-20">
          <h2 className="text-2xl font-semibold tracking-tight">Side by side</h2>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-muted">
                  <th className="px-5 py-4 font-medium">&nbsp;</th>
                  <th className="px-5 py-4 text-center font-medium text-foreground">
                    DocKaro
                  </th>
                  <th className="px-5 py-4 text-center font-medium">CKEditor 5</th>
                  <th className="px-5 py-4 text-center font-medium">TinyMCE</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={i % 2 === 0 ? "bg-transparent" : "bg-surface/50"}
                  >
                    <td className="px-5 py-4 text-muted">{row.feature}</td>
                    <td className="px-5 py-4 text-center">
                      <CellValue value={row.us} emphasis />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <CellValue value={row.ck} />
                    </td>
                    <td className="px-5 py-4 text-center">
                      <CellValue value={row.tiny} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            Competitor details reflect published terms and documentation as of{" "}
            {COMPETITOR_DATA_AS_OF}. Both products change their packaging
            regularly — verify against their own pricing pages before deciding.
          </p>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="bg-grid relative overflow-hidden rounded-3xl border border-border px-8 py-16 text-center">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/15 via-transparent to-transparent" />
            <div className="relative">
              <h2 className="text-3xl font-semibold tracking-tight">
                Try it before you renew
              </h2>
              <p className="mx-auto mt-3 max-w-md text-muted">
                5,000 editor loads a month, every feature, no card and no
                licence key to paste anywhere.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/api-docs"
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-medium text-black transition-opacity hover:opacity-90"
                >
                  Get an API key <ArrowRight size={16} />
                </Link>
                <Link
                  href="/pricing"
                  className="rounded-lg border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-surface"
                >
                  See pricing
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
