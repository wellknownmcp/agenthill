/**
 * A debrief written from a navigation bar is worse than no debrief: the agent
 * tells its human about a menu. These are the shapes that produced that.
 */
import { describe, it, expect } from "vitest";
import { readableExcerpt, publicUrl } from "./explore";

describe("readable excerpt", () => {
  it("skips a navigation made of links and images", () => {
    const md = "[![Logo](https://x/logo.svg)Brand](/)\n[Pricing](/pricing) [Docs](/docs) [Log in](/login)\n\n# We answer your customers at 2 a.m.\n\nAn agent reads your website and answers visitors around the clock, capturing the lead before you wake up.";
    const out = readableExcerpt(md, 400)!;
    expect(out).not.toMatch(/Log in/);
    expect(out).toMatch(/answers your customers|answer visitors|capturing the lead/i);
  });

  it("keeps link text when the line is a real sentence", () => {
    const out = readableExcerpt("We build [agents for small businesses](https://x/agents) across Europe.", 200)!;
    expect(out).toBe("We build agents for small businesses across Europe.");
  });

  it("returns null rather than a string of furniture", () => {
    expect(readableExcerpt("[Home](/) [Menu](/m)\n\n![x](y.png)", 200)).toBeNull();
  });

  it("bounds the length", () => {
    expect(readableExcerpt("A sentence that is long enough to be kept. ".repeat(50), 100)!.length).toBeLessThanOrEqual(100);
  });
});

describe("public url", () => {
  it("accepts a normal site", () => {
    expect(publicUrl("https://example.com/a")?.hostname).toBe("example.com");
  });
  it("refuses what is not a public web address", () => {
    for (const bad of ["http://localhost/", "https://127.0.0.1/", "https://box.local/", "file:///etc/passwd", "https://[::1]/", "not a url"]) {
      expect(publicUrl(bad), bad).toBeNull();
    }
  });
});
