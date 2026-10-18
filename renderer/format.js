'use strict';
/* Small text helpers shared by the main process and the widget. */
(function (root) {
  function countdown(ms, withSeconds) {
    ms = Math.max(0, ms);
    const d = Math.floor(ms / 86400e3);
    const h = Math.floor((ms % 86400e3) / 3600e3);
    const m = Math.floor((ms % 3600e3) / 60e3);
    const s = Math.floor((ms % 60e3) / 1000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return withSeconds ? `${h}h ${m}m ${String(s).padStart(2, '0')}s` : `${h}h ${m}m`;
    if (m > 0) return withSeconds ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`;
    return `${s}s`;
  }

  // "in 5h 20m" within a day, otherwise "Mon 12:00 PM".
  function when(resetsAt, now) {
    if (!resetsAt) return '';
    const left = resetsAt - now;
    if (left <= 24 * 3600e3) return 'in ' + countdown(left, false);
    const d = new Date(resetsAt);
    const day = d.toLocaleDateString('en-US', { weekday: 'short' });
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${day} ${t}`;
  }

  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    return `${Math.round(m / 60)}h ago`;
  }

  // Mood from the higher of session and weekly usage.
  function mood(p) {
    if (p === null || p === undefined) return 'happy';
    if (p >= 100) return 'asleep';
    if (p >= 95) return 'panic';
    if (p >= 80) return 'worried';
    if (p >= 50) return 'okay';
    return 'happy';
  }

  const api = { countdown, when, ago, mood };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TTFormat = api;
})(typeof window !== 'undefined' ? window : globalThis);
