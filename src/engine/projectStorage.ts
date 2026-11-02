const DB_NAME = 'harfa_foundry_db_v1';
const STORE_NAME = 'kv_store';

function openHarfaDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function savePersistedData<T>(key: string, value: T): Promise<void> {
  const serialized = JSON.stringify(value);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, serialized);
    }
  } catch {
    // Quota exceeded in localStorage — IndexedDB below will still persist the full payload
  }

  const db = await openHarfaDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadPersistedData<T>(key: string): Promise<T | null> {
  const db = await openHarfaDb();
  if (db) {
    const fromIdb = await new Promise<T | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (fromIdb !== null && fromIdb !== undefined) {
      return fromIdb;
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (raw) {
        return JSON.parse(raw) as T;
      }
    }
  } catch {
    // ignore
  }
  return null;
}
