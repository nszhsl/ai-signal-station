import { normalizeEvent } from './events.js';

export const WHENRESET_RESETS_URL = 'https://whenreset.dev/api/resets';

export const PRODUCT_IDS = ['codex', 'claude', 'grok'];

const SCOPE_ZH = {
  all: '全体用户',
  paid: '付费用户',
  max: 'Max 用户',
  affected: '受影响用户',
  unknown: '范围未说明',
  plus_pro_business: 'Plus / Pro / Business',
};

const REASON_ZH = {
  new_model: '新模型',
  fix: '故障修复',
  weekend: '周末',
  rival: '竞品',
  compensation: '补偿',
  milestone: '里程碑',
  new_product: '新产品',
};

const SOURCE_ZH = {
  ClaudeDevs: 'ClaudeDevs（官方账号）',
  claudeai: 'claudeai（官方账号）',
  lydiahallie: 'lydiahallie',
};

const LANGS = ['zh-CN', 'zh', 'en'];

export function localizedText(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;
  for (const lang of LANGS) {
    if (typeof value[lang] === 'string' && value[lang]) return value[lang];
  }
  const first = Object.values(value).find((item) => typeof item === 'string' && item);
  return first || null;
}

export function productName(product) {
  switch (product) {
    case 'codex':
      return 'Codex';
    case 'claude':
      return 'Claude';
    case 'grok':
      return 'Grok';
    default: {
      const unknown = product;
      return unknown ? String(unknown) : 'Signal';
    }
  }
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round2(value) {
  if (value == null) return null;
  return Math.round(value * 100) / 100;
}

function unwrapResets(raw) {
  if (!raw || typeof raw !== 'object') return {};
  if (raw.resets && (Array.isArray(raw.resets.events) || raw.resets.stats)) return raw.resets;
  return raw;
}

export function eventsForProvider(payload, product) {
  const events = payload && Array.isArray(payload.events) ? payload.events : [];
  return events.filter((evt) => evt && evt.provider === product);
}

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

function mapSources(sources) {
  const list = Array.isArray(sources) ? sources.filter(Boolean) : [];
  return list.map((source) => ({
    role: source.role || null,
    postId: source.postId || null,
    account: source.account || null,
    at: source.at || null,
    url: source.url || null,
  }));
}

function primarySource(sources) {
  return sources.find((item) => item.role === 'landed' && item.url)
    || sources.find((item) => item.url)
    || null;
}

function noteFrom(raw) {
  const localized = localizedText(raw.reasonNote);
  if (localized) return localized;
  if (!raw.reason || raw.reason === 'unstated') return null;
  return REASON_ZH[raw.reason] || raw.reason;
}

function scopeFields(raw) {
  const noteZh = raw.scopeNote ? localizedText(raw.scopeNote) : null;
  const noteEn = raw.scopeNote && typeof raw.scopeNote === 'object' ? (raw.scopeNote.en || null) : null;
  const scopeEn = noteEn || raw.scope || null;
  const scope = noteZh || (raw.scope ? (SCOPE_ZH[raw.scope] || raw.scope) : null);
  return { scope, scopeEn };
}

function titleFor(product, sourceType, scope) {
  const name = productName(product);
  if (sourceType === 'card') return `${name} 额度卡`;
  if (sourceType !== 'reset') return `${name} 信号`;
  switch (scope) {
    case 'all':
      return `${name} 全球额度重置`;
    case 'max':
      return `${name} Max 额度重置`;
    case 'paid':
      return `${name} 付费用户额度重置`;
    case 'affected':
      return `${name} 受影响用户额度重置`;
    case 'plus_pro_business':
      return `${name} Plus / Pro / Business 额度重置`;
    default:
      return `${name} 额度重置`;
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

function buildDescription(product, evt) {
  const name = productName(product);
  const parts = [];
  const dateStr = formatUtcMonthDay(evt.datetime);
  let head = '官方';
  if (dateStr) head += `于 ${dateStr}`;

  switch (evt.kind) {
    case 'confirmed':
      if (evt.scope) head += ` 对 ${evt.scope}`;
      if (product === 'claude') {
        parts.push(`${head}执行了 Claude 额度重置，5 小时及/或每周用量计数已刷新。`);
      } else {
        parts.push(`${head}执行了 ${name} 额度重置，用量计数已刷新。`);
      }
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
  const followups = (evt.sources || []).filter((source) => source.role === 'followup' && source.url);
  if (followups.length) parts.push(`另有 ${followups.length} 条后续来源。`);
  return parts.join('');
}

export function parseWhenresetEvent(product, raw) {
  const sourceType = raw && raw.type;
  const sources = mapSources(raw && raw.sources);
  const source = primarySource(sources);
  const account = (source && source.account) || null;
  const labels = labelFor(sourceType);
  const scopes = scopeFields(raw || {});
  const evt = {
    id: (source && source.postId) || (raw && raw.id) || null,
    sourceId: (raw && raw.id) || null,
    datetime: (raw && raw.landedAt) || null,
    kind: mapType(sourceType),
    sourceKind: sourceType || null,
    authority: (raw && raw.authority) || null,
    reason: (raw && raw.reason) || null,
    reasonNote: (raw && raw.reasonNote) || null,
    scopeNote: (raw && raw.scopeNote) || null,
    sources,
    sourceUrl: (source && source.url) || null,
    titleEn: titleFor(product, sourceType, raw && raw.scope),
    labelEn: labels.en,
    tagEn: raw && raw.reason && raw.reason !== 'unstated' ? raw.reason : null,
    scopeEn: scopes.scopeEn,
    sourceNameEn: account,
    title: titleFor(product, sourceType, raw && raw.scope),
    label: labels.zh,
    tag: raw && raw.reason ? (REASON_ZH[raw.reason] || null) : null,
    scope: scopes.scope,
    sourceName: account ? (SOURCE_ZH[account] || account) : null,
    note: noteFrom(raw || {}),
  };
  evt.description = buildDescription(product, evt);
  return normalizeEvent(product, evt);
}

export function mapEstimate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    method: raw.method ?? null,
    asOf: raw.asOf ?? null,
    anchorAt: raw.anchorAt ?? null,
    elapsedDays: finiteNumber(raw.elapsedDays),
    windowSamples: finiteNumber(raw.windowSamples),
    comparableSamples: finiteNumber(raw.comparableSamples),
    baselineDays: finiteNumber(raw.baselineDays),
    limitedHistory: raw.limitedHistory === true,
    status: raw.status ?? null,
    target: raw.target ?? null,
  };
}

export function mapStats(raw) {
  const stats = raw && typeof raw === 'object' ? raw : {};
  const medianGapHours = finiteNumber(stats.medianGapHours);
  return {
    total: finiteNumber(stats.total),
    resets: finiteNumber(stats.resets),
    cards: finiteNumber(stats.cards),
    lastResetAt: stats.lastResetAt || null,
    resetsLast30Days: finiteNumber(stats.resetsLast30Days),
    cardsLast30Days: finiteNumber(stats.cardsLast30Days),
    gapSamples: finiteNumber(stats.gapSamples),
    medianGapHours,
    medianGapDays: round2(medianGapHours == null ? null : medianGapHours / 24),
    estimatedNextAt: stats.estimatedNextAt || null,
    estimate: mapEstimate(stats.estimate),
  };
}

export function mapWatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    open: raw.open === true,
    type: raw.type ?? null,
    scheduledAt: raw.scheduledAt ?? null,
    scheduledAtEstimated: raw.scheduledAtEstimated === true,
    scheduledDay: raw.scheduledDay ?? null,
    scheduledTimeZone: raw.scheduledTimeZone ?? null,
    scheduledZoneLabel: raw.scheduledZoneLabel ?? null,
    timeZoneConfirmed: raw.timeZoneConfirmed === true,
    timingNote: raw.timingNote ?? null,
    completedEventId: raw.completedEventId ?? null,
    publicationToken: raw.publicationToken ?? null,
    postId: raw.postId ?? null,
    url: raw.url ?? null,
    at: raw.at ?? null,
    account: raw.account ?? null,
    name: raw.name ?? null,
    title: raw.title ?? null,
    text: raw.text ?? null,
  };
}

function summaryFields(stats, events) {
  const ranked = events
    .filter((evt) => evt.kind === 'confirmed' || evt.kind === 'card')
    .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  const latest = ranked[0] || null;
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
    policyNote: 'whenreset 不提供 policy（只改限额、不刷新计数）事件',
    medianGapHours: stats.medianGapHours,
    medianGapDays: stats.medianGapDays,
    estimatedNextAt: stats.estimatedNextAt,
    estimate: stats.estimate,
    estimateNote: '下次估计来自近期已完成间隔和已等待时间，不是个人额度倒计时，也不是官方日程。',
    lastResetScope: latest ? (latest.scopeEn || null) : null,
    lastResetUrl: latest ? (latest.sourceUrl || null) : null,
    sourcesResponding: null,
  };
}

export function parseProductSnapshot(product, raw, { now } = {}) {
  const payload = unwrapResets(raw);
  const events = eventsForProvider(payload, product).map((evt) => parseWhenresetEvent(product, evt));
  const stats = mapStats(payload.stats && payload.stats[product]);
  const watchRaw = payload.watch && Object.prototype.hasOwnProperty.call(payload.watch, product)
    ? payload.watch[product]
    : null;
  return {
    fetchedAt: now || new Date().toISOString(),
    feed: 'whenreset',
    product,
    upstreamGeneratedAt: payload.generatedAt || null,
    upstreamCheckedAt: payload.checkedAt || null,
    upstreamSource: payload.source || null,
    dataSource: (payload.dataSources && payload.dataSources[product]) || null,
    disclaimer: typeof payload.note === 'string' ? payload.note : null,
    stats,
    watch: mapWatch(watchRaw),
    ...summaryFields(stats, events),
    events,
  };
}

export function parseWhenresetSnapshots(raw, opts) {
  const snapshots = {};
  for (const product of PRODUCT_IDS) {
    snapshots[product] = parseProductSnapshot(product, raw, opts);
  }
  return snapshots;
}

export async function fetchWhenresetResets(fetcher) {
  const text = await fetcher(WHENRESET_RESETS_URL);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('whenreset JSON is not valid JSON');
  }
  if (!payload || !Array.isArray(payload.events)) {
    throw new Error('whenreset JSON missing events[]');
  }
  return payload;
}
