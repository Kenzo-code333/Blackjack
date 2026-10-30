// Entry point: `npm run dev:server` (development) or `npm start` (production).

import { createGameServer } from './app.js';

const port = Number(process.env.PORT) || 3000;
const server = createGameServer();

server.http.listen(port, () => {
  console.log(`Blackjack server listening on http://localhost:${port}`);
});

const shutdown = () => {
  console.log('Shutting down…');
  void server.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
