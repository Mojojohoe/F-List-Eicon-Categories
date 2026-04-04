/**
 * idb.js — IndexedDB utility module
 *
 * Thin Promise wrappers around IndexedDB operations.
 * Stateless — no opinions about what is stored or why.
 * Used by: index pipeline, tag storage, any future system needing persistence.
 *
 * All functions operate on a single object store whose name is passed
 * at openDB() time. The store is created automatically if it doesn't exist.
 *
 * API:
 *   openDB(dbName, version, storeName) → Promise<IDBDatabase>
 *     Opens (or creates) a database and ensures the named store exists.
 *
 *   idbGet(db, key) → Promise<value | undefined>
 *     Reads a single value by key. Returns undefined if key doesn't exist.
 *
 *   idbSet(db, key, value) → Promise<void>
 *     Writes a value under a key. Overwrites if key already exists.
 *
 *   idbDel(db, key) → Promise<void>
 *     Deletes a key. Silent no-op if key doesn't exist.
 *
 *   idbClear(db) → Promise<void>
 *     Deletes all records from the store.
 *
 * Usage:
 *   import { openDB, idbGet, idbSet, idbDel } from '/modules/idb.js';
 *   const db = await openDB('eicon-browser', 1, 'index');
 *   await idbSet(db, 'names', myArray);
 *   const names = await idbGet(db, 'names');
 */

/**
 * Opens a database, creating the object store if needed.
 * @param {string} dbName
 * @param {number} version
 * @param {string} storeName
 * @returns {Promise<IDBDatabase>}
 */
export function openDB(dbName, version, storeName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = e => e.target.result.createObjectStore(storeName);
    req.onsuccess       = e => resolve(e.target.result);
    req.onerror         = e => reject(e.target.error);
  });
}

/**
 * Reads a value from the store by key.
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<any>}
 */
export function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Writes a value to the store under the given key.
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
export function idbSet(db, storeName, key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Deletes a key from the store. Silent no-op if key doesn't exist.
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @param {string} key
 * @returns {Promise<void>}
 */
export function idbDel(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

/**
 * Clears all records from the store.
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @returns {Promise<void>}
 */
export function idbClear(db, storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readwrite').objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}
