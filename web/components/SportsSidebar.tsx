"use client";

import Link from "next/link";
import { BarChart3, CircleDot, Radio, ShieldCheck, Ticket, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Sports home", icon: Trophy },
  { href: "/portfolio", label: "My bets", icon: Ticket },
  { href: "/", label: "Live matches", icon: Radio, badge: "LIVE" },
  { href: "/stats", label: "Analytics", icon: BarChart3 },
  { href: "/proofs", label: "Proofs", icon: ShieldCheck },
];

export function SportsSidebar({ fixture }: { fixture?: string }) {
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-24 overflow-hidden rounded-lg border border-edge bg-surface">
        <div className="border-b border-edge bg-raised/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Onside Sports</p>
          <p className="mt-1 text-sm font-medium text-ink">World Cup 2026</p>
        </div>
        <nav className="p-2" aria-label="Sportsbook navigation">
          {links.map(({ href, label, icon: Icon, badge }, index) => (
            <Link key={`${label}-${index}`} href={href} className={cn(
              "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted transition-colors duration-100 hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand",
              index === 0 && "bg-brand/10 text-brand"
            )}>
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {badge && <span className="rounded bg-no/15 px-1.5 py-0.5 text-[10px] font-bold text-no">{badge}</span>}
            </Link>
          ))}
        </nav>
        <div className="border-t border-edge p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <CircleDot className="h-4 w-4 text-yes" aria-hidden="true" /> Football
          </div>
          <p className="mt-2 truncate text-sm text-ink">{fixture || "Choose a match"}</p>
          <p className="mt-1 text-xs text-muted">Same-match parlays only</p>
        </div>
      </div>
    </aside>
  );
}
