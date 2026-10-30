import type { Card, Outcome } from '../game/index.js';
import type { PublicPlayer, PublicState } from '../shared/protocol.js';

export const money = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

export const signed = (n: number): string => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : '±0');

export const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
export const isRed = (card: Card): boolean => card.suit === 'H' || card.suit === 'D';

export const OUTCOME_TEXT: Record<Outcome, string> = {
  blackjack: 'Blackjack!',
  win: 'Win',
  push: 'Push',
  lose: 'Lose',
  bust: 'Bust',
};

/** Net result of a player's whole round (all hands + insurance). */
export function roundNet(p: PublicPlayer): number | null {
  if (!p.inRound || p.hands.some((h) => h.payout === null)) return null;
  const staked = p.hands.reduce((s, h) => s + h.bet, 0) + (p.insurance ?? 0);
  const returned = p.hands.reduce((s, h) => s + (h.payout ?? 0), 0) + (p.insurancePayout ?? 0);
  return returned - staked;
}

/** The headline at the top of the screen. */
export function bannerText(state: PublicState, me: string | null): string {
  const mine = state.players.find((p) => p.id === me);
  const host = state.players.find((p) => p.isHost);
  switch (state.phase) {
    case 'waiting':
      if (mine?.isHost) return 'Press Start when everyone is seated';
      return `Waiting for ${host?.name ?? 'the host'} to start`;
    case 'betting':
      if (mine?.seat === null) return 'Players are betting';
      if (mine?.ready) return 'Waiting for other players…';
      return state.deadline ? 'Place your bets' : 'Place your bet, then Deal';
    case 'dealing':
      return 'Dealing…';
    case 'insurance':
      return mine?.inRound && mine.insurance === null ? 'Insurance?' : 'Waiting on insurance…';
    case 'playing': {
      const turn = state.turn;
      if (!turn) return '';
      const p = state.players.find((x) => x.id === turn.playerId);
      if (turn.playerId === me) {
        return p && p.hands.length > 1 ? `Your turn · hand ${turn.handIndex + 1} of ${p.hands.length}` : 'Your turn';
      }
      return `${p?.name ?? 'Player'}'s turn`;
    }
    case 'dealer':
      return 'Dealer plays';
    case 'results': {
      if (!mine?.inRound) return 'Round over';
      const net = roundNet(mine);
      if (net === null) return 'Round over';
      const bj = mine.hands.some((h) => h.outcome === 'blackjack');
      if (bj && net > 0) return `Blackjack! ${signed(net)}`;
      if (net > 0) return `You win ${signed(net)}`;
      if (net < 0) return `Dealer wins ${signed(net)}`;
      return 'Push · bet returned';
    }
  }
}
