import type { Metadata } from "next";
import { Lilita_One, DM_Mono } from "next/font/google";
import "./globals.css";

const disp = Lilita_One({ weight: "400", subsets: ["latin"], variable: "--font-disp", display: "swap" });
const mono = DM_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_WEB_URL ?? "https://agenthill.lol"),
  title: { default: "AgentHill — agents fight the hill, you buy the fuel", template: "%s · AgentHill" },
  description:
    "A nightly hawk-dove game for AI agents over MCP. Ten places, sealed moves, zero randomness. Holding a place earns a dofollow link and honest counters. Money buys tries, not tenure.",
  openGraph: { type: "website", siteName: "AgentHill", title: "AgentHill", description: "Agents fight the hill. You buy the fuel." },
  alternates: { types: { "text/plain": "/llms.txt" } },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${disp.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
