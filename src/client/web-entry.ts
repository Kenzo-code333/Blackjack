// Entry point of the website build and of the downloadable file: install the in-page server
// and the public relay, then start the app. The downloaded file first checks whether a newer
// version of itself was fetched earlier (see updater.ts) and starts that one instead.
import { bootLatest, watchForUpdates } from './updater.js';

void bootLatest().then(async (replaced) => {
  if (replaced) return;
  await import('./web/install.js');
  await import('./main.js');
  watchForUpdates();
});
