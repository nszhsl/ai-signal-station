/**
 * AI 额度信号站 — 本地运行版（无需 Cloudflare）
 *
 * 功能：
 *   1. 启动后每 30 分钟抓取 codexreset.org，写入 data/codex.json
 *   2. 同时提供 HTTP 服务，托管 public/ 下的前端和 /api/codex 接口
 *   3. 检测到新的确认重置时推送到飞书
 *
 * 用法：
 *   node local/server.js
 *   # 打开 http://localhost:8860
 *
 * 配置：
 *   复制 local/config.example.json 为 local/config.json，填入飞书 Webhook。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'local', 'data');
const CONFIG_PATH = path.join(ROOT, 'local', 'config.json');
const PORT = process.env.PORT || 8860;
const POLL_INTERVAL = 30 * 60 * 1000; // 30 分钟

// ─── 工具 ───

function fetch(urlStr) {
  return new Promise((resolve, reject) => {
    const mod = urlStr.startsWith('https') ? https : http;
    const req = mod.get(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── 解析逻辑（与 src/worker.js 保持一致） ───

function stripTags(s) {
  return s
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
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
  'Compensation': '故障补偿', 'Milestone': '里程碑',
  'Launch': '新品发布', 'Upward signal': '重置概率上升',
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
  for (const [p, zh] of SCOPE_ZH_RULES) { if (p.test(scope)) return zh; }
  return scope;
}

function translateSource(name) {
  if (!name) return null;
  return {
    'OpenAI Status': 'OpenAI 官方状态页',
    'OpenAI on X': 'OpenAI 官方推特',
    'Tibo on X': 'Tibo 推特（官方人员）',
    'Tibo / Codex Radar': 'Tibo / Codex Radar',
  }[name] || name;
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
      const m = titleEn.match(/(\d+)M/i);
      const users = m ? `${m[1]}00 万` : '';
      parts.push(`为庆祝${users ? users + ' ' : ''}活跃用户里程碑，官方于 ${dateStr} 宣布重置 ${scope}的 Codex 使用额度。所有受影响用户限额恢复满额。`);
    } else if (/launch/i.test(titleEn)) {
      parts.push(`配合新模型发布，官方于 ${dateStr} 为 ${scope}开启了双重置窗口，Codex 额度在短时间内连续重置两次。`);
    } else {
      parts.push(`官方于 ${dateStr} 对 ${scope}执行了全球额度重置，所有受影响用户的使用限额已恢复至满额。`);
    }
    if (evt.sourceName) parts.push(`消息来源：${evt.sourceName}。`);
  } else {
    parts.push(tagEn === 'Upward signal'
      ? `监控账号于 ${dateStr} 发布了可能预示近期重置的推文信号，24/48 小时重置概率有所上升。该信号尚待官方确认，不代表重置已发生。`
      : `监控账号于 ${dateStr} 发布的相关推文，已归档作为重置历史参考。`);
  }
  return parts.join('');
}

function parseCodexReset(html) {
  const result = {
    fetchedAt: new Date().toISOString(), lastReset: null, timeSinceLast: null,
    forecast24h: null, forecast48h: null, hitRate: null, sourcesResponding: null, events: [],
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
      datetime, kind, sourceUrl, titleEn, labelEn, tagEn, scopeEn, sourceNameEn,
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
  if (events.length) {
    const confirmed = events.filter(e => e.kind === 'confirmed').sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    if (confirmed.length) result.lastReset = confirmed[0].datetime;
  }
  const sinceMatch = html.match(/TIME SINCE THE LAST BLESSING[\s\S]*?<p[^>]*>([^<]+)<\/p>/i);
  if (sinceMatch) result.timeSinceLast = stripTags(sinceMatch[1]);
  const ff = [...html.matchAll(/Final forecast:\s*(\d+)%/g)];
  if (ff[0]) result.forecast24h = +ff[0][1];
  if (ff[1]) result.forecast48h = +ff[1][1];
  const hit = html.match(/(\d+)%\s*reset\s*hit\s*rate/i);
  if (hit) result.hitRate = +hit[1];
  return result;
}

// ─── 飞书推送 ───

function buildResetCard(event) {
  const bj = new Date(new Date(event.datetime).getTime() + 8 * 3600000);
  const timeStr = bj.toISOString().replace('T', ' ').slice(0, 16) + ' 北京时间';
  const fields = [
    { is_short: true, text: { tag: 'lark_md', content: `**时间**\n${timeStr}` } },
    { is_short: true, text: { tag: 'lark_md', content: `**类型**\n${event.label || '已确认重置'}` } },
  ];
  if (event.scope) fields.push({ is_short: true, text: { tag: 'lark_md', content: `**范围**\n${event.scope}` } });
  if (event.sourceName) fields.push({ is_short: true, text: { tag: 'lark_md', content: `**来源**\n${event.sourceName}` } });
  if (event.tag) fields.push({ is_short: true, text: { tag: 'lark_md', content: `**分类**\n${event.tag}` } });
  const elements = [{ tag: 'div', fields }];
  if (event.title) elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${event.title}**` } });
  if (event.description) elements.push({ tag: 'div', text: { tag: 'lark_md', content: event.description.slice(0, 300) } });
  if (event.sourceUrl) elements.push({
    tag: 'action',
    actions: [{ tag: 'button', text: { tag: 'plain_text', content: '查看来源推文' }, type: 'primary', url: event.sourceUrl }],
  });
  return {
    header: { title: { tag: 'plain_text', content: `[Codex] 🟢 额度重置确认` }, template: 'green' },
    elements,
  };
}

function sendFeishu(webhookUrl, card) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ msg_type: 'interactive', card });
    const url = new URL(webhookUrl);
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('feishu timeout')); });
    req.write(payload); req.end();
  });
}

// ─── 监控任务 ───

async function runMonitor() {
  const config = readJSON(CONFIG_PATH, { feishu_webhook: '' });
  const now = new Date().toISOString();
  console.log(`[${now}] 开始检查...`);
  const html = await fetch('https://codexreset.org/');
  const parsed = parseCodexReset(html);
  console.log(`  解析到 ${parsed.events.length} 个事件，最后重置: ${parsed.lastReset}`);

  const CODEX_FILE = path.join(DATA_DIR, 'codex.json');
  const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
  const old = readJSON(CODEX_FILE, { events: [] });
  const oldDts = new Set((old.events || []).map(e => e.datetime));
  const newEvents = parsed.events.filter(e => !oldDts.has(e.datetime));
  writeJSON(CODEX_FILE, parsed);
  console.log(`  新事件: ${newEvents.length}`);

  if (!newEvents.length) return;
  const allEvents = readJSON(EVENTS_FILE, []);
  newEvents.forEach(e => allEvents.push({ ...e, detectedAt: now, product: 'codex' }));
  writeJSON(EVENTS_FILE, allEvents);

  const webhook = config.feishu_webhook;
  if (!webhook) { console.log('  未配置飞书 Webhook，跳过推送'); return; }
  for (const evt of newEvents.filter(e => e.kind === 'confirmed')) {
    try {
      const r = await sendFeishu(webhook, buildResetCard(evt));
      console.log(`  飞书推送: HTTP ${r.status}`);
    } catch (e) { console.error(`  飞书推送失败: ${e.message}`); }
    await new Promise(r => setTimeout(r, 1000));
  }
}

// ─── HTTP 服务 ───

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API
  if (url.pathname === '/api/codex') {
    const data = readJSON(path.join(DATA_DIR, 'codex.json'), { events: [] });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(data));
    return;
  }

  // 静态文件
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  AI 额度信号站已启动: http://localhost:${PORT}`);
  console.log(`  数据目录: ${DATA_DIR}\n`);
  // 启动时立即执行一次
  runMonitor().catch(e => console.error('监控失败:', e));
  // 定时执行
  setInterval(() => runMonitor().catch(e => console.error('监控失败:', e)), POLL_INTERVAL);
});
