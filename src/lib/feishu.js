import { localizedText, productName } from './whenreset.js';

function kindPresentation(kind) {
  switch (kind) {
    case 'confirmed':
      return { label: '🟢 额度重置确认', color: 'green' };
    case 'card':
      return { label: '🟢 额度卡发放', color: 'green' };
    case 'policy':
      return { label: '🟡 策略变更', color: 'yellow' };
    case 'post':
      return { label: '🔵 重置信号', color: 'blue' };
    default: {
      const unknown = kind;
      void unknown;
      return { label: '🔵 重置信号', color: 'blue' };
    }
  }
}

function watchPresentation(action) {
  switch (action) {
    case 'open':
      return { label: '🔵 预告开放', color: 'blue' };
    case 'change':
      return { label: '🔵 预告更新', color: 'blue' };
    case 'complete':
      return { label: '⚪ 预告已结束', color: 'grey' };
    default: {
      const unknown = action;
      void unknown;
      return { label: '🔵 预告', color: 'blue' };
    }
  }
}

function field(label, value) {
  return { is_short: true, text: { tag: 'lark_md', content: `**${label}**\n${value}` } };
}

function sourceButton(label, url) {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type: 'primary',
    url,
  };
}

function eventSources(event) {
  const sources = Array.isArray(event.sources) ? event.sources.filter((source) => source && source.url) : [];
  if (sources.length === 0 && event.sourceUrl) {
    sources.push({ role: 'landed', url: event.sourceUrl, account: event.sourceName });
  }
  return sources;
}

function sourceRole(role) {
  switch (role) {
    case 'followup':
      return '后续';
    case 'landed':
      return '落地';
    default:
      return '来源';
  }
}

function beijingTime(iso) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '时间未知';
  const bj = new Date(dt.getTime() + 8 * 3600000);
  return `${bj.toISOString().replace('T', ' ').slice(0, 16)} 北京时间`;
}

export function buildFeishuCard(product, event) {
  const isConfirmed = event.kind === 'confirmed';
  const { label: kindLabel, color: kindColor } = kindPresentation(event.kind);
  const fields = [
    field('时间', beijingTime(event.datetime)),
    field('类型', event.label || (isConfirmed ? '已确认重置' : '信号')),
  ];
  if (event.scope) fields.push(field('范围', event.scope));
  if (event.sourceName) fields.push(field('来源', event.sourceName));
  if (event.tag) fields.push(field('分类', event.tag));

  const elements = [{ tag: 'div', fields }];
  if (event.title) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${event.title}**` } });
  }
  if (event.description) {
    const desc = event.description.length > 300 ? `${event.description.slice(0, 300)}...` : event.description;
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: desc } });
  }

  const sources = eventSources(event);
  if (sources.length > 1) {
    const lines = sources.map((source) => {
      const who = source.account ? ` @${source.account}` : '';
      return `- ${sourceRole(source.role)}${who}：${source.url}`;
    }).join('\n');
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**来源帖**\n${lines}` } });
  }
  if (sources.length > 0) {
    elements.push({
      tag: 'action',
      actions: sources.slice(0, 3).map((source, index) => sourceButton(
        sources.length === 1 ? '查看来源推文' : `${sourceRole(source.role)}${index > 0 ? ` ${index}` : ''}`,
        source.url,
      )),
    });
  }

  return {
    header: {
      title: { tag: 'plain_text', content: `[${productName(product)}] ${kindLabel}` },
      template: kindColor,
    },
    elements,
  };
}

export function buildFeishuWatchCard(product, watch, action) {
  const { label, color } = watchPresentation(action);
  const title = localizedText(watch.title) || '额度预告';
  const timing = localizedText(watch.timingNote);
  const fields = [];
  if (watch.scheduledAt) fields.push(field('预告时间', beijingTime(watch.scheduledAt)));
  if (watch.type) fields.push(field('类型', watch.type === 'card' ? '额度卡' : '额度重置'));
  if (watch.name || watch.account) fields.push(field('来源', watch.name || watch.account));
  const elements = [];
  if (fields.length) elements.push({ tag: 'div', fields });
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${title}**` } });
  if (timing) elements.push({ tag: 'div', text: { tag: 'lark_md', content: timing } });
  if (action === 'complete') {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '这条预告已结束。落地的重置或额度卡会另行通知。' } });
  }
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: '这是公开预告，不是个人额度倒计时，也不是官方日程。' },
  });
  if (watch.url) {
    elements.push({ tag: 'action', actions: [sourceButton('查看预告', watch.url)] });
  }
  return {
    header: {
      title: { tag: 'plain_text', content: `[${productName(product)}] ${label}` },
      template: color,
    },
    elements,
  };
}

export async function sendFeishu(webhookUrl, card) {
  const payload = JSON.stringify({ msg_type: 'interactive', card });
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  return resp.text();
}
