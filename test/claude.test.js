import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLAUDE_RESETS_URL,
  CLAUDE_RSS_URL,
  claudeProvider,
  fetchClaudeRaw,
  parseClaudeSnapshot,
} from '../src/lib/providers/claude.js';
import { loadFixture, loadJsonFixture } from './helpers.js';

const NOW = '2026-09-08T00:00:00.000Z';
const resets = loadJsonFixture('whenreset-resets.json');

function fixtureFetcher(calls) {
  return async (url) => {
    calls.push(url);
    if (url === CLAUDE_RESETS_URL) return JSON.stringify(resets);
    throw new Error('unexpected url ' + url);
  };
}

describe('parseClaudeSnapshot', () => {
  const parsed = parseClaudeSnapshot(resets, { now: NOW });

  it('keeps only claude events and maps whenreset fields onto the app contract', () => {
    assert.equal(parsed.events.length, 4);
    assert.deepEqual(parsed.events.map((evt) => evt.kind), ['card', 'confirmed', 'confirmed', 'confirmed']);
    assert.equal(parsed.events.some((evt) => evt.kind === 'policy'), false);
    assert.equal(parsed.policyChangeCount, 0);
    assert.equal(parsed.lastReset, '2026-09-22T16:31:08.000Z');
    assert.equal(parsed.resetCount, 13);
    assert.equal(parsed.cardCount, 1);
    assert.equal(parsed.medianGapHours, 192.48097222222222);
    assert.equal(parsed.medianGapDays, 8.02);
    assert.equal(parsed.meanGapDays, undefined);
    assert.equal(parsed.forecast24h, null);
    assert.equal(parsed.lastResetScope, 'paid');
    assert.equal(parsed.lastResetUrl, 'https://x.com/claudeai/status/2102435538120691886');

    const card = parsed.events[0];
    assert.equal(card.id, '2102435538120691886');
    assert.equal(card.sourceId, 'claude-2102438800836489554');
    assert.equal(card.datetime, '2026-09-22T16:31:08.000Z');
    assert.equal(card.title, 'Claude 额度卡');
    assert.equal(card.scope, '付费用户');
    assert.equal(card.note, 'Opus 5.5 发布');
    assert.equal(card.tag, '新模型');
    assert.equal(card.sourceName, 'claudeai（官方账号）');
    assert.equal(card.sourceUrl, 'https://x.com/claudeai/status/2102435538120691886');
    assert.match(card.description, /额度卡/);
    assert.doesNotMatch(card.description, /策略/);

    const maxReset = parsed.events[1];
    assert.equal(maxReset.id, '2095967323412930677');
    assert.equal(maxReset.title, 'Claude Max 额度重置');
    assert.equal(maxReset.scope, 'Max 用户');
    assert.equal(maxReset.sourceName, 'lydiahallie');
    assert.equal(maxReset.note, '应对 Astra 发布，官方说法是长周末');
    assert.match(maxReset.description, /5 小时及\/或每周用量计数已刷新/);

    const affected = parsed.events[3];
    assert.equal(affected.scope, '额度显示异常的 Pro、Max 用户');
    assert.equal(affected.note, '周额度显示错误');
    assert.equal(affected.tag, '故障修复');
    assert.equal(parsed.events[2].note, null);
    assert.equal(parsed.events[2].tag, null);
  });

  it('does not invent policy events or adopt the old claude-resets shape', () => {
    const dropped = parseClaudeSnapshot({
      summary: {
        lastResetAt: '2020-01-01T00:00:00Z',
        resetCount: 9,
        policyChangeCount: 6,
        meanGapDays: 14.1,
      },
      resets: {
        providers: {
          claude: {
            events: [{
              id: '1',
              date: '2020-01-01T00:00:00Z',
              kind: 'policy',
              scope: 'paid plans',
              note: 'limit change',
              url: 'https://x.com/ClaudeDevs/status/1',
            }],
          },
        },
      },
    }, { now: NOW });
    assert.deepEqual(dropped.events, []);
    assert.equal(dropped.policyChangeCount, 0);
    assert.equal(dropped.resetCount, 0);
    assert.equal(dropped.meanGapDays, undefined);

    const unknown = parseClaudeSnapshot({
      stats: { claude: { resets: 0, cards: 0, medianGapHours: 48 } },
      events: [
        {
          id: 'claude-policyish',
          provider: 'claude',
          type: 'policy',
          scope: 'all',
          reason: 'unstated',
          landedAt: '2026-01-01T00:00:00.000Z',
          sources: [{ role: 'landed', postId: '1', account: 'ClaudeDevs', url: 'https://x.com/ClaudeDevs/status/1' }],
        },
        {
          id: 'codex-1',
          provider: 'codex',
          type: 'reset',
          landedAt: '2026-01-02T00:00:00.000Z',
          sources: [{ role: 'landed', postId: '2', url: 'https://x.com/thsottiaux/status/2' }],
        },
      ],
    }, { now: NOW });
    assert.deepEqual(unknown.events.map((evt) => evt.kind), ['post']);
    assert.equal(unknown.policyChangeCount, 0);
    assert.equal(unknown.medianGapDays, 2);
    assert.equal(unknown.medianGapHours, 48);
  });

  it('does not invent events missing from the source payload', () => {
    const empty = parseClaudeSnapshot({
      stats: { claude: { lastResetAt: null, resets: 0, cards: 0, medianGapHours: null } },
      events: [],
    }, { now: NOW });
    assert.deepEqual(empty.events, []);
    assert.equal(empty.lastReset, null);
    assert.equal(empty.policyChangeCount, 0);
    assert.equal(empty.medianGapDays, null);
  });
});

describe('fetchClaudeRaw', () => {
  it('fetches whenreset JSON once and skips a rebuild when the fingerprint matches', async () => {
    const previous = parseClaudeSnapshot(resets, { now: NOW });
    const calls = [];
    const raw = await fetchClaudeRaw(fixtureFetcher(calls), { previous });
    assert.equal(raw.unchanged, true);
    assert.deepEqual(calls, [CLAUDE_RESETS_URL]);
    const parsed = claudeProvider.parse(raw, { now: '2026-09-08T01:00:00.000Z' });
    assert.equal(parsed.events.length, 4);
    assert.equal(parsed.fetchedAt, '2026-09-08T01:00:00.000Z');
    assert.equal(parsed.events[0].description, previous.events[0].description);
  });

  it('refreshes the median gap from stats without treating hours as mean days', async () => {
    const previous = parseClaudeSnapshot(resets, { now: NOW });
    const shifted = structuredClone(resets);
    shifted.stats.claude.medianGapHours = 240;
    const raw = await fetchClaudeRaw(async () => JSON.stringify(shifted), { previous });
    assert.equal(raw.unchanged, true);
    const parsed = parseClaudeSnapshot(raw, { now: NOW });
    assert.equal(parsed.medianGapHours, 240);
    assert.equal(parsed.medianGapDays, 10);
    assert.equal(parsed.meanGapDays, undefined);
  });

  it('falls back to the Claude RSS feed when the JSON API fails', async () => {
    const calls = [];
    const raw = await fetchClaudeRaw(async (url) => {
      calls.push(url);
      if (url === CLAUDE_RESETS_URL) throw new Error('HTTP 502');
      if (url === CLAUDE_RSS_URL) return loadFixture('whenreset-claude-rss.xml');
      throw new Error('unexpected url ' + url);
    });
    assert.equal(raw.feed, 'rss');
    assert.deepEqual(calls, [CLAUDE_RESETS_URL, CLAUDE_RSS_URL]);
    const parsed = parseClaudeSnapshot(raw, { now: NOW });
    assert.deepEqual(parsed.events.map((evt) => evt.kind), ['card', 'confirmed']);
    assert.equal(parsed.policyChangeCount, 0);
    assert.equal(parsed.events[0].sourceUrl, 'https://x.com/ClaudeDevs/status/2102438800836489554');
    assert.equal(parsed.events[0].datetime, '2026-09-22T16:44:06.000Z');
    assert.match(parsed.events[1].note, /weekly limits/);
    assert.equal(parsed.medianGapHours, null);
    assert.equal(parsed.resetCount, 1);
    assert.equal(parsed.cardCount, 1);
  });
});

describe('claude source cutover', () => {
  it('does not keep claude-resets.com URLs in the collector, UI, or README', () => {
    const files = [
      new URL('../src/lib/providers/claude.js', import.meta.url),
      new URL('../public/app.js', import.meta.url),
      new URL('../public/index.html', import.meta.url),
      new URL('../README.md', import.meta.url),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      assert.equal(text.includes('claude-resets.com'), false, file.pathname);
    }
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    assert.match(readme, /https:\/\/whenreset\.dev\/api\/resets/);
    assert.match(readme, /policy/);
  });
});
