// Default to devnet (where the program lives) — matches the API routes. Override
// with NEXT_PUBLIC_RPC for a dedicated RPC in production.
export const RPC = process.env.NEXT_PUBLIC_RPC || "https://api.devnet.solana.com";

export const ONSIDE_PROGRAM_ID = "6F6fVu5x4ng1mxxLtXseVEE9ZxRAvyjxqeXfDQUsEpvb";
export const TXORACLE_PROGRAM_ID = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
export const WC_COMPETITION_ID = 72;

// Trusted market creator — the UI only shows markets from this authority, so an
// attacker who permissionlessly creates a look-alike market cannot hijack the feed.
export const SEED_AUTHORITY = "CgdfP57FAkR5ho8JnRmCkQSn7caAGjd8jKUtK7A3TDA7";

// Fixture with a pinned proof fallback so the canonical demo always settles cleanly.
export const DEMO_FIXTURE = 17926615;

// Default "broadcast" stream for the live match centre — a real, embeddable public football
// stream (licensed World Cup video isn't iframe-embeddable, so this is a public stand-in; the
// TxODDS data tracker renders underneath regardless). Override per-deploy with
// NEXT_PUBLIC_DEMO_STREAM_URL, or per-user via the player's "Change stream" button.
// Default: official MLS full-match highlights (real football, globally available + embeddable;
// live/licensed feeds like the World Cup are geo-locked and can't be embedded). Users in
// regions where FIFA feeds ARE available can swap to the real match via "Change stream".
export const DEMO_STREAM_URL =
  process.env.NEXT_PUBLIC_DEMO_STREAM_URL || "https://www.youtube.com/watch?v=-z4BJeCLTIs";
