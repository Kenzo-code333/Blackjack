// Computer players: names, personalities and table talk.

import { type Look, randomLook } from '../shared/protocol.js';

const NAMES = ['Rosa', 'Malik', 'Hana', 'Theo', 'Ines', 'Kofi', 'Lena', 'Mateo', 'Priya', 'Sven', 'Aiko', 'Omar'];

export interface BotPersonality {
  /** Typical bet as a fraction of the balance. */
  betShare: number;
  /** How talkative, 0–1. */
  chatty: number;
}

export function newBot(taken: Set<string>): { name: string; look: Look; personality: BotPersonality } {
  const free = NAMES.filter((n) => !taken.has(n));
  const name = free[Math.floor(Math.random() * free.length)] ?? `Bot ${taken.size + 1}`;
  return {
    name,
    look: randomLook(),
    personality: { betShare: 0.02 + Math.random() * 0.06, chatty: 0.3 + Math.random() * 0.5 },
  };
}

/** A bet in whole chips (multiples of 5) that fits the limits. */
export function botBet(balance: number, p: BotPersonality, min: number, max: number): number {
  const raw = balance * p.betShare * (0.6 + Math.random() * 0.8);
  const bet = Math.round(raw / 5) * 5;
  return Math.max(min, Math.min(max, bet, Math.floor(balance / 5) * 5));
}

const LINES = {
  blackjack: ['Blackjack!', 'Yes! Blackjack.', 'There it is 🂡', 'Twenty-one, baby.'],
  win: ['Nice.', "I'll take it.", 'Good hand.', 'Thank you, dealer!'],
  bust: ['Ugh, too many.', 'Busted…', 'Should have stood.', 'Oof.'],
  lose: ['Next one.', 'Close.', "Dealer's lucky tonight."],
  othersBlackjack: ['Nice blackjack, {name}!', 'Well played, {name}.', '{name} is on fire!'],
  greeting: ['Hey {name}! Good luck.', 'Hi {name} 👋', 'Welcome, {name}!', 'Evening, {name}.'],
  thanks: ['Anytime!', 'Good luck to you too.', '😄'],
};

export type BotLine = keyof typeof LINES;

export function botLine(kind: BotLine, name = ''): string {
  const options = LINES[kind];
  return options[Math.floor(Math.random() * options.length)]!.replace('{name}', name);
}

/** Which kind of reply (if any) a human's chat message deserves. */
export function replyKind(text: string): BotLine | null {
  if (/\b(hi|hello|hey|yo|evening|bonjour|salut)\b/i.test(text)) return 'greeting';
  if (/\b(gl|good luck|thanks|thank you|merci|nice)\b/i.test(text)) return 'thanks';
  return null;
}
