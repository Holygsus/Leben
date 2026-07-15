const DB_NAME = "leben-os";
const DB_VERSION = 1;
const STORE_NAME = "settings";
const BACKGROUND_IMAGE_KEY = "background-image";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Hintergrundbild (rein lokal, IndexedDB statt localStorage — Blob-Daten passen dort
// nicht rein, siehe wissensdatenbank/features/personalisierung.md) ----------

export async function getBackgroundImageBlob() {
  return (await idbGet(BACKGROUND_IMAGE_KEY)) || null;
}

export async function saveBackgroundImageBlob(blob) {
  await idbSet(BACKGROUND_IMAGE_KEY, blob);
}

export async function clearBackgroundImage() {
  await idbDelete(BACKGROUND_IMAGE_KEY);
}

// Verkleinert/komprimiert ein Upload-Bild auf max. maxEdge Pixel Kantenlänge, bevor es in
// IndexedDB landet — sonst würde ein unkomprimiertes Handy-Foto die Quota unnötig belasten.
export async function resizeImageToBlob(file, maxEdge = 1920, quality = 0.85) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

// ---------- Dark/Light-Mode (rein lokal, localStorage) ----------
// Ohne gespeicherte Wahl bleibt das data-theme-Attribut ungesetzt und die
// @media(prefers-color-scheme)-Regel in variables.css greift (Modus "System").

const THEME_STORAGE_KEY = "leben-os:theme";

export function getStoredTheme() {
  return localStorage.getItem(THEME_STORAGE_KEY);
}

export function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } else {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(THEME_STORAGE_KEY);
  }
}
