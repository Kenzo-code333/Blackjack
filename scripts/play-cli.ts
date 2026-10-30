// A tiny terminal blackjack game for trying out the rules module.
// Run with:  npm run play

import { createInterface } from 'node:readline/promises';
import {
  type Card,
  type PlayerHand,
  DEFAULT_RULES as rules,
  Shoe,
  cardLabel,
  describeHand,
  evaluateHand,
  double,
  hit,
  insuranceCost,
  insuranceOffered,
  isBlackjack,
  isHandDone,
  legalActions,
  newHand,
  playDealer,
  settleHand,
  settleInsurance,
  split,
  stand,
  validateBet,
} from '../src/game/index.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const shoe = new Shoe({ decks: rules.decks, penetration: rules.penetration });
let balance = rules.startingBalance;

const KEYS = { hit: 'h', stand: 's', double: 'd', split: 'p' } as const;
const show = (cards: Card[]) => cards.map(cardLabel).join(' ');

async function playRound(): Promise<boolean> {
  if (shoe.cutCardReached) {
    console.log('\n🔀 Cut card reached, shuffling the shoe…');
    shoe.shuffle();
  }
  console.log(`\nBalance: ${balance}`);
  const answer = (await rl.question(`Bet (${rules.minBet}-${rules.maxBet}, q to quit, r to reset): `)).trim();
  if (answer === 'q') return false;
  if (answer === 'r') {
    balance = rules.startingBalance;
    return true;
  }
  const bet = Number(answer || rules.minBet);
  const error = validateBet(bet, balance);
  if (error) {
    console.log(error);
    return true;
  }
  balance -= bet;

  const hands: PlayerHand[] = [newHand(bet, [shoe.draw()])];
  const dealer = [shoe.draw()];
  hands[0]!.cards.push(shoe.draw());
  dealer.push(shoe.draw());

  console.log(`Dealer: ${cardLabel(dealer[0]!)} [hidden]`);
  console.log(`You:    ${show(hands[0]!.cards)}  (${describeHand(hands[0]!.cards)})`);

  let insurance = 0;
  if (insuranceOffered(dealer[0]!) && balance >= insuranceCost(hands[0]!)) {
    const ins = await rl.question(`Insurance for ${insuranceCost(hands[0]!)}? (y/N): `);
    if (ins.trim().toLowerCase() === 'y') {
      insurance = insuranceCost(hands[0]!);
      balance -= insurance;
    }
  }

  const dealerBJ = isBlackjack(dealer);
  if (!dealerBJ) {
    if (insurance) console.log('Dealer does not have blackjack. Insurance lost.');
    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i]!;
      if (hand.cards.length === 1) hit(hand, shoe.draw()); // second card for a split hand
      while (!isHandDone(hand)) {
        const actions = legalActions({ hand, handCount: hands.length, balance });
        const label = hands.length > 1 ? `Hand ${i + 1}: ` : '';
        const prompt = actions.map((a) => `[${KEYS[a]}] ${a}`).join('  ');
        const choice = (await rl.question(`${label}${show(hand.cards)} (${describeHand(hand.cards, hand.fromSplit)})  ${prompt}: `))
          .trim()
          .toLowerCase();
        const action = actions.find((a) => KEYS[a] === choice[0]);
        if (action === 'hit') hit(hand, shoe.draw());
        else if (action === 'stand') stand(hand);
        else if (action === 'double') {
          balance -= hand.bet;
          double(hand, shoe.draw());
        } else if (action === 'split') {
          balance -= hand.bet;
          const [a, b] = split(hand);
          hands.splice(i, 1, a, b);
          hit(a, shoe.draw());
          i--; // replay this slot with the new first hand
          break;
        }
      }
      if (i >= 0 && hands[i] === hand) console.log(`  → ${show(hand.cards)} (${describeHand(hand.cards, hand.fromSplit)})`);
    }
    if (hands.some((h) => !evaluateHand(h.cards).bust)) playDealer(dealer, () => shoe.draw(), rules);
  }

  console.log(`Dealer: ${show(dealer)}  (${describeHand(dealer)})`);
  balance += settleInsurance(insurance, dealer);
  if (insurance && dealerBJ) console.log(`Insurance pays ${insurance * 3}.`);
  for (const [i, hand] of hands.entries()) {
    const result = settleHand(hand, dealer, rules);
    balance += result.payout;
    const sign = result.net > 0 ? '+' : '';
    console.log(`${hands.length > 1 ? `Hand ${i + 1}: ` : ''}${result.outcome.toUpperCase()} ${sign}${result.net}`);
  }
  return true;
}

console.log('♠ ♥ Blackjack (terminal test)  ♦ ♣\n6 decks · Dealer stands on soft 17 · Blackjack pays 3 to 2');
while (await playRound()) {
  // keep playing
}
rl.close();
