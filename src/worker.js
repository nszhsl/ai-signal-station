/**
 * AI 额度信号站 — Cloudflare Worker
 *
 * 职责：
 * 1. Cron（每30分钟）：一次拉取 whenreset /api/resets，分发 Codex / Claude / Grok，存 KV，新重置/额度卡与 watch 变更推飞书
 * 2. GET /api/{product}：返回该产品 KV 快照（供前端读取）
 * 3. 其他请求：提供静态前端（public/ 目录）
 */

import { fetchText } from './lib/http.js';
import { runEnabledProviders } from './lib/monitor.js';
import { sendFeishu } from './lib/feishu.js';
import { getEnabledProviders, getProviderByApiPath } from './lib/providers/index.js';

function workerStore(env) {
  return {
    get: (key) => env.DATA.get(key),
    put: (key, value) => env.DATA.put(key, value),
  };
}

function runMonitor(env) {
  return runEnabledProviders(getEnabledProviders(), {
    store: workerStore(env),
    fetchText,
    webhook: env.FEISHU_WEBHOOK,
    sendCard: sendFeishu,
    watchNotify: env.WATCH_NOTIFY,
  });
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const provider = getProviderByApiPath(url.pathname);
    if (provider) {
      const raw = await env.DATA.get(provider.kvKey);
      const data = raw ? JSON.parse(raw) : { events: [] };
      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=120',
        },
      });
    }

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

    return env.ASSETS.fetch(request);
  },
};
