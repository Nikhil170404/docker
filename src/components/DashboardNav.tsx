"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

const NAV_TABS = [
  { href: "/dashboard", label: "Documents" },
  { href: "/dashboard/templates", label: "Templates" },
  { href: "/dashboard/merge", label: "Mail Merge" },
  { href: "/dashboard/history", label: "Send History" },
  { href: "/dashboard/signatures", label: "Signatures" },
  { href: "/dashboard/scheduled", label: "Scheduled" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardNav({ session }: { session: SessionUser }) {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-white">D</span>
          DocKaro
        </Link>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-muted sm:block">{session.email}</span>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex gap-6 text-sm">
          {NAV_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={`border-b-2 py-3 transition-colors ${
                pathname === tab.href
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  );
}
