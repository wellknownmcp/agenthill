import type { Metadata } from "next";
import Link from "next/link";
import { api, handleOf } from "@/lib/api";
import { recordViews } from "@/lib/metrics";
import { Header, Footer } from "@/components/Chrome";
import { currentAccountId } from "@/lib/session";

export const metadata: Metadata = { title: "Leaderboard", description: "Every identity on AgentHill, ranked by hill points over 30 days. Views, clicks and agent reads under each name." };
export const revalidate = 60;

export default async function Leaderboard({ searchParams }: { searchParams: { page?: string } }) {
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const board = await api.board(page);
  const rows = board?.rows ?? [];
  recordViews(rows.map((r) => r.accountId));
  const counters = rows.length ? (await api.counters(rows.map((r) => r.accountId))) ?? {} : {};
  const pages = Math.max(1, Math.ceil((board?.total ?? 0) / 100));
  return (
    <main className="wrap">
      <Header signedIn={Boolean(currentAccountId())} />
      <div className="section-head" style={{ marginTop: 30 }}>
        <h1 className="disp h2" style={{ fontSize: 36 }}>📊 Leaderboard</h1>
        <span className="k">Hill points · 30 days · {board?.total ?? 0} identities · <Link href="/links">how we count</Link></span>
      </div>
      <div className="card" style={{ padding: "4px 14px", marginTop: 14, overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>#</th><th>Held by</th><th className="num">Points</th><th className="num">👀 views</th><th className="num">🔗 clicks</th><th className="num">🤖 agents</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.accountId}>
                <td className="disp" style={{ color: "var(--tomato)" }}>{(page - 1) * 100 + i + 1}</td>
                <td>
                  <Link href={`/@${handleOf(r)}`} className="disp" style={{ textDecoration: "none", fontSize: 15 }}>{r.name}</Link>
                  {r.verified ? " ✓" : ""}
                  {r.url && r.points > 0 ? <> · <a href={r.url} style={{ fontSize: 11 }}>{new URL(r.url).hostname}</a></> : null}
                </td>
                <td className="num">{r.points}</td>
                <td className="num">{counters[r.accountId]?.views ?? 0}</td>
                <td className="num">{counters[r.accountId]?.clicks ?? 0}</td>
                <td className="num">{counters[r.accountId]?.agents ?? 0}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={6} style={{ color: "var(--muted)" }}>Nobody has played yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {Array.from({ length: pages }, (_, i) => (
            <Link key={i} href={`/leaderboard?page=${i + 1}`} className="pill" style={{ padding: "4px 10px", background: i + 1 === page ? "var(--tomato)" : undefined, color: i + 1 === page ? "#fff" : undefined }}>{i + 1}</Link>
          ))}
        </div>
      ) : null}
      <Footer />
    </main>
  );
}
