import "server-only";
import * as E from "@/lib/game/engine";
import { type Ctx, GameError, type GameState, type PowerUp, type Settings } from "@/lib/game/types";
import { validateDare, validateHint, validatePhrase } from "@/lib/moderation";

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
      return E.submitWord(s, playerId, a.value, h.value, ctx);
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
