// Drop-in replacement for the window.storage API the app was originally built
// against (Claude's artifact key-value store). Backed by the browser's
// localStorage, so all data stays on this one device/browser — no server.
//
// Keys are namespaced so this app never collides with anything else that
// might use localStorage on the same origin.

const NS = "overblik-app:";

function fullKey(key, shared) {
  return `${NS}${shared ? "shared" : "personal"}:${key}`;
}

window.storage = {
  async get(key, shared = false) {
    const k = fullKey(key, shared);
    if (!(k in window.localStorage)) {
      throw new Error(`Key not found: ${key}`);
    }
    return { key, value: window.localStorage.getItem(k), shared: !!shared };
  },

  async set(key, value, shared = false) {
    const k = fullKey(key, shared);
    try {
      window.localStorage.setItem(k, value);
      return { key, value, shared: !!shared };
    } catch (err) {
      console.error("storage.set failed", err);
      return null;
    }
  },

  async delete(key, shared = false) {
    const k = fullKey(key, shared);
    const existed = k in window.localStorage;
    window.localStorage.removeItem(k);
    return existed ? { key, deleted: true, shared: !!shared } : null;
  },

  async list(prefix = "", shared = false) {
    const nsPrefix = `${NS}${shared ? "shared" : "personal"}:`;
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const raw = window.localStorage.key(i);
      if (raw && raw.startsWith(nsPrefix)) {
        const bare = raw.slice(nsPrefix.length);
        if (!prefix || bare.startsWith(prefix)) keys.push(bare);
      }
    }
    return { keys, prefix, shared: !!shared };
  },
};
