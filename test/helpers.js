import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function loadFixture(name) {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');
}

export function loadJsonFixture(name) {
  return JSON.parse(loadFixture(name));
}

export function memoryStore(init = {}) {
  const map = { ...init };
  return {
    async get(key) {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    },
    async put(key, value) {
      map[key] = value;
    },
    raw: map,
  };
}

export function recordedSend() {
  const cards = [];
  return {
    cards,
    async sendCard(_webhook, card) {
      cards.push(card);
      return '{"ok":true}';
    },
  };
}
