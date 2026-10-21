import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { logger } from './utils/logger.js';
import { dispatchPending } from './services/notification.service.js';
import { keepAwake } from './services/exam-correction.service.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`Holy Sai API listening on http://localhost:${env.PORT}  (docs: /api/docs)`);
});

// Paper Correction: wake the marking service now and keep it awake while the API runs.
const stopKeepAwake = keepAwake();

// Notification outbox dispatcher. Only sends when channel credentials are configured.
const dispatcher = setInterval(() => {
  dispatchPending().catch((err) => logger.error({ err }, 'notification dispatch failed'));
}, 60_000);

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
