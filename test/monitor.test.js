import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEnabledProviders, runProviderMonitor, shouldBackfillQuietly } from '../src/lib/monitor.js';
import { getEnabledProviders, getProviderById } from '../src/lib/providers/index.js';
import { WHENRESET_RESETS_URL, parseProductSnapshot } from '../src/lib/whenreset.js';
import { loadJsonFixture, memoryStore, recordedSend } from './helpers.js';

const NOW = '2026-09-23T01:00:00.000Z';
const resets = loadJsonFixture('whenreset-resets.json');
const WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/test';

function fetcher(calls = []) {
  return async (url) => {
    calls.push(url);
    if (url === WHENRESET_RESETS_URL) return JSON.stringify(resets);
    throw new Error('unexpected url ' + url);
  };
}

function withWatch(product, watch) {
  return {
    ...resets,
    watch: { ...resets.watch, [product]: watch },
  };
}

const openWatch = {
  open: true,
  type: 'reset',
  scheduledAt: '2026-09-24T10:00:00.000Z',
  scheduledAtEstimated: false,
  scheduledDay: '2026-09-24',
  scheduledZoneLabel: 'PT',
  postId: '999',
  publicationToken: 'token-1',
  url: 'https://x.com/claudeai/status/999',
  account: 'claudeai',
  name: 'Claude',
  title: { 'zh-CN': 'Claude 预告重置', en: 'Claude reset preview' },
  timingNote: { 'zh-CN': '明天上午', en: 'tomorrow morning' },
  text: 'A reset is coming.',
};

describe('runEnabledProviders', () => {
  it('fetches whenreset once and backfills all three products without Feishu spam', async () => {
    const calls = [];
    const store = memoryStore();
    const { cards, sendCard } = recordedSend();
    const results = await runEnabledProviders(getEnabledProviders(), {
      store,
      fetchText: fetcher(calls),
      webhook: WEBHOOK,
      sendCard,
      now: NOW,
    });
    assert.deepEqual(calls, [WHENRESET_RESETS_URL]);
    assert.deepEqual(results.map((result) => result.id), ['codex', 'claude', 'grok']);
    assert.equal(results.every((result) => result.seeded && result.notified === 0 && result.watchNotified === 0), true);
    assert.equal(cards.length, 0);
    assert.equal(JSON.parse(store.raw['codex:data']).events.length, 54);
    assert.equal(JSON.parse(store.raw['claude:data']).events.length, 14);
    assert.equal(JSON.parse(store.raw['grok:data']).events.length, 7);
    assert.equal(JSON.parse(store.raw['grok:data']).watch, null);
    assert.equal(JSON.parse(store.raw['codex:data']).watch.open, false);
  });

  it('does not replay a pre-whenreset Codex snapshot', async () => {
    const store = memoryStore({
      'codex:data': JSON.stringify({
        forecast24h: 12,
        hitRate: 80,
        events: [{ datetime: '2026-08-01T03:32:37Z', kind: 'confirmed', title: '旧 HTML 重置' }],
      }),
    });
    const { cards, sendCard } = recordedSend();
    const result = await runProviderMonitor(getProviderById('codex'), {
      store,
      payload: resets,
      webhook: WEBHOOK,
      sendCard,
      now: NOW,
    });
    assert.equal(result.seeded, true);
    assert.equal(result.notified, 0);
    assert.equal(cards.length, 0);
    assert.equal(JSON.parse(store.raw['codex:data']).feed, 'whenreset');
  });

  it('shares one fetch error across products', async () => {
    const results = await runEnabledProviders(getEnabledProviders(), {
      store: memoryStore(),
      fetchText: async () => { throw new Error('HTTP 502'); },
      webhook: WEBHOOK,
      sendCard: async () => { throw new Error('should not send'); },
      now: NOW,
    });
    assert.equal(results.length, 3);
    assert.equal(results.every((result) => result.error === 'HTTP 502' && result.notified === 0), true);
  });

  it('keeps the other products when one parser throws', async () => {
    const calls = [];
    const failing = {
      ...getProviderById('claude'),
      parse() { throw new Error('claude down'); },
    };
    const results = await runEnabledProviders([getProviderById('codex'), failing, getProviderById('grok')], {
      store: memoryStore(),
      fetchText: fetcher(calls),
      webhook: WEBHOOK,
      sendCard: async () => {},
      now: NOW,
    });
    assert.equal(calls.length, 1);
    assert.equal(results.find((result) => result.id === 'codex').seeded, true);
    assert.match(results.find((result) => result.id === 'claude').error, /claude down/);
    assert.equal(results.find((result) => result.id === 'grok').error, undefined);
  });
});

describe('runProviderMonitor notifications', () => {
  it('pushes one card for a new reset and one for a new banked card', async () => {
    const parsed = parseProductSnapshot('claude', resets, { now: NOW });
    const prior = {
      ...parsed,
      events: parsed.events.filter((evt) => evt.sourceId !== 'claude-2102438800836489554' && evt.id !== '2095967323412930677'),
    };
    const store = memoryStore({ 'claude:data': JSON.stringify(prior) });
    const { cards, sendCard } = recordedSend();
    const result = await runProviderMonitor(getProviderById('claude'), {
      store,
      payload: resets,
      webhook: WEBHOOK,
      sendCard,
      now: NOW,
    });
    assert.equal(result.seeded, false);
    assert.equal(result.newEvents, 2);
    assert.equal(result.notified, 2);
    assert.deepEqual(cards.map((card) => card.header.title.content), [
      '[Claude] 🟢 额度卡发放',
      '[Claude] 🟢 额度重置确认',
    ]);
    const card = cards[0];
    const sourceBlock = card.elements.find((el) => el.text && String(el.text.content).includes('来源帖'));
    assert.match(sourceBlock.text.content, /2102435538120691886/);
    assert.match(sourceBlock.text.content, /2102438800836489554/);
    assert.equal(JSON.parse(store.raw['claude:data']).policyChangeCount, 0);
  });

  it('pushes a Codex card event and ignores an unchanged snapshot', async () => {
    const parsed = parseProductSnapshot('codex', resets, { now: NOW });
    const card = parsed.events.find((evt) => evt.kind === 'card');
    const prior = { ...parsed, events: parsed.events.filter((evt) => evt.id !== card.id) };
    const store = memoryStore({ 'codex:data': JSON.stringify(prior) });
    const { cards, sendCard } = recordedSend();
    const first = await runProviderMonitor(getProviderById('codex'), {
      store,
      payload: resets,
      webhook: WEBHOOK,
      sendCard,
      now: NOW,
    });
    assert.equal(first.notified, 1);
    assert.equal(cards[0].header.title.content, '[Codex] 🟢 额度卡发放');

    const second = await runProviderMonitor(getProviderById('codex'), {
      store,
      payload: resets,
      webhook: WEBHOOK,
      sendCard,
      now: NOW,
    });
    assert.equal(second.newEvents, 0);
    assert.equal(second.notified, 0);
    assert.equal(second.watchNotified, 0);
    assert.equal(cards.length, 1);
  });

  it('notifies once when a watch opens or changes, and stays quiet when it completes', async () => {
    const baseline = parseProductSnapshot('claude', resets, { now: NOW });
    const store = memoryStore({ 'claude:data': JSON.stringify(baseline) });
    const { cards, sendCard } = recordedSend();
    const deps = { store, webhook: WEBHOOK, sendCard, now: NOW };

    const opened = await runProviderMonitor(getProviderById('claude'), {
      ...deps,
      payload: withWatch('claude', openWatch),
    });
    assert.equal(opened.newEvents, 0);
    assert.equal(opened.watchAction, 'open');
    assert.equal(opened.watchNotified, 1);
    assert.equal(cards[0].header.title.content, '[Claude] 🔵 预告开放');
    assert.match(JSON.stringify(cards[0]), /Claude 预告重置/);
    assert.match(JSON.stringify(cards[0]), /不是个人额度倒计时/);

    const again = await runProviderMonitor(getProviderById('claude'), {
      ...deps,
      payload: withWatch('claude', openWatch),
    });
    assert.equal(again.watchNotified, 0);

    const changed = await runProviderMonitor(getProviderById('claude'), {
      ...deps,
      payload: withWatch('claude', { ...openWatch, scheduledAt: '2026-09-25T10:00:00.000Z', text: 'Moved.' }),
    });
    assert.equal(changed.watchAction, 'change');
    assert.equal(changed.watchNotified, 1);

    const completed = await runProviderMonitor(getProviderById('claude'), {
      ...deps,
      payload: withWatch('claude', { ...openWatch, open: false, completedEventId: 'claude-done' }),
    });
    assert.equal(completed.watchAction, null);
    assert.equal(completed.watchNotified, 0);
    assert.equal(cards.length, 2);

    const withComplete = await runProviderMonitor(getProviderById('claude'), {
      ...deps,
      payload: withWatch('claude', openWatch),
      watchNotify: 'open-change-and-complete',
    });
    assert.equal(withComplete.watchAction, 'open');
    const closed = await runProviderMonitor(getProviderById('claude'), {
      ...deps,
      payload: withWatch('claude', { ...openWatch, open: false }),
      watchNotify: 'open-change-and-complete',
    });
    assert.equal(closed.watchAction, 'complete');
    assert.equal(cards.at(-1).header.title.content, '[Claude] ⚪ 预告已结束');
  });

  it('does not notify an already-open watch during backfill', () => {
    assert.equal(shouldBackfillQuietly({ events: [] }, { notifyOnEmpty: false }), true);
    assert.equal(shouldBackfillQuietly({ feed: 'whenreset', events: [], watch: null }, { notifyOnEmpty: false }), false);
    assert.equal(shouldBackfillQuietly({ events: [{ id: 'old' }] }, { notifyOnEmpty: false }), true);
  });
});
