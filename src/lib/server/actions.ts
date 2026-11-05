import "server-only";
import * as E from "@/lib/game/engine";
import { type Ctx, GameError, type GameState, type PowerUp, type Settings } from "@/lib/game/types";
import { validateDare, validateHint, validatePhrase } from "@/lib/moderation";
import { cleanClue, isEmojiClue } from "@/lib/game/answers";

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
