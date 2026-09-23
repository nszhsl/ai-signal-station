import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WHENRESET_RESETS_URL,
  eventsForProvider,
  fetchWhenresetResets,
  parseProductSnapshot,
  parseWhenresetSnapshots,
} from '../src/lib/whenreset.js';
import { getEnabledProviders } from '../src/lib/providers/index.js';
import { loadJsonFixture } from './helpers.js';

const NOW = '2026-09-23T01:00:00.000Z';
const resets = loadJsonFixture('whenreset-resets.json');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function bySourceId(snapshot, sourceId) {
  return snapshot.events.find((evt) => evt.sourceId === sourceId);
}

describe('parseWhenresetSnapshots', () => {
  const snapshots = parseWhenresetSnapshots(resets, { now: NOW });

  it('splits one payload into claude, codex, and grok', () => {
    assert.deepEqual(getEnabledProviders().map((provider) => provider.id), ['codex', 'claude', 'grok']);
    assert.equal(snapshots.claude.events.length, eventsForProvider(resets, 'claude').length);
    assert.equal(snapshots.codex.events.length, 54);
    assert.equal(snapshots.claude.events.length, 14);
    assert.equal(snapshots.grok.events.length, 7);
    assert.equal(
      snapshots.codex.events.length + snapshots.claude.events.length + snapshots.grok.events.length,
      resets.events.length,
    );
    for (const product of ['codex', 'claude', 'grok']) {
      assert.equal(snapshots[product].feed, 'whenreset');
      assert.equal(snapshots[product].product, product);
      assert.equal(snapshots[product].policyChangeCount, 0);
      assert.equal(snapshots[product].forecast24h, null);
      assert.equal(snapshots[product].hitRate, null);
      assert.equal(snapshots[product].estimate.method, 'bounded-wait-v2');
      assert.equal(snapshots[product].estimate.status, 'historical-reference');
      assert.equal(snapshots[product].estimatedNextAt, resets.stats[product].estimatedNextAt);
      assert.equal(snapshots[product].stats.estimatedNextAt, resets.stats[product].estimatedNextAt);
      assert.match(snapshots[product].estimateNote, /不是个人额度倒计时/);
      assert.match(snapshots[product].disclaimer, /official schedule/i);
    }
  });

  it('maps claude reset and card fields, including both source posts', () => {
    const claude = snapshots.claude;
    assert.equal(claude.lastReset, '2026-09-22T16:31:08.000Z');
    assert.equal(claude.resetCount, 13);
    assert.equal(claude.cardCount, 1);
    assert.equal(claude.medianGapHours, 192.48097222222222);
    assert.equal(claude.medianGapDays, 8.02);
    assert.equal(claude.meanGapDays, undefined);
    assert.equal(claude.lastResetScope, 'paid');
    assert.equal(claude.lastResetUrl, 'https://x.com/claudeai/status/2102435538120691886');
    assert.equal(claude.watch, null);

    const card = bySourceId(claude, 'claude-2102438800836489554');
    assert.equal(card.kind, 'card');
    assert.equal(card.id, '2102435538120691886');
    assert.equal(card.title, 'Claude 额度卡');
    assert.equal(card.scope, '付费用户');
    assert.equal(card.note, 'Opus 5.5 发布');
    assert.equal(card.tag, '新模型');
    assert.equal(card.sourceName, 'claudeai（官方账号）');
    assert.equal(card.sourceUrl, 'https://x.com/claudeai/status/2102435538120691886');
    assert.deepEqual(card.sources.map((source) => source.role), ['landed', 'followup']);
    assert.equal(card.sources[1].url, 'https://x.com/ClaudeDevs/status/2102438800836489554');
    assert.match(card.description, /额度卡/);
    assert.match(card.description, /后续来源/);
    assert.doesNotMatch(card.description, /策略/);

    const maxReset = bySourceId(claude, 'claude-2095967323412930677');
    assert.equal(maxReset.kind, 'confirmed');
    assert.equal(maxReset.title, 'Claude Max 额度重置');
    assert.equal(maxReset.scope, 'Max 用户');
    assert.equal(maxReset.sourceName, 'lydiahallie');
    assert.equal(maxReset.note, '应对 Astra 发布，官方说法是长周末');
    assert.equal(maxReset.reasonNote.en, 'Response to Astra launch; official wording is the long weekend');
    assert.match(maxReset.description, /5 小时及\/或每周用量计数已刷新/);

    const affected = bySourceId(claude, 'claude-2067802163498352929');
    assert.equal(affected.scope, '额度显示异常的 Pro、Max 用户');
    assert.equal(affected.note, '周额度显示错误');
    assert.equal(affected.tag, '故障修复');
  });

  it('keeps codex authority, stats, and the closed watch announcement', () => {
    const codex = snapshots.codex;
    assert.equal(codex.resetCount, 50);
    assert.equal(codex.cardCount, 4);
    assert.equal(codex.stats.resetsLast30Days, 7);
    assert.equal(codex.stats.cardsLast30Days, 3);
    assert.equal(codex.medianGapDays, 2.8);
    assert.equal(codex.dataSource, 'https://x.com/thsottiaux');
    assert.equal(codex.events.every((evt) => evt.authority === 'codex-ledger'), true);
    assert.equal(codex.events.some((evt) => evt.kind === 'card'), true);
    assert.equal(codex.watch.open, false);
    assert.equal(codex.watch.title['zh-CN'], 'Tibo 预告周二重置');
    assert.equal(codex.watch.timingNote.en.startsWith('September 22'), true);
    assert.equal(codex.watch.url, 'https://x.com/thsottiaux/status/2102254445082116335');
  });

  it('maps grok resets and keeps follow-up posts', () => {
    const grok = snapshots.grok;
    assert.equal(grok.lastReset, '2026-09-05T18:24:39.000Z');
    assert.equal(grok.resetCount, 7);
    assert.equal(grok.cardCount, 0);
    assert.equal(grok.medianGapHours, 156.57555555555555);
    assert.equal(grok.medianGapDays, 6.52);
    assert.equal(grok.watch, null);
    assert.equal(grok.estimate.target, 'reset-or-card-record');
    const multi = bySourceId(grok, 'grok-2096303514230423629');
    assert.equal(multi.kind, 'confirmed');
    assert.equal(multi.title, 'Grok 全球额度重置');
    assert.deepEqual(multi.sources.map((source) => [source.role, source.account]), [
      ['landed', 'bot'],
      ['followup', 'elonmusk'],
    ]);
  });

  it('does not invent policy events or adopt the old claude-resets shape', () => {
    const dropped = parseProductSnapshot('claude', {
      summary: { policyChangeCount: 6, meanGapDays: 14.1 },
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

    const unknown = parseProductSnapshot('claude', {
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
  });
});

describe('fetchWhenresetResets', () => {
  it('fetches the shared resets URL once', async () => {
    const calls = [];
    const payload = await fetchWhenresetResets(async (url) => {
      calls.push(url);
      return JSON.stringify(resets);
    });
    assert.deepEqual(calls, [WHENRESET_RESETS_URL]);
    assert.equal(payload.events.length, resets.events.length);
    assert.equal(parseProductSnapshot('grok', payload, { now: NOW }).events.length, 7);
  });
});

describe('whenreset source cutover', () => {
  it('does not keep the old Codex HTML source or claude-resets.com', () => {
    const banned = ['codexreset.org', 'parseCodexReset', 'reset-timeline-item', 'claude-resets.com'];
    const files = sourceFiles(ROOT);
    assert.ok(files.some((file) => file.endsWith(`${path.sep}src${path.sep}lib${path.sep}whenreset.js`)));
    assert.equal(files.some((file) => file.endsWith(`${path.sep}codex.js`)), false);
    assert.equal(files.some((file) => file.endsWith(`${path.sep}html.js`)), false);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const token of banned) {
        assert.equal(text.includes(token), false, `${file} contains ${token}`);
      }
    }
  });
});

function sourceFiles(root) {
  const out = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|html|css|md|toml|json)$/.test(entry)) out.push(full);
    }
  }
  for (const name of ['src', 'public', 'local']) walk(path.join(root, name));
  for (const name of ['README.md', 'wrangler.example.toml', 'package.json']) out.push(path.join(root, name));
  return out;
}
