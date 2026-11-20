import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { logger } from './utils/logger.js';
import { dispatchPending, readyChannels } from './services/notification.service.js';
import { keepAwake } from './services/exam-correction.service.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`Holy Sai API listening on http://localhost:${env.PORT}  (docs: /api/docs)`);
});

// Background timers keep the process busy around the clock. On hosts billed by CPU time
// (Vercel) that uses up the plan even when nobody opens the app, so each one only starts
// where it does something.

// Paper Correction: on free hosting that sleeps idle services (Render), wake the marking
// service now and keep it awake while the API runs. Elsewhere it is synced on first use
// (see status / ensureSynced). EXAM_KEEP_AWAKE overrides the host check.
const stopKeepAwake = env.examKeepAwake ? keepAwake() : () => undefined;

// Notification outbox dispatcher: only runs when a channel can actually send.
const channels = readyChannels();
const dispatcher = channels.length
  ? setInterval(() => {
      dispatchPending().catch((err) => logger.error({ err }, 'notification dispatch failed'));
    }, 60_000)
  : undefined;
logger.info({ keepAwake: env.examKeepAwake, dispatcher: channels }, 'background timers');

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  clearInterval(dispatcher);
  stopKeepAwake();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
