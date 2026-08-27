"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import type { ApiKeySummary } from "@/lib/server/api-key-repository";

/**
 * API key management.
 *
 * The secret is rendered exactly once, immediately after creation, and is
 * never fetched again — the server only stores its hash, so there is nothing
 * to fetch. Everything after that shows a masked form, which is enough to
 * tell two keys apart and not enough to use either.
 */
export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  /** Bumped after create/revoke to re-run the fetch below. */
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let mounted = true;

    // Inline rather than a shared callback: the state update has to sit
    // visibly after an await, both for the linter and for the reader.
    void (async () => {
      const response = await fetch("/api/v1/keys");
      const next: ApiKeySummary[] = response.ok
        ? (await response.json()).keys
        : [];
      // A response that lands after unmount must not set state.
      if (mounted) setKeys(next);
    })();

    return () => {
      mounted = false;
    };
  }, [reloads]);

  const create = async () => {
    setBusy(true);
    setError("");
    const response = await fetch("/api/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "API key" }),
    });
    setBusy(false);

    if (!response.ok) {
      setError("Could not create a key.");
      return;
    }
    const created = await response.json();
    setFreshSecret(created.secret);
    reload();
  };

  const revoke = async (id: string) => {
    await fetch(`/api/v1/keys/${id}`, { method: "DELETE" });
    reload();
  };

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">API keys</h2>
          <p className="mt-1 text-sm text-muted">
            For the REST API and self-hosted embeds.
          </p>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={busy}
          data-testid="create-api-key"
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Creating…" : "New key"}
        </button>
      </div>

      {freshSecret && (
        <div
          data-testid="fresh-key"
          className="mt-5 rounded-xl border border-accent/40 bg-accent/[0.06] p-5"
        >
          <p className="text-sm font-medium">Copy this key now</p>
          <p className="mt-1 text-xs text-muted">
            We store only a hash of it, so this is the last time it can be
            shown. Losing it means creating a new one.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 text-xs">
              {freshSecret}
            </code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(freshSecret);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-surface"
            >
              <Copy size={13} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFreshSecret(null)}
            className="mt-3 text-xs text-muted underline underline-offset-4"
          >
            I have saved it
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="mt-6">
        {keys === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted">
            No keys yet. Create one to call the API.
          </p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-4 py-3">
                <span className="min-w-0">
                  <code className="text-xs">{key.masked}</code>
                  <span className="ml-3 text-xs text-muted">
                    {key.name} · {key.planId}
                    {key.lastUsedAt
                      ? ` · last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                      : " · never used"}
                  </span>
                </span>
                {key.revoked ? (
                  <span className="shrink-0 text-xs text-muted">revoked</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => revoke(key.id)}
                    aria-label={`Revoke ${key.name}`}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-red-400"
                  >
                    <Trash2 size={13} /> Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
