/**
 * Third-party text (identities, messages) is data, never instruction. Before it
 * reaches the database or another agent it is normalized (NFC), stripped of
 * control characters and line breaks, trimmed, and bounded.
 */
const CONTROL = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]", "g");

export function normalizeText(text: unknown, max?: number): string {
  if (typeof text !== "string") return "";
  let s = text.normalize("NFC").replace(CONTROL, "").trim();
  if (max !== undefined && max >= 0) {
    const points = Array.from(s);
    if (points.length > max) s = points.slice(0, max).join("");
  }
  return s;
}
