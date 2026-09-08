/**
 * AI 额度信号站 — 前端逻辑
 */

(function () {
  'use strict';

  const EMPTY_COPY = '暂无公开全球重置信号';
  const FOOTER = {
    codex: '数据来源 <a href="https://codexreset.org/" target="_blank" rel="noopener">codexreset.org</a> · 仅供参考，不代表官方口径',
    claude: '数据来源 <a href="https://claude-resets.com/" target="_blank" rel="noopener">claude-resets.com</a> · 仅供参考，不代表官方口径',
  };

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
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
    const dayMatch = text.match(/(\d+)\s+days?\s+ago/i);
    if (dayMatch) return `${dayMatch[1]} 天前`;
    const hrMatch = text.match(/(\d+)\s+hours?\s+ago/i);
    if (hrMatch) return `${hrMatch[1]} 小时前`;
    if (/just now/i.test(text)) return '刚刚';
    return text;
  }

  function setRing(pct, ring) {
    if (!ring || pct == null) return;
    const circ = 2 * Math.PI * 52;
    const offset = circ - (pct / 100) * circ;
    ring.style.strokeDasharray = circ;
    ring.style.strokeDashoffset = offset;
  }

  function productFromHash() {
    const hash = (location.hash || '').replace('#', '');
    if (hash === 'claude' || hash === 'codex') return hash;
    return 'codex';
  }

  function panelFor(product) {
    return document.getElementById('panel-' + product);
  }

  function role(panel, name) {
    return panel ? panel.querySelector('[data-role="' + name + '"]') : null;
  }

  function hasForecast(data) {
    return data && (data.forecast24h != null || data.forecast48h != null);
  }

  async function loadData(product) {
    try {
      const resp = await fetch('/api/' + product + '?t=' + Date.now());
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return await resp.json();
    } catch (err) {
      console.error('加载数据失败:', err);
      return null;
    }
  }

  function render(data, product) {
    const panel = panelFor(product);
    if (!panel) return;

    const list = role(panel, 'event-list');
    if (!data) {
      if (list) {
        list.innerHTML =
          '<div class="event-card"><p style="color:var(--text-muted)">暂无数据。请先启动本地服务或等待 Cron 抓取。</p></div>';
      }
      return;
    }

    const timeSinceEl = role(panel, 'time-since');
    if (timeSinceEl) {
      timeSinceEl.textContent = translateTimeSince(data.timeSinceLast) || timeAgo(data.lastReset);
    }

    const secondary = role(panel, 'secondary-value');
    if (secondary) {
      if (product === 'claude') {
        secondary.textContent = data.resetCount != null ? String(data.resetCount) : '—';
      } else {
        secondary.textContent = data.hitRate != null ? `${data.hitRate}%` : '—';
      }
    }

    const rings = role(panel, 'forecast-rings');
    if (rings) rings.hidden = !hasForecast(data);
    if (hasForecast(data)) {
      const pct24 = role(panel, 'pct-24h');
      const pct48 = role(panel, 'pct-48h');
      if (pct24) pct24.textContent = data.forecast24h != null ? data.forecast24h + '%' : '—';
      if (pct48) pct48.textContent = data.forecast48h != null ? data.forecast48h + '%' : '—';
      setTimeout(() => {
        setRing(data.forecast24h || 0, role(panel, 'ring-24h'));
        setRing(data.forecast48h || 0, role(panel, 'ring-48h'));
      }, 100);
    }

    document.getElementById('lastCheck').textContent =
      data.fetchedAt ? `更新于 ${timeAgo(data.fetchedAt)}` : '';

    const events = data.events || [];
    const countEl = role(panel, 'event-count');
    if (countEl) countEl.textContent = `${events.length} 条记录`;

    const sorted = [...events].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    renderTimeline(role(panel, 'timeline'), sorted);
    renderEventList(list, sorted, product);
  }

  function renderTimeline(tl, events) {
    if (!tl) return;
    if (!events.length) { tl.innerHTML = ''; return; }

    const ordered = [...events].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    let html = '';
    let useTop = true;

    ordered.forEach((evt, i) => {
      const isConfirmed = evt.kind === 'confirmed';
      const isPolicy = evt.kind === 'policy';
      const side = useTop ? 'top' : 'bottom';
      const dateLabel = formatDateShort(evt.datetime);
      const dotClass = isConfirmed ? 'confirmed' : (isPolicy ? 'policy' : 'signal');
      let label = '';
      if (isConfirmed && evt.label) {
        label = `<span class="tl-label ${side} confirmed">重置</span>`;
      } else if (isPolicy) {
        label = `<span class="tl-label ${side} policy">策略</span>`;
      }

      html += `
        <div class="tl-node" data-index="${i}">
          <div class="tl-dot ${dotClass}" title="${formatDate(evt.datetime)}"></div>
          <span class="tl-date ${side}">${dateLabel}</span>
          ${label}
        </div>`;
      useTop = !useTop;
    });

    tl.innerHTML = html;
  }

  function renderEventList(list, events, product) {
    if (!list) return;
    if (!events.length) {
      list.innerHTML = `<div class="event-card"><p style="color:var(--text-muted)">${EMPTY_COPY}</p></div>`;
      return;
    }

    list.innerHTML = events.map((evt) => {
      const isConfirmed = evt.kind === 'confirmed';
      const isPolicy = evt.kind === 'policy';
      const tagText = isConfirmed ? '已确认重置' : (isPolicy ? '策略变更' : '信号 / 推文');
      const fallbackTitle = product === 'claude'
        ? (isConfirmed ? 'Claude 额度重置' : (isPolicy ? 'Claude 策略变更' : 'Claude 信号'))
        : (isConfirmed ? 'Codex 额度重置' : '重置相关信号');
      const title = evt.title || fallbackTitle;
      const desc = evt.description || '';
      const source = evt.sourceUrl
        ? `<a href="${evt.sourceUrl}" target="_blank" rel="noopener" class="event-source">查看来源 →</a>`
        : '<span></span>';

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

  function switchProduct(product) {
    if (product !== 'codex' && product !== 'claude') return;
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.product === product);
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.product === product);
    });
    const footer = document.getElementById('footerSource');
    if (footer) footer.innerHTML = FOOTER[product] || FOOTER.codex;
    if (location.hash.replace('#', '') !== product) {
      history.replaceState(null, '', '#' + product);
    }
    refresh(product);
  }

  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-product]');
    if (!btn || btn.disabled || btn.classList.contains('disabled')) return;
    switchProduct(btn.dataset.product);
  });

  document.querySelectorAll('[data-role="scroll-left"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.panel');
      const scroller = role(panel, 'timeline-scroll');
      if (scroller) scroller.scrollBy({ left: -300, behavior: 'smooth' });
    });
  });
  document.querySelectorAll('[data-role="scroll-right"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.panel');
      const scroller = role(panel, 'timeline-scroll');
      if (scroller) scroller.scrollBy({ left: 300, behavior: 'smooth' });
    });
  });

  const webhookInput = document.getElementById('webhookInput');
  const saveBtn = document.getElementById('saveWebhook');
  const status = document.getElementById('webhookStatus');

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

    localStorage.setItem('feishu_webhook', url);
    status.textContent = '✓ 已保存到浏览器。请同时在 config.json 中填入 feishu_webhook 字段以启用服务端推送。';
    status.className = 'webhook-status ok';
  });

  async function refresh(product) {
    const current = product || document.querySelector('.panel.active')?.dataset.product || 'codex';
    const data = await loadData(current);
    render(data, current);
  }

  window.addEventListener('hashchange', () => switchProduct(productFromHash()));
  switchProduct(productFromHash());
  setInterval(() => refresh(), 5 * 60 * 1000);
})();
