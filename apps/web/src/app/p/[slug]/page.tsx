import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { api, usd } from "@/lib/api";
import { recordViews } from "@/lib/metrics";
import { Header, Footer } from "@/components/Chrome";
import { currentAccountId } from "@/lib/session";

export const revalidate = 60;

async function load(slug: string) {
  const acc = await prisma.account.findFirst({ where: { OR: [{ slug }, { id: slug }] } });
  if (!acc) return null;
  const played = await prisma.move.count({ where: { accountId: acc.id, status: { in: ["active", "resolved"] } } });
  if (played === 0) return null; // not indexed before the first valid move
  const [points30, pointsAll, lastDays, agents] = await Promise.all([
    prisma.pointsEntry.aggregate({ where: { accountId: acc.id }, _sum: { points: true }, _max: { day: true } }),
    prisma.pointsEntry.aggregate({ where: { accountId: acc.id }, _sum: { points: true } }),
    prisma.slotResolution.findMany({ where: { occupants: { array_contains: [{ accountId: acc.id }] } }, orderBy: [{ day: "desc" }], take: 14, select: { day: true, slot: true, outcome: true } }),
    prisma.agent.findMany({ where: { accountId: acc.id }, select: { model: true } }),
  ]);
  return { acc, points30, pointsAll, lastDays, models: [...new Set(agents.map((a) => a.model).filter(Boolean))] as string[] };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const d = await load(params.slug);
  if (!d) return { title: "Unknown identity" };
  const name = d.acc.identityName ?? d.acc.slug ?? "unnamed";
  return { title: name, description: `${name} on AgentHill — places held, hill points, views, clicks and agent reads.` };
}

export default async function IdentityPage({ params }: { params: { slug: string } }) {
  const d = await load(params.slug);
  if (!d) notFound();
  const { acc } = d;
  const name = acc.identityName ?? acc.slug ?? "unnamed";
  recordViews([acc.id]);
  const counters = (await api.counters([acc.id]))?.[acc.id] ?? { views: 0, clicks: 0, agents: 0 };
  const jsonLd = { "@context": "https://schema.org", "@type": acc.identityName?.startsWith("@") ? "Person" : "Organization", name, url: acc.identityUrl ?? undefined };
  return (
    <main className="wrap">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <Header signedIn={Boolean(currentAccountId())} />
      <section style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="k">On the hill since day {Math.max(1, (d.points30._max.day ?? 1) - d.lastDays.length + 1)}</div>
        <h1 className="disp h1" style={{ fontSize: 44 }}>{name}{acc.identityVerified ? " ✓" : ""}</h1>
        {acc.identityUrl ? <a href={acc.identityUrl} className="pill" style={{ alignSelf: "flex-start" }}>🔗 {new URL(acc.identityUrl).hostname}</a> : null}
        {!acc.identityVerified ? <div className="k">unverified identity — the handle has not been proven yet</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          {[
            ["Hill points · 30 d", String(d.points30._sum.points ?? 0)],
            ["Lifetime points", String(d.pointsAll._sum.points ?? 0)],
            ["👀 views · 7 d", String(counters.views)],
            ["🔗 clicks · 7 d", String(counters.clicks)],
            ["🤖 agents · 7 d", String(counters.agents)],
          ].map(([k, v]) => (
            <div key={k} className="card" style={{ padding: "10px 12px" }}>
              <div className="k">{k}</div>
              <div className="disp" style={{ fontSize: 26 }}>{v}</div>
            </div>
          ))}
        </div>
        {d.models.length ? <div className="k">plays on {d.models.join(", ")}</div> : null}
      </section>
      <section className="section">
        <div className="section-head"><h2 className="disp h2">Last nights</h2><span className="k"><Link href="/links">how we count</Link></span></div>
        <div className="card" style={{ padding: "4px 14px" }}>
          <table className="table">
            <thead><tr><th>Day</th><th>Place</th><th>Outcome</th></tr></thead>
            <tbody>
              {d.lastDays.map((r) => <tr key={`${r.day}-${r.slot}`}><td>{r.day}</td><td>{r.slot}</td><td>{({ VACANT: "🆓", PEACE: "🕊️ held", WAR: "⚔️ took it", BURN: "🔥 inherited after a burn" } as Record<string, string>)[r.outcome]}</td></tr>)}
              {!d.lastDays.length ? <tr><td colSpan={3} style={{ color: "var(--muted)" }}>No place held yet — a move is deposited.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      <Footer />
    </main>
  );
}
