"use client";

import { Buffer } from "buffer";
import { useMemo } from "react";
import { Toaster } from "sonner";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletStateProvider } from "@/lib/wallet";
import { ConnectModal } from "@/components/ConnectModal";
import { RPC } from "@/lib/config";

// wallet-adapter currently ships React 19-compatible component types while this app
// is on React 18; the runtime component contract is unchanged.
const SolanaConnectionProvider = ConnectionProvider as React.ComponentType<any>;
const SolanaWalletProvider = WalletProvider as React.ComponentType<any>;

// Browser polyfill required by @solana/web3.js + anchor.
if (typeof globalThis !== "undefined") {
  (globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Empty list: modern wallets register via the Wallet Standard and are auto-detected
  // (Phantom, Solflare, Backpack, …). No per-wallet adapter packages needed.
  const wallets = useMemo(() => [], []);

  return (
    <SolanaConnectionProvider endpoint={RPC} config={{ commitment: "confirmed", disableRetryOnRateLimit: true }}>
      {/* autoConnect persists the wallet across reloads — wallet-adapter remembers the
          selected wallet and silently reconnects a trusted one on mount. Fresh connects
          still go through the click gesture in ConnectModal, so there's no popup race. */}
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletStateProvider>
          {children}
          <ConnectModal />
          <Toaster
            theme="dark"
            position="top-center"
            toastOptions={{
              style: {
                background: "#111113",
                border: "1px solid #262629",
                color: "#fafafa",
              },
            }}
          />
        </WalletStateProvider>
      </SolanaWalletProvider>
    </SolanaConnectionProvider>
  );
}
