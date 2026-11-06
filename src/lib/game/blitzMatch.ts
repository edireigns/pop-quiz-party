// Category Blitz answer matching (server-side source of truth).
import { normalizeAnswer, typoDistance } from "./answers";

/** Typos allowed for a normalised accepted answer: up to 4 chars exact, 5–8 one typo, longer two. */
export function blitzTypos(normalizedLength: number): number {
  if (normalizedLength <= 4) return 0;
  if (normalizedLength <= 8) return 1;
  return 2;
}

/** True if the normalised answer starts with the prompt's letter. */
export function startsWithLetter(normalized: string, letter: string): boolean {
  return normalized.length > 0 && normalized[0] === letter.toLowerCase();
}

const digitsOf = (s: string) => s.replace(/[^0-9]/g, "");

/**
 * Which accepted answer group a typed answer matches, or -1.
 * - Must start with the letter (after dropping a leading the/a/an).
 * - An exact normalised match on an answer or alternate always wins.
 * - Otherwise the closest answer within its typo allowance wins, but only if it's the
 *   single closest: numbers must match exactly ("Shrek 2" is never "Shrek") and a typo
 *   that sits equally close to two different answers (Mouse / Moose) matches neither.
 */
export function matchBlitzAnswer(input: string, letter: string, answers: readonly (readonly string[])[]): number {
  const g = normalizeAnswer(input);
  if (!startsWithLetter(g, letter)) return -1;
  for (let i = 0; i < answers.length; i++) for (const alt of answers[i]) if (normalizeAnswer(alt) === g) return i;
  let best = Infinity;
  let hits = new Set<number>();
  for (let i = 0; i < answers.length; i++) {
    for (const alt of answers[i]) {
      const a = normalizeAnswer(alt);
      const allowed = blitzTypos(a.length);
      if (!allowed || a[0] !== g[0] || digitsOf(a) !== digitsOf(g)) continue;
      const d = typoDistance(g, a, allowed);
      if (d > allowed) continue;
      if (d < best) {
        best = d;
        hits = new Set([i]);
      } else if (d === best) hits.add(i);
    }
  }
  return hits.size === 1 ? [...hits][0] : -1;
}
