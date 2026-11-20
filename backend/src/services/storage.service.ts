/**
 * Blob storage for uploaded documents.
 *
 * Two drivers share one key space, so a deployment can move between them
 * without rewriting the storage_key values already in the documents table:
 *
 *   local     — files under UPLOAD_DIR. Development, or a host with a
 *               persistent disk mounted.
 *   supabase  — a *private* Supabase Storage bucket, reached with the service
 *               role key. Required on hosts with an ephemeral filesystem
 *               (Render, Fly, Heroku), where local files are lost on every
 *               deploy and restart.
 *   vercel-blob — a *private* Vercel Blob store, for deployments on Vercel.
 *
 * Keys look like "2026-09/<uuid>.pdf" and are generated server-side — they
 * never contain user input. The guards here are defence in depth.
 */

import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as blob from '@vercel/blob';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);
if (env.STORAGE_DRIVER === 'local') mkdirSync(UPLOAD_ROOT, { recursive: true });

/** Keys are "<segment>/<segment>" with no traversal, no absolute paths. */
function assertSafeKey(key: string) {
  if (!/^[\w.-]+(\/[\w.-]+)*$/.test(key) || key.split('/').some((s) => s === '.' || s === '..')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

// ---------------------------------------------------------------------------
// local driver
// ---------------------------------------------------------------------------

function localPath(key: string) {
  const full = path.resolve(UPLOAD_ROOT, key);
  // Second guard: resolve() must not have escaped the root.
  if (full !== UPLOAD_ROOT && !full.startsWith(UPLOAD_ROOT + path.sep)) throw new Error(`Unsafe storage key: ${key}`);
  return full;
}

const local = {
  async put(key: string, body: Buffer) {
    const full = localPath(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  },
  async get(key: string): Promise<Readable | null> {
    const full = localPath(key);
    return existsSync(full) ? createReadStream(full) : null;
  },
  async remove(key: string) {
    await unlink(localPath(key)).catch(() => undefined);
  },
};

// ---------------------------------------------------------------------------
// supabase driver — Storage REST API
//
// Called with fetch rather than @supabase/supabase-js: three operations do not
// justify the dependency, and this keeps the backend free of client SDKs.
// ---------------------------------------------------------------------------

function objectUrl(key: string) {
  return `${env.SUPABASE_URL!.replace(/\/$/, '')}/storage/v1/object/${env.SUPABASE_STORAGE_BUCKET}/${key}`;
}

const authHeaders = () => ({
  authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
  apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
});

const supabase = {
  async put(key: string, body: Buffer, contentType: string) {
    const res = await fetch(objectUrl(key), {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': contentType, 'cache-control': 'max-age=3600', 'x-upsert': 'true' },
      body: new Uint8Array(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error({ status: res.status, detail }, 'Supabase Storage upload failed');
      throw new Error(`Storage upload failed (${res.status})`);
    }
  },
  async get(key: string): Promise<Readable | null> {
    const res = await fetch(objectUrl(key), { headers: authHeaders() });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok || !res.body) {
      logger.error({ status: res.status }, 'Supabase Storage download failed');
      return null;
    }
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  },
  async remove(key: string) {
    const res = await fetch(objectUrl(key), { method: 'DELETE', headers: authHeaders() });
    if (!res.ok && res.status !== 404) logger.warn({ status: res.status, key }, 'Supabase Storage delete failed');
  },
};

// ---------------------------------------------------------------------------
// vercel-blob driver — a *private* Vercel Blob store. The SDK reads
// BLOB_READ_WRITE_TOKEN from the environment; downloads stream through the API
// after its permission checks, exactly like the supabase driver.
// ---------------------------------------------------------------------------

const vercelBlob = {
  async put(key: string, body: Buffer, contentType: string) {
    try {
      await blob.put(key, body, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: true });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Vercel Blob upload failed');
      throw new Error('Storage upload failed');
    }
  },
  async get(key: string): Promise<Readable | null> {
    try {
      const res = await blob.get(key, { access: 'private' });
      if (!res || res.statusCode !== 200) return null;
      return Readable.fromWeb(res.stream as Parameters<typeof Readable.fromWeb>[0]);
    } catch (err) {
      if (err instanceof blob.BlobNotFoundError) return null;
      logger.error({ err: (err as Error).message }, 'Vercel Blob download failed');
      return null;
    }
  },
  async remove(key: string) {
    await blob.del(key).catch((err: Error) => logger.warn({ err: err.message, key }, 'Vercel Blob delete failed'));
  },
};

// ---------------------------------------------------------------------------

const driver = env.STORAGE_DRIVER === 'supabase' ? supabase : env.STORAGE_DRIVER === 'vercel-blob' ? vercelBlob : local;

export async function putObject(key: string, body: Buffer, contentType: string) {
  assertSafeKey(key);
  return driver.put(key, body, contentType);
}

/** Resolves to a readable stream, or null when the object no longer exists. */
export async function getObject(key: string): Promise<Readable | null> {
  try {
    assertSafeKey(key);
  } catch {
    return null;
  }
  return driver.get(key);
}

export async function deleteObject(key: string) {
  assertSafeKey(key);
  return driver.remove(key);
}
