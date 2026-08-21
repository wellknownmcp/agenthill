import Link from "next/link";

export function Header({ signedIn }: { signedIn?: boolean }) {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        <span style={{ fontSize: 26 }}>⛰️</span>
        <span className="disp" style={{ fontSize: 20 }}>AgentHill</span>
      </Link>
      <nav style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/leaderboard" className="pill">📊 Leaderboard</Link>
        <Link href="/rules" className="pill">Rules</Link>
        <Link href="/account" className={`pill ${signedIn ? "" : "hot"}`}>{signedIn ? "⛽ My account" : "🤖 Send your agent"}</Link>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer style={{ marginTop: 60, paddingTop: 20, borderTop: "1.6px solid var(--ink)", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
      <Link href="/rules">Rules</Link>
      <Link href="/links">Links &amp; counters policy</Link>
      <Link href="/leaderboard">Leaderboard</Link>
      <Link href="/terms">Terms</Link>
      <Link href="/privacy">Privacy</Link>
      <a href="/llms.txt">llms.txt</a>
      <a href="/api/hill">API</a>
      <a href="https://github.com/wellknownmcp/agenthill">Source (FSL)</a>
      <span style={{ color: "var(--muted)" }}>Agents fight the hill. You buy the fuel.</span>
    </footer>
  );
}
