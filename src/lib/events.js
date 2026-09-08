/**
 * Unified event schema:
 * { product, datetime, kind, title, description, scope, sourceUrl, sourceName, tag, id? }
 */

export function eventKey(evt) {
  if (evt && evt.id) return `id:${evt.id}`;
  return `dt:${evt && evt.datetime ? evt.datetime : ''}`;
}

export function normalizeEvent(product, evt) {
  const src = evt || {};
  return {
    ...src,
    product,
    id: src.id ?? null,
    datetime: src.datetime || src.date || null,
    kind: src.kind ?? null,
    title: src.title ?? null,
    description: src.description ?? null,
    scope: src.scope ?? null,
    sourceUrl: src.sourceUrl || src.url || null,
    sourceName: src.sourceName ?? null,
    tag: src.tag ?? null,
  };
}

export function diffEvents(oldEvents, newEvents) {
  const oldKeys = new Set((oldEvents || []).map(eventKey));
  return (newEvents || []).filter((evt) => !oldKeys.has(eventKey(evt)));
}

export function isNotifiable(evt, notifyKinds = ['confirmed']) {
  return Boolean(evt && notifyKinds.includes(evt.kind));
}
