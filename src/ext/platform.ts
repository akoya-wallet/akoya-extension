// Thin wrapper over chrome.* so the UI can also run under `npm run dev` for development.
// The dev fallback keeps everything in memory — never localStorage/sessionStorage/IndexedDB.

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;

type Area = { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void>; remove(k: string): Promise<void> };

function chromeArea(area: chrome.storage.StorageArea): Area {
  return {
    get: async k => (await area.get(k))[k],
    set: (k, v) => area.set({ [k]: v }),
    remove: k => area.remove(k),
  };
}

function memoryArea(): Area {
  const m = new Map<string, string>();
  return {
    get: async k => (m.has(k) ? JSON.parse(m.get(k)!) : undefined),
    set: async (k, v) => void m.set(k, JSON.stringify(v)),
    remove: async k => void m.delete(k),
  };
}

/** chrome.storage.local — encrypted vault entries and non-secret settings only */
export const localStore: Area = hasChrome ? chromeArea(chrome.storage.local) : memoryArea();
/** chrome.storage.session — memory-only, cleared when the browser exits; public session data only */
export const sessionStore: Area = hasChrome && chrome.storage.session ? chromeArea(chrome.storage.session) : memoryArea();

const DEV_REWRITE: Record<string, string> = {
  'https://blockbook.pearlresearch.ai': '/__bb/mainnet',
  'https://blockbook.testnet.pearlresearch.ai': '/__bb/testnet2',
};

/** fetch for indexer calls; in `vite dev` the default indexers go through the dev proxy */
export const indexerFetch = (url: string, init?: RequestInit): Promise<Response> => {
  if (!hasChrome && import.meta.env?.DEV) {
    for (const [from, to] of Object.entries(DEV_REWRITE)) if (url.startsWith(from)) return fetch(to + url.slice(from.length), init);
  }
  return fetch(url, init);
};

const DEV_POOL_REWRITE: Record<string, string> = { 'https://pearlhash.xyz': '/__pool/pearlhash' };

/** fetch for mining-pool calls; in `vite dev` (no host permissions, no CORS) via the dev proxy */
export const poolFetch = (url: string, init?: RequestInit): Promise<Response> => {
  if (!hasChrome && import.meta.env?.DEV) {
    for (const [from, to] of Object.entries(DEV_POOL_REWRITE)) if (url.startsWith(from)) return fetch(to + url.slice(from.length), init);
  }
  return fetch(url, init);
};

/** Whether the extension already has access to an origin (always true outside the extension). */
export async function hasOrigin(url: string): Promise<boolean> {
  if (!hasChrome || !chrome.permissions) return true;
  return chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] });
}

export function openTab(url: string) {
  if (hasChrome && chrome.tabs?.create) void chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export const extensionUrl = (path: string) => (hasChrome ? chrome.runtime.getURL(path) : `${location.origin}/${path}`);

/** Asks Chrome for access to one extra origin (custom indexer). Must be called from a click handler. */
export async function requestOrigin(url: string): Promise<boolean> {
  if (!hasChrome || !chrome.permissions) return true;
  const origins = [`${new URL(url).origin}/*`];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

export const isPopup = () => !new URLSearchParams(location.search).has('tab');
