const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../leads.js'), 'utf8');
const endpoint = 'https://script.google.com/macros/s/AKfycbPUBLIC_DEPLOYMENT_TEST_1234567890/exec';
const googleOrigin = 'https://n-app-0lu-script.googleusercontent.com';
const shownKey = 'israel-updates:shown:v1';
const subscribedKey = 'israel-updates:subscribed:v1';

function events(element = {}) {
  const listeners = new Map();
  element.addEventListener = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(callback);
  };
  element.dispatch = (type, input = {}) => {
    const event = { target: element, preventDefault() {}, ...input };
    for (const callback of listeners.get(type) || []) callback(event);
  };
  return element;
}

function classes() {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value), has: value => values.has(value) };
}

function harness(options = {}) {
  const storage = options.storage || new Map();
  const globalEvents = events();
  const openButton = events({ hidden: false });
  const closeButton = events();
  const dialog = events({ open: false, opens: 0, closes: 0 });
  dialog.showModal = () => { dialog.open = true; dialog.opens++; };
  dialog.close = () => { dialog.open = false; dialog.closes++; dialog.dispatch('close'); };
  dialog.querySelectorAll = () => [closeButton];
  dialog.getBoundingClientRect = () => ({ left: 100, right: 700, top: 100, bottom: 700 });
  const notice = { hidden: true, textContent: '', focusCalls: [], focus(options) { this.focusCalls.push(options); } };
  const timers = [];
  let time = 0;

  function shell(source, popup) {
    const outer = {}; outer.parent = outer;
    const sent = [];
    const inner = { parent: outer, postMessage(data, origin) { sent.push({ data, origin }); } };
    const frame = { contentWindow: outer, hidden: false, style: {}, classList: classes() };
    const status = { hidden: false, textContent: 'טוענים', setAttribute(name, value) { this[name] = value; } };
    const direct = { hidden: false };
    const element = { hidden: true, dataset: { updatesSource: source }, classList: classes(),
      closest() { return popup ? dialog : null; },
      querySelector(selector) { return selector === 'iframe' ? frame : selector.includes('status') ? status : direct; } };
    return { element, frame, status, direct, outer, inner, sent };
  }
  const inline = shell('updates', false);
  const popup = shell('exit', true);
  const document = { hidden: false, activeElement: { tagName: 'BODY' }, documentElement: { scrollHeight: 5000 }, otherDialog: null,
    querySelectorAll(selector) { return selector === '[data-updates-open]' ? [openButton] : selector === '[data-updates-form]' ? [inline.element, popup.element] : []; },
    querySelector(selector) { return selector === '#updates-dialog' ? dialog : selector === '[data-updates-notice]' ? notice : selector === 'dialog[open]' ? (document.otherDialog || (dialog.open ? dialog : null)) : null; } };
  const window = { ISRAEL_LEADS_CONFIG: { webAppUrl: options.webAppUrl === undefined ? endpoint : options.webAppUrl, loadTimeoutMs: 5000 },
    innerHeight: 1000, scrollY: options.scrollY || 0,
    matchMedia() { return { matches: options.finePointer !== false }; } };
  Object.defineProperty(window, 'sessionStorage', { get() {
    if (options.storageBlocked) throw new Error('Storage blocked');
    return { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  } });
  class Clock extends Date { static now() { return time; } }
  vm.runInNewContext(code, { window, document, URL, Date: Clock,
    addEventListener: globalEvents.addEventListener,
    setTimeout(callback, duration) { const timer = { callback, duration, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; } });

  const result = { window, document, dialog, inline, popup, openButton, closeButton, notice, storage, timers,
    advance(milliseconds) { time += milliseconds; },
    scroll(value) { window.scrollY = value; globalEvents.dispatch('scroll'); },
    exit(input) { globalEvents.dispatch('mouseout', { clientY: -1, relatedTarget: null, buttons: 0, ...input }); },
    message(data, source, origin = googleOrigin) { globalEvents.dispatch('message', { data, source, origin }); },
    ready(target, nonce = '0123456789abcdef0123456789abcdef') {
      result.message({ type: 'israel-leads:hello', nonce }, target.inner);
      result.message({ type: 'israel-leads:ready', nonce, height: 560 }, target.inner);
      return nonce;
    } };
  return result;
}

test('Updates embed uses the public URL and loads the exit form only on opening', () => {
  const h = harness({ webAppUrl: endpoint + '?discard=private#' });
  const inline = new URL(h.inline.frame.src);
  assert.equal(inline.searchParams.get('mode'), 'updates');
  assert.equal(inline.searchParams.get('source'), 'updates');
  assert.equal(inline.searchParams.get('embed'), '1');
  assert.equal(inline.searchParams.has('discard'), false);
  assert.equal(new URL(h.inline.direct.href).searchParams.has('embed'), false);
  assert.equal(h.popup.frame.src, undefined);
  h.openButton.dispatch('click');
  assert.equal(h.dialog.open, true);
  assert.equal(new URL(h.popup.frame.src).searchParams.get('source'), 'exit');
  assert.equal(h.storage.get(shownKey), '1');
});

test('Exit suggestion needs reading exposure, dwell time and an actual top-edge mouse exit', () => {
  const h = harness();
  h.exit(); assert.equal(h.dialog.opens, 0);
  h.scroll(1600); h.exit(); assert.equal(h.dialog.opens, 0);
  h.advance(25000);
  h.exit({ clientY: 60 }); assert.equal(h.dialog.opens, 0);
  h.exit({ relatedTarget: {} }); assert.equal(h.dialog.opens, 0);
  h.exit({ buttons: 1 }); assert.equal(h.dialog.opens, 0);
  h.exit(); assert.equal(h.dialog.opens, 1);
  assert.equal(h.popup.element.hidden, false);
  h.closeButton.dispatch('click'); h.exit();
  assert.equal(h.dialog.opens, 1);
});

test('Hidden pages, editing and another modal prevent automatic interruptions', () => {
  for (const active of [{ tagName: 'IFRAME' }, { tagName: 'INPUT', closest() { return this; } }, { isContentEditable: true }]) {
    const h = harness(); h.scroll(1800); h.advance(30000); h.document.activeElement = active;
    h.exit(); assert.equal(h.dialog.opens, 0);
  }
  const hidden = harness(); hidden.scroll(1800); hidden.advance(30000); hidden.document.hidden = true;
  hidden.exit(); assert.equal(hidden.dialog.opens, 0);
  const modal = harness(); modal.scroll(1800); modal.advance(30000); modal.document.otherDialog = {};
  modal.exit(); assert.equal(modal.dialog.opens, 0);
});

test('Touch users get manual signup without an exit trap or automatic dialog', () => {
  const h = harness({ finePointer: false }); h.scroll(2000); h.advance(60000); h.exit();
  assert.equal(h.dialog.opens, 0);
  h.openButton.dispatch('click'); assert.equal(h.dialog.opens, 1);
});

test('Only a confirmed handshake from the matching Google iframe can announce subscription', () => {
  const h = harness(); h.openButton.dispatch('click');
  const nonce = h.ready(h.popup);
  const stranger = {}; stranger.parent = stranger;
  h.message({ type: 'israel-leads:subscribed', nonce }, stranger);
  h.message({ type: 'israel-leads:subscribed', nonce }, h.popup.inner, 'https://script.googleusercontent.com.evil.example');
  h.message({ type: 'israel-leads:subscribed', nonce: 'wrong-nonce-0123456789' }, h.popup.inner);
  h.message({ type: 'israel-leads:subscribed', nonce }, h.inline.inner);
  assert.equal(h.dialog.open, true);
  assert.equal(h.notice.hidden, true);
  h.message({ type: 'israel-leads:subscribed', nonce }, h.popup.inner);
  assert.equal(h.dialog.open, false);
  assert.equal(h.storage.get(subscribedKey), '1');
  assert.equal(h.notice.hidden, false);
  assert.equal(h.notice.focusCalls.length, 1);
  assert.equal(h.notice.focusCalls[0].preventScroll, true);
  assert.match(h.inline.status.textContent, /נרשמתם לעדכונים/);
  assert.equal(h.inline.frame.hidden, true);
  assert.equal(h.openButton.hidden, true);
  // Delayed iframe ready messages cannot resurrect a completed form.
  h.message({ type: 'israel-leads:ready', nonce, height: 700 }, h.popup.inner);
  assert.equal(h.inline.frame.hidden, true);
  assert.equal(h.dialog.open, false);
  assert.ok(h.popup.sent.every(item => Object.keys(item.data).every(key => ['type', 'nonce'].includes(key))));
});

test('Shown/subscribed session flags suppress repeats without storing personal details', () => {
  const storage = new Map([[shownKey, '1']]);
  const h = harness({ storage }); h.scroll(1800); h.advance(30000); h.exit();
  assert.equal(h.dialog.opens, 0);
  h.openButton.dispatch('click'); assert.equal(h.dialog.opens, 1);
  const subscribed = harness({ storage: new Map([[subscribedKey, '1']]) });
  assert.equal(subscribed.inline.frame.src, undefined);
  assert.equal(subscribed.popup.frame.src, undefined);
  assert.match(subscribed.inline.status.textContent, /נרשמתם לעדכונים/);
  subscribed.openButton.dispatch('click'); assert.equal(subscribed.dialog.opens, 0);
  assert.ok([...h.storage.values()].every(value => value === '1'));
});

test('Blocked storage still permits one suggestion and remembers dismissal in memory', () => {
  const h = harness({ storageBlocked: true }); h.scroll(1800); h.advance(30000); h.exit();
  assert.equal(h.dialog.opens, 1);
  h.dialog.dispatch('cancel'); h.dialog.close(); h.exit();
  assert.equal(h.dialog.opens, 1);
});

test('An unavailable iframe offers a fallback and never implies subscription', () => {
  const h = harness();
  h.timers[0].callback();
  assert.equal(h.inline.frame.hidden, true);
  assert.match(h.inline.status.textContent, /לא נטען/);
  assert.equal(h.notice.hidden, true);
  assert.equal(h.storage.has(subscribedKey), false);
});

test('Backdrop clicks close only outside the dialog bounds', () => {
  const h = harness(); h.openButton.dispatch('click');
  h.dialog.dispatch('click', { clientX: 300, clientY: 300 }); assert.equal(h.dialog.open, true);
  h.dialog.dispatch('click', { target: {}, clientX: 0, clientY: 0 }); assert.equal(h.dialog.open, true);
  h.dialog.dispatch('click', { clientX: 50, clientY: 300 }); assert.equal(h.dialog.open, false);
});

test('Invalid endpoint hides signup openers and never loads or suggests a form', () => {
  const h = harness({ webAppUrl: 'https://evil.example/exec' });
  assert.equal(h.openButton.hidden, true);
  assert.equal(h.inline.frame.src, undefined);
  h.scroll(1800); h.advance(30000); h.exit();
  assert.equal(h.dialog.opens, 0);
});
