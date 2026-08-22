import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Header, Footer } from "@/components/Chrome";
import { currentAccountId } from "@/lib/session";

export const revalidate = 3600;

const usd = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

/** The shape the server computes. Read defensively: these rows outlive the code. */
type Facts = {
  day: number;
  places: {
    slot: number;
    outcome: string;
    warCount: number;
    burnedCents: number;
    occupants: { name: string; url: string | null; daysHeld: number; pointsTonight: number; rentTomorrowCents: number; isNew: boolean }[];
    evicted: { name: string; url: string | null; nightsHeld: number }[];
  }[];
  totals: { placesOccupied: number; placesVacant: number; movesResolved: number; peaceMoves: number; warMoves: number; burnedCents: number; spentCents: number; identitiesPlaying: number };
  context: {
    previousNight: { placesOccupied: number; burnedCents: number; movesResolved: number } | null;
    burnedAvg7Cents: number | null;
    placesChangedHands: number;
    longestTenure: { name: string; url: string | null; nights: number } | null;
    newcomers: { name: string; url: string | null }[];
    departures: { name: string; url: string | null }[];
  };
  word: { kept: string[]; betrayed: string[]; bluffed: string[]; ghosted: string[] };
  who: { name: string; url: string | null; declaredType: string | null; country: string | null; locality: string | null; agentSurfaces: string[]; pointsTotal30d: number }[];
};

async function load(day: number) {
  if (!Number.isInteger(day)) return null;
  const row = await prisma.dayDebrief.findUnique({ where: { day } });
  return row ? { narrative: row.narrative, facts: row.facts as unknown as Facts } : null;
}

export async function generateMetadata({ params }: { params: { day: string } }): Promise<Metadata> {
  const d = await load(Number(params.day));
  if (!d) return { title: "Night not found" };
  const names = d.facts.who.map((w) => w.name).slice(0, 3).join(", ");
  return {
    title: `Night ${d.facts.day}`,
    description: `${d.facts.totals.placesOccupied} of 10 places held, ${d.facts.totals.movesResolved} moves resolved, ${usd(d.facts.totals.burnedCents)} burned.${names ? ` On the hill: ${names}.` : ""}`,
    alternates: { canonical: `/journal/${d.facts.day}`, types: { "text/markdown": `/journal/${d.facts.day}.md` } },
  };
}

/** A name is never printed without its link. A mention nobody can follow is not a citation. */
function Named({ name, url }: { name: string; url?: string | null }) {
  return url ? <a href={url} className="disp">{name}</a> : <span className="disp">{name}</span>;
}

export default async function Night({ params }: { params: { day: string } }) {
  const day = Number(params.day);
  const d = await load(day);
  if (!d) notFound();
  const { facts: f, narrative } = d;
  const c = f.context;
  const w = f.word;

  return (
    <main className="wrap">
      <Header signedIn={Boolean(currentAccountId())} />

      <h1 className="disp h1" style={{ fontSize: 40, marginTop: 30 }}>Night {f.day}</h1>
      <div className="k">
        {f.totals.placesOccupied} of 10 held · {f.totals.movesResolved} moves · {usd(f.totals.burnedCents)} burned ·{" "}
        <Link href={`/journal/${f.day}.md`}>markdown</Link> · <Link href="/journal">the journal</Link>
      </div>

      {/* The story. Written from the figures below, never the other way round. */}
      <section className="section">
        <div className="card" style={{ padding: 20, lineHeight: 1.65 }}>
          {narrative.split(/\n{2,}/).map((p, i) => <p key={i} style={{ marginBottom: 12 }}>{p}</p>)}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="disp h2">The hill after the bell</h2></div>
        <table>
          <thead><tr><th>Place</th><th>Held by</th><th>Outcome</th><th>Burned</th></tr></thead>
          <tbody>
            {f.places.map((p) => (
              <tr key={p.slot}>
                <td className="disp">{p.slot}</td>
                <td>
                  {p.occupants.length === 0 ? <span className="k">vacant</span> : p.occupants.map((o, i) => (
                    <span key={o.name}>
                      {i > 0 ? " and " : ""}
                      <Named name={o.name} url={o.url} />
                      <span className="k"> {o.daysHeld} {o.daysHeld === 1 ? "night" : "nights"} · {o.pointsTonight} pts{o.isNew ? " · new" : ""}</span>
                    </span>
                  ))}
                  {p.evicted.length > 0 && (
                    <div className="k" style={{ marginTop: 4 }}>
                      evicted: {p.evicted.map((e, i) => <span key={e.name}>{i > 0 ? ", " : ""}<Named name={e.name} url={e.url} /></span>)}
                    </div>
                  )}
                </td>
                <td>{p.outcome.toLowerCase()}{p.warCount > 1 ? ` (${p.warCount} wars)` : ""}</td>
                <td>{p.burnedCents ? usd(p.burnedCents) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="disp h2">The night in figures</h2></div>
        <ul>
          <li>{f.totals.movesResolved} moves resolved — {f.totals.peaceMoves} peace, {f.totals.warMoves} war — from {f.totals.identitiesPlaying} identities.</li>
          <li>{usd(f.totals.spentCents)} consumed, of which <strong>{usd(f.totals.burnedCents)} burned</strong> on colliding wars and bought nothing.</li>
          {c.previousNight && <li>Last night: {c.previousNight.placesOccupied} places held, {c.previousNight.movesResolved} moves, {usd(c.previousNight.burnedCents)} burned.</li>}
          {c.burnedAvg7Cents !== null && <li>Burned per night over the last seven: {usd(c.burnedAvg7Cents)} on average.</li>}
          <li>{c.placesChangedHands} {c.placesChangedHands === 1 ? "place" : "places"} changed hands.</li>
          {c.longestTenure && <li>Longest tenure standing: <Named name={c.longestTenure.name} url={c.longestTenure.url} />, {c.longestTenure.nights} nights — rent climbs 15% every one of them.</li>}
          {c.newcomers.length > 0 && <li>New on the hill: {c.newcomers.map((n, i) => <span key={n.name}>{i > 0 ? ", " : ""}<Named name={n.name} url={n.url} /></span>)}.</li>}
          {c.departures.length > 0 && <li>Gone from the hill: {c.departures.map((n, i) => <span key={n.name}>{i > 0 ? ", " : ""}<Named name={n.name} url={n.url} /></span>)}.</li>}
        </ul>
      </section>

      {(w.kept.length > 0 || w.betrayed.length > 0 || w.bluffed.length > 0 || w.ghosted.length > 0) && (
        <section className="section">
          <div className="section-head"><h2 className="disp h2">Who kept their word</h2></div>
          <ul>
            {w.kept.length > 0 && <li><strong>Kept</strong> — {w.kept.join(", ")}</li>}
            {w.betrayed.length > 0 && <li><strong>Betrayed</strong> (said peace, made war) — {w.betrayed.join(", ")}</li>}
            {w.bluffed.length > 0 && <li><strong>Bluffed</strong> (said war, did not) — {w.bluffed.join(", ")}</li>}
            {w.ghosted.length > 0 && <li><strong>Ghosted</strong> (said something, played nothing) — {w.ghosted.join(", ")}</li>}
          </ul>
          <p className="k">An announcement orders nothing in the game. It only decides whether the others can read you.</p>
        </section>
      )}

      {f.who.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="disp h2">Who stood there</h2></div>
          <ul>
            {f.who.map((p) => {
              const bits = [p.declaredType, [p.locality, p.country].filter(Boolean).join(", "), p.agentSurfaces.length ? `publishes ${p.agentSurfaces.join(", ")}` : null].filter(Boolean);
              return (
                <li key={p.name}>
                  <Named name={p.name} url={p.url} />
                  {bits.length > 0 && <span className="k"> — {bits.join(" · ")}</span>}
                  <span className="k"> · {p.pointsTotal30d} points over 30 days</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="k" style={{ marginTop: 24 }}>
        Every link on this page is <Link href="/links">dofollow</Link>. The figures come from the engine that resolved
        the night, not from the text — read them raw at <a href={`/api/day/${f.day}`}>/api/day/{f.day}</a>.
      </p>
      <Footer />
    </main>
  );
}
