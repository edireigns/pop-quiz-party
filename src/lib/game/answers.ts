// Emoji Decode answer matching and clue helpers (server-side source of truth).

/**
 * Normalise a typed answer for comparison:
 * lower-case, strip accents, "&" → "and", drop punctuation, collapse spaces,
 * drop a leading "the" / "a" / "an", then remove spaces entirely so
 * "Spider-Man", "spider man" and "spiderman" all compare equal.
 */
export function normalizeAnswer(input: string): string {
  let s = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "") // "Grey's" → "greys"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  s = s.replace(/^(the|a|an) (?=\S)/, "");
  return s.replace(/ /g, "");
}

/** Optimal-string-alignment distance: insert, delete, substitute, or swap two neighbours = 1 typo. */
export function typoDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => {
    const row = new Array<number>(b.length + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Typos allowed for a normalised answer: <4 chars exact, 4–8 one typo, longer two. */
export function allowedTypos(normalizedLength: number): number {
  if (normalizedLength < 4) return 0;
  if (normalizedLength <= 8) return 1;
  return 2;
}

/** True if `guess` matches the answer or any accepted alternate. */
export function isCorrectAnswer(guess: string, answer: string, alternates: readonly string[] = []): boolean {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  for (const accepted of [answer, ...alternates]) {
    const a = normalizeAnswer(accepted);
    if (!a) continue;
    const allowed = allowedTypos(a.length);
    if (typoDistance(g, a, allowed) <= allowed) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Emoji clues
// ---------------------------------------------------------------------------
const EMOJI_GRAPHEME =
  /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|(?!\p{Regional_Indicator})(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier})?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\p{Emoji_Modifier})?)*)$/u;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;

/** Split a string into user-perceived characters. */
export function graphemes(text: string): string[] {
  if (segmenter) return [...segmenter.segment(text)].map((s) => s.segment);
  return [...text];
}

/** A clue may contain only emojis and spaces (1–12 emojis). */
export function isEmojiClue(text: string): boolean {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return false;
  const parts = graphemes(trimmed).filter((g) => g.trim() !== "");
  if (parts.length < 1 || parts.length > 12) return false;
  if (graphemes(trimmed).some((g) => g.trim() === "" && g !== " ")) return false; // only plain spaces
  return parts.every((g) => EMOJI_GRAPHEME.test(g));
}

/** Clean up spacing in a clue (no leading/trailing/double spaces). */
export function cleanClue(text: string): string {
  return text.trim().replace(/ {2,}/g, " ");
}

/** Key used so the same clue isn't shown twice in a game. */
export function clueKey(clue: string): string {
  return graphemes(clue).filter((g) => g.trim() !== "").map((g) => g.replace(/\uFE0F/g, "")).join("");
}

// ---------------------------------------------------------------------------
// Host hints
// ---------------------------------------------------------------------------
export const MAX_HOST_HINTS = 2;

/** Hint 1: the first letter. Hint 2: number of words and letters. */
export function hostHintText(answer: string, index: number): string {
  const words = answer
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  if (index === 0) {
    const first = (words[0] ?? "?")[0].toUpperCase();
    return `Starts with “${first}”`;
  }
  const lens = words.map((w) => w.length);
  const total = lens.reduce((a, b) => a + b, 0);
  return words.length === 1 ? `1 word · ${total} letters` : `${words.length} words · ${lens.join(" + ")} letters`;
}

/** Letters/digits of the answer in order (what the Reveal power-up indexes into). */
export function answerLetters(answer: string): string[] {
  return [...answer.normalize("NFD").replace(/[\u0300-\u036f]/g, "")].filter((c) => /[A-Za-z0-9]/.test(c)).map((c) => c.toUpperCase());
}
