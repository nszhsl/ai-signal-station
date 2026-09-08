import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodexReset } from '../src/lib/providers/codex.js';
import { loadFixture } from './helpers.js';

const NOW = '2026-09-08T00:00:00.000Z';

describe('parseCodexReset', () => {
  const html = loadFixture('codex-sample.html');
  const parsed = parseCodexReset(html, { now: NOW });

  it('locks event count and kinds from the HTML fixture', () => {
    assert.equal(parsed.events.length, 3);
    assert.deepEqual(parsed.events.map((e) => e.kind), ['confirmed', 'confirmed', 'post']);
    assert.equal(parsed.lastReset, '2026-08-01T03:32:37Z');
    assert.equal(parsed.timeSinceLast, '6 days ago');
    assert.equal(parsed.forecast24h, 12);
    assert.equal(parsed.forecast48h, 34);
    assert.equal(parsed.hitRate, 80);
    assert.equal(parsed.fetchedAt, NOW);
  });

  it('keeps Codex translations and push-facing fields', () => {
    const [compensation, milestone, signal] = parsed.events;
    assert.equal(compensation.title, 'Codex 全球额度重置');
    assert.equal(compensation.label, '已确认重置');
    assert.equal(compensation.tag, '故障补偿');
    assert.equal(compensation.scope, 'Codex 和 ChatGPT Work 全体付费用户');
    assert.equal(compensation.sourceName, 'Tibo 推特（官方人员）');
    assert.match(compensation.description, /补偿性额度重置/);

    assert.equal(milestone.title, '800 万活跃用户庆祝重置');
    assert.equal(milestone.tag, '里程碑');
    assert.equal(milestone.scope, '全体付费用户');
    assert.match(milestone.description, /800 万/);

    assert.equal(signal.title, '上行信号');
    assert.equal(signal.label, '上行信号');
    assert.equal(signal.tag, '重置概率上升');
    assert.equal(signal.scope, 'Codex 付费用户');
    assert.match(signal.description, /尚待官方确认/);
  });
});
