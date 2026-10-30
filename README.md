# Blackjack

A multiplayer blackjack table in your browser, seen in first person from your seat.
A robot dealer deals from a 6-deck shoe. Play solo, or create a table and send the
link to friends: they type a name and sit down. No accounts, no installs, play money only.

- **3D first-person table**: felt, padded rail, warm lamp, animated dealer, cards and chips
- **Up to 5 players per table**, plus spectators when it's full
- **Server-authoritative rules**: the server deals, checks every move and pays out.
  Browsers never see the hole card or the shoe order early.
- **Works on phones**, with a low-graphics mode and a 2D fallback for devices without 3D

## Table rules

- 6-deck shoe, cut card at ~75%. The shoe is reshuffled after the round in which the cut card comes out.
- Dealer stands on soft 17 and peeks for blackjack with an ace or ten showing.
- Blackjack pays 3 to 2. Insurance (offered on a dealer ace) pays 2 to 1.
- Double on any two cards, including after a split. Split any pair up to 3 hands
  (split aces get one card each). 21 after a split is not a blackjack.
- Bets 5 to 500. Everyone starts with 1,000 chips and can reset any time between rounds.
- 15 s betting countdown, 20 s per decision (then you stand automatically).

To change a rule, edit `DEFAULT_RULES` in `src/game/rules.ts` or `DEFAULT_TIMING` in `src/server/table.ts`.

---

## Run it on your computer

You need [Node.js](https://nodejs.org/) **20 or newer** (pick the "LTS" download). Check with `node -v`.

```bash
git clone https://github.com/kenzo-code333/blackjack.git
cd blackjack
npm install
npm run dev
```

Then open **http://localhost:5173**. Stop with `Ctrl+C`.

`npm run dev` starts two things: the game server (port 3000) and Vite, which serves the
page and reloads it when you change code (port 5173). You only ever open 5173.

### Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Runs all unit and integration tests (~70) |
| `npm run typecheck` | Checks the TypeScript types |
| `npm run play` | Plays blackjack in the terminal using the real rules module |
| `npm run build` | Builds the browser code into `dist/client` |
| `npm start` | Runs the production server (serves `dist/client` too) on port 3000 |
| `npm run build:preview` | Builds an offline, solo-only version into `dist/preview` (the game engine runs in the page; used for the claude.ai preview) |

### Testing multiplayer locally

1. Open http://localhost:5173, type a name, click **Create table**.
2. Click **Copy invite link** and open it in a second tab (or another browser).
   Type a different name. You are now two players at the same table.
3. In the first tab (the host 👑), press **Start round**. Both tabs place chips and press **Deal**.
4. **On your phone:** connect it to the same Wi-Fi. `npm run dev` prints a
   `Network: http://192.168.x.x:5173` address: open that on the phone, then
   join with the table code. (If it doesn't load, your computer's firewall may be
   blocking port 5173.)

Things worth trying: split a pair, double, take insurance on a dealer ace, let your
timer run out, reload a tab mid-round (you keep your seat), close a tab and reopen the
link within 60 s, kick a player from the 👥 menu, chat with 💬, fill all 5 seats and
join a 6th time (you watch as a spectator), toggle sound 🔊 and graphics ●/◐.

---

## Put it online (Render, free)

[Render](https://render.com) runs Node apps with WebSockets on a free plan. This repo
includes `render.yaml`, so Render knows how to build and run it.

**1. Get the code on your main branch.** On GitHub, open a pull request from the branch
this was built on into `main` and merge it. (Or skip this and choose the branch in step 4.)

**2. Create a Render account** at https://dashboard.render.com/register, using
"Sign up with GitHub". It's free, and no credit card is needed for the free plan.

**3. Give Render access to the repository.** When asked, allow the Render GitHub app to see
the `blackjack` repository (you can pick only that one).

**4. Create the service from the blueprint.**
In the Render dashboard: **New +** → **Blueprint** → select `kenzo-code333/blackjack`
→ branch `main` → **Apply**. Render reads `render.yaml` and creates a web service called
`blackjack`.

**5. Wait for the first deploy** (3–5 minutes). The log ends with
`Blackjack server listening on …` and the status turns **Live**.

**6. Open your URL**, e.g. `https://blackjack-xxxx.onrender.com`. Create a table and send the
invite link (`https://blackjack-xxxx.onrender.com/table/ABC123`) to a friend.

From now on, every push to `main` redeploys automatically.

**Good to know about the free plan:**
- After 15 minutes with no visitors the server goes to sleep; the next visit takes ~30–60 s to
  wake it. Upgrading the service to Render's cheapest paid instance keeps it always on.
- Tables live in the server's memory, so a redeploy or a sleep closes all open tables.
  Players just create a new one. (Chips are play money and aren't saved anywhere.)

**Custom domain (optional):** in the service → **Settings** → **Custom Domains** → add your
domain and create the DNS record Render shows you at your domain registrar.

### Alternative: Railway

1. Sign in at https://railway.com with GitHub.
2. **New Project** → **Deploy from GitHub repo** → pick `blackjack`.
3. Railway detects Node and runs `npm run build` then `npm start` by itself.
4. In the service → **Settings** → **Networking** → **Generate Domain**.

Railway has a free trial, then a small monthly fee.

### If something goes wrong

- **Build fails on Render:** open the deploy log; the error is usually near the end. Make sure
  `npm install && npm run build` works on your computer first.
- **Page loads but says "Connection lost":** check that the service is **Live** and that
  `https://your-url/health` returns `{"ok":true,…}`.
- **"Table not found":** the server restarted or slept since the table was created. Create a new one.

---

## How it works

```
Browser (Vite + TypeScript + Three.js)          Server (Node + Socket.IO)
┌──────────────────────────────┐   intentions  ┌───────────────────────────────┐
│ HUD: chips, Hit/Stand, chat  │ ───────────►  │ Rooms: codes, seats, rejoin,  │
│ 3D scene: plays events as    │   bet, hit…   │ kick, chat rate limits        │
│ animations, then snaps to    │               │ Table: the round state machine│
│ the exact server state       │ ◄───────────  │ Game: shoe, rules, payouts    │
└──────────────────────────────┘ state+events  └───────────────────────────────┘
```

Clients only send what they *want* to do. The server checks it, updates the game and
broadcasts a public state (with the hole card replaced by `null`) plus a list of events
("card dealt to Bob", "hole card revealed", …). The 3D view animates those events, then
reconciles with the state, so it can never show something the server didn't say.

```
src/
  game/          Pure blackjack logic: cards, hands, shoe, rules, payouts (+ tests)
  server/
    table.ts     Round state machine: betting → deal → insurance → turns → dealer → results
    rooms.ts     Room codes, rejoin grace period, empty-room cleanup, chat, rate limiter
    app.ts       HTTP + Socket.IO: validates every message, serves the built client
    index.ts     Starts the server (uses the PORT environment variable)
  shared/
    protocol.ts  Every message between browser and server, with types
  client/
    main.ts      Screens and routing (/ and /table/CODE)
    net.ts       Socket connection, saved session tokens, auto-rejoin
    hud.ts       Buttons, chips, timers, chat, players, help
    audio.ts     All sounds, synthesized with the Web Audio API (no files)
    table2d.ts   Simple 2D table, used when 3D isn't available
    three/       The 3D scene: layout, canvas textures, dealer robot, avatars, cards, chips
scripts/
  dev.mjs        Runs server + Vite together for `npm run dev`
  play-cli.ts    Terminal blackjack
```

**Rejoining:** when you join, the server gives your browser a secret session token, saved in
`sessionStorage` (per tab) and `localStorage`. If you reload or lose connection, the page sends
it back and you get the same seat and chips, for up to 60 seconds after disconnecting.

**Security notes:** all game logic runs on the server, inputs are validated and length-limited,
names and chat are cleaned, each connection is rate limited (and chat more strictly), and the
shoe uses the cryptographic random generator. There is no real money anywhere.

## License

MIT, see `LICENSE`. Card faces, chips, dealer and sounds are original and generated in code.
