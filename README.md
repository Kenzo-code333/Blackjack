# Blackjack

A browser-based, multiplayer, first-person 3D blackjack table. Play-money only.

> 🚧 Work in progress, built in stages. Current stage: **1 – game logic**.

| Stage | What | Status |
| --- | --- | --- |
| 1 | Game logic module (deck, hands, rules, payouts) + unit tests | ✅ |
| 2 | Server: rooms, round state machine, Socket.IO events | ⏳ |
| 3 | Basic 2D UI wired to the server | ⏳ |
| 4 | 3D first-person scene, animations, sound | ⏳ |
| 5 | Polish: mobile controls, low-graphics mode, reconnection, chat | ⏳ |
| 6 | Deployment + full README | ⏳ |

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer (the "LTS" download). Check with `node -v`.

## Running locally

```bash
npm install      # once, downloads dependencies into node_modules/
npm test         # runs the unit tests
npm run play     # plays blackjack in your terminal, using the real rules module
```

## Table rules

- 6-deck shoe, cut card at ~75% (±4%). Reshuffle after the round in which the cut card comes out.
- Dealer stands on soft 17. Dealer peeks for blackjack with an ace or ten showing.
- Blackjack pays 3 to 2. Insurance (offered on a dealer ace) pays 2 to 1.
- Double on any first two cards, including after a split.
- Split any pair (including mixed ten-value cards like K+Q) up to 3 hands.
  Split aces get one card each; no re-splitting aces. 21 after a split is not a blackjack.
- Bets 5 to 500. Everyone starts with 1,000 play chips.

All of these live in one place: `DEFAULT_RULES` in `src/game/rules.ts`.

## Project layout

```
src/game/        pure game logic, no networking (shared by server and tests)
  cards.ts       cards, ranks, suits, deck
  hand.ts        totals, soft/hard, blackjack, "soft 17" labels
  random.ts      crypto RNG for real games, seeded RNG for tests
  shoe.ts        multi-deck shoe with cut card
  rules.ts       allowed actions, dealer play, payouts
  game.test.ts   unit tests
scripts/
  play-cli.ts    terminal version for trying the rules
```
