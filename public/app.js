/**
 * AI 额度信号站 — 前端逻辑
 * 三厂快照都来自 /api/{product}，字段由同一次 whenreset /api/resets 解析而来。
 */

(function () {
  'use strict';

  const PRODUCTS = {
    codex: {
      title: 'Codex 额度重置监控',
      desc: '公开 Codex 额度重置与额度卡，和 Claude、Grok 来自同一次 whenreset.dev/api/resets。',
    },
    claude: {
      title: 'Claude Code 额度重置监控',
      desc: '公开 Claude 额度重置与额度卡。whenreset 不收录只改限额、不刷新计数的 policy。',
    },
    grok: {
      title: 'Grok 额度重置监控',
      desc: '公开 Grok 额度重置。下次估计来自历史间隔，不是个人额度倒计时，也不是官方日程。',
    },
  };

  const ESTIMATE_STATUS = {
    'historical-reference': '历史间隔参考',
    'no-data': '样本不足',
  };

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
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
    if (Number.isNaN(d.getTime())) return '';
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${mo}/${da}`;
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return '—';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    if (days > 0) return `${days} 天前`;
    if (hours > 0) return `${hours} 小时前`;
    return '刚刚';
  }

  function daysUntil(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(diff)) return null;
    const days = diff / 86400000;
    if (days < 0) return '已过估计时点';
    if (days < 1) return '不到 1 天';
    return `约 ${Math.round(days * 10) / 10} 天`;
  }

  function estimateStatus(estimate) {
    if (!estimate || !estimate.status) return '历史间隔参考';
    return ESTIMATE_STATUS[estimate.status] || estimate.status;
  }

  function localized(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value['zh-CN'] || value.zh || value.en || '';
  }

  function productFromHash() {
    const hash = (location.hash || '').replace('#', '');
    if (PRODUCTS[hash]) return hash;
    return 'codex';
  }

  function panelFor(product) {
    return document.getElementById('panel-' + product);
  }

  function role(panel, name) {
    return panel ? panel.querySelector('[data-role="' + name + '"]') : null;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : '';
  }

  function mountPanels() {
    const tpl = document.getElementById('panel-template');
    const host = document.getElementById('panels');
    Object.keys(PRODUCTS).forEach((id) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.id = 'panel-' + id;
      node.dataset.product = id;
      role(node, 'title').textContent = PRODUCTS[id].title;
      role(node, 'desc').textContent = PRODUCTS[id].desc;
      host.appendChild(node);
    });
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
        list.innerHTML = '<div class="event-card"><p style="color:var(--text-muted)">暂无数据。请先启动本地服务或等待 Cron 抓取。</p></div>';
      }
      return;
    }

    const timeSinceEl = role(panel, 'time-since');
    if (timeSinceEl) timeSinceEl.textContent = timeAgo(data.lastReset);

    const gapEl = role(panel, 'gap-value');
    if (gapEl) gapEl.textContent = data.medianGapDays != null ? `${data.medianGapDays} 天` : '—';

    const estimateEl = role(panel, 'estimate-value');
    const estimateSub = role(panel, 'estimate-sub');
    if (estimateEl) {
      estimateEl.textContent = data.estimatedNextAt ? daysUntil(data.estimatedNextAt) : '暂无';
    }
    if (estimateSub) {
      const bits = [];
      if (data.estimatedNextAt) bits.push(formatDate(data.estimatedNextAt));
      bits.push(estimateStatus(data.estimate));
      if (data.estimate && data.estimate.limitedHistory) bits.push('历史有限');
      estimateSub.textContent = bits.join(' · ');
    }

    const disclaimer = role(panel, 'disclaimer');
    if (disclaimer) {
      const note = data.estimateNote || '下次估计不是个人额度倒计时，也不是官方日程。';
      disclaimer.textContent = data.disclaimer ? `${note} ${data.disclaimer}` : note;
    }

    document.getElementById('lastCheck').textContent = data.fetchedAt ? `更新于 ${timeAgo(data.fetchedAt)}` : '';
    renderStats(role(panel, 'stats'), data);
    renderWatch(role(panel, 'watch'), data.watch);

    const events = data.events || [];
    const countEl = role(panel, 'event-count');
    if (countEl) countEl.textContent = `${events.length} 条记录`;
    const sorted = [...events].sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
    renderTimeline(role(panel, 'timeline'), sorted);
    renderEventList(list, sorted, product);
  }

  function statCard(label, value, title) {
    const shown = value == null || value === '' ? '—' : String(value);
    return `<div class="stat-card" title="${escapeHtml(title || '')}"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(shown)}</div></div>`;
  }

  function renderStats(el, data) {
    if (!el) return;
    const stats = data.stats || {};
    const baseline = data.estimate && data.estimate.baselineDays != null
      ? `${Math.round(data.estimate.baselineDays * 10) / 10} 天`
      : null;
    el.innerHTML = [
      statCard('累计重置', stats.resets ?? data.resetCount, 'stats.resets'),
      statCard('额度卡', stats.cards ?? data.cardCount, 'stats.cards'),
      statCard('近 30 天重置', stats.resetsLast30Days, 'stats.resetsLast30Days'),
      statCard('近 30 天额度卡', stats.cardsLast30Days, 'stats.cardsLast30Days'),
      statCard('间隔样本', stats.gapSamples, 'stats.gapSamples'),
      statCard('估计基线', baseline, 'estimate.baselineDays'),
      statCard('策略变更', data.policyChangeCount == null ? 0 : data.policyChangeCount, '上游没有 policy'),
    ].join('') + `<p class="stats-note">${escapeHtml(data.policyNote || 'whenreset 不提供 policy 事件。')}</p>`;
  }

  function renderWatch(el, watch) {
    if (!el) return;
    if (!watch) {
      el.className = 'watch-card is-empty';
      el.innerHTML = '<p class="watch-kicker">预告</p><p>当前没有开放预告。</p>';
      return;
    }
    const open = watch.open === true;
    el.className = open ? 'watch-card is-open' : 'watch-card is-closed';
    const title = localized(watch.title) || '额度预告';
    const timing = localized(watch.timingNote);
    const when = watch.scheduledAt ? formatDate(watch.scheduledAt) : '';
    const zone = watch.scheduledZoneLabel ? ` · ${watch.scheduledZoneLabel}` : '';
    const estimated = watch.scheduledAtEstimated ? '（时间是估计）' : '';
    const url = safeUrl(watch.url);
    const link = url ? `<a class="event-source" href="${escapeHtml(url)}" target="_blank" rel="noopener">查看预告 →</a>` : '';
    const status = open ? '预告开放' : '预告已结束';
    el.innerHTML = `
      <p class="watch-kicker">${status}</p>
      <p class="watch-title">${escapeHtml(title)}</p>
      ${timing ? `<p class="watch-text">${escapeHtml(timing)}</p>` : ''}
      <p class="watch-meta">${escapeHtml([when, zone, estimated].join(''))}${watch.name ? ` · ${escapeHtml(watch.name)}` : ''}</p>
      ${link}`;
  }

  function renderTimeline(tl, events) {
    if (!tl) return;
    if (!events.length) { tl.innerHTML = ''; return; }
    const ordered = [...events].sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    let html = '';
    let useTop = true;
    ordered.forEach((evt, i) => {
      const view = kindView(evt.kind);
      const side = useTop ? 'top' : 'bottom';
      const label = view.timeline ? `<span class="tl-label ${side} ${view.dot}">${view.timeline}</span>` : '';
      html += `
        <div class="tl-node" data-index="${i}">
          <div class="tl-dot ${view.dot}" title="${escapeHtml(formatDate(evt.datetime))}"></div>
          <span class="tl-date ${side}">${formatDateShort(evt.datetime)}</span>
          ${label}
        </div>`;
      useTop = !useTop;
    });
    tl.innerHTML = html;
  }

  function renderEventList(list, events, product) {
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<div class="event-card"><p style="color:var(--text-muted)">暂无公开记录</p></div>';
      return;
    }
    list.innerHTML = events.map((evt) => {
      const view = kindView(evt.kind);
      const title = evt.title || `${PRODUCTS[product] ? product : '信号'} 记录`;
      const meta = [];
      if (evt.scope) meta.push(chip('范围', evt.scope));
      if (evt.sourceName) meta.push(chip('来源', evt.sourceName));
      if (evt.tag) meta.push(`<span class="meta-chip meta-chip-tag">${escapeHtml(evt.tag)}</span>`);
      if (evt.authority) meta.push(chip('记录', evt.authority));
      return `
        <div class="event-card ${escapeHtml(evt.kind || '')}">
          <div class="event-top">
            <span class="event-title">${escapeHtml(title)}</span>
            <span class="event-tag ${escapeHtml(evt.kind || '')}">${view.tag}</span>
          </div>
          ${evt.description ? `<div class="event-summary">${escapeHtml(evt.description)}</div>` : ''}
          ${meta.length ? `<div class="event-meta-chips">${meta.join('')}</div>` : ''}
          <div class="event-bottom">
            <span class="event-time">${formatDate(evt.datetime)}</span>
            <span class="event-sources">${sourceLinks(evt)}</span>
          </div>
        </div>`;
    }).join('');
  }

  function chip(label, value) {
    return `<span class="meta-chip"><span class="meta-chip-label">${escapeHtml(label)}</span>${escapeHtml(value)}</span>`;
  }

  function sourceLinks(evt) {
    const sources = Array.isArray(evt.sources) && evt.sources.length
      ? evt.sources
      : (evt.sourceUrl ? [{ role: 'landed', url: evt.sourceUrl }] : []);
    return sources.map((source) => {
      const url = safeUrl(source.url);
      if (!url) return '';
      const roleName = source.role === 'followup' ? '后续' : '落地';
      const who = source.account ? ` @${source.account}` : '';
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="event-source">${roleName}${escapeHtml(who)} →</a>`;
    }).join('');
  }

  function kindView(kind) {
    switch (kind) {
      case 'confirmed':
        return { dot: 'confirmed', tag: '已确认重置', timeline: '重置' };
      case 'card':
        return { dot: 'card', tag: '额度卡', timeline: '额度卡' };
      case 'policy':
        return { dot: 'policy', tag: '策略变更', timeline: '策略' };
      default:
        return { dot: 'signal', tag: '信号 / 推文', timeline: '' };
    }
  }

  function switchProduct(product) {
    if (!PRODUCTS[product]) return;
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.product === product);
    });
    document.querySelectorAll('.panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.product === product);
    });
    if (location.hash.replace('#', '') !== product) {
      history.replaceState(null, '', '#' + product);
    }
    refresh(product);
  }

  function bindScroll() {
    document.querySelectorAll('[data-role="scroll-left"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scroller = role(btn.closest('.panel'), 'timeline-scroll');
        if (scroller) scroller.scrollBy({ left: -300, behavior: 'smooth' });
      });
    });
    document.querySelectorAll('[data-role="scroll-right"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scroller = role(btn.closest('.panel'), 'timeline-scroll');
        if (scroller) scroller.scrollBy({ left: 300, behavior: 'smooth' });
      });
    });
  }

  function bindWebhook() {
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
      status.textContent = '✓ 已保存到浏览器。请同时在 config.json 或 FEISHU_WEBHOOK Secret 中填入，服务端才会推送。';
      status.className = 'webhook-status ok';
    });
  }

  async function refresh(product) {
    const current = product || document.querySelector('.panel.active')?.dataset.product || 'codex';
    const data = await loadData(current);
    render(data, current);
  }

  mountPanels();
  bindScroll();
  bindWebhook();
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-product]');
    if (!btn || btn.disabled) return;
    switchProduct(btn.dataset.product);
  });
  window.addEventListener('hashchange', () => switchProduct(productFromHash()));
  switchProduct(productFromHash());
  setInterval(() => refresh(), 5 * 60 * 1000);
})();
