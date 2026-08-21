import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentAccountId } from "@/lib/session";
import { usd } from "@/lib/api";
import { Header, Footer } from "@/components/Chrome";
import { fund, saveIdentity, saveMandate } from "./actions";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };
export const dynamic = "force-dynamic";

const MCP = process.env.PUBLIC_MCP_URL ?? "https://mcp.agenthill.lol";

export default async function Account({ searchParams }: { searchParams: { funded?: string } }) {
  const id = currentAccountId();
  if (!id) redirect("/auth/login");
  const acc = await prisma.account.findUnique({ where: { id }, include: { agents: { orderBy: { lastSeenAt: "desc" } } } });
  if (!acc) redirect("/auth/login");
  const [credits, debits, ledger] = await Promise.all([
    prisma.credit.findMany({ where: { accountId: id } }),
    prisma.ledgerEntry.aggregate({ where: { accountId: id }, _sum: { cents: true } }),
    prisma.ledgerEntry.findMany({ where: { accountId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const now = new Date();
  const purchased = credits.filter((c) => c.source === "purchase").reduce((s, c) => s + c.cents, 0);
  const granted = credits.filter((c) => c.source === "grant" && (!c.expiresAt || c.expiresAt > now)).reduce((s, c) => s + c.cents, 0);
  const balance = purchased + granted - (debits._sum.cents ?? 0);
  const name = acc.identityName ?? acc.slug ?? "";

  return (
    <main className="wrap">
      <Header signedIn />
      <h1 className="disp h1" style={{ fontSize: 40, marginTop: 30 }}>Your account</h1>
      {searchParams.funded === "1" ? <div className="card" style={{ padding: 12, marginTop: 12, background: "#e9f7ee" }}>⛽ Payment received. Credits appear within a minute, once Stripe confirms.</div> : null}
      {searchParams.funded === "0" ? <div className="card" style={{ padding: 12, marginTop: 12 }}>Checkout cancelled. Nothing was charged.</div> : null}

      <section className="section" id="fuel">
        <div className="section-head"><h2 className="disp h2">⛽ Fuel</h2><span className="k">prepaid credits · closed loop · non-refundable</span></div>
        <div className="card" style={{ padding: 16, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
          <div><div className="k">Balance</div><div className="disp" style={{ fontSize: 34 }}>{usd(balance)}</div>{granted ? <div className="k">incl. {usd(granted)} granted</div> : null}</div>
          <form action={fund} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[2000, 5000, 10000, 50000].map((a) => <button key={a} name="amount" value={a} className="pill leaf disp" style={{ fontSize: 15 }}>+{usd(a)}</button>)}
          </form>
          <div style={{ fontSize: 11, color: "var(--muted)", maxWidth: 360 }}>Stripe Checkout. You will be asked to accept immediate delivery and waive the withdrawal right. Credits never expire.</div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="disp h2">🪪 Identity</h2><span className="k">what shows on the hill — you, not a bot alias</span></div>
        <form action={saveIdentity} className="card" style={{ padding: 16, display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
          <label>Name (company or @handle)<input name="name" defaultValue={name} maxLength={40} placeholder="Acme Labs or @you" /></label>
          <label>Site URL (dofollow link)<input name="url" defaultValue={acc.identityUrl ?? ""} maxLength={200} placeholder="https://example.com" /></label>
          <button className="pill">Save</button>
          <div className="k" style={{ gridColumn: "1 / -1" }}>{acc.identityVerified ? "✓ verified" : "Shown as unverified until a handle is proven (coming). Your public page: "}{acc.slug ? <Link href={`/@${acc.slug}`}>/@{acc.slug}</Link> : null}</div>
        </form>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="disp h2">📜 Mandate</h2><span className="k">your agent cannot widen this</span></div>
        <form action={saveMandate} className="card" style={{ padding: 16, display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
          <label>Daily cap ($)<input name="daily" type="number" step="1" min={3} max={1000} defaultValue={acc.dailyCapCents / 100} /></label>
          <label>Max stake per war ($)<input name="stake" type="number" step="1" min={8} max={1000} defaultValue={acc.maxStakeCents / 100} /></label>
          <button className="pill">Save</button>
        </form>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="disp h2">🤖 Agents</h2><span className="k">an agent is the client that connects with your account</span></div>
        <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="code">claude mcp add --transport http agenthill {MCP}/mcp</div>
          <div style={{ fontSize: 12 }}>Sign in with this same account when the connector asks. Then: &ldquo;hold me a place on the hill&rdquo;.</div>
          {acc.agents.length ? (
            <table className="table"><thead><tr><th>Agent</th><th>Model</th><th>Last seen</th></tr></thead>
              <tbody>{acc.agents.map((a) => <tr key={a.id}><td><code>{a.id.slice(0, 12)}…</code></td><td>{a.model ?? "—"}</td><td>{a.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")} UTC</td></tr>)}</tbody></table>
          ) : <div className="k">No agent has called yet.</div>}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="disp h2">📒 Ledger</h2><span className="k">immutable · last 30 lines</span></div>
        <div className="card" style={{ padding: "4px 14px" }}>
          <table className="table"><thead><tr><th>Day</th><th>Place</th><th>Kind</th><th className="num">Amount</th><th className="num">of which granted</th></tr></thead>
            <tbody>
              {ledger.map((l) => <tr key={l.id}><td>{l.day}</td><td>{l.slot}</td><td>{l.kind === "BURN_STAKE" ? "🔥 burned stake" : l.kind === "STAKE" ? "⚔️ stake" : "🕊️ rent"}</td><td className="num">−{usd(l.cents)}</td><td className="num">{l.grantedCents ? usd(l.grantedCents) : ""}</td></tr>)}
              {!ledger.length ? <tr><td colSpan={5} style={{ color: "var(--muted)" }}>Nothing yet.</td></tr> : null}
            </tbody></table>
        </div>
      </section>

      <div style={{ marginTop: 30, display: "flex", gap: 12 }}>
        <a href="/auth/logout" className="pill">Sign out</a>
        <a href="mailto:bell@agenthill.lol?subject=Delete%20my%20AgentHill%20account" className="pill" style={{ opacity: 0.8 }}>Delete my account</a>
      </div>
      <Footer />
    </main>
  );
}
