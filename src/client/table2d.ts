// A flat HTML table. Used to prove multiplayer works (stage 3), and kept as a
// fallback for devices without WebGL.

import type { Card } from '../game/index.js';
import type { PublicHand, PublicPlayer, PublicState } from '../shared/protocol.js';
import { MAX_SEATS } from '../shared/protocol.js';
import { h } from './dom.js';
import { OUTCOME_TEXT, SUIT_SYMBOL, isRed, money } from './format.js';
import type { TableRenderer } from './renderer.js';

function cardEl(card: Card | null): HTMLElement {
  if (!card) return h('div', { class: 'card2d back', 'aria-label': 'face-down card' });
  return h(
    'div',
    { class: `card2d${isRed(card) ? ' red' : ''}`, 'aria-label': `${card.rank} of ${card.suit}` },
    h('span', { class: 'rank' }, card.rank),
    h('span', { class: 'suit' }, SUIT_SYMBOL[card.suit]),
  );
}

function handEl(hand: PublicHand, active: boolean): HTMLElement {
  return h(
    'div',
    { class: `hand2d${active ? ' active' : ''}` },
    h('div', { class: 'cards2d' }, hand.cards.map(cardEl)),
    h(
      'div',
      { class: 'hand-meta' },
      h('span', { class: 'total' }, hand.label),
      h('span', { class: 'hand-bet' }, money(hand.bet), hand.doubled ? ' ×2' : ''),
      hand.outcome ? h('span', { class: `outcome ${hand.outcome}` }, OUTCOME_TEXT[hand.outcome]) : null,
    ),
  );
}

export class Table2D implements TableRenderer {
  private readonly root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = h('div', { class: 'table2d' });
    container.append(this.root);
  }

  update(state: PublicState, _events: unknown, me: string | null): void {
    const dealer = h(
      'section',
      { class: 'dealer2d' },
      h('div', { class: 'label' }, 'Dealer', state.dealer.label ? h('span', { class: 'total' }, state.dealer.label) : null),
      h('div', { class: 'cards2d' }, state.dealer.cards.map(cardEl)),
      h('div', { class: 'felt-text' }, 'BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON SOFT 17'),
      h('div', { class: 'shoe2d' }, `Shoe: ${state.shoe.remaining} cards`, state.shoe.cutCardReached ? ' · shuffle after this round' : ''),
    );

    const bySeat = new Map<number, PublicPlayer>();
    for (const p of state.players) if (p.seat !== null) bySeat.set(p.seat, p);
    const seatCount = state.solo ? 1 : MAX_SEATS;
    const seats: HTMLElement[] = [];
    for (let s = 0; s < seatCount; s++) {
      const p = bySeat.get(s);
      if (!p) {
        seats.push(h('div', { class: 'seat2d empty' }, h('div', { class: 'name' }, `Seat ${s + 1}`), h('div', { class: 'muted' }, 'empty')));
        continue;
      }
      const isTurn = state.turn?.playerId === p.id;
      seats.push(
        h(
          'div',
          { class: `seat2d${p.id === me ? ' me' : ''}${isTurn ? ' turn' : ''}${p.connected ? '' : ' away'}` },
          h('div', { class: 'name' }, p.isHost ? '👑 ' : '', p.name, p.id === me ? ' (you)' : ''),
          h('div', { class: 'muted' }, money(p.balance), ' chips', p.connected ? '' : ' · away'),
          p.hands.length
            ? h('div', { class: 'hands2d' }, p.hands.map((hand, i) => handEl(hand, isTurn && state.turn?.handIndex === i)))
            : h('div', { class: 'circle2d' }, p.bet ? money(p.bet) : state.phase === 'betting' ? 'bet' : 'waiting'),
          p.insurance ? h('div', { class: 'muted' }, `Insured ${money(p.insurance)}`) : null,
          p.ready && state.phase === 'betting' ? h('div', { class: 'ready' }, '✓ ready') : null,
        ),
      );
    }
    // Seat 1 ("first base") is on the dealer's left, so on the right of the screen.
    this.root.replaceChildren(dealer, h('section', { class: 'seats2d' }, seats.reverse()));
  }

  setLowGraphics(): void {}

  dispose(): void {
    this.root.remove();
  }
}
