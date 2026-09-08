import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffEvents, eventKey, normalizeEvent } from '../src/lib/events.js';

describe('normalizeEvent', () => {
  it('fills the unified schema and keeps extra fields', () => {
    const evt = normalizeEvent('codex', {
      datetime: '2026-08-01T03:32:37Z',
      kind: 'confirmed',
      title: 'Codex 全球额度重置',
      titleEn: 'Global Codex quota reset',
    });
    assert.equal(evt.product, 'codex');
    assert.equal(evt.datetime, '2026-08-01T03:32:37Z');
    assert.equal(evt.kind, 'confirmed');
    assert.equal(evt.title, 'Codex 全球额度重置');
    assert.equal(evt.titleEn, 'Global Codex quota reset');
    assert.equal(evt.sourceUrl, null);
  });

  it('accepts Claude date/url aliases', () => {
    const evt = normalizeEvent('claude', {
      id: '2095967323412930677',
      date: '2026-09-04T20:08:45Z',
      kind: 'confirmed',
      url: 'https://x.com/lydiahallie/status/2095967323412930677',
    });
    assert.equal(evt.datetime, '2026-09-04T20:08:45Z');
    assert.equal(evt.sourceUrl, 'https://x.com/lydiahallie/status/2095967323412930677');
    assert.equal(evt.id, '2095967323412930677');
  });
});

describe('diffEvents', () => {
  it('returns nothing when datetime keys already exist', () => {
    const oldEvents = [{ datetime: '2026-08-01T03:32:37Z', kind: 'confirmed' }];
    const next = [{ datetime: '2026-08-01T03:32:37Z', kind: 'confirmed' }];
    assert.deepEqual(diffEvents(oldEvents, next), []);
  });

  it('uses id when present so Claude events stay stable', () => {
    const oldEvents = [{ id: 'a', datetime: '2026-01-01T00:00:00Z' }];
    const next = [
      { id: 'a', datetime: '2026-01-01T00:00:00Z' },
      { id: 'b', datetime: '2026-02-01T00:00:00Z' },
    ];
    const added = diffEvents(oldEvents, next);
    assert.equal(added.length, 1);
    assert.equal(added[0].id, 'b');
  });

  it('treats missing id as datetime identity (Codex)', () => {
    assert.equal(eventKey({ datetime: '2026-08-01T03:32:37Z' }), 'dt:2026-08-01T03:32:37Z');
  });
});
