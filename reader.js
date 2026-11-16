'use strict';
(() => {
  const key = 'israel-portnoy-booklet-page-v1';
  const resumeLinks = [...document.querySelectorAll('[data-reader-resume]')].map(element => ({element,label:element.querySelector('[data-reader-resume-label]'),initial:element.querySelector('[data-reader-resume-label]')?.textContent,aria:element.getAttribute('aria-label')}));
  function savedPage() {
    try { const page = Number(localStorage.getItem(key)); if (Number.isInteger(page) && page >= 1 && page <= 21) return page; } catch {}
    return 1;
  }
  function updateResume() {
    const saved = savedPage();
    resumeLinks.forEach(({element,label,initial,aria}) => {
      if (element instanceof HTMLAnchorElement) element.href = `read.html#page=${saved}`;
      if (saved > 1) {
        if (label) label.textContent = `להמשך הקריאה · עמ׳ ${saved}`;
        element.setAttribute('aria-label', `המשך קריאת החוברת מעמוד ${saved}`);
      } else {
        if (label) label.textContent = initial;
        if (aria) element.setAttribute('aria-label', aria);
        else element.removeAttribute('aria-label');
      }
    });
  }
  updateResume();
  addEventListener('pageshow', updateResume);
  addEventListener('storage', event => { if (event.key === key) updateResume(); });
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const trigger = event.target.closest('[data-reader-page], [data-reader-resume]');
    if (!trigger || trigger instanceof HTMLAnchorElement || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const page = trigger.hasAttribute('data-reader-resume') ? savedPage() : Math.min(21, Math.max(1, Number(trigger.dataset.readerPage) || 1));
    location.href = `read.html#page=${page}`;
  });
})();
