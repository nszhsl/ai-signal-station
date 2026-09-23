import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEnabledProviders, runProviderMonitor } from '../src/lib/monitor.js';
import { CLAUDE_RESETS_URL, claudeProvider, parseClaudeSnapshot } from '../src/lib/providers/claude.js';
import { codexProvider, parseCodexReset } from '../src/lib/providers/codex.js';
import { loadFixture, loadJsonFixture, memoryStore, recordedSend } from './helpers.js';

const NOW = '2026-09-08T00:00:00.000Z';
const resets = loadJsonFixture('whenreset-resets.json');
const html = loadFixture('codex-sample.html');

function claudeFetcher() {
  return async (url) => {
    if (url === CLAUDE_RESETS_URL) return JSON.stringify(resets);
    throw new Error('unexpected ' + url);
  };
}

describe('runProviderMonitor', () => {
  it('does not push Feishu when Codex events are unchanged', async () => {
    const parsed = parseCodexReset(html, { now: NOW });
    const store = memoryStore({
      'codex:data': JSON.stringify(parsed),
    });
    const { cards, sendCard } = recordedSend();
    const result = await runProviderMonitor(codexProvider, {
      store,
      fetchText: async () => html,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      sendCard,
      now: NOW,
    });
    assert.equal(result.newEvents, 0);
    assert.equal(result.notified, 0);
    assert.equal(cards.length, 0);
  });

  it('does not push Feishu when Claude events are unchanged', async () => {
    const parsed = parseClaudeSnapshot(resets, { now: NOW });
    const store = memoryStore({
      'claude:data': JSON.stringify(parsed),
    });
    const { cards, sendCard } = recordedSend();
    const result = await runProviderMonitor(claudeProvider, {
      store,
      fetchText: claudeFetcher(),
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      sendCard,
      now: NOW,
    });
    assert.equal(result.newEvents, 0);
    assert.equal(result.notified, 0);
    assert.equal(cards.length, 0);
  });

  it('pushes one Codex card for a new confirmed reset and ignores posts', async () => {
    const parsed = parseCodexReset(html, { now: NOW });
    const prior = {
      ...parsed,
      events: parsed.events.filter((e) => e.datetime !== '2026-08-01T03:32:37Z'),
    };
    const store = memoryStore({
      'codex:data': JSON.stringify(prior),
    });
    const { cards, sendCard } = recordedSend();
    const result = await runProviderMonitor(codexProvider, {
      store,
      fetchText: async () => html,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      sendCard,
      now: NOW,
    });
    assert.equal(result.newEvents, 1);
    assert.equal(result.notified, 1);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].header.title.content, '[Codex] 🟢 额度重置确认');
  });

  it('pushes one Claude card for a new confirmed reset', async () => {
    const parsed = parseClaudeSnapshot(resets, { now: NOW });
    const prior = {
      ...parsed,
      events: parsed.events.filter((e) => e.id !== '2095967323412930677'),
      lastReset: '2026-06-01T17:35:01Z',
      resetCount: 2,
      sourceFingerprint: 'stale',
    };
    const store = memoryStore({
      'claude:data': JSON.stringify(prior),
    });
    const { cards, sendCard } = recordedSend();
    const result = await runProviderMonitor(claudeProvider, {
      store,
      fetchText: claudeFetcher(),
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      sendCard,
      now: NOW,
    });
    assert.equal(result.newEvents, 1);
    assert.equal(result.notified, 1);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].header.title.content, '[Claude] 🟢 额度重置确认');
    assert.match(cards[0].elements[0].fields[1].text.content, /已确认重置/);
  });

  it('seeds Claude history without Feishu spam on first fill', async () => {
    const store = memoryStore();
    const { cards, sendCard } = recordedSend();
    const result = await runProviderMonitor(claudeProvider, {
      store,
      fetchText: claudeFetcher(),
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      sendCard,
      now: NOW,
    });
    assert.equal(result.seeded, true);
    assert.equal(result.newEvents, 4);
    assert.equal(result.notified, 0);
    assert.equal(cards.length, 0);
    const saved = JSON.parse(store.raw['claude:data']);
    assert.equal(saved.events.length, 4);
  });

  it('pushes a new Claude banked card and does not treat it as policy', async () => {
    const parsed = parseClaudeSnapshot(resets, { now: NOW });
    const prior = {
      ...parsed,
      events: parsed.events.filter((e) => e.kind !== 'card'),
      cardCount: 0,
      policyChangeCount: 0,
      sourceFingerprint: 'stale',
    };
    const store = memoryStore({
      'claude:data': JSON.stringify(prior),
    });
    const { cards, sendCard } = recordedSend();
    const result = await runProviderMonitor(claudeProvider, {
      store,
      fetchText: claudeFetcher(),
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      sendCard,
      now: NOW,
    });
    assert.equal(result.newEvents, 1);
    assert.equal(result.notified, 1);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].header.title.content, '[Claude] 🟢 额度卡发放');
    assert.equal(parsed.events.some((evt) => evt.kind === 'policy'), false);
    assert.equal(JSON.parse(store.raw['claude:data']).policyChangeCount, 0);
  });
});

describe('runEnabledProviders', () => {
  it('keeps Codex green when Claude throws', async () => {
    const store = memoryStore();
    const { cards, sendCard } = recordedSend();
    const failingClaude = {
      ...claudeProvider,
      async fetchRaw() {
        throw new Error('claude down');
      },
    };
    const results = await runEnabledProviders([codexProvider, failingClaude], {
      store,
      fetchText: async (url) => {
        if (String(url).includes('codexreset')) return html;
        throw new Error('should not fetch claude');
      },
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      sendCard,
      now: NOW,
    });
    const codex = results.find((r) => r.id === 'codex');
    const claude = results.find((r) => r.id === 'claude');
    assert.equal(codex.newEvents, 3);
    assert.equal(codex.notified, 2);
    assert.equal(codex.error, undefined);
    assert.match(claude.error, /claude down/);
    assert.equal(cards.length, 2);
    assert.ok(cards.every((card) => card.header.title.content.startsWith('[Codex]')));
  });
});
