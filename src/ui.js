// DOM helpers: icons, 7-segment counters, the smiley, toasts, banner, modal.
export const $ = (id) => document.getElementById(id);

const sv = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICON = {
  menu: sv('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  zoomIn: sv('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20M10.5 8v5M8 10.5h5"/>'),
  zoomOut: sv('<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20M8 10.5h5"/>'),
  dig: sv('<path d="M18.5 5.5 11 13"/><path d="M16.5 3.5l4 4"/><path d="M10.6 10.6l2.8 2.8-4.6 4.6c-1.6 1.6-3.9 2.2-5.3 1.9-.3-1.4.3-3.7 1.9-5.3z" fill="currentColor" stroke="none"/>'),
  flag: sv('<path d="M6 21V3.5"/><path d="M6 4l12 4.5L6 13z" fill="currentColor"/>'),
  bulb: sv('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.9 10.6c.8.7 1.1 1.5 1.1 2.4h5.6c0-.9.3-1.7 1.1-2.4A6 6 0 0 0 12 3z"/>'),
  sliders: sv('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
  help: sv('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.7M12 17.2h.01"/>'),
  back: sv('<path d="M15 5l-7 7 7 7"/>'),
  prev: sv('<path d="M15 5l-7 7 7 7"/>'),
  next: sv('<path d="M9 5l7 7-7 7"/>'),
  planet: sv('<circle cx="12" cy="12" r="6"/><path d="M3.5 15.5c-1.6 2.3 6.6.8 11.3-2.4 4.6-3.2 7.3-7.4 5.6-8.1-.9-.4-2.7.1-4.8 1"/>'),
  calendar: sv('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="M9 14h2v2H9z" fill="currentColor"/>'),
  cube: sv('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"/>'),
  grid: sv('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>'),
  play: sv('<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>'),
  lock: sv('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  resume: sv('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
  share: sv('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v6A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-6"/>'),
  trophy: sv('<path d="M8 4h8v5.5a4 4 0 0 1-8 0z"/><path d="M8 6H5.2a3.2 3.2 0 0 0 3.3 4.4M16 6h2.8a3.2 3.2 0 0 1-3.3 4.4M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z"/>'),
};

export function starSVG(on, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill="${
    on ? '#ffc94a' : 'rgba(255,255,255,0.08)'
  }" stroke="${on ? '#ffdf8a' : 'rgba(255,255,255,0.28)'}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}
export function starsHTML(n, total = 3, size = 18) {
  let s = '<span class="stars">';
  for (let i = 0; i < total; i++) s += starSVG(i < n, size);
  return s + '</span>';
}

// ---- 7-segment LED --------------------------------------------------------
const SEGS = {
  a: '2.6,1 17.4,1 14.6,4 5.4,4',
  b: '18.6,2.4 18.6,16.6 15.6,15 15.6,5.2',
  c: '18.6,19.4 18.6,33.6 15.6,30.8 15.6,21',
  d: '2.6,35 17.4,35 14.6,32 5.4,32',
  e: '1.4,19.4 1.4,33.6 4.4,30.8 4.4,21',
  f: '1.4,2.4 1.4,16.6 4.4,15 4.4,5.2',
  g: '2.8,18 5.2,16.4 14.8,16.4 17.2,18 14.8,19.6 5.2,19.6',
};
const DIG = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '',
};
export function ledHTML(value) {
  let v = Math.round(value);
  let str;
  if (v < 0) str = '-' + String(Math.min(99, -v)).padStart(2, '0');
  else str = String(Math.min(999, v)).padStart(3, '0');
  let out = '<svg viewBox="0 0 64 36" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
  for (let i = 0; i < 3; i++) {
    const on = DIG[str[i]] || '';
    out += `<g transform="translate(${i * 22},0)">`;
    for (const k of 'abcdefg') out += `<polygon points="${SEGS[k]}" class="${on.includes(k) ? 'seg-on' : 'seg-off'}"/>`;
    out += '</g>';
  }
  return out + '</svg>';
}
const ledCache = new Map();
export function setLed(el, value, label) {
  const key = el.id;
  const v = Math.round(value);
  if (ledCache.get(key) === v) return;
  ledCache.set(key, v);
  el.innerHTML = ledHTML(v);
  if (label) el.setAttribute('aria-label', label + ': ' + v);
}

// ---- smiley ---------------------------------------------------------------
export function faceSVG(mood) {
  const ink = '#1b1b1b';
  let eyes = `<circle cx="14.5" cy="16" r="2.3" fill="${ink}"/><circle cx="25.5" cy="16" r="2.3" fill="${ink}"/>`;
  let mouth = `<path d="M12.5 23.5 Q20 31 27.5 23.5" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`;
  if (mood === 'oh') mouth = `<ellipse cx="20" cy="26" rx="3.4" ry="4" fill="none" stroke="${ink}" stroke-width="2.6"/>`;
  if (mood === 'cool') {
    eyes = `<path d="M8.5 13.5h10v4.2q-5 3.8-10 0z M21.5 13.5h10v4.2q-5 3.8-10 0z" fill="${ink}"/><path d="M18.5 14.5h3M6 13.5h2.5M31.5 13.5H34" stroke="${ink}" stroke-width="2"/>`;
  }
  if (mood === 'dead') {
    eyes = `<path d="M11.5 12.5l6 6M17.5 12.5l-6 6M22.5 12.5l6 6M28.5 12.5l-6 6" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
    mouth = `<path d="M13 28.5 Q20 22.5 27 28.5" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16.5" fill="#ffd23f" stroke="${ink}" stroke-width="2"/>${eyes}${mouth}</svg>`;
}
let lastMood = '';
export function setFace(mood) {
  if (mood === lastMood) return;
  lastMood = mood;
  $('face').innerHTML = faceSVG(mood);
}

// ---- toast / banner ---------------------------------------------------------
let toastTimer = 0;
export function toast(msg, ms = 2400) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
export function hideToast() {
  clearTimeout(toastTimer);
  $('toast').classList.remove('show');
}

export function banner(kicker, name) {
  const el = $('banner');
  el.querySelector('.k').textContent = kicker;
  el.querySelector('.n').textContent = name;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

// ---- modal ------------------------------------------------------------------
let modalClose = null;
export function openModal(html, { onClose = null, dismissable = true } = {}) {
  const m = $('modal');
  const p = $('panel');
  p.innerHTML = html;
  m.classList.remove('hidden');
  modalClose = onClose;
  m.onclick = (e) => {
    if (dismissable && e.target === m) closeModal();
  };
  const first = p.querySelector('button.primary, button');
  setTimeout(() => first?.focus({ preventScroll: true }), 30);
  return p;
}
export function closeModal(silent = false) {
  const m = $('modal');
  if (m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  $('panel').innerHTML = '';
  const cb = modalClose;
  modalClose = null;
  if (!silent && cb) cb();
}
export function modalOpen() {
  return !$('modal').classList.contains('hidden');
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
