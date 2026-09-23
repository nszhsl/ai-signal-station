import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWatchTransition, normalizeWatchNotify, watchOpenKey } from '../src/lib/watch.js';

const openWatch = {
  open: true,
  type: 'reset',
  scheduledAt: '2026-09-24T10:00:00.000Z',
  scheduledAtEstimated: true,
  scheduledDay: '2026-09-24',
  scheduledZoneLabel: 'PT',
  postId: '999',
  publicationToken: 'abc',
  url: 'https://x.com/claudeai/status/999',
  title: { 'zh-CN': 'Claude 预告重置', en: 'Claude reset preview' },
  timingNote: { 'zh-CN': '明天上午', en: 'tomorrow morning' },
  text: 'preview',
};

describe('classifyWatchTransition', () => {
  it('defaults unknown modes to open-or-change', () => {
    assert.equal(normalizeWatchNotify(undefined), 'open-or-change');
    assert.equal(normalizeWatchNotify('nope'), 'open-or-change');
    assert.equal(normalizeWatchNotify('off'), 'off');
  });

  it('notifies when a watch opens or its key fields change, once per fingerprint', () => {
    assert.equal(classifyWatchTransition(null, openWatch, 'open-or-change'), 'open');
    assert.equal(classifyWatchTransition(openWatch, openWatch, 'open-or-change'), null);
    assert.equal(watchOpenKey(openWatch), watchOpenKey({ ...openWatch, title: { 'zh-CN': 'Claude 预告重置', ja: '別訳' } }));

    const changed = { ...openWatch, scheduledAt: '2026-09-25T10:00:00.000Z' };
    assert.equal(classifyWatchTransition(openWatch, changed, 'open-or-change'), 'change');
    assert.equal(classifyWatchTransition({ ...openWatch, title: { 'zh-CN': '时间改了' } }, openWatch, 'open-or-change'), 'change');
  });

  it('stays silent when a watch completes unless completion notices are enabled', () => {
    const closed = { ...openWatch, open: false, completedEventId: 'claude-1' };
    assert.equal(classifyWatchTransition(openWatch, closed, 'open-or-change'), null);
    assert.equal(classifyWatchTransition(openWatch, null, 'open-or-change'), null);
    assert.equal(classifyWatchTransition(openWatch, closed, 'open-change-and-complete'), 'complete');
    assert.equal(classifyWatchTransition(null, closed, 'open-change-and-complete'), null);
    assert.equal(classifyWatchTransition(null, openWatch, 'off'), null);
  });
});
