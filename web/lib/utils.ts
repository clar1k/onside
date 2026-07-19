import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format lamports as a compact SOL string. */
export function fmtSol(lamports: number, digits = 2): string {
  return (lamports / 1e9).toFixed(digits);
}

export function shortAddr(addr: string, n = 4): string {
  return addr ? `${addr.slice(0, n)}…${addr.slice(-n)}` : "";
}
