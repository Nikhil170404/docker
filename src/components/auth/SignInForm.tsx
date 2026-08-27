"use client";

import { useState } from "react";
import { browserClient } from "@/lib/auth/supabase";

/**
 * Email magic-link sign in.
 *
 * No password field on purpose: passwords mean reset flows, breach exposure
 * and a support burden, none of which earn their keep for a product whose
 * accounts exist to attach documents and a subscription to a person.
 */
export default function SignInForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  if (!configured) {
    return (
      <div
        data-testid="auth-unconfigured"
        className="rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-muted"
      >
        <p className="font-medium text-foreground">Accounts are not set up here</p>
        <p className="mt-2">
          This deployment has no Supabase project configured. Set{" "}
          <code className="text-foreground">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-foreground">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
          enable sign in. The editor works without an account — documents are
          saved on this server and in this browser.
        </p>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = browserClient();
    if (!supabase) return;

    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }
    setState("sent");
  };

  if (state === "sent") {
    return (
      <div
        data-testid="auth-sent"
        className="rounded-xl border border-accent/40 bg-accent/[0.06] p-5 text-sm"
      >
        <p className="font-medium">Check your email</p>
        <p className="mt-2 text-muted">
          We sent a sign-in link to {email}. It expires in an hour.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="email" className="block text-sm text-muted">
        Email address
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
        className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
      {state === "error" && (
        <p role="alert" className="text-sm text-red-400">
          {message}
        </p>
      )}
      <p className="text-xs text-muted">
        No password to remember, and none for us to lose.
      </p>
    </form>
  );
}
