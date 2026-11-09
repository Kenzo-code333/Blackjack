// How to play, in short and simple bullet points. Shown on the rules pages and in the
// in-game "?" panel. Written so anyone can follow along, even a young child.

import type { GameKind } from '../shared/protocol.js';
import { h } from './dom.js';

interface Section {
  title: string;
  emoji: string;
  points: (string | [term: string, explanation: string])[];
}

export const RULES: Record<GameKind, { name: string; tagline: string; sections: Section[] }> = {
  blackjack: {
    name: 'Blackjack',
    tagline: 'Get close to 21. Don’t go over!',
    sections: [
      {
        title: 'The goal',
        emoji: '🎯',
        points: [
          'You play against the dealer, not the other players.',
          'Add up your cards. Try to get closer to 21 than the dealer.',
          'If you go over 21, you lose. That’s called a “bust”.',
        ],
      },
      {
        title: 'What cards are worth',
        emoji: '🃏',
        points: [
          ['2 to 10', 'worth the number on the card.'],
          ['J, Q, K', 'worth 10 each.'],
          ['Ace (A)', 'worth 1 or 11, whichever helps you more.'],
          'Ace + a 10-card (10, J, Q or K) as your first two cards is a “Blackjack”: the best hand!',
        ],
      },
      {
        title: 'How a round goes',
        emoji: '👣',
        points: [
          'Tap chips to bet, then tap Deal.',
          'You get 2 cards, face up. The dealer gets 2 cards: one up, one hidden.',
          'On your turn, choose a move (see below). You have 20 seconds.',
          'When everyone is done, the dealer shows the hidden card and plays.',
          'The dealer must take cards until 17 or more, and stops at 17.',
          'Closest to 21 without going over wins!',
        ],
      },
      {
        title: 'Your moves',
        emoji: '✋',
        points: [
          ['Hit', 'take one more card. (Real players tap the table.)'],
          ['Stand', 'keep what you have. (Real players wave a hand.)'],
          ['Double', 'double your bet, take exactly one more card, then stop.'],
          ['Split', 'two cards the same? Split them into two hands, each with its own bet.'],
          ['Insurance', 'only when the dealer shows an Ace: a small side bet that the dealer has Blackjack.'],
        ],
      },
      {
        title: 'Who wins what',
        emoji: '🏆',
        points: [
          ['You win', 'you get your bet back, plus the same again.'],
          ['Blackjack', 'you get your bet back, plus one and a half times more (3 to 2).'],
          ['Push (a tie)', 'you get your bet back.'],
          ['Bust or lower than the dealer', 'the dealer keeps your bet.'],
          'If the dealer busts, everyone still in the game wins!',
        ],
      },
      {
        title: 'Words you’ll see',
        emoji: '📖',
        points: [
          ['Soft hand', 'a hand with an Ace counted as 11, like A + 6 = “soft 17”. One more card can’t bust you: the Ace just becomes 1.'],
          ['Hard hand', 'no Ace counted as 11, like 10 + 7 = “hard 17”.'],
          ['Bust', 'over 21. You lose that hand.'],
          ['Shoe', 'the box the cards come from. It holds 6 decks.'],
        ],
      },
    ],
  },
  poker: {
    name: 'Texas Hold’em Poker',
    tagline: 'Make the best hand with 5 cards, or make everyone else give up!',
    sections: [
      {
        title: 'The goal',
        emoji: '🎯',
        points: [
          'You play against the other players. The dealer just deals.',
          'Win the chips in the middle (the “pot”).',
          'Two ways to win: have the best hand at the end, or be the last one left when everyone else gives up.',
        ],
      },
      {
        title: 'Your cards',
        emoji: '🃏',
        points: [
          'You get 2 secret cards. Only you can see them.',
          'The dealer puts 5 shared cards in the middle, little by little. Everyone can use them.',
          'Your hand is the best 5 cards out of your 2 + the 5 in the middle.',
        ],
      },
      {
        title: 'How a hand goes',
        emoji: '👣',
        points: [
          'Two players put in a small forced bet to start (the “blinds”): 5 and 10 chips.',
          'Everyone gets 2 secret cards. Then a round of betting.',
          ['The Flop', '3 cards go in the middle. Betting.'],
          ['The Turn', '1 more card. Betting.'],
          ['The River', 'the last card. Betting.'],
          'Then everyone left shows their cards. Best hand wins the pot!',
          'The dealer button (D) moves one seat to the left every hand.',
        ],
      },
      {
        title: 'Your moves',
        emoji: '✋',
        points: [
          ['Check', 'pass, without putting in chips (only if nobody has bet).'],
          ['Call', 'put in the same chips as the last bet to stay in.'],
          ['Bet / Raise', 'put in more chips. Others must match it, or give up.'],
          ['Fold', 'give up this hand. You lose what you already put in.'],
          ['All in', 'put in all your chips!'],
          'You have 25 seconds to decide.',
        ],
      },
      {
        title: 'Best hands, from best to worst',
        emoji: '🏆',
        points: [
          ['Royal flush', 'A K Q J 10, all the same suit. The best!'],
          ['Straight flush', '5 in a row, all the same suit. Like 5 6 7 8 9 of ♥.'],
          ['Four of a kind', '4 cards the same. Like 7 7 7 7.'],
          ['Full house', '3 the same + 2 the same. Like K K K 4 4.'],
          ['Flush', '5 cards of the same suit, any order.'],
          ['Straight', '5 in a row, any suits. Like 4 5 6 7 8.'],
          ['Three of a kind', '3 cards the same. Like Q Q Q.'],
          ['Two pair', 'two pairs. Like J J and 5 5.'],
          ['Pair', 'two cards the same. Like A A.'],
          ['High card', 'nothing matches: your highest card counts.'],
        ],
      },
      {
        title: 'Good to know',
        emoji: '💡',
        points: [
          'If two hands are the same kind, the higher cards win.',
          'A perfect tie splits the pot.',
          'Bluffing is allowed: you can bet big with a weak hand to make others fold!',
          'Your chips come with you from table to table. Down to 100 chips or less? Tap ↻ next to your chips for a free refill to 1,000.',
        ],
      },
    ],
  },
  roulette: {
    name: 'Roulette',
    tagline: 'Guess where the little ball will stop!',
    sections: [
      {
        title: 'The goal',
        emoji: '🎯',
        points: [
          'A big wheel spins with a little white ball in it.',
          'The wheel has numbers from 0 to 36 in little pockets.',
          'Guess where the ball will stop. Guess right and you win chips!',
        ],
      },
      {
        title: 'The colors',
        emoji: '🎨',
        points: [
          ['Red', 'half of the numbers are red.'],
          ['Black', 'the other half are black.'],
          ['Green', 'only one pocket is green: the 0.'],
        ],
      },
      {
        title: 'How a round goes',
        emoji: '👣',
        points: [
          'Pick a chip at the bottom of the screen.',
          'Tap the table to put it down: on a number, or on a box like “Red”.',
          'You can put chips in many places at once.',
          'Press “Spin”. The dealer spins the wheel and rolls the ball.',
          'Wait… wait… the ball slows down and drops into a pocket!',
          'If your bet covers that number, you win. Other chips are taken away.',
        ],
      },
      {
        title: 'What you can win',
        emoji: '💰',
        points: [
          ['One number', 'the hardest guess. Win 35 times your chips!'],
          ['Red or Black', 'win the same as your chips (double your money).'],
          ['Odd or Even', 'win the same as your chips.'],
          ['1–18 or 19–36', 'small numbers or big numbers: win the same as your chips.'],
          ['A dozen (12 numbers)', 'like “1st 12”: win 2 times your chips.'],
          ['A column', 'one long row of the table (the “2 to 1” boxes): win 2 times your chips.'],
          'You also get back the chips you bet when you win.',
        ],
      },
      {
        title: 'Good to know',
        emoji: '💡',
        points: [
          'The green 0 is not red or black, not odd or even. Only a bet on 0 itself wins.',
          'Every spin is new: the wheel doesn’t remember what came before.',
          '“Rebet” puts down the same chips as last time.',
          'Your chips come with you from table to table. Down to 100 chips or less? Tap ↻ next to your chips for a free refill to 1,000.',
        ],
      },
    ],
  },
};

/** The rules as a list of cards (for the rules page and the help panel). */
export function rulesContent(game: GameKind): HTMLElement {
  const r = RULES[game];
  return h(
    'div',
    { class: 'rules' },
    ...r.sections.map((s) =>
      h(
        'section',
        { class: 'rules-section' },
        h('h3', {}, h('span', { class: 'rules-emoji', 'aria-hidden': 'true' }, s.emoji), s.title),
        h(
          'ul',
          {},
          ...s.points.map((p) => (Array.isArray(p) ? h('li', {}, h('b', {}, p[0]), ': ', p[1]) : h('li', {}, p))),
        ),
      ),
    ),
  );
}
