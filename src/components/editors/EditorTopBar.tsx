import Link from "next/link";
import { FileText, Sheet, Presentation, ArrowLeft } from "lucide-react";
import clsx from "clsx";

const tabs = [
  { href: "/editor/docs", label: "Docs", icon: FileText },
  { href: "/editor/sheets", label: "Sheets", icon: Sheet },
  { href: "/editor/slides", label: "Slides", icon: Presentation, soon: true },
];

export default function EditorTopBar({
  active,
  right,
}: {
  active: "docs" | "sheets" | "slides";
  right?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-surface px-3 text-sm">
      <Link
        href="/"
        className="flex items-center gap-1.5 text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        <span className="flex h-5 w-5 items-center justify-center rounded bg-accent text-[11px] font-bold text-white">
          D
        </span>
      </Link>
      <div className="h-5 w-px bg-border" />
      <div className="flex items-center gap-1">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.soon ? "/pricing" : t.href}
            className={clsx(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors",
              active === t.href.split("/").pop()
                ? "bg-white/10 text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            <t.icon size={14} />
            {t.label}
            {t.soon && <span className="text-[10px] text-accent">soon</span>}
          </Link>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </header>
  );
}
