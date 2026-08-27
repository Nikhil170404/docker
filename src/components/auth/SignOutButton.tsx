"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/auth/supabase";

export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await browserClient()?.auth.signOut();
        router.replace("/");
        // The session cookie just changed, so every Server Component on the
        // next page has to be rendered again rather than served from the
        // client-side cache.
        router.refresh();
      }}
      className="rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
