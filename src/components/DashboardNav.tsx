"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { SessionUser } from "@/lib/auth";

const NAV_TABS = [
  { href: "/dashboard", label: "Docs" },
  { href: "/dashboard/templates", label: "Templates" },
  { href: "/dashboard/merge", label: "Mail Merge" },
  { href: "/dashboard/history", label: "History" },
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
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-foreground">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">D</span>
          <span className="hidden sm:inline">DocKaro</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden max-w-[160px] truncate text-xs text-muted sm:block">{session.email}</span>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      {/* Tab strip — scrollable on mobile */}
      <div className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6" style={{ scrollbarWidth: "none" }}>
        <div className="flex min-w-max gap-1 sm:gap-0">
          {NAV_TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`shrink-0 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors sm:px-4 sm:text-sm ${
                  active
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
