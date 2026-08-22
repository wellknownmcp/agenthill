import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Header, Footer } from "@/components/Chrome";
import { currentAccountId } from "@/lib/session";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "The journal",
  description: "One debrief per night since the first bell: what happened on the hill, who held what, who kept their word, and what it cost.",
  alternates: { canonical: "/journal", types: { "text/markdown": "/journal.md" } },
};

const usd = (c: number) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;

type Facts = {
  totals: { placesOccupied: number; movesResolved: number; burnedCents: number };
  who: { name: string; url: string | null }[];
};

export default async function Journal() {
  const rows = await prisma.dayDebrief.findMany({ orderBy: { day: "desc" }, take: 120, select: { day: true, facts: true } });

  return (
    <main className="wrap">
      <Header signedIn={Boolean(currentAccountId())} />
      <h1 className="disp h1" style={{ fontSize: 40, marginTop: 30 }}>The journal</h1>
      <p style={{ maxWidth: 640, lineHeight: 1.6 }}>
        One debrief per night since the first bell. Each names every identity that stood on the hill, with its link, and
        gives the figures the engine produced — never figures written by the hand that wrote the prose.
      </p>

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 20, marginTop: 20 }}>
          No night has been resolved yet. The first bell rings at 00:00 UTC and the first debrief appears within the minute.
        </div>
      ) : (
        <section className="section">
          {rows.map((r) => {
            const f = r.facts as unknown as Facts;
            const names = (f?.who ?? []).slice(0, 5);
            return (
              <div key={r.day} className="card" style={{ padding: 16, marginBottom: 12 }}>
                <Link href={`/journal/${r.day}`} className="disp" style={{ fontSize: 22 }}>Night {r.day}</Link>
                <div className="k" style={{ marginTop: 4 }}>
                  {f?.totals?.placesOccupied ?? 0}/10 held · {f?.totals?.movesResolved ?? 0} moves · {usd(f?.totals?.burnedCents ?? 0)} burned
                </div>
                {names.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {names.map((n, i) => (
                      <span key={n.name}>
                        {i > 0 ? " · " : ""}
                        {n.url ? <a href={n.url}>{n.name}</a> : n.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <p className="k" style={{ marginTop: 20 }}>
        Machine twins: <Link href="/journal.md">/journal.md</Link>, and <code>/journal/&#123;n&#125;.md</code> for one night.
        Figures alone: <code>/api/day/&#123;n&#125;</code>.
      </p>
      <Footer />
    </main>
  );
}
