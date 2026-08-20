/**
 * AI 额度信号站 — Cloudflare Worker
 *
 * 职责：
 * 1. Cron（每30分钟）：抓取 codexreset.org → 解析 → 存 KV → 新重置推飞书
 * 2. GET /api/codex：返回 KV 中的 JSON 数据（供前端读取）
 * 3. 其他请求：提供静态前端（public/ 目录）
 */

// ─── 配置（通过环境变量/Secret注入） ───
// FEISHU_WEBHOOK: 飞书机器人 Webhook URL（在 Cloudflare Dashboard 或 wrangler secret 设置）
// KV: DATA 绑定到 KV namespace

const CODEX_URL = 'https://codexreset.org/';
const KV_KEY = 'codex:data';
const KV_EVENTS_KEY = 'codex:events';

// ─── HTML 解析（从 monitor.js 移植） ───

function stripTags(s) {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function parseCodexReset(html) {
  const result = {
    fetchedAt: new Date().toISOString(),
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
    events.push(evt);
  }

  result.events = events;

  // 最后重置时间
  if (events.length > 0) {
    const confirmed = events.filter(e => e.kind === 'confirmed')
      .sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    if (confirmed.length > 0) result.lastReset = confirmed[0].datetime;
  }

  // 距上次重置
  const sinceMatch = html.match(/TIME SINCE THE LAST BLESSING[\s\S]*?<p[^>]*>([^<]+)<\/p>/i);
  if (sinceMatch) result.timeSinceLast = stripTags(sinceMatch[1]);

  // 预测概率
  const ff = [...html.matchAll(/Final forecast:\s*(\d+)%/g)];
  if (ff.length >= 1) result.forecast24h = parseInt(ff[0][1]);
  if (ff.length >= 2) result.forecast48h = parseInt(ff[1][1]);

  // 命中率
  const hitMatch = html.match(/(\d+)%\s*reset\s*hit\s*rate/i);
  if (hitMatch) result.hitRate = parseInt(hitMatch[1]);

  return result;
}

// ─── 飞书推送 ───

function buildResetCard(event) {
  const dt = new Date(event.datetime);
  const bj = new Date(dt.getTime() + 8 * 3600000);
  const timeStr = bj.toISOString().replace('T', ' ').slice(0, 16) + ' 北京时间';

  const isConfirmed = event.kind === 'confirmed';
  const kindLabel = isConfirmed ? '🟢 额度重置确认' : '🔵 重置信号';
  const kindColor = isConfirmed ? 'green' : 'blue';

  const fields = [
    { is_short: true, text: { tag: 'lark_md', content: `**时间**\n${timeStr}` } },
    { is_short: true, text: { tag: 'lark_md', content: `**类型**\n${event.label || (isConfirmed ? '已确认重置' : '信号')}` } },
  ];
  if (event.scope) {
    fields.push({ is_short: true, text: { tag: 'lark_md', content: `**范围**\n${event.scope}` } });
  }
  if (event.sourceName) {
    fields.push({ is_short: true, text: { tag: 'lark_md', content: `**来源**\n${event.sourceName}` } });
  }
  if (event.tag) {
    fields.push({ is_short: true, text: { tag: 'lark_md', content: `**分类**\n${event.tag}` } });
  }

  const elements = [{ tag: 'div', fields }];

  if (event.title) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${event.title}**` } });
  }
  if (event.description) {
    const desc = event.description.length > 300 ? event.description.slice(0, 300) + '...' : event.description;
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: desc } });
  }
  if (event.sourceUrl) {
    elements.push({
      tag: 'action',
      actions: [{
        tag: 'button',
        text: { tag: 'plain_text', content: '查看来源推文' },
        type: 'primary',
        url: event.sourceUrl,
      }],
    });
  }

  return {
    header: {
      title: { tag: 'plain_text', content: `[Codex] ${kindLabel}` },
      template: kindColor,
    },
    elements,
  };
}

async function sendFeishu(webhookUrl, card) {
  const payload = JSON.stringify({ msg_type: 'interactive', card });
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  return resp.text();
}

// ─── 定时监控任务 ───

async function runMonitor(env) {
  console.log('开始监控检查...');

  const resp = await fetch(CODEX_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const html = await resp.text();
  console.log(`抓取成功，HTML 长度: ${html.length}`);

  const parsed = parseCodexReset(html);
  console.log(`解析到 ${parsed.events.length} 个事件`);

  // 读取旧数据
  const oldRaw = await env.DATA.get(KV_KEY);
  const oldData = oldRaw ? JSON.parse(oldRaw) : { events: [] };
  const oldDatetimes = new Set((oldData.events || []).map(e => e.datetime));

  const newEvents = parsed.events.filter(e => !oldDatetimes.has(e.datetime));
  console.log(`新事件: ${newEvents.length} 个`);

  // 保存最新数据
  await env.DATA.put(KV_KEY, JSON.stringify(parsed));

  if (newEvents.length === 0) {
    console.log('没有新事件，完成。');
    return;
  }

  // 记录事件历史
  const oldEventsRaw = await env.DATA.get(KV_EVENTS_KEY);
  const allEvents = oldEventsRaw ? JSON.parse(oldEventsRaw) : [];
  for (const evt of newEvents) {
    allEvents.push({ ...evt, detectedAt: new Date().toISOString(), product: 'codex' });
  }
  await env.DATA.put(KV_EVENTS_KEY, JSON.stringify(allEvents));

  // 推送飞书
  const webhook = env.FEISHU_WEBHOOK;
  if (!webhook) {
    console.log('未配置 FEISHU_WEBHOOK，跳过推送。');
    return;
  }

  const toNotify = newEvents.filter(e => e.kind === 'confirmed');
  console.log(`需要推送 ${toNotify.length} 个确认重置事件`);

  for (const evt of toNotify) {
    try {
      const card = buildResetCard(evt);
      const result = await sendFeishu(webhook, card);
      console.log(`飞书推送结果: ${result.slice(0, 200)}`);
    } catch (err) {
      console.error(`飞书推送失败: ${err.message}`);
    }
  }
}

// ─── Worker 入口 ───

export default {
  // Cron 定时触发
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  // HTTP 请求
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // API：返回 Codex 数据
    if (url.pathname === '/api/codex') {
      const raw = await env.DATA.get(KV_KEY);
      const data = raw ? JSON.parse(raw) : { events: [] };
      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=120',
        },
      });
    }

    // 手动触发监控（可选，需要密钥保护）
    if (url.pathname === '/api/trigger') {
      const auth = url.searchParams.get('key');
      if (auth !== env.TRIGGER_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }
      ctx.waitUntil(runMonitor(env));
      return new Response(JSON.stringify({ ok: true, message: '监控已触发' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 静态前端
    return env.ASSETS.fetch(request);
  },
};
