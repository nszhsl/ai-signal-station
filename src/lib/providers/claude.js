import { normalizeEvent } from '../events.js';

export const CLAUDE_RESETS_URL = 'https://whenreset.dev/api/resets';
export const CLAUDE_RSS_URL = 'https://whenreset.dev/api/reset-feed?provider=claude';

const SCOPE_ZH = {
  all: '全体用户',
  paid: '付费用户',
  max: 'Max 用户',
  affected: '受影响用户',
};

const REASON_ZH = {
  new_model: '新模型',
  fix: '故障修复',
  weekend: '周末',
  rival: '竞品',
};

const SOURCE_ZH = {
  ClaudeDevs: 'ClaudeDevs（官方账号）',
  claudeai: 'claudeai（官方账号）',
  lydiahallie: 'lydiahallie',
};

function mapType(sourceType) {
  switch (sourceType) {
    case 'reset':
      return 'confirmed';
    case 'card':
      return 'card';
    default:
      return 'post';
  }
}

function localizedText(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value['zh-CN'] || value.zh || value.en || null;
}

function noteFrom(raw) {
  const localized = localizedText(raw.reasonNote);
  if (localized) return localized;
  if (!raw.reason || raw.reason === 'unstated') return null;
  return REASON_ZH[raw.reason] || raw.reason;
}

function scopeFields(raw) {
  const noteZh = raw.scopeNote && localizedText(raw.scopeNote);
  const noteEn = raw.scopeNote && typeof raw.scopeNote === 'object' ? (raw.scopeNote.en || null) : null;
  const scopeEn = noteEn || raw.scope || null;
  const scope = noteZh || (raw.scope ? (SCOPE_ZH[raw.scope] || raw.scope) : null);
  return { scope, scopeEn };
}

function primarySource(sources) {
  const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
  return list.find((item) => item.role === 'landed' && item.url)
    || list.find((item) => item.url)
    || null;
}

function titleFor(sourceType, scope) {
  if (sourceType === 'card') return 'Claude 额度卡';
  if (sourceType !== 'reset') return 'Claude 信号';
  switch (scope) {
    case 'all':
      return 'Claude 全球额度重置';
    case 'max':
      return 'Claude Max 额度重置';
    case 'paid':
      return 'Claude 付费用户额度重置';
    case 'affected':
      return 'Claude 受影响用户额度重置';
    default:
      return 'Claude 额度重置';
  }
}

function labelFor(sourceType) {
  switch (sourceType) {
    case 'reset':
      return { en: 'Confirmed reset', zh: '已确认重置' };
    case 'card':
      return { en: 'Banked reset card', zh: '额度卡' };
    default:
      return { en: sourceType || null, zh: sourceType || null };
  }
}

function formatUtcMonthDay(iso) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日`;
}

function buildDescription(evt) {
  const parts = [];
  const dateStr = formatUtcMonthDay(evt.datetime);
  let head = '官方';
  if (dateStr) head += `于 ${dateStr}`;

  switch (evt.kind) {
    case 'confirmed':
      if (evt.scope) head += ` 对 ${evt.scope}`;
      parts.push(`${head}执行了 Claude 额度重置，5 小时及/或每周用量计数已刷新。`);
      break;
    case 'card':
      if (evt.scope) head += ` 向 ${evt.scope}`;
      parts.push(`${head}发放了可稍后兑换的额度卡，用量计数不会在公告瞬间刷新。`);
      break;
    default:
      break;
  }
  if (evt.note) parts.push(evt.note);
  if (evt.sourceName) parts.push(`消息来源：${evt.sourceName}。`);
  return parts.join('');
}

export function extractClaudeEvents(payload) {
  const events = payload && Array.isArray(payload.events) ? payload.events : [];
  return events.filter((evt) => evt && evt.provider === 'claude');
}

function statsOf(payload) {
  return (payload && payload.stats && payload.stats.claude) || {};
}

function eventSignature(evt) {
  const note = localizedText(evt && evt.reasonNote) || '';
  const url = (primarySource(evt && evt.sources) || {}).url || '';
  return [evt && evt.id, evt && evt.type, evt && evt.landedAt, evt && evt.scope, evt && evt.reason, note, url].join('~');
}

export function claudeFingerprint(payload) {
  const stats = statsOf(payload);
  const signatures = extractClaudeEvents(payload).map(eventSignature).sort().join(',');
  return [stats.lastResetAt || '', stats.resets ?? '', stats.cards ?? '', signatures].join('|');
}

export function parseClaudeEvent(raw) {
  const sourceType = raw && raw.type;
  const source = primarySource(raw && raw.sources);
  const account = (source && source.account) || null;
  const labels = labelFor(sourceType);
  const scopes = scopeFields(raw || {});
  const evt = {
    id: (source && source.postId) || (raw && raw.id) || null,
    sourceId: (raw && raw.id) || null,
    datetime: (raw && raw.landedAt) || null,
    kind: mapType(sourceType),
    sourceKind: sourceType || null,
    sourceUrl: (source && source.url) || null,
    titleEn: titleFor(sourceType, raw && raw.scope),
    labelEn: labels.en,
    tagEn: raw && raw.reason && raw.reason !== 'unstated' ? raw.reason : null,
    scopeEn: scopes.scopeEn,
    sourceNameEn: account,
    title: titleFor(sourceType, raw && raw.scope),
    label: labels.zh,
    tag: raw && raw.reason ? (REASON_ZH[raw.reason] || null) : null,
    scope: scopes.scope,
    sourceName: account ? (SOURCE_ZH[account] || account) : null,
    note: noteFrom(raw || {}),
  };
  evt.description = buildDescription(evt);
  return normalizeEvent('claude', evt);
}

function summaryFields(stats, events) {
  const ranked = events
    .filter((evt) => evt.kind === 'confirmed' || evt.kind === 'card')
    .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  const latest = ranked[0] || null;
  const medianGapHours = typeof stats.medianGapHours === 'number' && Number.isFinite(stats.medianGapHours)
    ? stats.medianGapHours
    : null;
  const medianGapDays = medianGapHours == null ? null : Math.round((medianGapHours / 24) * 100) / 100;
  const confirmedCount = events.filter((evt) => evt.kind === 'confirmed').length;
  const cardCount = events.filter((evt) => evt.kind === 'card').length;

  return {
    lastReset: stats.lastResetAt || (latest && latest.datetime) || null,
    timeSinceLast: null,
    forecast24h: null,
    forecast48h: null,
    hitRate: null,
    resetCount: stats.resets ?? confirmedCount,
    cardCount: stats.cards ?? cardCount,
    policyChangeCount: 0,
    medianGapHours,
    medianGapDays,
    lastResetScope: latest ? (latest.scopeEn || null) : null,
    lastResetUrl: latest ? (latest.sourceUrl || null) : null,
    sourcesResponding: null,
  };
}

function unwrapResets(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.resets && (Array.isArray(raw.resets.events) || raw.resets.stats)) return raw.resets;
  return raw;
}

function decodeXml(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function rssTag(block, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return match ? decodeXml(match[1].trim()) : null;
}

export function parseClaudeRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let match = re.exec(xml || '');
  while (match) {
    const block = match[1];
    const title = rssTag(block, 'title');
    const link = rssTag(block, 'link');
    const pubDate = rssTag(block, 'pubDate');
    const description = rssTag(block, 'description');
    const label = (title || '').split('·').slice(1).join('·').trim();
    let sourceType = null;
    if (/bonus reset/i.test(label)) sourceType = 'card';
    else if (/usage reset/i.test(label)) sourceType = 'reset';
    const statusMatch = link ? /status\/(\d+)/.exec(link) : null;
    const postId = statusMatch ? statusMatch[1] : null;
    const account = (title || '').split('·')[0].trim() || null;
    const landedAt = pubDate ? new Date(pubDate) : null;
    items.push(parseClaudeEvent({
      id: postId || link || title,
      type: sourceType,
      landedAt: landedAt && !Number.isNaN(landedAt.getTime()) ? landedAt.toISOString() : null,
      reasonNote: description ? { en: description } : null,
      sources: [{
        role: 'landed',
        postId,
        account,
        url: link,
      }],
    }));
    match = re.exec(xml || '');
  }
  return items;
}

export function parseClaudeSnapshot(raw, { now } = {}) {
  const fetchedAt = now || new Date().toISOString();

  if (raw && raw.feed === 'rss') {
    const events = parseClaudeRss(raw.rss);
    return {
      fetchedAt,
      sourceFingerprint: null,
      feed: 'rss',
      ...summaryFields({}, events),
      events,
    };
  }

  const payload = unwrapResets(raw);
  const fingerprint = claudeFingerprint(payload);
  if (raw && raw.unchanged && raw.previous && Array.isArray(raw.previous.events)) {
    return {
      ...raw.previous,
      fetchedAt,
      sourceFingerprint: fingerprint,
      ...summaryFields(statsOf(payload), raw.previous.events),
      events: raw.previous.events,
    };
  }

  const events = extractClaudeEvents(payload).map((evt) => parseClaudeEvent(evt));
  return {
    fetchedAt,
    sourceFingerprint: fingerprint,
    feed: 'json',
    ...summaryFields(statsOf(payload), events),
    events,
  };
}

export async function fetchClaudeRaw(fetcher, { previous } = {}) {
  try {
    const text = await fetcher(CLAUDE_RESETS_URL);
    const resets = JSON.parse(text);
    if (!resets || !Array.isArray(resets.events)) {
      throw new Error('whenreset JSON missing events[]');
    }
    const fingerprint = claudeFingerprint(resets);
    const unchanged = Boolean(
      previous
      && previous.sourceFingerprint
      && previous.sourceFingerprint === fingerprint
      && Array.isArray(previous.events)
      && previous.events.length > 0,
    );
    return { feed: 'json', resets, unchanged, previous: previous || null };
  } catch (jsonError) {
    try {
      const rss = await fetcher(CLAUDE_RSS_URL);
      return { feed: 'rss', rss, unchanged: false, previous: previous || null };
    } catch {
      const message = jsonError && jsonError.message ? jsonError.message : String(jsonError);
      throw new Error(`Claude whenreset JSON unavailable (${message})`);
    }
  }
}

export const claudeProvider = {
  id: 'claude',
  enabled: true,
  kvKey: 'claude:data',
  eventsKey: 'claude:events',
  apiPath: '/api/claude',
  notifyKinds: ['confirmed', 'card'],
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
