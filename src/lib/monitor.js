import { diffEvents } from './events.js';
import { buildFeishuCard } from './feishu.js';

export async function runProviderMonitor(provider, deps) {
  const {
    store,
    fetchText,
    webhook,
    sendCard,
    now,
  } = deps;

  const nowIso = (now instanceof Date ? now : now ? new Date(now) : new Date()).toISOString();
  const raw = await provider.fetchRaw(fetchText, { store });
  const parsed = provider.parse(raw, { now: nowIso });

  const oldRaw = await store.get(provider.kvKey);
  const oldData = oldRaw ? JSON.parse(oldRaw) : { events: [] };
  const newEvents = diffEvents(oldData.events || [], parsed.events || []);

  const payload = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  await store.put(provider.kvKey, payload);

  console.log(`${provider.id}: 解析到 ${(parsed.events || []).length} 个事件，新事件 ${newEvents.length} 个`);

  if (newEvents.length === 0) {
    return { id: provider.id, newEvents: 0, notified: 0, events: parsed.events || [] };
  }

  const oldEventsRaw = await store.get(provider.eventsKey);
  const allEvents = oldEventsRaw ? JSON.parse(oldEventsRaw) : [];
  for (const evt of newEvents) {
    allEvents.push({ ...evt, detectedAt: nowIso, product: provider.id });
  }
  await store.put(provider.eventsKey, JSON.stringify(allEvents));

  if (!webhook || !sendCard) {
    return { id: provider.id, newEvents: newEvents.length, notified: 0, events: parsed.events || [] };
  }

  const hadHistory = Array.isArray(oldData.events) && oldData.events.length > 0;
  if (!hadHistory && provider.notifyOnEmpty === false) {
    console.log(`${provider.id}: 首次回填 ${newEvents.length} 个事件，跳过推送以免回放历史`);
    return { id: provider.id, newEvents: newEvents.length, notified: 0, seeded: true, events: parsed.events || [] };
  }

  const notifyKinds = provider.notifyKinds || ['confirmed'];
  const toNotify = newEvents.filter((evt) => notifyKinds.includes(evt.kind));
  let notified = 0;

  for (const evt of toNotify) {
    try {
      const card = buildFeishuCard(provider.id, evt);
      await sendCard(webhook, card);
      notified += 1;
    } catch (err) {
      console.error(`${provider.id} 飞书推送失败: ${err.message}`);
    }
  }

  return { id: provider.id, newEvents: newEvents.length, notified, events: parsed.events || [] };
}

export async function runEnabledProviders(providers, deps) {
  const results = [];
  for (const provider of providers) {
    if (!provider.enabled) continue;
    try {
      results.push(await runProviderMonitor(provider, deps));
    } catch (err) {
      console.error(`${provider.id} 监控失败: ${err.message}`);
      results.push({
        id: provider.id,
        error: err && err.message ? err.message : String(err),
        newEvents: 0,
        notified: 0,
      });
    }
  }
  return results;
}
