function productPrefix(product) {
  switch (product) {
    case 'codex':
      return 'Codex';
    case 'claude':
      return 'Claude';
    default: {
      const _unknown = product;
      return _unknown ? String(_unknown) : 'Signal';
    }
  }
}

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
      const _unknown = kind;
      void _unknown;
      return { label: '🔵 重置信号', color: 'blue' };
    }
  }
}

export function buildFeishuCard(product, event) {
  const dt = new Date(event.datetime);
  const bj = new Date(dt.getTime() + 8 * 3600000);
  const timeStr = bj.toISOString().replace('T', ' ').slice(0, 16) + ' 北京时间';

  const isConfirmed = event.kind === 'confirmed';
  const { label: kindLabel, color: kindColor } = kindPresentation(event.kind);

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
      title: { tag: 'plain_text', content: `[${productPrefix(product)}] ${kindLabel}` },
      template: kindColor,
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
