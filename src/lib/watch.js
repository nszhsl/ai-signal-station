import { localizedText } from './whenreset.js';

export const WATCH_NOTIFY_MODES = ['off', 'open-or-change', 'open-change-and-complete'];
export const DEFAULT_WATCH_NOTIFY = 'open-or-change';

export function normalizeWatchNotify(mode) {
  if (WATCH_NOTIFY_MODES.includes(mode)) return mode;
  return DEFAULT_WATCH_NOTIFY;
}

function textOf(value) {
  return localizedText(value) || '';
}

export function watchOpenKey(watch) {
  if (!watch || watch.open !== true) return null;
  return [
    watch.type || '',
    watch.scheduledAt || '',
    watch.scheduledAtEstimated ? '1' : '0',
    watch.scheduledDay || '',
    watch.scheduledZoneLabel || '',
    watch.postId || '',
    watch.publicationToken || '',
    watch.url || '',
    textOf(watch.title),
    textOf(watch.timingNote),
    watch.text || '',
  ].join('~');
}

export function classifyWatchTransition(previousWatch, nextWatch, mode) {
  const normalized = normalizeWatchNotify(mode);
  if (normalized === 'off') return null;
  const prevOpen = Boolean(previousWatch && previousWatch.open === true);
  const nextOpen = Boolean(nextWatch && nextWatch.open === true);
  if (nextOpen) {
    const prevKey = watchOpenKey(previousWatch);
    const nextKey = watchOpenKey(nextWatch);
    if (prevKey === nextKey) return null;
    return prevOpen ? 'change' : 'open';
  }
  if (prevOpen && normalized === 'open-change-and-complete') return 'complete';
  return null;
}
