'use strict';

/**
 * Self-ping loop that keeps Render's free tier from spinning down.
 * Render idles services after 15 minutes of no HTTP traffic — pinging
 * our own /health endpoint every 10 minutes resets that timer.
 */

const INTERVAL_MS = 10 * 60 * 1000;

let timer = null;

function inSleepWindow() {
  const start = parseInt(process.env.SLEEP_START_HOUR || '-1', 10);
  const end   = parseInt(process.env.SLEEP_END_HOUR   || '-1', 10);
  if (start < 0 || end < 0 || start === end) return false;
  const h = new Date().getHours();
  if (start <= end) return h >= start && h < end;
  return h >= start || h < end;
}

async function ping(selfUrl) {
  if (inSleepWindow()) {
    console.log('[keep-alive] in sleep window, skipping');
    return;
  }
  try {
    const res = await fetch(`${selfUrl}/health`);
    console.log(`[keep-alive] ${res.status} @ ${new Date().toISOString()}`);
  } catch (e) {
    console.warn('[keep-alive] ping failed:', e.message);
  }
}

function start(selfUrl) {
  if (timer) return;
  if (process.env.KEEP_ALIVE === 'false') {
    console.log('[keep-alive] disabled');
    return;
  }
  if (!selfUrl || selfUrl.includes('localhost') || selfUrl.includes('127.0.0.1')) {
    console.log('[keep-alive] local mode — not starting');
    return;
  }
  console.log(`[keep-alive] pinging ${selfUrl}/health every ${INTERVAL_MS / 60000} min`);
  ping(selfUrl);
  timer = setInterval(() => ping(selfUrl), INTERVAL_MS);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop };