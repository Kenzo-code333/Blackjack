# The Velvet Ace: a casino, a lounge and an arcade

A multiplayer casino in your browser, seen in first person from your seat. Make your avatar,
pick a table nickname, then choose **Blackjack** (you against the dealer) or **Texas Hold'em
poker** (you against the other players). Play alone, with bots, or with friends who just
open a link. No accounts, no installs, play money only.

- **Sign in or sign up with your email** (or play as a guest): your nickname, character,
  chips, vault and stats are saved to your account, and you can sign in from any device.
  On the game server (Render) accounts live on the server. The downloaded file and the
  website save accounts online through the public relays, encrypted with a key made from
  your email and password (AES-256-GCM, PBKDF2): only someone with both can find, read or
  overwrite the save. The claude.ai preview can't reach outside services, so there accounts
  stay in that browser
- **Three rooms to walk around** in 3D: the **Lounge** where you arrive (couches you can sit on,
  people chatting, a fireplace), the **Casino** (tables, slots, cashier) and the **Arcade**
  (blue neon, free games: Orbit Hop, PolyRush, and Game Night on a giant screen). Doorways
  and quick buttons take you between rooms; other players appear walking around
- **Chats like WhatsApp** (💬): everyone who plays (online status, which room), friend
  requests, private messages and group chats (end-to-end encrypted: ECDH P-256 keys per
  player, AES-256-GCM), and a global chat. Global messages also appear above people's heads.
  Works on the server version and in the file/website (through the public relays); chat
  history lives on the message board, so it follows you to other devices
- **Everything is saved to your account**, including the arcade games' own saves (best
  scores, PolyRush tracks and settings, Game Night history) and your friends and chats
- **Your avatar and nickname**, then a **3D casino floor** you walk around: go up to a
  table to play, press the red **Leave** button to walk away (a simple list view is there too)
- **Your chips go with you** from table to table (you start with 1,000). A free refill to
  1,000 is there only when you're down to 100 chips or less; **cash out** at the Cashier into your vault
- **Challenges between friends** (🏆): start one lasting as long as you like (quick picks, or any days / hours / minutes from 1 minute to 7 days), send the
  code or link, everyone gets the same fresh stack (1,000 or 5,000) and plays any game; a live
  leaderboard shows who's ahead and whoever has the most chips when time runs out wins. Normal
  chips are put aside and come back at the end; refills and the vault are closed meanwhile.
  On the server version challenges are kept on the server; the file and website use the
  public relays. (Chip counts are sent by each player's browser: it's for fun between friends.)
- **Slot machines** you can play: three reels, a lever, bets 5 to 100, about 96% paid back over time
- **Roulette**: single-zero wheel with a real ball spin, tap the layout to bet, bots and friends
- **Leaving is safe for hosts**: if the host leaves, the table keeps going and a friend becomes host
- **Blackjack**: 6-deck shoe, dealer stands on soft 17, blackjack pays 3 to 2, up to 5 players
- **Texas Hold'em**: no-limit, blinds 5/10, up to 6 players, side pots, showdowns, bots that bet and bluff
- **How to play** pages for both games in short, very simple bullet points (also in-game under "?")
- **3D first-person tables** with a human dealer, people around the table, chips and cards
- **Bots** for both games; **online tables** with a code, a ready-to-send link and a QR code
- **Server-authoritative**: the server (or the host's page) deals and checks every move.
  At poker, each player only ever receives their own two cards.
- **Music and sound**, celebrations for 21, blackjack and big pots, phone-friendly controls

## Blackjack rules

- 6-deck shoe, cut card at ~75%. The shoe is reshuffled after the round in which the cut card comes out.
- Dealer stands on soft 17 and peeks for blackjack with an ace or ten showing.
- Blackjack pays 3 to 2. Insurance (offered on a dealer ace) pays 2 to 1.
- Double on any two cards, including after a split. Split any pair up to 3 hands
  (split aces get one card each). 21 after a split is not a blackjack.
- Bets 5 to 500. Everyone starts with 1,000 chips and can reset any time between rounds.
- 15 s betting countdown, 20 s per decision (then you stand automatically).

## Roulette rules

- European single-zero wheel. Straight up pays 35 to 1; dozens and columns 2 to 1; red/black,
  odd/even, 1–18/19–36 pay 1 to 1. Zero loses all outside bets.
- Chips of 5 to 500 per spot, 2,000 per spin. 25 s to bet, or press Spin when ready.

The roulette engine is `src/game/roulette.ts` and `src/server/roulette-table.ts`.

To change a rule, edit `DEFAULT_RULES` in `src/game/rules.ts` or `DEFAULT_TIMING` in `src/server/table.ts`.

## Texas Hold'em rules

- No-limit Hold'em, blinds 5 and 10, everyone starts with 1,000 chips. Up to 6 seats.
- The dealer button moves one seat each hand; with two players, the button posts the small blind.
- Four betting rounds: before the flop, after the flop (3 cards), the turn (1) and the river (1).
- Fold, check, call, bet/raise (at least the last raise) or go all in. 25 seconds per move:
  you check if you can, otherwise fold.
- Best 5 of 7 cards wins; ties split the pot; all-ins for less make side pots.

The poker engine is `src/game/poker.ts` (hands and pots) and `src/server/poker-table.ts` (the table).

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
| `npm run build:file` | Builds the whole game as one HTML file you can download and double-click: `dist/blackjack.html` |
| `npm run build:web` | Builds the website version (no server; online tables via a public relay) into `dist/web` |
| `npm run build:preview` | Builds the single-page claude.ai preview into `dist/preview/blackjack-table.html`: the game engine runs in the page, and online tables use the artifact's live room |

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

## Download the game as one file

`npm run build:file` makes `dist/blackjack.html`: the whole game in a single file (about
800 KB). Double-click it to play in your browser: solo, with bots, or online with friends
(host a table, then friends open the website link, or their own copy of the file and type
the code). Once GitHub Pages is on, it's also at
**https://kenzo-code333.github.io/Blackjack/blackjack.html**.

## Play with friends who don't have any account

There are two ways to get a link that **anyone** can open (no Claude, GitHub or other
account, nothing to install). Both give you a table code and a ready-to-send invite
message with a link, plus a QR code.

### Option A: the website on GitHub Pages (free, no server to run)

The whole game runs in the browser. The host's tab runs the table, and friends' moves go
through a free public relay (MQTT over a secure WebSocket). Links look like
`https://kenzo-code333.github.io/Blackjack/?table=ABC123`.

1. Merge this code into `main` on GitHub.
2. On GitHub: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**
   (one time only).
3. Open the **Actions** tab: "Deploy website to GitHub Pages" runs (2–3 minutes). Re-run it
   from there if it ran before step 2.
4. Open **https://kenzo-code333.github.io/Blackjack/**, type your name, press
   **Host an online table**. The invite panel opens with the code and a message to send.

Good to know: the table lives in the host's browser tab, so the host keeps it open.
Messages pass through a public relay, which is fine for play-money games with friends.
Every push to `main` updates the website.

### Option B: your own server on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Kenzo-code333/Blackjack)

1. Make sure this code is on the `main` branch (merge the pull request on GitHub).
2. Click the button above, sign in to Render with GitHub (free), and press **Deploy Blueprint**.
3. After 3–5 minutes you get an address like `https://blackjack-xxxx.onrender.com`.
4. Open it, **Create table**: the invite panel opens with the code and the link.

Tables live on the server, so the host can close their tab. The detailed steps are below.

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

**The arcade games** are in `src/client/arcade/` (each a whole HTML page). They run in a frame
that shares the page's storage, so their saves (names starting `orbitHop`, `polyrush.`,
`gamenight.`) go into your profile. PolyRush's online races use PeerJS's free cloud server;
Game Night's online rooms need its own server (its offline and same-device modes work here).

**The message board** for chats is kept in `data/bus.json` (or `BUS_FILE`) on the server.

**Accounts on Render:** accounts are saved in `data/accounts.json` (or the path in the
`ACCOUNTS_FILE` environment variable). Passwords are stored only as salted scrypt hashes.
On Render's free plan the disk is wiped on every redeploy, so accounts would be lost: add a
Render **Disk** (paid) mounted at e.g. `/var/data` and set `ACCOUNTS_FILE=/var/data/accounts.json`.

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

## The claude.ai preview

`npm run build:preview` packs the whole game into one HTML page that runs without a server:
solo and bot tables run in your browser. **Online tables** use claude.ai's live room: the
host's page runs the dealer and rules, and friends' moves travel through the room. Friends
need the page shared with them as **Contributor** (Viewers can't send moves), and the table
closes if the host leaves or reloads.

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
