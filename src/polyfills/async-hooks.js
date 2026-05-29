// Edge runtime polyfill for node:async_hooks
// Vercel Edge Runtime provides AsyncLocalStorage as a global
const AsyncLocalStorage = globalThis.AsyncLocalStorage || 
  class AsyncLocalStorage {
    constructor() { this._store = new Map(); }
    run(store, callback, ...args) {
      const id = Symbol();
      this._store.set(id, store);
      try { return callback(...args); }
      finally { this._store.delete(id); }
    }
    getStore() { return undefined; }
  };

module.exports = { AsyncLocalStorage };
