/**
 * tags.js — Tag storage module
 *
 * Handles all reading and writing of user tags in IndexedDB.
 * Stateless — no DOM, no UI, no opinions about display.
 * All tag data is stored in a dedicated 'tags' object store,
 * separate from the eicon index store.
 *
 * Tags for each eicon are stored as a single comma-separated string,
 * matching the Tampermonkey script's export format so existing
 * dev_tags.txt data can be imported without conversion.
 *
 * API:
 *   openTagDB() → Promise<IDBDatabase>
 *     Opens (or creates) the tags database. Call once at boot.
 *
 *   getTags(db, eiconName) → Promise<string[]>
 *     Returns the tag array for one eicon. Empty array if untagged.
 *
 *   setTags(db, eiconName, tags) → Promise<void>
 *     Writes a tag array for one eicon. Pass [] to clear tags.
 *
 *   getAllTags(db) → Promise<Map<string, string[]>>
 *     Returns every tagged eicon as a Map<name, tags[]>.
 *     Used by search, tag browser, and export.
 *
 *   deleteTags(db, eiconName) → Promise<void>
 *     Removes an eicon's tag record entirely.
 *
 *   exportTags(db) → Promise<string>
 *     Returns a JSON string in the standard export format:
 *     { version: 1, tags: { [name]: "tag1, tag2" } }
 *     Compatible with the Tampermonkey script's import format.
 *
 *   importTags(db, jsonString) → Promise<{ added: number, skipped: number }>
 *     Merges a JSON export string into the database.
 *     Existing tags are never overwritten — only new eicons are added.
 *
 * Usage:
 *   import { openTagDB, getTags, setTags, getAllTags } from './modules/tags.js';
 *   const db = await openTagDB();
 *   const tags = await getTags(db, 'catgirl');
 *   await setTags(db, 'catgirl', [...tags, 'cat', 'girl']);
 */

const DB_NAME    = 'eicon-tags';
const DB_VERSION = 1;
const STORE      = 'tags';

/**
 * Opens the tag database, creating the store if needed.
 * @returns {Promise<IDBDatabase>}
 */
export function openTagDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db    = e.target.result;
      const store = db.createObjectStore(STORE, { keyPath: 'name' });
      store.createIndex('by_name', 'name', { unique: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Returns the tag array for a single eicon.
 * @param {IDBDatabase} db
 * @param {string} eiconName
 * @returns {Promise<string[]>}
 */
export function getTags(db, eiconName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(eiconName);
    req.onsuccess = e => {
      const rec = e.target.result;
      resolve(rec ? rec.tags.split(',').map(t => t.trim()).filter(Boolean) : []);
    };
    req.onerror = e => reject(e.target.error);
  });
}

/**
 * Writes a tag array for a single eicon.
 * Passing an empty array clears the record rather than storing an empty entry.
 * @param {IDBDatabase} db
 * @param {string} eiconName
 * @param {string[]} tags
 * @returns {Promise<void>}
 */
export function setTags(db, eiconName, tags) {
  const clean = tags.map(t => t.trim().toLowerCase()).filter(Boolean);
  if (clean.length === 0) return deleteTags(db, eiconName);
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE)
      .put({ name: eiconName, tags: clean.join(', ') });
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Removes an eicon's tag record entirely.
 * @param {IDBDatabase} db
 * @param {string} eiconName
 * @returns {Promise<void>}
 */
export function deleteTags(db, eiconName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(eiconName);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Returns all tagged eicons as a Map<name, tags[]>.
 * @param {IDBDatabase} db
 * @returns {Promise<Map<string, string[]>>}
 */
export function getAllTags(db) {
  return new Promise((resolve, reject) => {
    const result = new Map();
    const req    = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) {
        result.set(cursor.value.name,
          cursor.value.tags.split(',').map(t => t.trim()).filter(Boolean));
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    req.onerror = e => reject(e.target.error);
  });
}

/**
 * Exports all tags as a JSON string compatible with the Tampermonkey import format.
 * @param {IDBDatabase} db
 * @returns {Promise<string>}
 */
export async function exportTags(db) {
  const all  = await getAllTags(db);
  const tags = {};
  for (const [name, tagArr] of all) tags[name] = tagArr.join(', ');
  return JSON.stringify({ version: 1, tags }, null, 2);
}

/**
 * Merges a JSON export string into the database.
 * Never overwrites existing tags — only adds untagged eicons.
 * @param {IDBDatabase} db
 * @param {string} jsonString
 * @returns {Promise<{ added: number, skipped: number }>}
 */
export async function importTags(db, jsonString) {
  let parsed;
  try { parsed = JSON.parse(jsonString); } catch { throw new Error('Invalid JSON'); }

  // Accept both { version, tags: {...} } and flat { name: "tags" } formats
  const source = parsed.version ? parsed.tags : parsed;
  if (!source || typeof source !== 'object') throw new Error('Unrecognised tag format');

  const existing = await getAllTags(db);
  let added = 0, skipped = 0;

  for (const [name, tagVal] of Object.entries(source)) {
    if (existing.has(name)) { skipped++; continue; }
    const tagArr = typeof tagVal === 'string'
      ? tagVal.split(',').map(t => t.trim()).filter(Boolean)
      : Array.isArray(tagVal) ? tagVal : [];
    if (tagArr.length === 0) { skipped++; continue; }
    await setTags(db, name, tagArr);
    added++;
  }

  return { added, skipped };
}
