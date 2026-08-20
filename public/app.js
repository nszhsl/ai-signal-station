/**
 * AI 额度信号站 — 前端逻辑
 */

(function () {
  'use strict';

  // ─── 工具 ───

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    // 转为北京时间 UTC+8
    const bj = new Date(d.getTime() + 8 * 3600000);
    const mo = String(bj.getUTCMonth() + 1).padStart(2, '0');
    const da = String(bj.getUTCDate()).padStart(2, '0');
    const h = String(bj.getUTCHours()).padStart(2, '0');
    const mi = String(bj.getUTCMinutes()).padStart(2, '0');
    return `${mo}-${da} ${h}:${mi} 北京时间`;
  }

  function formatDateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${mo}/${da}`;
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return `${days} 天前`;
    if (hours > 0) return `${hours} 小时前`;
    return '刚刚';
  }

  function translateTimeSince(text) {
    if (!text) return null;
    // "6 days ago" → "6 天前"
    const dayMatch = text.match(/(\d+)\s+days?\s+ago/i);
    if (dayMatch) return `${dayMatch[1]} 天前`;
    const hrMatch = text.match(/(\d+)\s+hours?\s+ago/i);
    if (hrMatch) return `${hrMatch[1]} 小时前`;
    if (/just now/i.test(text)) return '刚刚';
    return text;
  }

  function setRing(pct, ringId) {
    const ring = document.getElementById(ringId);
    if (!ring || pct == null) return;
    const circ = 2 * Math.PI * 52; // ~326.7
    const offset = circ - (pct / 100) * circ;
    ring.style.strokeDasharray = circ;
    ring.style.strokeDashoffset = offset;
  }

  // ─── 加载数据 ───

  async function loadData() {
    try {
      const resp = await fetch('/api/codex?t=' + Date.now());
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json();
    } catch (err) {
      console.error('加载数据失败:', err);
      return null;
    }
  }

  // ─── 渲染 ───

  function render(data) {
    if (!data) {
      document.getElementById('eventList').innerHTML =
        '<div class="event-card"><p style="color:var(--text-muted)">暂无数据。请先运行 <code>node monitor.js</code> 抓取数据。</p></div>';
      return;
    }

    // Hero
    document.getElementById('timeSince').textContent =
      translateTimeSince(data.timeSinceLast) || timeAgo(data.lastReset);
    document.getElementById('hitRate').textContent =
      data.hitRate != null ? `${data.hitRate}%` : '—';

    // 预测环
    document.getElementById('pct24h').textContent = data.forecast24h != null ? data.forecast24h + '%' : '—';
    document.getElementById('pct48h').textContent = data.forecast48h != null ? data.forecast48h + '%' : '—';
    setTimeout(() => {
      setRing(data.forecast24h || 0, 'ring24h');
      setRing(data.forecast48h || 0, 'ring48h');
    }, 100);

    // 最后检查
    document.getElementById('lastCheck').textContent =
      data.fetchedAt ? `更新于 ${timeAgo(data.fetchedAt)}` : '';

    // 事件
    const events = data.events || [];
    document.getElementById('eventCount').textContent = `${events.length} 条记录`;

    // 按时间排序
    const sorted = [...events].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

    renderTimeline(sorted);
    renderEventList(sorted);
  }

  function renderTimeline(events) {
    const tl = document.getElementById('timeline');
    if (!events.length) { tl.innerHTML = ''; return; }

    // 时间线从左到右，旧→新
    const ordered = [...events].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    let html = '';
    let useTop = true;

    ordered.forEach((evt, i) => {
      const isConfirmed = evt.kind === 'confirmed';
      const side = useTop ? 'top' : 'bottom';
      const dateLabel = formatDateShort(evt.datetime);

      let label = '';
      if (isConfirmed && evt.label) {
        label = `<span class="tl-label ${side} confirmed">重置</span>`;
      }

      html += `
        <div class="tl-node" data-index="${i}">
          <div class="tl-dot ${isConfirmed ? 'confirmed' : 'signal'}" title="${formatDate(evt.datetime)}"></div>
          <span class="tl-date ${side}">${dateLabel}</span>
          ${label}
        </div>`;
      useTop = !useTop;
    });

    tl.innerHTML = html;
  }

  function renderEventList(events) {
    const list = document.getElementById('eventList');
    if (!events.length) {
      list.innerHTML = '<div class="event-card"><p style="color:var(--text-muted)">暂无事件</p></div>';
      return;
    }

    list.innerHTML = events.map(evt => {
      const isConfirmed = evt.kind === 'confirmed';
      const tagText = isConfirmed ? '已确认重置' : '信号 / 推文';
      const title = evt.title || (isConfirmed ? 'Codex 额度重置' : '重置相关信号');
      const desc = evt.description || '';
      const source = evt.sourceUrl
        ? `<a href="${evt.sourceUrl}" target="_blank" rel="noopener" class="event-source">查看来源 →</a>`
        : '<span></span>';

      // 元信息行：范围、来源、分类标签
      const metaItems = [];
      if (evt.scope) metaItems.push(`<span class="meta-chip"><span class="meta-chip-label">范围</span>${escapeHtml(evt.scope)}</span>`);
      if (evt.sourceName) metaItems.push(`<span class="meta-chip"><span class="meta-chip-label">来源</span>${escapeHtml(evt.sourceName)}</span>`);
      if (evt.tag) metaItems.push(`<span class="meta-chip meta-chip-tag">${escapeHtml(evt.tag)}</span>`);

      return `
        <div class="event-card ${evt.kind}">
          <div class="event-top">
            <span class="event-title">${escapeHtml(title)}</span>
            <span class="event-tag ${evt.kind}">${tagText}</span>
          </div>
          ${desc ? `<div class="event-summary">${escapeHtml(desc)}</div>` : ''}
          ${metaItems.length ? `<div class="event-meta-chips">${metaItems.join('')}</div>` : ''}
          <div class="event-bottom">
            <span class="event-time">${formatDate(evt.datetime)}</span>
            ${source}
          </div>
        </div>`;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── 时间线滚动 ───

  document.getElementById('scrollLeft').addEventListener('click', () => {
    document.getElementById('timelineScroll').scrollBy({ left: -300, behavior: 'smooth' });
  });
  document.getElementById('scrollRight').addEventListener('click', () => {
    document.getElementById('timelineScroll').scrollBy({ left: 300, behavior: 'smooth' });
  });

  // ─── Webhook 保存 ───

  const webhookInput = document.getElementById('webhookInput');
  const saveBtn = document.getElementById('saveWebhook');
  const status = document.getElementById('webhookStatus');

  // 从 localStorage 读取
  const saved = localStorage.getItem('feishu_webhook');
  if (saved) {
    webhookInput.value = saved;
    status.textContent = '✓ 已保存 Webhook';
    status.className = 'webhook-status ok';
  }

  saveBtn.addEventListener('click', () => {
    const url = webhookInput.value.trim();
    if (!url) {
      status.textContent = '请输入 Webhook URL';
      status.className = 'webhook-status err';
      return;
    }
    if (!url.startsWith('https://open.feishu.cn/open-apis/bot/v2/hook/') &&
        !url.startsWith('https://open.larksuite.com/open-apis/bot/v2/hook/')) {
      status.textContent = 'URL 格式不正确，应以 https://open.feishu.cn/open-apis/bot/v2/hook/ 开头';
      status.className = 'webhook-status err';
      return;
    }

    // 保存到 localStorage
    localStorage.setItem('feishu_webhook', url);

    // 同时发送给后端写入 config.json（通过 monitor 的一个轻量方式）
    // 由于是纯静态，这里只存 localStorage；monitor.js 读 config.json
    // 我们提供一个方式：尝试通过本地 API 写入，如果没有后端则只存本地
    status.textContent = '✓ 已保存到浏览器。请同时在 config.json 中填入 feishu_webhook 字段以启用服务端推送。';
    status.className = 'webhook-status ok';
  });

  // ─── 自动刷新 ───

  async function refresh() {
    const data = await loadData();
    render(data);
  }

  refresh();
  // 每 5 分钟刷新一次面板
  setInterval(refresh, 5 * 60 * 1000);
})();
