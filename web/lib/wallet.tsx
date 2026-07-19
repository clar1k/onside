"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet as useAdapterWallet, useAnchorWallet } from "@solana/wallet-adapter-react";
import { fetchSolBalance } from "@/lib/onside";

const KEY = "onside_burner_sk_v1";
const GUEST_FLAG = "onside_guest_v1";

function loadOrCreateKeypair(): Keypair {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    } catch {}
  }
  const kp = Keypair.generate();
  localStorage.setItem(KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/** Guest (in-browser devnet) wallet + the global connect-modal toggle. The guest
 *  wallet is NOT created until the user explicitly chooses it — so by default the
 *  app shows "Connect wallet", not a mystery address. */
type GuestCtx = {
  enabled: boolean;
  keypair: Keypair | null;
  enable: () => void;
  disable: () => void;
  connectOpen: boolean;
  openConnect: () => void;
  closeConnect: () => void;
};
const GuestContext = createContext<GuestCtx>(null as any);
export const useGuest = () => useContext(GuestContext);

export function WalletStateProvider({ children }: { children: React.ReactNode }) {
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(GUEST_FLAG) === "1") {
      setKeypair(loadOrCreateKeypair());
      setEnabled(true);
    }
  }, []);

  const enable = useCallback(() => {
    const kp = loadOrCreateKeypair();
    localStorage.setItem(GUEST_FLAG, "1");
    setKeypair(kp);
    setEnabled(true);
    setConnectOpen(false);
  }, []);

  const disable = useCallback(() => {
    localStorage.removeItem(GUEST_FLAG);
    setEnabled(false);
  }, []);

  return (
    <GuestContext.Provider
      value={{
        enabled,
        keypair,
        enable,
        disable,
        connectOpen,
        openConnect: () => setConnectOpen(true),
        closeConnect: () => setConnectOpen(false),
      }}
    >
      {children}
    </GuestContext.Provider>
  );
}

export type WalletKind = "real" | "guest" | "none";

export type ActiveWallet = {
  kind: WalletKind;
  ready: boolean;
  connecting: boolean;
  publicKey: PublicKey | null;
  address: string;
  anchorWallet: any;
  balance: number;
  funding: boolean;
  walletName?: string;
  refresh: () => Promise<void>;
  fund: () => Promise<void>;
  disconnect: () => void;
  useGuest: () => void;
  openConnect: () => void;
};

/** Unified wallet: a real connected wallet (wallet-adapter) takes priority; otherwise
 *  the guest wallet if the user enabled it; otherwise none. Same shape for both, so
 *  callers (bet/settle/claim) don't care which is active. */
export function useWallet(): ActiveWallet {
  const adapter = useAdapterWallet();
  const anchor = useAnchorWallet();
  const guest = useContext(GuestContext);
  const [balance, setBalance] = useState(0);
  const [funding, setFunding] = useState(false);

  const kind: WalletKind =
    adapter.connected && adapter.publicKey ? "real" : guest.enabled && guest.keypair ? "guest" : "none";
  const publicKey = kind === "real" ? adapter.publicKey! : kind === "guest" ? guest.keypair!.publicKey : null;
  const address = publicKey?.toBase58() ?? "";

  const guestAnchor = useMemo(() => {
    if (!guest.keypair) return null;
    const kp = guest.keypair;
    return {
      publicKey: kp.publicKey,
      signTransaction: async (tx: any) => {
        tx.partialSign(kp);
        return tx;
      },
      signAllTransactions: async (txs: any[]) => {
        txs.forEach((t) => t.partialSign(kp));
        return txs;
      },
    };
  }, [guest.keypair]);

  const anchorWallet = kind === "real" ? anchor ?? null : kind === "guest" ? guestAnchor : null;

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalance(0);
      return;
    }
    try {
      setBalance((await fetchSolBalance(publicKey)) / 1e9);
    } catch {
      // keep the last known balance on a throttled RPC rather than flashing 0.00
    }
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const fund = useCallback(async () => {
    if (!publicKey) return;
    setFunding(true);
    try {
      const res = await fetch("/api/fund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: publicKey.toBase58() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Faucet is busy, try again");
      }
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
    } finally {
      setFunding(false);
    }
  }, [address, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = useCallback(() => {
    if (kind === "real") adapter.disconnect().catch(() => {});
    else guest.disable();
  }, [kind, adapter, guest]);

  return {
    kind,
    ready: kind !== "none",
    connecting: adapter.connecting,
    publicKey,
    address,
    anchorWallet,
    balance,
    funding,
    walletName: adapter.wallet?.adapter.name,
    refresh,
    fund,
    disconnect,
    useGuest: guest.enable,
    openConnect: guest.openConnect,
  };
}
