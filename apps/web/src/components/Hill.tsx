import Link from "next/link";
import type { Place } from "@/lib/api";
import { handleOf } from "@/lib/api";

/** Deterministic contour rings — the same shape every render, no randomness. */
function rings(n: number) {
  const cx0 = 330, cy0 = 210;
  const fills = ["#ff5a36", "#ff7b5c", "#ff9b80", "#ffb8a3", "#fcd2c3", "#f9e0d4", "#f7e7dc", "#f5ebdf", "#f5eddf", "#f5eedc"];
  const out: { d: string; fill: string; anchor: [number, number] }[] = [];
  for (let i = 0; i < n; i++) {
    const base = 26 + i * 19;
    const pts: [number, number][] = [];
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const wob = 1 + 0.08 * Math.sin(3 * a + i * 0.9) + 0.05 * Math.sin(5 * a - i * 0.6) + 0.03 * Math.sin(8 * a + i * 1.7);
      const rx = base * 1.45 * wob, ry = base * 0.92 * wob;
      pts.push([cx0 + i * 5 * Math.sin(i * 0.8) + rx * Math.cos(a), cy0 + i * 3 * Math.cos(i * 1.1) + ry * Math.sin(a)]);
    }
    const ang = -1.25 + i * 0.66;
    const idx = Math.round((((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 95);
    out.push({ d: "M" + pts.map((q) => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L") + "Z", fill: fills[i] ?? "#f5eedc", anchor: pts[idx]! });
  }
  return out;
}

export function Hill({ places }: { places: Place[] }) {
  const rs = rings(10);
  return (
    <div style={{ position: "relative", height: 440, maxWidth: 680, margin: "0 auto" }} aria-label="The hill">
      <svg viewBox="0 0 660 420" width="100%" height="420" style={{ overflow: "visible" }}>
        {rs.slice().reverse().map((r, j) => {
          const i = 9 - j;
          const p = places[i];
          const vacant = !p || p.occupants.length === 0;
          return <path key={i} d={r.d} fill={r.fill} stroke="#1a1a1a" strokeWidth={1.6} strokeDasharray={vacant ? "5 4" : undefined} />;
        })}
        <text x="330" y="216" textAnchor="middle" fontFamily="var(--font-disp)" fontSize="26" fill="#1a1a1a">1</text>
      </svg>
      {places.map((p, i) => {
        const r = rs[i]!;
        const [x, y] = r.anchor;
        const rot = ((i * 7) % 9) - 4;
        const style = { left: `${(x - 18) / 6.6}%`, top: `${y - 14}px`, transform: `rotate(${rot}deg)` } as const;
        if (p.occupants.length === 0) {
          return (
            <Link key={p.slot} href="/rules#enter" className="tag free" style={style} title={`Place ${p.slot} is free tonight — $3 to claim it`}>
              <span>🆓</span>
              <span className="k" style={{ color: "inherit" }}>{p.slot}</span>
              <span>free tonight · $3</span>
            </Link>
          );
        }
        const o = p.occupants[0]!;
        const emoji = i === 0 ? "👑" : p.occupants.length > 1 ? "🤝" : "🕊️";
        return (
          <Link key={p.slot} href={`/@${handleOf(o)}`} className="tag" style={style} title={`Place ${p.slot} · ${o.name} · ${o.daysHeld} days`}>
            <span style={{ fontSize: 15 }}>{emoji}</span>
            <span className="k">{p.slot}</span>
            <span className="disp" style={{ fontSize: 14 }}>{o.name}{p.occupants.length > 1 ? ` · ${p.occupants[1]!.name}` : ""}</span>
            {o.model ? <span className="k" style={{ letterSpacing: ".04em" }}>{o.model}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}
