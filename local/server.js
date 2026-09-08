/**
 * AI 额度信号站 — 本地运行版（无需 Cloudflare）
 *
 * 功能：
 *   1. 启动后每 30 分钟抓取 enabled providers，写入 local/data/
 *   2. 同时提供 HTTP 服务，托管 public/ 下的前端和 /api/{product} 接口
 *   3. 检测到新的确认重置时推送到飞书
 *
 * 用法：
 *   node local/server.js
 *   # 打开 http://localhost:8860
 *
 * 配置：
 *   复制 local/config.example.json 为 local/config.json，填入飞书 Webhook。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText } from '../src/lib/http.js';
import { sendFeishu } from '../src/lib/feishu.js';
import { runEnabledProviders } from '../src/lib/monitor.js';
import { getEnabledProviders, getProviderByApiPath } from '../src/lib/providers/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'local', 'data');
const CONFIG_PATH = path.join(ROOT, 'local', 'config.json');
const PORT = process.env.PORT || 8860;
const POLL_INTERVAL = 30 * 60 * 1000;

const KEY_FILES = {
  'codex:data': 'codex.json',
  'codex:events': 'codex-events.json',
  'claude:data': 'claude.json',
  'claude:events': 'claude-events.json',
};

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch { return fallback; }
}

function fileStore(dataDir) {
  return {
    async get(key) {
      const file = KEY_FILES[key];
      if (!file) return null;
      try { return fs.readFileSync(path.join(dataDir, file), 'utf-8'); }
      catch { return null; }
    },
    async put(key, value) {
      const file = KEY_FILES[key];
      if (!file) return;
      fs.mkdirSync(dataDir, { recursive: true });
      let pretty = value;
      try { pretty = JSON.stringify(JSON.parse(value), null, 2); }
      catch { /* keep raw */ }
      fs.writeFileSync(path.join(dataDir, file), pretty);
    },
  };
}

async function runMonitor() {
  const config = readJSON(CONFIG_PATH, { feishu_webhook: '' });
  const now = new Date().toISOString();
  console.log(`[${now}] 开始检查...`);
  const results = await runEnabledProviders(getEnabledProviders(), {
    store: fileStore(DATA_DIR),
    fetchText,
    webhook: config.feishu_webhook,
    sendCard: sendFeishu,
    now,
  });
  for (const result of results) {
    if (result.error) console.error(`  ${result.id} 失败: ${result.error}`);
    else console.log(`  ${result.id}: 新事件 ${result.newEvents}，推送 ${result.notified}`);
  }
  return results;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const provider = getProviderByApiPath(url.pathname);
  if (provider) {
    const raw = await fileStore(DATA_DIR).get(provider.kvKey);
    const data = raw ? JSON.parse(raw) : { events: [] };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(data));
    return;
  }

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
  runMonitor().catch((e) => console.error('监控失败:', e));
  setInterval(() => runMonitor().catch((e) => console.error('监控失败:', e)), POLL_INTERVAL);
});
