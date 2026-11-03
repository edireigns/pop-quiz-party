/*
 * Starter dares for the Dare Wheel. Edit freely.
 * Every dare must be safe, consensual and optional: no alcohol, nothing
 * physically risky, nothing degrading, nothing that involves touching
 * someone without their OK. The spinner can always pass.
 */
import type { ContentLevel } from "@/lib/game/types";

export interface Dare {
  text: string;
  content: ContentLevel;
}

const d = (text: string, content: ContentLevel = "clean"): Dare => ({ text, content });

export const STARTER_DARES: Dare[] = [
  d("Do your best runway walk across the room"),
  d("Sing the chorus of a song the group picks"),
  d("Talk in a movie-trailer voice until the next round"),
  d("Give a 20-second award acceptance speech for 'Best Hangman Player'"),
  d("Compliment every player in 20 seconds"),
  d("Narrate the room like a nature documentary for 30 seconds"),
  d("Talk like a pirate until the next round"),
  d("Do your best celebrity impression — the group guesses who"),
  d("Strike three superhero poses"),
  d("Hum a song until someone guesses it"),
  d("Speak only in questions until the next round"),
  d("Sell an object near you in a dramatic 20-second commercial"),
  d("Beatbox for 15 seconds"),
  d("Do your best evil-villain laugh"),
  d("Share a harmless embarrassing fun fact about yourself"),
  d("Do 10 seconds of interpretive dance about your score"),
  d("Explain the plot of your favourite movie in 3 emojis, out loud"),
  d("Do a dramatic slow-motion replay of your last wrong guess"),
  d("Invent a new handshake with a willing volunteer"),
  d("Freeze like a statue until someone makes you laugh (max 30s)"),
  d("Reveal your celebrity crush", "pg13"),
  d("Deliver your smoothest pickup line to the TV", "pg13"),
  d("Show the group your screen-time report", "pg13"),
  d("Do a dramatic soap-opera breakup scene with a pillow", "pg13"),
  d("Read your last sent emoji out loud and explain it (skip anything private)", "pg13"),
  d("Do a sultry slow-motion hair flip", "pg13"),
  d("Rate everyone's outfit like a fashion judge", "pg13"),
  d("Recreate a famous movie romance moment with a pillow", "pg13"),
];

export function startersFor(content: ContentLevel): string[] {
  return STARTER_DARES.filter((x) => content === "pg13" || x.content === "clean").map((x) => x.text);
}
