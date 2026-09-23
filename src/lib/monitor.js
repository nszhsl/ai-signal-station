import { diffEvents, isNotifiable } from './events.js';
import { buildFeishuCard, buildFeishuWatchCard } from './feishu.js';
import { fetchWhenresetResets } from './whenreset.js';
import { classifyWatchTransition, normalizeWatchNotify } from './watch.js';

function hadStoredEvents(data) {
  return Array.isArray(data && data.events) && data.events.length > 0;
}

export function shouldBackfillQuietly(oldData, provider) {
  if (oldData && oldData.feed === 'whenreset') return false;
  if (!hadStoredEvents(oldData) && provider.notifyOnEmpty === false) return true;
  if (hadStoredEvents(oldData)) return true;
  return false;
}

async function notifyEvents(provider, events, deps) {
  const notifyKinds = provider.notifyKinds || ['confirmed'];
  const toNotify = events.filter((evt) => isNotifiable(evt, notifyKinds));
  let notified = 0;
  for (const evt of toNotify) {
    try {
      const card = buildFeishuCard(provider.id, evt);
      await deps.sendCard(deps.webhook, card);
      notified += 1;
    } catch (err) {
      console.error(`${provider.id} 飞书推送失败: ${err.message}`);
    }
  }
  return notified;
}

async function notifyWatch(provider, previousWatch, nextWatch, deps) {
  const action = classifyWatchTransition(previousWatch, nextWatch, deps.watchNotify);
  if (!action || !nextWatch) return { action: null, watchNotified: 0 };
  try {
    const card = buildFeishuWatchCard(provider.id, nextWatch, action);
    await deps.sendCard(deps.webhook, card);
    return { action, watchNotified: 1 };
  } catch (err) {
    console.error(`${provider.id} watch 飞书推送失败: ${err.message}`);
    return { action, watchNotified: 0 };
  }
}

export async function runProviderMonitor(provider, deps) {
  const {
    store,
    payload,
    webhook,
    sendCard,
    now,
  } = deps;
  if (!payload) throw new Error('missing whenreset payload');

  const nowIso = (now instanceof Date ? now : now ? new Date(now) : new Date()).toISOString();
  const parsed = provider.parse(payload, { now: nowIso });
  const oldRaw = await store.get(provider.kvKey);
  const oldData = oldRaw ? JSON.parse(oldRaw) : { events: [] };
  const newEvents = diffEvents(oldData.events || [], parsed.events || []);
  const seeded = shouldBackfillQuietly(oldData, provider);

  await store.put(provider.kvKey, JSON.stringify(parsed));
  console.log(`${provider.id}: 解析到 ${(parsed.events || []).length} 个事件，新事件 ${newEvents.length} 个`);

  if (newEvents.length > 0) {
    const oldEventsRaw = await store.get(provider.eventsKey);
    const allEvents = oldEventsRaw ? JSON.parse(oldEventsRaw) : [];
    for (const evt of newEvents) {
      allEvents.push({ ...evt, detectedAt: nowIso, product: provider.id });
    }
    await store.put(provider.eventsKey, JSON.stringify(allEvents));
  }

  const base = {
    id: provider.id,
    newEvents: newEvents.length,
    notified: 0,
    watchNotified: 0,
    watchAction: null,
    seeded,
    events: parsed.events || [],
  };

  if (seeded) {
    console.log(`${provider.id}: 回填 ${newEvents.length} 个事件，跳过推送以免回放历史`);
    return base;
  }

  if (!webhook || !sendCard) return base;

  const notified = await notifyEvents(provider, newEvents, deps);
  const watch = await notifyWatch(provider, oldData.watch || null, parsed.watch, deps);
  return {
    ...base,
    notified,
    watchNotified: watch.watchNotified,
    watchAction: watch.action,
  };
}

export async function runEnabledProviders(providers, deps) {
  const enabled = providers.filter((provider) => provider.enabled);
  let payload = deps.payload;
  if (!payload) {
    try {
      payload = await fetchWhenresetResets(deps.fetchText);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.error(`whenreset 抓取失败: ${message}`);
      return enabled.map((provider) => ({
        id: provider.id,
        error: message,
        newEvents: 0,
        notified: 0,
        watchNotified: 0,
      }));
    }
  }

  const watchNotify = normalizeWatchNotify(deps.watchNotify);
  const results = [];
  for (const provider of enabled) {
    try {
      results.push(await runProviderMonitor(provider, { ...deps, payload, watchNotify }));
    } catch (err) {
      console.error(`${provider.id} 监控失败: ${err.message}`);
      results.push({
        id: provider.id,
        error: err && err.message ? err.message : String(err),
        newEvents: 0,
        notified: 0,
        watchNotified: 0,
      });
    }
  }
  return results;
}
