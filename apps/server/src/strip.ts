/**
 * The page owns its own structure.
 *
 * Asked for prose with no headings, the writer still opened its debrief with
 * "# AgentHill — Night 7", which gave the markdown twin two H1s. A structural
 * constraint you can enforce is not one you ask for politely — so the headings
 * come off here, and the prompt's request is only a first line of defence.
 */
export function stripStructure(text: string): string {
  const NL = String.fromCharCode(10);
  const isHeading = (line: string) => /^ {0,3}#{1,6} /.test(line);
  return text
    .split(/\r?\n/)
    .filter((l) => !isHeading(l))
    .join(NL)
    .replace(/\n{3,}/g, NL + NL)
    .trim();
}
