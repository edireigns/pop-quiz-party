// Content moderation for nicknames, friend-written words, inside jokes and dares.
//
// Word lists are ROT13-encoded so the source stays readable for contributors.
// To add a term, ROT13 it (e.g. `echo word | tr 'a-z' 'n-za-m'`) and append it.
import type { ContentLevel } from "@/lib/game/types";

const rot13 = (s: string) =>
  s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
const decode = (list: string[]) => new Set(list.map(rot13));

/** Slurs, hate terms and explicit sexual terms — blocked at BOTH content levels. */
const SEVERE = decode([
  "avttre", "avttn", "avttnf", "snttbg", "snt", "sntf", "ergneq", "ergneqrq", "fcvp", "puvax", "xvxr",
  "genaal", "qlxr", "jrgonpx", "tbbx", "pbba", "enturnq", "gbjryurnq", "ornare", "cnxv", "cbea", "cbeab",
  "cbeauho", "kkk", "phz", "phzfubg", "oybjwbo", "unaqwbo", "qvyqb", "nany", "encr", "encvfg", "encvat",
  "crqb", "crqbcuvyr", "vaprfg", "betnfz", "znfgheongr", "wrexbss", "pbpx", "chffl", "phag", "cravf",
  "intvan", "obbof", "gvgf", "ahqr", "ahqrf", "ubeal", "zvys", "uragnv", "baylsnaf", "anmv", "uvgyre",
  "urvy", "xxx", "juber", "fyhg", "fyhgf", "pbpxfhpxre", "zbgureshpxre",
]);
/** Severe stems that also match as a prefix of a longer word. */
const SEVERE_PREFIX = [...decode([
  "avtt", "sntt", "cbea", "phag", "juber", "fyhg", "encvfg", "crqbcuvy", "znfgheong", "pbpxfhpx", "zbgureshpx",
])];

/** Everyday profanity and innuendo — blocked only in Clean mode. */
const MILD = decode([
  "shpx", "shpxvat", "shpxrq", "shpxre", "fuvg", "fuvggl", "ohyyfuvg", "qnza", "qnzzvg", "uryy", "penc",
  "nff", "nffubyr", "onfgneq", "ovgpu", "ovgpurf", "qvpx", "qvpxf", "cvff", "cvffrq", "obyybpxf",
  "oybbql", "jnaxre", "cevpx", "qbhpur", "frkl", "frk", "obbo", "ohgg", "jgs", "fgsh", "yzsnb", "bzst",
  "ubr", "ubrf", "gubg", "gjng", "nefr", "ohttre", "obbgl", "jrrq", "fgbare", "qehax",
]);
const MILD_PREFIX = [...decode(["shpx", "fuvg", "ovgpu", "jnax"])];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

/** Lower-case, strip accents, undo common leetspeak, split into word tokens. */
export function tokenize(text: string): string[] {
  const base = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  const raw = base.split(/[^a-z]+/).filter(Boolean);
  // Re-join spaced-out letters ("f u c k") so they can't dodge the filter.
  const out: string[] = [];
  let run = "";
  for (const t of raw) {
    if (t.length === 1) run += t;
    else {
      if (run.length > 1) out.push(run);
      else if (run) out.push(run);
      run = "";
      out.push(t);
    }
  }
  if (run) out.push(run);
  // Also squash repeated letters ("fuuuuck") as an extra variant.
  return out.flatMap((t) => {
    const squashed = t.replace(/(.)\1{2,}/g, "$1");
    return squashed !== t ? [t, squashed] : [t];
  });
}

function hits(tokens: string[], exact: Set<string>, prefixes: string[]): boolean {
  return tokens.some((t) => {
    const singular = t.replace(/(es|s|ed|ing)$/, "");
    return exact.has(t) || exact.has(singular) || prefixes.some((p) => t.startsWith(p));
  });
}

export function isSevere(text: string): boolean {
  return hits(tokenize(text), SEVERE, SEVERE_PREFIX);
}

/** True if the text is not allowed at the given content level. */
export function isBlocked(text: string, level: ContentLevel): boolean {
  const tokens = tokenize(text);
  if (hits(tokens, SEVERE, SEVERE_PREFIX)) return true;
  if (level === "clean" && hits(tokens, MILD, MILD_PREFIX)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Field validators. Each returns { ok: true, value } or { ok: false, error }.
// ---------------------------------------------------------------------------
export type Validation = { ok: true; value: string } | { ok: false; error: string };

const PHRASE_RE = /^[A-Za-z0-9 .,'!?&:\-]+$/;
const NICK_RE = /^[\p{L}\p{N} ._'!?\-]+$/u;

export function validateNickname(input: unknown, level: ContentLevel): Validation {
  if (typeof input !== "string") return { ok: false, error: "Pick a nickname." };
  const value = input.replace(/\s+/g, " ").trim();
  if ([...value].length < 2 || [...value].length > 16) return { ok: false, error: "Nicknames are 2–16 characters." };
  if (!NICK_RE.test(value)) return { ok: false, error: "Use letters, numbers and spaces only." };
  if (isBlocked(value, level)) return { ok: false, error: "That nickname isn't allowed. Try another." };
  return { ok: true, value };
}

/** Friend-written words and inside jokes. */
export function validatePhrase(input: unknown, level: ContentLevel): Validation {
  if (typeof input !== "string") return { ok: false, error: "Enter a word or phrase." };
  const value = input.replace(/\s+/g, " ").trim();
  if (value.length < 2 || value.length > 40) return { ok: false, error: "Words must be 2–40 characters." };
  if (!PHRASE_RE.test(value)) return { ok: false, error: "Use letters, numbers, spaces and basic punctuation (. , ' ! ? & : -)." };
  if (!/[A-Za-z]/.test(value)) return { ok: false, error: "Include at least one letter." };
  if (isBlocked(value, level)) return { ok: false, error: "That word isn't allowed in this game." };
  return { ok: true, value };
}

export function validateHint(input: unknown, level: ContentLevel, answer?: string): Validation {
  if (input == null || input === "") return { ok: true, value: "" };
  if (typeof input !== "string") return { ok: false, error: "Hint must be text." };
  const value = input.replace(/\s+/g, " ").trim();
  if (value.length > 60) return { ok: false, error: "Hints are 60 characters max." };
  if (!/^[\p{L}\p{N}\p{P}\p{Zs}]*$/u.test(value)) return { ok: false, error: "Hint has unsupported characters." };
  if (isBlocked(value, level)) return { ok: false, error: "That hint isn't allowed in this game." };
  if (answer && value.toLowerCase().includes(answer.toLowerCase())) return { ok: false, error: "The hint can't contain the answer." };
  return { ok: true, value };
}

export function validateDare(input: unknown, level: ContentLevel): Validation {
  if (typeof input !== "string") return { ok: false, error: "Enter a dare." };
  const value = input.replace(/\s+/g, " ").trim();
  if (value.length < 4 || value.length > 100) return { ok: false, error: "Dares are 4–100 characters." };
  if (isBlocked(value, level)) return { ok: false, error: "That dare isn't allowed at this content level." };
  return { ok: true, value };
}
