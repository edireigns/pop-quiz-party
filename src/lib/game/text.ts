// Phrase handling: normalisation, guessable letters, masking.

/** Strip accents and upper-case a single character. */
export function normalizeChar(ch: string): string {
  return ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

/** A character the player must guess (A-Z after normalisation). */
export function isGuessable(ch: string): boolean {
  return /^[A-Z]$/.test(normalizeChar(ch));
}

/** Normalise a guess. Returns null if it isn't a single letter A-Z. */
export function normalizeGuess(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if ([...trimmed].length !== 1) return null;
  const n = normalizeChar(trimmed);
  return /^[A-Z]$/.test(n) ? n : null;
}

/** Distinct guessable letters in an answer. */
export function letterSet(answer: string): Set<string> {
  const s = new Set<string>();
  for (const ch of answer) if (isGuessable(ch)) s.add(normalizeChar(ch));
  return s;
}

/** Collapse whitespace and trim. */
export function cleanPhrase(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Key used to prevent repeats within a game. */
export function wordKey(answer: string): string {
  return [...answer]
    .map(normalizeChar)
    .filter((c) => /[A-Z0-9]/.test(c))
    .join("");
}

export type MaskCell =
  | { t: "letter"; c: string | null } // c is null while hidden
  | { t: "space" }
  | { t: "fixed"; c: string }; // punctuation/digits, revealed automatically

/**
 * Build the masked pattern. Only letters in `known` are revealed.
 * Passing an empty set gives the blank pattern used on the TV.
 */
export function maskAnswer(answer: string, known: ReadonlySet<string>): MaskCell[] {
  const cells: MaskCell[] = [];
  for (const ch of answer) {
    if (ch === " ") cells.push({ t: "space" });
    else if (isGuessable(ch)) {
      const n = normalizeChar(ch);
      cells.push({ t: "letter", c: known.has(n) ? ch.toUpperCase() : null });
    } else cells.push({ t: "fixed", c: ch });
  }
  return cells;
}

/** Fraction (0..1) of letter positions revealed. */
export function solvedFraction(answer: string, known: ReadonlySet<string>): number {
  let total = 0;
  let got = 0;
  for (const ch of answer) {
    if (!isGuessable(ch)) continue;
    total++;
    if (known.has(normalizeChar(ch))) got++;
  }
  return total === 0 ? 1 : got / total;
}

export function isSolved(answer: string, known: ReadonlySet<string>): boolean {
  for (const l of letterSet(answer)) if (!known.has(l)) return false;
  return true;
}
