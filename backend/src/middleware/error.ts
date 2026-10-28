import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/** 404 for unknown API routes, in the standard envelope. */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found`, error: 'ROUTE_NOT_FOUND' });
}

// Postgres error codes that map to client errors
const PG_MAP: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'DUPLICATE', message: 'A record with the same unique value already exists' },
  '23503': { status: 409, code: 'REFERENCE_CONFLICT', message: 'The record is referenced by, or references, a missing record' },
  '23514': { status: 400, code: 'CONSTRAINT_VIOLATION', message: 'A value is outside the allowed range' },
  '22P02': { status: 400, code: 'INVALID_INPUT', message: 'A value has an invalid format' },
  '22007': { status: 400, code: 'INVALID_DATE', message: 'A date value is invalid' },
  '22008': { status: 400, code: 'INVALID_DATE', message: 'A date value is out of range' },
};

/**
 * Centralised error handler. Every failure leaves the API as
 * { success: false, message, error, details? } and internal details
 * (stack traces, SQL) are never sent to the client.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, err.message);
    return res.status(err.status).json({
      success: false,
      message: err.message,
      error: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON body', error: 'INVALID_JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large', error: 'PAYLOAD_TOO_LARGE' });
  }
  if (err?.name === 'MulterError') {
    return res.status(400).json({ success: false, message: err.message, error: `UPLOAD_${err.code}` });
  }
  // Other client errors raised by body-parser / http-errors (unsupported charset or encoding, aborted request …)
  if (err?.expose && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ success: false, message: err.message, error: 'BAD_REQUEST' });
  }
  const pg = err?.code && Object.hasOwn(PG_MAP, err.code) ? PG_MAP[err.code] : undefined;
  if (pg) {
    logger.warn({ code: err.code, detail: err.detail, path: req.path }, 'database constraint');
    return res.status(pg.status).json({ success: false, message: pg.message, error: pg.code });
  }
  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again.',
    error: 'INTERNAL_ERROR',
    ...(env.isProd ? {} : { debug: String(err?.message ?? err) }),
  });
}
