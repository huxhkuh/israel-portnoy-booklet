'use strict';

(() => {
  const config = window.ISRAEL_LEADS_CONFIG;
  const openButtons = [...(document.querySelectorAll?.('[data-updates-open]') || [])];
  let endpoint;
  try {
    endpoint = new URL(config?.webAppUrl);
    if (endpoint.origin !== 'https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(endpoint.pathname) || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Invalid deployment');
  } catch {
    openButtons.forEach(button => { button.hidden = true; });
    return;
  }

  const updatesShells = [...(document.querySelectorAll?.('[data-updates-form]') || [])];
  // Retain the old contact embed contract for pages that have not adopted updates yet.
  const legacyShell = updatesShells.length ? null : document.querySelector('#contact-form-shell');
  const dialogElement = document.querySelector('#updates-dialog');
  const dialog = typeof dialogElement?.showModal === 'function' ? dialogElement : null;
  const notice = document.querySelector('[data-updates-notice]');
  const shownKey = 'israel-updates:shown:v1';
  const subscribedKey = 'israel-updates:subscribed:v1';
  const successMessage = 'נרשמתם לעדכונים מישראל. שמחים שתישארו בקשר.';
  const startedAt = Date.now();
  let shown = readSession(shownKey);
  let subscribed = readSession(subscribedKey);
  let maxScrollRatio = 0;

  function readSession(key) {
    try { return window.sessionStorage?.getItem(key) === '1'; }
    catch { return false; }
  }
  function writeSession(key) {
    try { window.sessionStorage?.setItem(key, '1'); }
    catch { /* In-memory flags still suppress repetition when storage is blocked. */ }
  }
  function rememberShown() { shown = true; writeSession(shownKey); }
  function googleScriptOrigin(origin) {
    try {
      const value = new URL(origin);
      return value.protocol === 'https:' && value.port === '' &&
        (['script.google.com', 'script.googleusercontent.com'].includes(value.hostname) || /^[a-z0-9-]+-script\.googleusercontent\.com$/.test(value.hostname));
    } catch { return false; }
  }
  function belongsToFrame(source, frame) {
    if (!source || !frame.contentWindow) return false;
    try {
      let current = source;
      for (let depth = 0; depth < 8; depth++) {
        if (current === frame.contentWindow) return true;
        if (current.parent === current) return false;
        current = current.parent;
      }
    } catch { /* Ignore frame ancestry that cannot be verified. */ }
    return false;
  }

  function embed(shell, updates) {
    const frame = shell.querySelector('iframe');
    const status = shell.querySelector('[data-lead-frame-status]');
    const direct = shell.querySelector('[data-lead-form-direct]');
    if (!frame || !status || !direct) return null;
    const popup = Boolean(dialog && shell.closest?.('#updates-dialog') === dialog);
    const source = updates ? (shell.dataset.updatesSource === 'exit' ? 'exit' : 'updates') : 'contact';
    const url = new URL(endpoint.href);
    url.search = '';
    url.searchParams.set('mode', updates ? 'updates' : 'contact');
    url.searchParams.set('source', source);
    direct.href = url.href;
    url.searchParams.set('embed', '1');
    const context = { shell, frame, status, direct, popup, updates, sender: null, nonce: null, loaded: false, initialized: false, failed: false, timer: null };
    context.initialize = () => {
      if (context.initialized && !context.failed) return;
      clearTimeout(context.timer);
      context.initialized = true;
      context.failed = false;
      context.loaded = false;
      context.sender = null;
      context.nonce = null;
      status.hidden = false;
      status.textContent = 'טוענים את טופס ההרשמה…';
      status.setAttribute('role', 'status');
      frame.hidden = false;
      frame.classList.remove?.('lead-frame-ready');
      shell.classList.remove('lead-frame-unavailable');
      shell.hidden = false;
      context.timer = setTimeout(() => {
        if (context.loaded) return;
        context.failed = true;
        status.hidden = false;
        status.textContent = updates ? 'טופס ההרשמה לא נטען. אפשר לפתוח אותו בחלון נפרד ולנסות שוב.' : 'הטופס לא נטען. אפשר לפתוח אותו בלשונית חדשה או ליצור קשר בטלפון ובמייל שמופיעים כאן.';
        status.setAttribute('role', 'alert');
        shell.classList.add('lead-frame-unavailable');
        frame.hidden = true;
      }, Math.min(60000, Math.max(5000, Number(config.loadTimeoutMs) || 25000)));
      frame.src = url.href;
    };
    return context;
  }

  const contexts = (updatesShells.length ? updatesShells.map(shell => embed(shell, true)) : [legacyShell && embed(legacyShell, false)]).filter(Boolean);
  const popupContexts = contexts.filter(context => context.popup);
  const inlineContexts = contexts.filter(context => !context.popup);

  function displaySubscription() {
    inlineContexts.filter(context => context.updates).forEach(context => {
      clearTimeout(context.timer);
      context.shell.hidden = false;
      context.shell.classList.add('updates-subscribed');
      context.frame.hidden = true;
      context.direct.hidden = true;
      context.status.textContent = successMessage;
      context.status.setAttribute('role', 'status');
      context.status.hidden = false;
    });
    openButtons.forEach(button => { button.hidden = true; });
  }
  function completeSubscription() {
    subscribed = true;
    rememberShown();
    writeSession(subscribedKey);
    displaySubscription();
    if (dialog?.open) dialog.close();
    if (notice) {
      notice.textContent = successMessage;
      notice.hidden = false;
      notice.focus({ preventScroll: true });
    }
  }

  addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object' || !googleScriptOrigin(event.origin)) return;
    const context = contexts.find(candidate => candidate.initialized && belongsToFrame(event.source, candidate.frame));
    if (!context) return;
    if (subscribed && context.updates) return;
    if (data.type === 'israel-leads:hello') {
      if (typeof data.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(data.nonce)) return;
      context.sender = event.source;
      context.nonce = data.nonce;
      context.sender.postMessage({ type: 'israel-leads:authorize', nonce: context.nonce }, event.origin);
      return;
    }
    if (event.source !== context.sender || data.nonce !== context.nonce) return;
    if (data.type === 'israel-leads:ready') {
      context.loaded = true;
      context.failed = false;
      clearTimeout(context.timer);
      context.frame.hidden = false;
      context.shell.classList.remove('lead-frame-unavailable');
      context.status.hidden = true;
      context.frame.classList.add('lead-frame-ready');
    }
    if (context.loaded && ['israel-leads:ready', 'israel-leads:height'].includes(data.type) && Number.isFinite(data.height)) {
      context.frame.style.height = String(Math.min(1800, Math.max(350, Math.ceil(data.height)))) + 'px';
    }
    if (context.updates && context.loaded && data.type === 'israel-leads:subscribed') completeSubscription();
  });

  function editing() {
    const active = document.activeElement;
    return Boolean(active && (active.isContentEditable || active.tagName === 'IFRAME' || active.closest?.('input, textarea, select, [contenteditable="true"]')));
  }
  function openBanner() {
    if (!dialog || !popupContexts.length || dialog.open || subscribed || document.hidden) return;
    const openDialog = document.querySelector('dialog[open]');
    if (openDialog && openDialog !== dialog) return;
    try { dialog.showModal(); }
    catch { return; }
    rememberShown();
    popupContexts.forEach(context => context.initialize());
  }
  function closeBanner() { if (dialog?.open) dialog.close(); }
  function updateExposure() {
    const range = Number(document.documentElement?.scrollHeight) - Number(window.innerHeight);
    if (range > 0) maxScrollRatio = Math.max(maxScrollRatio, Math.max(0, Number(window.scrollY) || 0) / range);
  }
  function exitIntent(event) {
    if (shown || subscribed || !dialog || Date.now() - startedAt < 25000 || maxScrollRatio < .35 || document.hidden || editing()) return;
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches || event.relatedTarget || !Number.isFinite(event.clientY) || event.clientY > 0 || event.buttons) return;
    openBanner();
  }

  openButtons.forEach(button => button.addEventListener('click', event => { event.preventDefault(); openBanner(); }));
  if (dialog) {
    dialog.querySelectorAll('[data-updates-close]').forEach(button => button.addEventListener('click', closeBanner));
    dialog.addEventListener('cancel', rememberShown);
    dialog.addEventListener('close', rememberShown);
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeBanner();
    });
    addEventListener('scroll', updateExposure, { passive: true });
    addEventListener('mouseout', exitIntent);
    updateExposure();
  }
  if (subscribed) displaySubscription();
  else inlineContexts.forEach(context => context.initialize());
})();
