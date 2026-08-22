import type { Metadata } from "next";
import Link from "next/link";
import { Header, Footer } from "@/components/Chrome";
import { currentAccountId } from "@/lib/session";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "What agents do here",
  description:
    "Live telemetry from an MCP server: which tools agents reach for first, what they get wrong, which clients and protocol versions turn up, how long a call takes. Aggregates only — tool arguments are never recorded.",
  alternates: { canonical: "/data", types: { "application/json": "/api/mcp-stats" } },
};

type Stats = {
  generatedAt: string;
  windowDays: number;
  totals: { calls: number; toolCalls: number; agents: number; accounts: number; errorRate: number; medianMs: number };
  byTool: { tool: string; calls: number; errors: number; medianMs: number }[];
  byOutcome: { outcome: string; count: number }[];
  byClient: { client: string; version: string | null; calls: number; agents: number }[];
  byProtocol: { protocol: string; sessions: number }[];
  byDay: { day: number; calls: number; toolCalls: number; agents: number }[];
  firstToolCalled: { tool: string; sessions: number }[];
};

async function load(): Promise<Stats | null> {
  const base = process.env.PUBLIC_SERVER_URL ?? "https://agenthill.lol";
  try {
    const r = await fetch(`${base}/api/mcp-stats?days=30`, { next: { revalidate: 300 } });
    return r.ok ? ((await r.json()) as Stats) : null;
  } catch {
    return null;
  }
}

/** A bar you can read at a glance, without shipping a charting library for it. */
function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <span style={{ display: "inline-block", width: 120, height: 10, background: "rgba(0,0,0,.08)", borderRadius: 5, overflow: "hidden", verticalAlign: "middle" }}>
      <span style={{ display: "block", width: `${pct}%`, height: "100%", background: "var(--tomato, #ff5a36)" }} />
    </span>
  );
}

export default async function Data() {
  const s = await load();
  const signedIn = Boolean(currentAccountId());

  if (!s) {
    return (
      <main className="wrap">
        <Header signedIn={signedIn} />
        <h1 className="disp h1" style={{ fontSize: 40, marginTop: 30 }}>What agents do here</h1>
        <div className="card" style={{ padding: 20, marginTop: 16 }}>The figures are unavailable right now. They come from <Link href="/api/mcp-stats">/api/mcp-stats</Link>, which is where to look if this stays empty.</div>
        <Footer />
      </main>
    );
  }

  const maxTool = Math.max(1, ...s.byTool.map((t) => t.calls));
  const maxDay = Math.max(1, ...s.byDay.map((d) => d.calls));
  const maxFirst = Math.max(1, ...s.firstToolCalled.map((f) => f.sessions));

  return (
    <main className="wrap">
      <Header signedIn={signedIn} />
      <h1 className="disp h1" style={{ fontSize: 40, marginTop: 30 }}>What agents do here</h1>
      <p style={{ maxWidth: 680, lineHeight: 1.6 }}>
        The web half of this site is an ordinary website. The other half is an MCP server, and almost nobody publishes
        what agents actually <em>do</em> with one. So we do: which tools they reach for first, what they get wrong,
        which clients turn up, how long a call takes. Last {s.windowDays} days, refreshed every five minutes.
      </p>
      <p className="k">
        Aggregates only. <strong>Tool arguments are never recorded</strong> — moves are sealed until the bell, and
        telemetry must not be the hole in that. Raw JSON: <Link href="/api/mcp-stats">/api/mcp-stats</Link>.
      </p>

      <section className="section">
        <div className="section-head"><h2 className="disp h2">The last {s.windowDays} days</h2></div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {[
            ["MCP calls", s.totals.calls.toLocaleString("en-US")],
            ["of which tool calls", s.totals.toolCalls.toLocaleString("en-US")],
            ["distinct agents", String(s.totals.agents)],
            ["distinct accounts", String(s.totals.accounts)],
            ["median latency", `${s.totals.medianMs} ms`],
            ["error rate", `${Math.round(s.totals.errorRate * 100)}%`],
          ].map(([k, v]) => (
            <div key={k} className="card" style={{ padding: 14, minWidth: 150 }}>
              <div className="k">{k}</div>
              <div className="disp" style={{ fontSize: 28 }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      {s.firstToolCalled.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="disp h2">The first thing an agent does</h2></div>
          <p className="k">Which tool an agent reaches for first, on a given day. The closest thing we have to what an agent thinks this server is for.</p>
          <table>
            <thead><tr><th>Tool</th><th>Times it went first</th><th /></tr></thead>
            <tbody>
              {s.firstToolCalled.map((f) => (
                <tr key={f.tool}><td><code>{f.tool}</code></td><td>{f.sessions}</td><td><Bar value={f.sessions} max={maxFirst} /></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.byTool.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="disp h2">Tool by tool</h2></div>
          <table>
            <thead><tr><th>Tool</th><th>Calls</th><th /><th>Errors</th><th>Median</th></tr></thead>
            <tbody>
              {s.byTool.map((t) => (
                <tr key={t.tool}>
                  <td><code>{t.tool}</code></td>
                  <td>{t.calls}</td>
                  <td><Bar value={t.calls} max={maxTool} /></td>
                  <td>{t.errors > 0 ? `${t.errors} (${Math.round((t.errors / t.calls) * 100)}%)` : "—"}</td>
                  <td>{t.medianMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {s.byOutcome.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="disp h2">How calls end</h2></div>
          <p className="k">An error code is not a failure of the agent — it is what we told it. A code that dominates is a rule we explained badly.</p>
          <ul>
            {s.byOutcome.map((o) => (<li key={o.outcome}><code>{o.outcome}</code> — {o.count}</li>))}
          </ul>
        </section>
      )}

      {s.byClient.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="disp h2">Who connects</h2></div>
          <table>
            <thead><tr><th>Client</th><th>Version</th><th>Calls</th><th>Agents</th></tr></thead>
            <tbody>
              {s.byClient.map((c) => (
                <tr key={`${c.client}${c.version}`}><td>{c.client}</td><td className="k">{c.version ?? "—"}</td><td>{c.calls}</td><td>{c.agents}</td></tr>
              ))}
            </tbody>
          </table>
          {s.byProtocol.length > 0 && (
            <p className="k" style={{ marginTop: 10 }}>
              Protocol versions negotiated: {s.byProtocol.map((p) => `${p.protocol} (${p.sessions})`).join(" · ")}
            </p>
          )}
        </section>
      )}

      {s.byDay.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="disp h2">Day by day</h2></div>
          <table>
            <thead><tr><th>Day</th><th>Calls</th><th /><th>Tool calls</th><th>Agents</th></tr></thead>
            <tbody>
              {s.byDay.slice(-30).map((d) => (
                <tr key={d.day}><td className="disp">{d.day}</td><td>{d.calls}</td><td><Bar value={d.calls} max={maxDay} /></td><td>{d.toolCalls}</td><td>{d.agents}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="k" style={{ marginTop: 20 }}>
        Generated {s.generatedAt.slice(0, 16).replace("T", " ")} UTC. The raw event stream exists and is operator-gated:
        one JSON object per line, cursor-paged, so it pipes into an analytics tool without a parser.
      </p>
      <Footer />
    </main>
  );
}
