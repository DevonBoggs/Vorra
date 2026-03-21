// Electron Bridge — unified API that works in both Electron and browser
// In Electron: uses IPC via window.vorra (exposed by preload.js)
// In browser: falls back to localStorage

/**
 * Returns true if running inside Electron with the vorra bridge available.
 */
export const isElectron = () => !!window.vorra;

/**
 * Database operations.
 * Falls back to localStorage when not running in Electron.
 */
export const db = {
  get: async (key) => {
    if (isElectron()) return window.vorra.db.get(key);
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  set: async (key, value) => {
    if (isElectron()) return window.vorra.db.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('[Vorra:Bridge] localStorage set failed:', e.message);
    }
  },

  getAll: async () => {
    if (isElectron()) return window.vorra.db.getAll();
    // In browser, return all vorra-prefixed keys
    const result = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('vorra-')) {
        try {
          result[key] = JSON.parse(localStorage.getItem(key));
        } catch {
          result[key] = localStorage.getItem(key);
        }
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  },

  export: async () => {
    if (isElectron()) return window.vorra.db.export();
    try {
      const data = localStorage.getItem('vorra-v1');
      return data || JSON.stringify(null);
    } catch {
      return JSON.stringify(null);
    }
  },

  import: async (json) => {
    if (isElectron()) return window.vorra.db.import(json);
    try {
      const value = typeof json === 'string' ? json : JSON.stringify(json);
      // If it's a wrapped export { version, data }, unwrap it
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = null;
      }
      if (parsed && parsed.data && parsed.version) {
        // Wrapped format — import each key
        for (const [key, val] of Object.entries(parsed.data)) {
          localStorage.setItem(key, JSON.stringify(val));
        }
      } else {
        // Raw data — store under vorra-v1
        localStorage.setItem('vorra-v1', value);
      }
    } catch (e) {
      console.error('[Vorra:Bridge] localStorage import failed:', e.message);
    }
  },

  getPath: async () => {
    if (isElectron()) return window.vorra.db.getPath();
    return null; // No file path in browser
  },
};

/**
 * Backup operations (Electron only).
 * Returns no-ops / empty results when in browser.
 */
export const backup = {
  save: async (customPath) => {
    if (isElectron()) return window.vorra.backup.save(customPath);
    console.warn('[Vorra:Bridge] Backup not available in browser');
    return null;
  },

  restore: async (filePath) => {
    if (isElectron()) return window.vorra.backup.restore(filePath);
    console.warn('[Vorra:Bridge] Backup restore not available in browser');
    return null;
  },

  listBackups: async () => {
    if (isElectron()) return window.vorra.backup.listBackups();
    return [];
  },

  autoBackup: async () => {
    if (isElectron()) return window.vorra.backup.autoBackup();
  },
};

/**
 * Notification wrapper.
 * Falls back to the Web Notification API when not in Electron.
 */
export const notify = {
  show: async (title, body, options = {}) => {
    if (isElectron()) return window.vorra.notify.show(title, body, options);
    // Fallback to Web Notification API
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body, ...options });
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(title, { body, ...options });
        }
      }
    }
  },

  setBadge: async (count) => {
    if (isElectron()) return window.vorra.notify.setBadge(count);
    // Fallback to document title badge
    const base = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = count > 0 ? `(${count}) ${base}` : base;
  },
};

/**
 * Platform info.
 */
export const platform = {
  isElectron: () => isElectron(),
  os: () => isElectron() ? window.vorra.platform.os : navigator.platform,
  appVersion: () => isElectron() ? window.vorra.platform.appVersion : null,
};
