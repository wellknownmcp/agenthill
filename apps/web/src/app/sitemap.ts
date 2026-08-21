import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

export const revalidate = 3600;
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const web = process.env.PUBLIC_WEB_URL ?? "https://agenthill.lol";
  const now = new Date();
  const base: MetadataRoute.Sitemap = [
    { url: `${web}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${web}/leaderboard`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${web}/rules`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${web}/links`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
  ];
  // Indexed identities only: at least one valid move (§7 ter — registering alone
  // gets no link). A database that is down must not take the sitemap with it.
  try {
    const played = await prisma.move.groupBy({ by: ["accountId"], where: { status: { in: ["active", "resolved"] } } });
    const ids = played.map((p) => p.accountId);
    const accounts = ids.length ? await prisma.account.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } }) : [];
    return [...base, ...accounts.map((a) => ({ url: `${web}/@${a.slug ?? a.id}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.5 }))];
  } catch (e) {
    console.error("[sitemap] identities unavailable", e instanceof Error ? e.message : e);
    return base;
  }
}
