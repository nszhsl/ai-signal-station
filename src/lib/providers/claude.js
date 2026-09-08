import { normalizeEvent } from '../events.js';

export const CLAUDE_SUMMARY_URL = 'https://claude-resets.com/data/summary.json';
export const CLAUDE_DATA_RESETS_URL = 'https://claude-resets.com/data/resets.json';
export const CLAUDE_API_RESETS_URL = 'https://claude-resets.com/api/resets';
export const CLAUDE_RSS_URL = 'https://claude-resets.com/rss/resets.xml';

// Maps taken from live claude-resets.com events only (scope / kind / account).
const SCOPE_ZH = {
  all: '全体用户',
  'paid plans': '付费计划用户',
  'Pro + Max': 'Pro 与 Max 用户',
  'affected users': '受影响用户',
  Max: 'Max 用户',
};

const TAG_ZH = {
  reset: '额度重置',
  policy: '策略变更',
};

const TITLE_ZH = {
  'reset:all': 'Claude 全球额度重置',
  'reset:Max': 'Claude Max 额度重置',
  'reset:Pro + Max': 'Claude Pro / Max 额度重置',
  'reset:affected users': 'Claude 受影响用户额度重置',
  'policy:paid plans': 'Claude 付费计划策略变更',
};

const SOURCE_ZH = {
  ClaudeDevs: 'ClaudeDevs（官方账号）',
  lydiahallie: 'lydiahallie',
};

function mapKind(sourceKind) {
  switch (sourceKind) {
    case 'reset':
      return 'confirmed';
    case 'policy':
      return 'policy';
    default: {
      const _unknown = sourceKind;
      return _unknown || 'post';
    }
  }
}

function translateScope(scope) {
  if (!scope) return null;
  return SCOPE_ZH[scope] || scope;
}

function titleFor(sourceKind, scope) {
  const key = `${sourceKind}:${scope || ''}`;
  if (TITLE_ZH[key]) return TITLE_ZH[key];
  switch (sourceKind) {
    case 'reset':
      return 'Claude 额度重置';
    case 'policy':
      return 'Claude 策略变更';
    default:
      return 'Claude 信号';
  }
}

function labelFor(sourceKind) {
  switch (sourceKind) {
    case 'reset':
      return { en: 'Confirmed reset', zh: '已确认重置' };
    case 'policy':
      return { en: 'Policy change', zh: '策略变更' };
    default:
      return { en: sourceKind || null, zh: sourceKind || null };
  }
}

function buildDescription(evt) {
  const parts = [];
  const dt = new Date(evt.datetime);
  const dateStr = `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日`;
  const scope = evt.scope || '受影响用户';

  switch (evt.kind) {
    case 'confirmed':
      parts.push(`官方于 ${dateStr} 对 ${scope}执行了 Claude Code 额度重置，5 小时及/或每周用量计数已刷新。`);
      break;
    case 'policy':
      parts.push(`官方于 ${dateStr} 公布了面向 ${scope}的用量策略变更；按来源定义，策略公告不刷新额度计数。`);
      break;
    default:
      break;
  }
  if (evt.note) parts.push(evt.note);
  if (evt.sourceName) parts.push(`消息来源：${evt.sourceName}。`);
  return parts.join('');
}

export function extractClaudeEvents(resetsPayload) {
  const events = resetsPayload && resetsPayload.providers && resetsPayload.providers.claude
    ? resetsPayload.providers.claude.events
    : null;
  if (Array.isArray(events)) return events;
  if (resetsPayload && Array.isArray(resetsPayload.events)) return resetsPayload.events;
  return [];
}

export function parseClaudeEvent(raw, fallbackAccount) {
  const sourceKind = raw.kind;
  const scopeEn = raw.scope || null;
  const account = raw.account || fallbackAccount || 'ClaudeDevs';
  const labels = labelFor(sourceKind);
  const evt = {
    id: raw.id || null,
    datetime: raw.date,
    kind: mapKind(sourceKind),
    sourceKind,
    sourceUrl: raw.url || null,
    titleEn: titleFor(sourceKind, scopeEn),
    labelEn: labels.en,
    tagEn: sourceKind,
    scopeEn,
    sourceNameEn: account,
    title: titleFor(sourceKind, scopeEn),
    label: labels.zh,
    tag: TAG_ZH[sourceKind] || sourceKind,
    scope: translateScope(scopeEn),
    sourceName: SOURCE_ZH[account] || account,
    note: raw.note || null,
    verification: raw.verification || null,
  };
  evt.description = buildDescription(evt);
  return normalizeEvent('claude', evt);
}

export function summaryFingerprint(summary) {
  if (!summary) return '';
  return [summary.lastResetAt || '', summary.resetCount ?? '', summary.policyChangeCount ?? ''].join('|');
}

export async function fetchClaudeRaw(fetcher, { previous } = {}) {
  const summary = JSON.parse(await fetcher(CLAUDE_SUMMARY_URL));
  const unchanged = Boolean(
    previous
    && summaryFingerprint(summary) === summaryFingerprint({
      lastResetAt: previous.lastReset,
      resetCount: previous.resetCount,
      policyChangeCount: previous.policyChangeCount,
    })
    && Array.isArray(previous.events)
    && previous.events.length > 0,
  );

  if (unchanged) {
    return { summary, resets: null, unchanged: true, previous };
  }

  let lastError;
  for (const url of [CLAUDE_API_RESETS_URL, CLAUDE_DATA_RESETS_URL]) {
    try {
      const resets = JSON.parse(await fetcher(url));
      return { summary, resets, unchanged: false, previous: previous || null };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Claude resets JSON unavailable');
}

export function parseClaudeSnapshot(raw, { now } = {}) {
  const fetchedAt = now || new Date().toISOString();
  const summary = raw.summary || {};

  if (raw.unchanged && raw.previous) {
    return {
      ...raw.previous,
      fetchedAt,
      lastReset: summary.lastResetAt || raw.previous.lastReset,
      resetCount: summary.resetCount ?? raw.previous.resetCount,
      policyChangeCount: summary.policyChangeCount ?? raw.previous.policyChangeCount,
    };
  }

  const fallbackAccount = summary.account
    || (raw.resets && raw.resets.providers && raw.resets.providers.claude && raw.resets.providers.claude.account)
    || 'ClaudeDevs';
  const events = extractClaudeEvents(raw.resets).map((evt) => parseClaudeEvent(evt, fallbackAccount));
  const confirmed = events
    .filter((e) => e.kind === 'confirmed')
    .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

  return {
    fetchedAt,
    lastReset: summary.lastResetAt || (confirmed[0] && confirmed[0].datetime) || null,
    timeSinceLast: null,
    forecast24h: null,
    forecast48h: null,
    hitRate: null,
    resetCount: summary.resetCount ?? confirmed.length,
    policyChangeCount: summary.policyChangeCount ?? events.filter((e) => e.kind === 'policy').length,
    lastResetScope: summary.lastResetScope || null,
    lastResetUrl: summary.lastResetUrl || null,
    sourcesResponding: null,
    events,
  };
}

export const claudeProvider = {
  id: 'claude',
  enabled: true,
  kvKey: 'claude:data',
  eventsKey: 'claude:events',
  apiPath: '/api/claude',
  notifyKinds: ['confirmed'],
  notifyOnEmpty: false,
  async fetchRaw(fetcher, { store } = {}) {
    let previous = null;
    if (store) {
      const oldRaw = await store.get(this.kvKey);
      previous = oldRaw ? JSON.parse(oldRaw) : null;
    }
    return fetchClaudeRaw(fetcher, { previous });
  },
  parse(raw, opts) {
    return parseClaudeSnapshot(raw, opts);
  },
};
