import "server-only";
import * as E from "@/lib/game/engine";
import { type Ctx, GameError, type GameState, type PowerUp, type Settings } from "@/lib/game/types";
import { validateDare, validateHint, validatePhrase, validatePrompt, validateQuestion } from "@/lib/moderation";
import { cleanClue, isEmojiClue, normalizeAnswer } from "@/lib/game/answers";

/** Optional emoji clue: emojis and spaces only. */
function parseClue(v: unknown, required: boolean): string | undefined {
  if (v == null || (typeof v === "string" && v.trim() === "")) {
    if (required) throw new GameError("invalid", "Add an emoji clue (emojis only).");
    return undefined;
  }
  if (typeof v !== "string" || !isEmojiClue(v)) throw new GameError("invalid", "Emoji clues can only contain emojis and spaces (up to 12 emojis).");
  return cleanClue(v);
}

/** Accepted alternates: an array or a comma-separated string, up to 6. */
function parseAlternates(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const alt = validatePhrase(raw, "pg13");
    if (!alt.ok) throw new GameError("invalid", `Alternate "${String(raw).slice(0, 40)}": ${alt.error}`);
    if (!out.includes(alt.value)) out.push(alt.value);
  }
  if (out.length > 6) throw new GameError("invalid", "Up to 6 alternate answers.");
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * A host-written Category Blitz prompt: a category (2–40 characters), one letter,
 * and optional accepted answers — comma-separated, alternates joined with "/".
 */
function parseBlitzPrompt(body: Record<string, unknown>): { category: string; letter: string; answers: string[][] } {
  const cat = validatePhrase(body.category, "pg13"); // the game's content level is applied when prompts are used
  if (!cat.ok) throw new GameError("invalid", `Category: ${cat.error}`);
  const letter = str(body.letter).trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) throw new GameError("invalid", "Pick one letter, A–Z.");
  const raw = Array.isArray(body.answers) ? body.answers.join(",") : str(body.answers);
  const answers: string[][] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split(/[,\n]/)) {
    if (!chunk.trim()) continue;
    const group: string[] = [];
    for (const part of chunk.split("/")) {
      if (!part.trim()) continue;
      const a = validatePhrase(part, "pg13");
      if (!a.ok) throw new GameError("invalid", `"${part.trim().slice(0, 40)}": ${a.error}`);
      const n = normalizeAnswer(a.value);
      if (!n.startsWith(letter.toLowerCase())) throw new GameError("invalid", `"${a.value}" doesn't start with ${letter}.`);
      if (seen.has(n)) continue;
      seen.add(n);
      group.push(a.value);
    }
    if (group.length) answers.push(group);
  }
  if (answers.length > 200) throw new GameError("invalid", "Up to 200 accepted answers.");
  return { category: cat.value, letter, answers };
}

/** Host actions. Caller must already have verified the host token. */
export function hostAction(s: GameState, ctx: Ctx, body: Record<string, unknown>) {
  const action = str(body.action);
  switch (action) {
    case "ping":
      return;
    case "updateSettings":
      return E.updateSettings(s, (body.settings ?? {}) as Partial<Settings>);
    case "addInsideJoke": {
      if (s.phase !== "lobby") throw new GameError("wrong_phase", "Add inside jokes before the game starts.", 409);
      const a = validatePhrase(body.answer, "pg13");
      if (!a.ok) throw new GameError("invalid", a.error);
      const h = validateHint(body.hint, "pg13", a.value);
      if (!h.ok) throw new GameError("invalid", h.error);
      E.addInsideJoke(s, a.value, h.value, ctx);
      if (!s.settings.categories.includes("inside")) s.settings.categories = [...s.settings.categories, "inside"];
      return;
    }
    case "removeInsideJoke":
      if (s.phase !== "lobby") throw new GameError("wrong_phase", "Inside jokes are locked once the game starts.", 409);
      return E.removeInsideJoke(s, str(body.id));
    case "addInsideClue": {
      if (s.phase !== "lobby") throw new GameError("wrong_phase", "Add inside jokes before the game starts.", 409);
      const clue = parseClue(body.clue, true)!;
      const a = validatePhrase(body.answer, "pg13");
      if (!a.ok) throw new GameError("invalid", a.error);
      E.addInsideClue(s, clue, a.value, parseAlternates(body.alternates), ctx);
      if (!s.settings.categories.includes("inside")) s.settings.categories = [...s.settings.categories, "inside"];
      return;
    }
    case "removeInsideClue":
      if (s.phase !== "lobby") throw new GameError("wrong_phase", "Inside jokes are locked once the game starts.", 409);
      return E.removeInsideClue(s, str(body.id));
    case "dropHint":
      return E.dropHint(s, ctx);
    case "addCustomQuestion": {
      if (s.phase !== "lobby" && s.phase !== "ended") throw new GameError("wrong_phase", "Add questions before the game starts.", 409);
      const q = validateQuestion(body.text, "pg13"); // the game's content level is applied when questions are used
      if (!q.ok) throw new GameError("invalid", q.error);
      return E.addCustomQuestion(s, q.value, ctx);
    }
    case "removeCustomQuestion":
      if (s.phase !== "lobby" && s.phase !== "ended") throw new GameError("wrong_phase", "Questions are locked once the game starts.", 409);
      return E.removeCustomQuestion(s, str(body.id));
    case "removeQuestionSub":
      return E.removeQuestionSub(s, str(body.id));
    case "addCustomPrompt": {
      if (s.phase !== "lobby" && s.phase !== "ended") throw new GameError("wrong_phase", "Add questions before the game starts.", 409);
      const q = validatePrompt(body.text, "pg13"); // the game's content level is applied when questions are used
      if (!q.ok) throw new GameError("invalid", q.error);
      return E.addCustomPrompt(s, q.value, ctx);
    }
    case "removeCustomPrompt":
      if (s.phase !== "lobby" && s.phase !== "ended") throw new GameError("wrong_phase", "Questions are locked once the game starts.", 409);
      return E.removeCustomPrompt(s, str(body.id));
    case "removePromptSub":
      return E.removePromptSub(s, str(body.id));
    case "addCustomBlitz": {
      if (s.phase !== "lobby" && s.phase !== "ended") throw new GameError("wrong_phase", "Add prompts before the game starts.", 409);
      return E.addCustomBlitz(s, parseBlitzPrompt(body), ctx);
    }
    case "removeCustomBlitz":
      if (s.phase !== "lobby" && s.phase !== "ended") throw new GameError("wrong_phase", "Prompts are locked once the game starts.", 409);
      return E.removeCustomBlitz(s, str(body.id));
    case "reviewAnswer":
      return E.reviewBlitzAnswer(s, str(body.id), body.verdict ?? null);
    case "finishReview":
      return E.finishBlitzReview(s, ctx);
    case "skipAnswer":
      return E.skipWwiAnswer(s, ctx);
    case "removeAnswer":
      return E.removeWwiAnswer(s, str(body.answerId), ctx);
    case "addDare": {
      const d = validateDare(body.text, "pg13"); // content level is applied when dares are used
      if (!d.ok) throw new GameError("invalid", d.error);
      return E.addCustomDare(s, d.value, ctx);
    }
    case "removeDare":
      return E.removeCustomDare(s, str(body.id));
    case "removeSubmission":
      return E.removeSubmission(s, str(body.id));
    case "start":
      return E.startGame(s, ctx);
    case "next":
      return E.next(s, ctx);
    case "pause":
      return E.pause(s, ctx);
    case "resume":
      return E.resume(s, ctx);
    case "skip":
      return E.skipWord(s, ctx);
    case "removePlayer":
      return E.removePlayer(s, str(body.playerId), ctx);
    case "respinDare":
      return E.respinDare(s, ctx);
    case "end":
      return E.endGame(s, ctx);
    case "playAgain":
      return E.playAgain(s, ctx);
    default:
      throw new GameError("bad_action", "Unknown action.");
  }
}

/** Player actions. Caller must already have resolved the player from their token. */
export function playerAction(s: GameState, ctx: Ctx, playerId: string, body: Record<string, unknown>) {
  const action = str(body.action);
  switch (action) {
    case "ping":
      return;
    case "guess":
      return E.guess(s, playerId, body.letter, ctx);
    case "hint":
      return E.takeHint(s, playerId, ctx);
    case "answer":
      return E.submitAnswer(s, playerId, body.answer, ctx);
    case "vote":
      return E.castVote(s, playerId, body.targetId, ctx);
    case "submitQuestion": {
      const q = validateQuestion(body.text, s.settings.content);
      if (!q.ok) throw new GameError("invalid", q.error);
      return E.submitQuestion(s, playerId, q.value, ctx);
    }
    case "submitPrompt": {
      const q = validatePrompt(body.text, s.settings.content);
      if (!q.ok) throw new GameError("invalid", q.error);
      return E.submitPrompt(s, playerId, q.value, ctx);
    }
    case "blitzAnswer":
      return E.submitBlitzAnswer(s, playerId, body.text, ctx);
    case "writeAnswer":
      return E.submitWwiAnswer(s, playerId, body.text, ctx);
    case "wwiGuess":
      return E.wwiGuess(s, playerId, body.targetId, ctx);
    case "powerup": {
      const type = str(body.type) as PowerUp;
      if (!["freeze", "reveal", "extraLife"].includes(type)) throw new GameError("bad_powerup", "Unknown power-up.");
      return E.activatePowerup(s, playerId, type, body.targetId ? str(body.targetId) : null, ctx);
    }
    case "react":
      return E.react(s, playerId, body.emoji, ctx);
    case "submitWord": {
      const a = validatePhrase(body.answer, s.settings.content);
      if (!a.ok) throw new GameError("invalid", a.error);
      const h = validateHint(body.hint, s.settings.content, a.value);
      if (!h.ok) throw new GameError("invalid", h.error);
      const clue = parseClue(body.clue, s.settings.mode === "emoji");
      return E.submitWord(s, playerId, a.value, h.value, ctx, clue);
    }
    case "pickCategory":
      return E.pickCategory(s, playerId, body.category, ctx);
    case "spinDare":
      return E.spinDare(s, playerId, ctx);
    case "passDare":
      return E.passDare(s, playerId);
    default:
      throw new GameError("bad_action", "Unknown action.");
  }
}
