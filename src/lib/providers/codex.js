import { normalizeEvent } from '../events.js';
import { stripTags } from '../html.js';

export const CODEX_URL = 'https://codexreset.org/';

const TITLE_ZH = {
  'Usage depletion compensation': '用量耗尽补偿重置',
  'GPT-5.6 launch double-reset window': 'GPT-5.6 发布双重置窗口',
  'Global Codex quota reset': 'Codex 全球额度重置',
  'Global Codex compensation reset': 'Codex 全球补偿重置',
  '6M active users forced reset': '600 万活跃用户强制重置',
  '8M active users celebration reset': '800 万活跃用户庆祝重置',
  '9M active users hard reset': '900 万活跃用户硬性重置',
  '10M active users milestone reset': '1000 万用户里程碑重置',
  'Archived signal': '历史信号',
  'Upward signal': '上行信号',
};

const TAG_ZH = {
  'Compensation': '故障补偿',
  'Milestone': '里程碑',
  'Launch': '新品发布',
  'Upward signal': '重置概率上升',
};

const SCOPE_ZH_RULES = [
  [/paid codex users/i, 'Codex 付费用户'],
  [/all paid plans/i, '所有付费计划用户'],
  [/all paid users of codex and chatgpt work/i, 'Codex 和 ChatGPT Work 全体付费用户'],
  [/all paid users of chatgpt work and codex/i, 'Codex 和 ChatGPT Work 全体付费用户'],
  [/paid users of codex and chatgpt work/i, 'Codex 和 ChatGPT Work 付费用户'],
  [/all codex and chatgpt work users/i, 'Codex 和 ChatGPT Work 全体用户'],
  [/all chatgpt work and codex users/i, 'Codex 和 ChatGPT Work 全体用户'],
  [/codex and chatgpt work users/i, 'Codex 和 ChatGPT Work 用户'],
  [/shared usage limits across codex and chatgpt work/i, 'Codex 与 ChatGPT Work 共享额度'],
  [/shared\/global codex usage limits?.*chatgpt work/i, 'Codex 全球共享额度（含 ChatGPT Work）'],
  [/shared\/global codex usage quot?a/i, 'Codex 全球共享额度'],
  [/all paid users/i, '全体付费用户'],
];

function translateScope(scope) {
  if (!scope) return null;
  for (const [pattern, zh] of SCOPE_ZH_RULES) {
    if (pattern.test(scope)) return zh;
  }
  return scope;
}

function translateSource(name) {
  if (!name) return null;
  const map = {
    'OpenAI Status': 'OpenAI 官方状态页',
    'OpenAI on X': 'OpenAI 官方推特',
    'Tibo on X': 'Tibo 推特（官方人员）',
    'Tibo / Codex Radar': 'Tibo / Codex Radar',
  };
  return map[name] || name;
}

function buildDescription(evt) {
  const parts = [];
  const dt = new Date(evt.datetime);
  const dateStr = `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日`;
  const scope = evt.scope || '受影响用户';
  const titleEn = evt.titleEn || '';
  const tagEn = evt.tagEn || '';

  if (evt.kind === 'confirmed') {
    if (tagEn === 'Compensation') {
      parts.push(`OpenAI 于 ${dateStr} 对 ${scope}进行了补偿性额度重置，以弥补此前用量异常消耗或服务故障带来的损失。用户限额已恢复至满额。`);
    } else if (/milestone|celebration|active users/i.test(titleEn)) {
      const match = titleEn.match(/(\d+)M/i);
      const users = match ? `${match[1]}00 万` : '';
      parts.push(`为庆祝${users ? users + ' ' : ''}活跃用户里程碑，官方于 ${dateStr} 宣布重置 ${scope}的 Codex 使用额度。所有受影响用户限额恢复满额。`);
    } else if (/launch/i.test(titleEn)) {
      parts.push(`配合新模型发布，官方于 ${dateStr} 为 ${scope}开启了双重置窗口，Codex 额度在短时间内连续重置两次。`);
    } else {
      parts.push(`官方于 ${dateStr} 对 ${scope}执行了全球额度重置，所有受影响用户的使用限额已恢复至满额。`);
    }
    if (evt.sourceName) {
      parts.push(`消息来源：${evt.sourceName}。`);
    }
  } else if (evt.kind === 'post') {
    if (tagEn === 'Upward signal') {
      parts.push(`监控账号于 ${dateStr} 发布了可能预示近期重置的推文信号，24/48 小时重置概率有所上升。该信号尚待官方确认，不代表重置已发生。`);
    } else {
      parts.push(`监控账号于 ${dateStr} 发布的相关推文，已归档作为重置历史参考。`);
    }
  }
  return parts.join('');
}

export function parseCodexReset(html, { now } = {}) {
  const result = {
    fetchedAt: now || new Date().toISOString(),
    lastReset: null,
    timeSinceLast: null,
    forecast24h: null,
    forecast48h: null,
    hitRate: null,
    sourcesResponding: null,
    events: [],
  };

  const itemRegex = /<div\b[^>]*data-datetime="([^"]*)"[^>]*data-kind="([^"]*)"[^>]*data-source-url="([^"]*)"[^>]*data-testid="reset-timeline-item"[^>]*>([\s\S]*?)<\/article>/gi;
  const events = [];
  let m;
  while ((m = itemRegex.exec(html)) !== null) {
    const [, datetime, kind, sourceUrl, inner] = m;
    const titleMatch = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const labelMatch = inner.match(/text-primary-foreground[^>]*>([^<]+)</);
    const scopeMatch = inner.match(/<dt[^>]*>Scope<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
    const sourceNameMatch = inner.match(/<dt[^>]*>Source<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/i);
    const bottomTagMatch = inner.match(/reset-sand[^>]*>([^<]+)</);

    const titleEn = titleMatch ? stripTags(titleMatch[1]) : null;
    const labelEn = labelMatch ? stripTags(labelMatch[1]) : null;
    const scopeEn = scopeMatch ? stripTags(scopeMatch[1]) : null;
    const sourceNameEn = sourceNameMatch ? stripTags(sourceNameMatch[1]) : null;
    const tagEn = bottomTagMatch ? stripTags(bottomTagMatch[1]) : null;

    const evt = {
      datetime,
      kind,
      sourceUrl,
      titleEn,
      labelEn,
      tagEn,
      scopeEn,
      sourceNameEn,
      title: TITLE_ZH[titleEn] || titleEn,
      label: labelEn === 'Confirmed reset' ? '已确认重置' : (labelEn === 'Upward signal' ? '上行信号' : labelEn),
      tag: TAG_ZH[tagEn] || tagEn,
      scope: translateScope(scopeEn),
      sourceName: translateSource(sourceNameEn),
    };
    evt.description = buildDescription({ ...evt, titleEn, tagEn });
    events.push(normalizeEvent('codex', evt));
  }

  result.events = events;

  if (events.length > 0) {
    const confirmed = events.filter((e) => e.kind === 'confirmed')
      .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    if (confirmed.length > 0) result.lastReset = confirmed[0].datetime;
  }

  const sinceMatch = html.match(/TIME SINCE THE LAST BLESSING[\s\S]*?<p[^>]*>([^<]+)<\/p>/i);
  if (sinceMatch) result.timeSinceLast = stripTags(sinceMatch[1]);

  const ff = [...html.matchAll(/Final forecast:\s*(\d+)%/g)];
  if (ff.length >= 1) result.forecast24h = parseInt(ff[0][1]);
  if (ff.length >= 2) result.forecast48h = parseInt(ff[1][1]);

  const hitMatch = html.match(/(\d+)%\s*reset\s*hit\s*rate/i);
  if (hitMatch) result.hitRate = parseInt(hitMatch[1]);

  return result;
}

export const codexProvider = {
  id: 'codex',
  enabled: true,
  kvKey: 'codex:data',
  eventsKey: 'codex:events',
  apiPath: '/api/codex',
  notifyKinds: ['confirmed'],
  async fetchRaw(fetcher) {
    return fetcher(CODEX_URL);
  },
  parse(html, opts) {
    return parseCodexReset(html, opts);
  },
};
