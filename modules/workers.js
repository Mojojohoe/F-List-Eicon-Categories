/**
 * workers.js — Decompress worker module
 *
 * Handles one-shot decompression of the gzipped eicon name index.
 * Spins up a temporary Web Worker, runs the job off the main thread,
 * then terminates and cleans up the worker automatically.
 *
 * The worker also pre-computes sibling groups (eicons sharing a name
 * base, e.g. sammilk1–4) so the browse grid can keep related eicons
 * adjacent without re-running regex on the main thread later.
 *
 * This module is complete. It does not need editing when search or
 * tagging systems are modified — those systems receive the output of
 * decompress() and do their own work with it.
 *
 * API:
 *   decompress(arrayBuffer) → Promise<{ names: string[], groups: string[][] }>
 *     Takes a raw gzip ArrayBuffer (e.g. from fetch().arrayBuffer()).
 *     Returns:
 *       names  — flat array of all eicon names, in order from the index
 *       groups — array of arrays, each inner array being a sibling group
 *                e.g. [['sammilk1','sammilk2','sammilk3','sammilk4'], ['catgirl'], ...]
 *
 * Usage:
 *   import { decompress } from './modules/workers.js';
 *   const { names, groups } = await decompress(await res.arrayBuffer());
 */

// Worker source — runs entirely off the main thread.
// Receives: a gzip ArrayBuffer (transferred, zero-copy).
// Returns:  { ok: true, names, groups } or { ok: false, error }.
const WORKER_SRC = `
self.onmessage = async (e) => {
  try {
    const ds     = new DecompressionStream('gzip');
    const stream = new Blob([e.data]).stream().pipeThrough(ds);
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Assemble chunks into a single buffer
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf   = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }

    // Decode and split into name array
    const names = new TextDecoder().decode(buf).split('\\n').filter(n => n.length > 0);

    // Pre-compute sibling groups (strip trailing digits to find related eicons).
    // Stored in IDB alongside names so newRandomSet() never runs regex again.
    const groupMap = new Map();
    for (const name of names) {
      const base = name.replace(/\\d+$/, '') || name;
      if (!groupMap.has(base)) groupMap.set(base, []);
      groupMap.get(base).push(name);
    }

    self.postMessage({ ok: true, names, groups: [...groupMap.values()] });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
`;

/**
 * Decompresses a gzipped eicon index buffer in a temporary Web Worker.
 * The ArrayBuffer is transferred (zero-copy) to the worker and must not
 * be used by the caller after this call.
 *
 * @param {ArrayBuffer} buffer — raw gzip bytes from fetch().arrayBuffer()
 * @returns {Promise<{ names: string[], groups: string[][] }>}
 */
export function decompress(buffer) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    const w    = new Worker(url);

    w.onmessage = (e) => {
      w.terminate();
      URL.revokeObjectURL(url);
      e.data.ok
        ? resolve({ names: e.data.names, groups: e.data.groups })
        : reject(new Error(e.data.error));
    };

    w.onerror = (err) => {
      w.terminate();
      URL.revokeObjectURL(url);
      reject(err);
    };

    // Transfer ownership of the buffer — avoids copying 2MB across threads
    w.postMessage(buffer, [buffer]);
  });
}
