import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAUDE_API_RESETS_URL,
  CLAUDE_DATA_RESETS_URL,
  CLAUDE_SUMMARY_URL,
  claudeProvider,
  fetchClaudeRaw,
  parseClaudeSnapshot,
} from '../src/lib/providers/claude.js';
import { loadFixture, loadJsonFixture } from './helpers.js';

const NOW = '2026-09-08T00:00:00.000Z';
const summary = loadJsonFixture('claude-summary.json');
const resets = loadJsonFixture('claude-resets.json');

function fixtureFetcher(calls) {
  return async (url) => {
    calls.push(url);
    if (url === CLAUDE_SUMMARY_URL) return loadFixture('claude-summary.json');
    if (url === CLAUDE_API_RESETS_URL || url === CLAUDE_DATA_RESETS_URL) {
      return loadFixture('claude-resets.json');
    }
    throw new Error('unexpected url ' + url);
  };
}

describe('parseClaudeSnapshot', () => {
  const parsed = parseClaudeSnapshot({ summary, resets }, { now: NOW });

  it('maps live JSON shapes onto the unified event schema', () => {
    assert.equal(parsed.events.length, 4);
    assert.equal(parsed.lastReset, '2026-09-04T20:08:45Z');
    assert.equal(parsed.resetCount, 3);
    assert.equal(parsed.policyChangeCount, 1);
    assert.equal(parsed.forecast24h, null);
    assert.equal(parsed.forecast48h, null);
    assert.equal(parsed.hitRate, null);
    assert.deepEqual(parsed.events.map((e) => e.kind), ['confirmed', 'policy', 'confirmed', 'confirmed']);
    assert.deepEqual(parsed.events.map((e) => e.scope), [
      '全体用户',
      '付费计划用户',
      'Pro 与 Max 用户',
      'Max 用户',
    ]);
    assert.equal(parsed.events[0].title, 'Claude 全球额度重置');
    assert.equal(parsed.events[1].title, 'Claude 付费计划策略变更');
    assert.equal(parsed.events[1].tag, '策略变更');
    assert.equal(parsed.events[3].title, 'Claude Max 额度重置');
    assert.equal(parsed.events[3].sourceName, 'lydiahallie');
    assert.equal(parsed.events[3].id, '2095967323412930677');
    assert.match(parsed.events[3].description, /Max 用户/);
    assert.match(parsed.events[1].description, /不刷新额度计数/);
  });

  it('does not invent events missing from the source payload', () => {
    const empty = parseClaudeSnapshot({
      summary: { ...summary, lastResetAt: null, resetCount: 0, policyChangeCount: 0 },
      resets: { providers: { claude: { events: [] } } },
    }, { now: NOW });
    assert.deepEqual(empty.events, []);
    assert.equal(empty.lastReset, null);
  });
});

describe('fetchClaudeRaw', () => {
  it('uses summary.json as the fast path and skips full events when unchanged', async () => {
    const previous = parseClaudeSnapshot({ summary, resets }, { now: NOW });
    const calls = [];
    const raw = await fetchClaudeRaw(fixtureFetcher(calls), { previous });
    assert.equal(raw.unchanged, true);
    assert.deepEqual(calls, [CLAUDE_SUMMARY_URL]);
    const parsed = claudeProvider.parse(raw, { now: '2026-09-08T01:00:00.000Z' });
    assert.equal(parsed.events.length, 4);
    assert.equal(parsed.fetchedAt, '2026-09-08T01:00:00.000Z');
  });

  it('falls back to data/resets.json when api/resets fails', async () => {
    const calls = [];
    const raw = await fetchClaudeRaw(async (url) => {
      calls.push(url);
      if (url === CLAUDE_SUMMARY_URL) return loadFixture('claude-summary.json');
      if (url === CLAUDE_API_RESETS_URL) throw new Error('HTTP 502');
      if (url === CLAUDE_DATA_RESETS_URL) return loadFixture('claude-resets.json');
      throw new Error('unexpected url ' + url);
    });
    assert.equal(raw.unchanged, false);
    assert.equal(extractCount(raw), 4);
    assert.deepEqual(calls, [CLAUDE_SUMMARY_URL, CLAUDE_API_RESETS_URL, CLAUDE_DATA_RESETS_URL]);
  });
});

function extractCount(raw) {
  return raw.resets.providers.claude.events.length;
}
