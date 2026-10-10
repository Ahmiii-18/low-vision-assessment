(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 2500);
  }

  /* ---------------- search ---------------- */
  const searchBox = $('#searchBox');
  if (searchBox) {
    const params = new URLSearchParams(location.search);
    if (params.get('q')) searchBox.value = params.get('q');
    applySearch(searchBox.value);

    let debounce;
    searchBox.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => applySearch(searchBox.value), 120);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchBox) {
        e.preventDefault();
        searchBox.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchBox) {
        searchBox.value = '';
        applySearch('');
        searchBox.blur();
      }
    });
  }

  function applySearch(q) {
    q = (q || '').toLowerCase().trim();

    const url = new URL(location.href);
    if (q) url.searchParams.set('q', q);
    else url.searchParams.delete('q');
    history.replaceState(null, '', url);

    const table = $('#dataTable');
    if (!table) return;

    let visible = 0;
    $$('#dataTable tbody tr.expandable').forEach((tr) => {
      const hay = tr.textContent.toLowerCase();
      const match = !q || hay.includes(q);
      tr.style.display = match ? '' : 'none';
      const detail = $(`tr[data-parent="${tr.dataset.id}"]`);
      if (detail) detail.style.display = 'none';
      if (match) visible++;
    });

    let el = $('#noResultsMsg');
    if (visible === 0) {
      if (!el) {
        el = document.createElement('div');
        el.id = 'noResultsMsg';
        el.className = 'no-results';
        el.textContent = 'No participants match your search.';
        $('.table-wrap')?.appendChild(el);
      }
    } else if (el) el.remove();
  }

  /* ---------------- sorting ---------------- */
  $$('#dataTable th[data-key]').forEach((th) => {
    let asc = true;
    th.addEventListener('click', () => {
      const tbody = $('#dataTable tbody');
      if (!tbody) return;

      const idx = [...th.parentNode.children].indexOf(th);
      const rows = $$('#dataTable tbody tr.expandable');

      rows.sort((a, b) => {
        const av = a.children[idx]?.textContent.trim() ?? '';
        const bv = b.children[idx]?.textContent.trim() ?? '';
        const an = parseFloat(av);
        const bn = parseFloat(bv);
        const cmp = (!isNaN(an) && !isNaN(bn))
          ? an - bn
          : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
        return asc ? cmp : -cmp;
      });

      rows.forEach((r) => {
        const d = $(`tr[data-parent="${r.dataset.id}"]`);
        tbody.appendChild(r);
        if (d) tbody.appendChild(d);
      });

      $$('#dataTable th .arrow').forEach((a) => (a.textContent = ''));
      const arrow = th.querySelector('.arrow');
      if (arrow) arrow.textContent = asc ? '▲' : '▼';

      const url = new URL(location.href);
      url.searchParams.set('sort', th.dataset.key);
      url.searchParams.set('dir', asc ? 'asc' : 'desc');
      history.replaceState(null, '', url);

      asc = !asc;
    });
  });

  /* ---------------- row expand ---------------- */
  $$('#dataTable tbody tr.expandable').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a, button')) return;
      const detail = $(`tr[data-parent="${tr.dataset.id}"]`);
      if (!detail) return;

      const isOpen = detail.style.display !== 'none';
      if (isOpen) {
        detail.style.display = 'none';
        tr.classList.remove('open');
      } else {
        $$('#dataTable tbody tr.detail-row').forEach((d) => (d.style.display = 'none'));
        $$('#dataTable tbody tr.expandable').forEach((t) => t.classList.remove('open'));
        detail.style.display = '';
        tr.classList.add('open');
      }
    });
  });

  /* ---------------- copy row as TSV ---------------- */
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      const focused = $('tr.expandable.open');
      if (!focused) return;
      const detail = $(`tr[data-parent="${focused.dataset.id}"]`);
      if (!detail) return;

      const lines = [];
      $$('tr', detail).forEach((row) => {
        const cells = $$('td, th', row).map((c) => c.textContent.trim());
        lines.push(cells.join('\t'));
      });

      navigator.clipboard.writeText(lines.join('\n'))
        .then(() => toast('Row copied as TSV', 'ok'))
        .catch(() => toast('Copy failed', 'error'));
      e.preventDefault();
    }
  });

  /* ---------------- live feed ---------------- */
  const liveFeed = $('#liveFeed');
  const liveDot  = $('#liveDot');

  function pushFeed(html, cls) {
    if (!liveFeed) return;
    const div = document.createElement('div');
    div.className = 'event ' + (cls || '');
    div.innerHTML = html;
    liveFeed.prepend(div);
    while (liveFeed.children.length > 30) liveFeed.lastElementChild.remove();
  }

  let reloadTimer = null;
  function scheduleReload(delay = 2500) {
    if (reloadTimer) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      location.reload();
    }, delay);
  }

  if (typeof io !== 'undefined') {
    const socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => {
      if (liveDot) liveDot.style.background = 'var(--green)';
      socket.emit('watch:global');
      pushFeed('🟢 Connected to live feed', 'ok');
    });

    socket.on('disconnect', () => {
      if (liveDot) liveDot.style.background = 'var(--red)';
      pushFeed('🔴 Disconnected — reconnecting…', 'error');
    });

    socket.on('reconnect', () => pushFeed('🟢 Reconnected', 'ok'));

    socket.on('task:new', (ev) => {
      const badgeClass =
        ev.skipped ? 'skip' :
        ev.correct === null ? 'none' :
        ev.correct ? 'ok' : 'no';
      const badgeText =
        ev.skipped ? 'Skipped' :
        ev.correct === null ? '—' :
        ev.correct ? 'Correct' : 'Incorrect';

      pushFeed(
        `<strong>P${escapeHtml(ev.participant_code)}</strong>
         · Task ${ev.task_number} <em>${escapeHtml(ev.task_name)}</em>
         · <span class="badge ${badgeClass}">${badgeText}</span>
         <span class="feed-time">${fmtTime(ev.ts)}</span>`,
        badgeClass
      );

      const row = $(`tr.expandable[data-id="${ev.participant_id}"]`);
      if (row) {
        const tasksCell = row.children[5];
        if (tasksCell) {
          const parts = tasksCell.textContent.trim().split('/');
          const done = parseInt(parts[0], 10) + 1;
          tasksCell.textContent = `${done}/${parts[1] || 18}`;
        }
        if (ev.skipped) {
          const skipCell = row.children[6];
          if (skipCell && skipCell.textContent.trim() === '—') {
            skipCell.innerHTML = '<span class="badge skip">1</span>';
          } else if (skipCell) {
            const m = skipCell.textContent.match(/(\d+)/);
            const n = m ? parseInt(m[1], 10) + 1 : 2;
            skipCell.innerHTML = `<span class="badge skip">${n}</span>`;
          }
        }
        const detail = $(`tr[data-parent="${ev.participant_id}"]`);
        if (detail && detail.style.display !== 'none') {
          const cellRow = $$('tbody tr', detail)[ev.task_number - 1];
          if (cellRow) {
            const cells = cellRow.children;
            if (cells[2]) cells[2].textContent = ev.response || '—';
            if (cells[3]) {
              cells[3].innerHTML = `<span class="badge ${badgeClass}">${badgeText}</span>`;
            }
          }
        }
      }
    });

    socket.on('participant:created', (ev) => {
      pushFeed(`👤 New participant <strong>${escapeHtml(ev.participantId)}</strong> created`, 'ok');
      scheduleReload();
    });

    socket.on('participant:deleted', (ev) => {
      const row = $(`tr.expandable[data-id="${ev.id}"]`);
      if (row) {
        row.style.opacity = '0.4';
        pushFeed(`🗑 Participant <strong>#${ev.id}</strong> deleted`, 'error');
      }
      scheduleReload();
    });
  }

  /* ---------------- restore sort from URL ---------------- */
  (function restoreSort() {
    const params = new URLSearchParams(location.search);
    const sortKey = params.get('sort');
    const dir = params.get('dir');
    if (!sortKey) return;
    const th = $(`#dataTable th[data-key="${sortKey}"]`);
    if (!th) return;
    if (dir === 'desc') {
      th.click();
      th.click();
    } else {
      th.click();
    }
  })();

  /* ---------------- stats footer ---------------- */
  function updateStats() {
    const rows = $$('#dataTable tbody tr.expandable');
    if (rows.length === 0) return;

    let totalScore = 0;
    let totalScored = 0;
    let totalTasks = 0;

    rows.forEach((r) => {
      const scoreBadge = r.children[7]?.textContent.trim() || '';
      const m = scoreBadge.match(/(\d+)\/(\d+)/);
      if (m) {
        totalScore += parseInt(m[1], 10);
        totalScored += parseInt(m[2], 10);
      }
      const tasksBadge = r.children[5]?.textContent.trim() || '';
      const t = tasksBadge.match(/(\d+)\//);
      if (t) totalTasks += parseInt(t[1], 10);
    });

    const statsEl = $('#statsLine');
    if (statsEl) {
      const pct = totalScored > 0 ? Math.round((totalScore / totalScored) * 100) : 0;
      const completion = rows.length > 0
        ? Math.round((totalTasks / (rows.length * 18)) * 100)
        : 0;
      statsEl.textContent =
        `${rows.length} participants · ${totalTasks} responses · ` +
        `${pct}% correct · ${completion}% complete`;
    }
  }
  updateStats();

  window.__dataViewer = { applySearch, scheduleReload, toast };
  console.log('[data.js] ready');
})();