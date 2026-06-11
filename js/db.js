const DB_NAME = "turno-handling-db";
const DB_VERSION = 1;
const STORE_NAME = "app";
const STATE_KEY = "state";

export const createInitialState = () => ({
  version: 1,
  currentDay: {
    date: localDateKey(),
    clockIn: null,
    clockOut: null,
    items: []
  },
  history: [],
  schedule: [],
  settings: {
    notificationsEnabled: false
  },
  updatedAt: new Date().toISOString()
});

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readState() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function writeState(state) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(state, STATE_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

function normalizeState(saved) {
  const initial = createInitialState();
  if (!saved || typeof saved !== "object") return initial;

  return {
    ...initial,
    ...saved,
    currentDay: {
      ...initial.currentDay,
      ...(saved.currentDay || {}),
      items: Array.isArray(saved.currentDay?.items) ? saved.currentDay.items : []
    },
    history: Array.isArray(saved.history) ? saved.history : [],
    schedule: Array.isArray(saved.schedule) ? saved.schedule : [],
    settings: {
      ...initial.settings,
      ...(saved.settings || {})
    }
  };
}

export const storage = {
  async load() {
    const state = normalizeState(await readState());
    await this.save(state);
    return state;
  },

  async save(state) {
    state.updatedAt = new Date().toISOString();
    await writeState(state);
  },

  async replace(data) {
    const state = normalizeState(data);
    await this.save(state);
    return state;
  },

  async clear() {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    const state = createInitialState();
    await this.save(state);
    return state;
  }
};
