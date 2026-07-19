"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Plus, LogOut, Trophy, BarChart3, Ticket, ShieldCheck, CircleDot, Radio } from "lucide-react";
import { Logo, SolIcon, Spinner } from "@/components/icons";
import { useWallet } from "@/lib/wallet";
import { cn, shortAddr } from "@/lib/utils";

export function Header() {
  const w = useWallet();
  const pathname = usePathname();

  const onFund = () =>
    toast.promise(w.fund(), {
      loading: "Adding 0.2 test SOL…",
      success: "Added 0.2 SOL to your wallet",
      error: (e) => e?.message || "Faucet is busy, try again",
    });

  return (
    <>
    <header className="sticky top-0 z-40 border-b border-edge bg-canvas/95 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" aria-label="Onside home">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 text-sm font-medium md:flex">
            <NavLink href="/" pathname={pathname}>Markets</NavLink>
            <NavLink href="/stats" pathname={pathname}>Analytics</NavLink>
            <NavLink href="/proofs" pathname={pathname}>Proofs</NavLink>
            <NavLink href="/portfolio" pathname={pathname}>My bets</NavLink>
          </nav>
        </div>

        {w.kind === "none" ? (
          <button
            data-testid="connect-btn"
            onClick={w.openConnect}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition-colors duration-100 hover:bg-brand-600 active:translate-y-px focus-visible:ring-2 focus-visible:ring-brand"
          >
            {w.connecting ? <Spinner className="h-3.5 w-3.5" /> : null}
            Connect
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-edge bg-surface px-2.5 text-sm" title={w.address}>
              {w.kind === "guest" ? (
                <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Guest</span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-yes" title={w.walletName} />
              )}
              <span className="font-mono text-xs text-muted">{shortAddr(w.address)}</span>
              <span className="h-3.5 w-px bg-edge" />
              <SolIcon className="h-3 w-3" />
              <span className="font-semibold tabular-nums" data-testid="balance">
                {w.balance.toFixed(2)}
              </span>
              <button
                onClick={w.disconnect}
                aria-label="Disconnect"
                title="Disconnect"
                className="ml-0.5 flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              data-testid="fund-btn"
              onClick={onFund}
              disabled={w.funding}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-brand px-3.5 text-sm font-semibold text-white transition-colors duration-100 hover:bg-brand-600 active:translate-y-px disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
            >
              {w.funding ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" strokeWidth={3} />}
              <span className="hidden sm:inline">Add funds</span>
              <span className="sm:hidden">Fund</span>
            </button>
          </div>
        )}
      </div>
      <div className="hidden h-11 items-center gap-1 border-t border-edge bg-surface px-6 md:flex">
        <span className="mr-2 text-xs font-semibold uppercase tracking-widest text-muted">Sports</span>
        <span className="inline-flex h-8 items-center gap-2 rounded-md bg-brand/15 px-3 text-sm font-semibold text-brand"><CircleDot className="h-4 w-4" /> Football</span>
        <span className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm text-muted"><Radio className="h-4 w-4" /> Live</span>
        <span className="ml-auto rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-300">Devnet</span>
      </div>
    </header>
    <MobileNav pathname={pathname} />
    </>
  );
}

function NavLink({ href, pathname, children }: { href: string; pathname: string; children: React.ReactNode }) {
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link href={href} className={cn("rounded-md px-3 py-2 transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-brand", active ? "bg-raised text-ink" : "text-muted hover:bg-raised hover:text-ink")}>
      {children}
    </Link>
  );
}

/** Bottom tab bar — the top-nav links are hidden on phones, so give judges a way around. */
function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-edge bg-canvas/95 backdrop-blur-xl sm:hidden">
      <MobileTab href="/" pathname={pathname} label="Markets">
        <Trophy className="h-[18px] w-[18px]" />
      </MobileTab>
      <MobileTab href="/stats" pathname={pathname} label="Analytics">
        <BarChart3 className="h-[18px] w-[18px]" />
      </MobileTab>
      <MobileTab href="/proofs" pathname={pathname} label="Proofs">
        <ShieldCheck className="h-[18px] w-[18px]" />
      </MobileTab>
      <MobileTab href="/portfolio" pathname={pathname} label="My bets">
        <Ticket className="h-[18px] w-[18px]" />
      </MobileTab>
    </nav>
  );
}

function MobileTab({ href, pathname, label, children }: { href: string; pathname: string; label: string; children: React.ReactNode }) {
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link href={href} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition", active ? "text-brand" : "text-muted")}>
      {children}
      {label}
    </Link>
  );
}
