This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Accounts and payments

Both are optional. With neither configured the editor, the embed and the site
all work; the sign-in page explains what is missing and every paid path
refuses with a reason rather than half-working. Copy `.env.example` to
`.env.local` to enable them.

**Accounts** — Supabase, email magic link. No passwords, so no reset flow and
nothing to breach. `src/middleware.ts` refreshes the session on every
navigation, because Server Components cannot write cookies and the token
would otherwise be discarded roughly hourly.

**Payments** — Razorpay for both markets: INR with UPI, netbanking, cards and
wallets in India, and USD international cards once International Payments is
enabled on the account. One gateway means one reconciliation and one webhook
path.

The amount is always computed on the server from the plan id — a price posted
by the browser is a price the browser can edit. Access is granted only by the
signed webhook at `/api/v1/billing/webhook`; the browser's success callback
just shows a receipt. Orders are recorded before checkout opens, so a webhook
for an order we never created is rejected even with a valid signature.

## Pasting from Word

`src/lib/univer/paste-clean.ts` turns Word's clipboard HTML into something
worth keeping: `mso-` declarations and Office-namespaced elements removed,
flat `mso-list` paragraphs rebuilt into nested `ul`/`ol` trees, and Word's
own bullet glyphs stripped so a real list marker does not double up.

It is an allow-list rather than a block-list, which makes it a sanitiser as
well as a cleaner — pasted markup is untrusted, so scripts, event handlers,
`javascript:` URLs and `url()` in styles never reach the document.

Cleaning happens on the HTML, before the editor parses it. Univer's own
`onBeforePaste` hook runs after parsing, by which point Word's bullets are
already text and the list structure is gone.

## API keys

Generated on the account page, shown once, and stored only as a SHA-256
hash — a leaked database is not a set of live credentials.

SHA-256 rather than bcrypt on purpose. Password hashing is slow to make
guessing a human-chosen secret expensive; this secret is 32 random bytes, so
slowness buys nothing and costs a lot, because the hash runs on every single
API request. Hashing also turns authentication into one indexed equality
lookup rather than a scan over candidate keys.

Keys carry the plan their owner has paid for, so quota comes from the
subscription rather than from whatever the client asks for. Revoked keys keep
their row: the auth path can then answer "revoked" instead of "invalid",
which is a materially more useful thing for a customer to read.

## Database

With `SUPABASE_SERVICE_ROLE_KEY` set, Postgres stores documents, API keys,
orders and subscriptions. Apply `supabase/migrations/0001_init.sql` first.

Row Level Security is on for every table, written as though the client is
hostile — because it is reachable by anyone holding the anon key, which is
public by design. Customers can read their own rows and write almost none of
them: order status is decided by a signed webhook, and API key hashes are
minted server-side, so neither is writable from a browser.

Without the service-role key, everything falls back to JSON files on disk, so
a clone with no credentials still runs.

## Document storage

Documents live on disk, one JSON file per document, written atomically
through a temp file and a rename. Configure with:

| Variable | Default | Purpose |
|---|---|---|
| `DOCKARO_DATA_DIR` | `.data/documents` | Where documents are stored |
| `DOCKARO_SITE_URL` | `https://dockaro.com` | Origin used to build `editUrl` |

A filesystem rather than a database on purpose: durable, nothing to run
beside the app, and every function in `src/lib/server/document-repository.ts`
is the shape a SQL table would expose. It assumes a persistent disk and a
single writer — on a serverless host, or behind several instances, that is
the point to swap it for a database.

The editor writes to `localStorage` first and the server second, so a lost
connection degrades to browser-only storage rather than to a lost document.

## Testing

Two layers, because the editor is a canvas application: almost nothing about
it can be verified without a real browser, while the code underneath it can
be checked in milliseconds.

```bash
npm test          # unit + integration (vitest)
npm run test:e2e  # browser suite (playwright)
npm run test:all  # both
```

**Unit** (`tests/unit`) — the `.docx` reader property by property, the zip
writer/reader round trip, the editor-load metering and its grace band, the
pricing maths, the embed protocol, and the API routes driven directly as
functions.

**End to end** (`tests/e2e`) — the Word editor boots and accepts typing, a
real `.docx` opens with its formatting intact, a document survives export
and re-import unchanged, both embed modes mount and answer the host SDK,
a document typed in one browser reopens in a completely fresh one, and
every marketing page renders without a console error.

The `.docx` fixture is generated by `tests/e2e/fixtures.ts` rather than
committed as a binary, so what it contains is reviewable in the diff.

`npm run test:e2e` needs a production build (`npm run build`); Playwright
starts the server itself and reuses one that is already running.


## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# docker
