const PDF_URL = 'assets/להשקיע_בנכס_בלי_לשקוע_לקריאה.pdf';
const MANIFEST_URL = 'assets/booklet/manifest.json';
const STORAGE_KEY = 'israel-portnoy-booklet-page-v1';
const mobile = matchMedia('(max-width:760px)');
const $ = selector => document.querySelector(selector);
const ui = {
  contents: $('#read-contents'), toc: $('#read-chapters'), contentsToggle: $('#read-contents-toggle'), backdrop: $('.read-sidebar-backdrop'),
  textMode: $('#read-text-mode'), pdfMode: $('#read-pdf-mode'), textContainer: $('#text-container'), text: $('#read-text'),
  pdfContainer: $('#pdf-container'), pdfViewer: $('#pdf-viewer'), status: $('#read-status'), statusMessage: $('#read-status-message'),
  errorActions: $('#read-error-actions'), retry: $('#read-retry'), fallbackText: $('#read-fallback-text'),
  tools: $('#read-tools'), settingsToggle: $('#read-settings-toggle'), smaller: $('#read-smaller'), larger: $('#read-larger'), scale: $('#read-scale'), fit: $('#read-fit'),
  searchbar: $('#read-searchbar'), search: $('#read-search'), searchToggle: $('#read-search-toggle'), searchCount: $('#read-search-count'), searchPrevious: $('#read-search-previous'), searchNext: $('#read-search-next'),
  pageForm: $('#read-page-form'), page: $('#read-page'), total: $('#read-total'), previous: $('#read-previous'), next: $('#read-next'), progress: $('#read-progress'), description: $('#read-page-description'),
};
let manifest, manifestPromise, textReady = false, pdfRuntime, pdfPromise;
let currentPage = 1, mode = mobile.matches ? 'text' : 'pdf', modeRequest = 0, textSize = 22;
let searchTimer, toastTimer, matches = [], matchIndex = -1, lastQuery = '';
let scrollScheduled = false, ignoreScrollUntil = 0;
const textSources = new Map();

function readSavedPage() {
  try { return clampPage(Number(localStorage.getItem(STORAGE_KEY)) || 1); } catch { return 1; }
}
function clampPage(value) {
  return Math.min(manifest?.pageCount || 21, Math.max(1, Number.isFinite(Number(value)) ? Math.round(Number(value)) : 1));
}
function route() {
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    page: params.has('page') ? clampPage(params.get('page')) : readSavedPage(),
    mode: ['pdf', 'text'].includes(params.get('mode')) ? params.get('mode') : (mobile.matches ? 'text' : 'pdf'),
  };
}
function updateAddress() {
  const hash = `#${new URLSearchParams({ page: String(currentPage), mode })}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}
function remember() {
  try { localStorage.setItem(STORAGE_KEY, String(currentPage)); } catch { /* Reading does not depend on storage. */ }
}
function setPageState(number) {
  currentPage = clampPage(number);
  ui.page.value = String(currentPage);
  ui.previous.disabled = currentPage === 1;
  ui.next.disabled = currentPage === (manifest?.pageCount || 21);
  ui.progress.value = currentPage;
  ui.progress.setAttribute('aria-valuetext', `עמוד ${currentPage} מתוך ${manifest?.pageCount || 21}`);
  ui.description.textContent = manifest?.pages[currentPage - 1]?.title || '';
  const chapters = [...ui.toc.querySelectorAll('[data-read-page]')];
  const selected = chapters.filter(link => Number(link.dataset.readPage) <= currentPage).at(-1);
  chapters.forEach(link => {
    if (link === selected) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
    link.href = `#page=${link.dataset.readPage}&mode=${mode}`;
  });
  remember();
  updateAddress();
}
function loading(message) {
  ui.status.hidden = false;
  ui.statusMessage.textContent = message;
  ui.errorActions.hidden = true;
  ui.status.setAttribute('role', 'status');
  ui.status.setAttribute('aria-busy', 'true');
}
function clearStatus() {
  ui.status.hidden = true;
  ui.status.setAttribute('aria-busy', 'false');
}
function errorState() {
  ui.status.hidden = false;
  ui.status.setAttribute('role', 'alert');
  ui.status.setAttribute('aria-busy', 'false');
  ui.statusMessage.textContent = mode === 'pdf' ? 'לא הצלחנו לפתוח את תצוגת ה־PDF. אפשר לנסות שוב או לעבור לקריאה נוחה.' : 'לא הצלחנו לטעון את החוברת. אפשר לנסות שוב או להוריד את ה־PDF.';
  ui.fallbackText.hidden = mode !== 'pdf';
  ui.errorActions.hidden = false;
}

async function loadManifest(retry = false) {
  if (manifest) return manifest;
  if (!manifestPromise) manifestPromise = fetch(MANIFEST_URL, { cache: retry ? 'reload' : 'default' }).then(response => {
    if (!response.ok) throw new Error('Manifest unavailable');
    return response.json();
  }).then(data => {
    if (!data || data.pageCount !== 21 || !Array.isArray(data.pages) || data.pages.length !== 21) throw new Error('Invalid manifest');
    if (!data.pages.every((page, index) => page.number === index + 1 && typeof page.text === 'string')) throw new Error('Invalid pages');
    manifest = data;
    ui.total.textContent = String(data.pageCount);
    ui.page.max = String(data.pageCount);
    ui.progress.max = data.pageCount;
    buildContents();
    return data;
  }).catch(error => { manifestPromise = undefined; throw error; });
  return manifestPromise;
}
function buildContents() {
  const fragment = document.createDocumentFragment();
  manifest.chapters.forEach(chapter => {
    if (!Number.isInteger(chapter.page) || chapter.page < 1 || chapter.page > 21) return;
    const link = document.createElement('a');
    link.className = 'read-chapter';
    link.dataset.readPage = String(chapter.page);
    link.href = `#page=${chapter.page}&mode=${mode}`;
    const title = document.createElement('span');
    title.textContent = chapter.title;
    const number = document.createElement('b');
    number.textContent = String(chapter.page);
    number.setAttribute('aria-label', `עמוד ${chapter.page}`);
    link.append(title, number);
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
      event.preventDefault();
      goToPage(chapter.page);
      if (mobile.matches) {
        setContents(false);
        (mode === 'text' ? ui.textContainer : ui.pdfContainer).focus({ preventScroll: true });
      }
    });
    fragment.append(link);
  });
  ui.toc.replaceChildren(fragment);
}
function searchable(element, text) {
  element.textContent = text;
  textSources.set(element, text);
  return element;
}
function buildText() {
  if (textReady) return;
  const fragment = document.createDocumentFragment();
  manifest.pages.forEach(page => {
    const section = document.createElement('section');
    section.className = 'read-text-page';
    section.id = `text-page-${page.number}`;
    section.dataset.page = String(page.number);
    section.setAttribute('aria-label', `עמוד ${page.number}: ${page.title}`);
    if (page.number === 1) {
      section.classList.add('read-cover');
      const image = document.createElement('img');
      image.src = 'assets/cover.webp';
      image.alt = 'כריכת החוברת להשקיע בנכס בלי לשקוע';
      image.width = 1000;
      image.height = 1416;
      const copy = document.createElement('div');
      copy.append(searchable(document.createElement('h2'), manifest.title), searchable(document.createElement('p'), 'ישראל פורטנוי'));
      section.append(image, copy);
    } else {
      let contentParent = section;
      if (page.number === 3 || page.number === 4) {
        const details = document.createElement('details');
        details.className = 'read-toc-page';
        const summary = document.createElement('summary');
        summary.className = 'read-toc-summary';
        summary.textContent = page.title;
        details.append(summary);
        section.append(details);
        contentParent = details;
      } else contentParent.append(searchable(document.createElement('h2'), page.title));
      const content = document.createElement('div');
      content.className = 'read-text-content';
      const paragraphs = page.text.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean);
      paragraphs.forEach((text, index) => {
        // Chapter numbers and the repeated chapter heading are represented by the semantic page heading.
        if (index < 2 && (/^0?[1-4]$/.test(text) || (text.startsWith('פרק ') && page.number !== 3 && page.number !== 4))) return;
        if (index === 0 && text === page.title) return;
        const p = searchable(document.createElement('p'), text);
        content.append(p);
      });
      contentParent.append(content);
      const pageLabel = document.createElement('span');
      pageLabel.className = 'read-page-number';
      pageLabel.textContent = `עמוד ${page.number}`;
      section.append(pageLabel);
    }
    fragment.append(section);
  });
  ui.text.replaceChildren(fragment);
  textReady = true;
}

async function loadPdf() {
  if (pdfRuntime?.ready) return pdfRuntime;
  if (pdfPromise) return pdfPromise;
  pdfPromise = (async () => {
    const pdfjs = await import('./assets/vendor/pdfjs/build/pdf.mjs');
    globalThis.pdfjsLib = pdfjs;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./assets/vendor/pdfjs/build/pdf.worker.mjs', import.meta.url).href;
    // Keep the optional renderer worker disabled; normal PDF.js rendering is portable across browsers.
    const { EventBus, PDFViewer, PDFLinkService, PDFFindController } = await import('./assets/vendor/pdfjs/web/pdf_viewer.mjs');
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2, externalLinkRel: 'noopener noreferrer' });
    const findController = new PDFFindController({ eventBus, linkService });
    const controller = new AbortController();
    const viewer = new PDFViewer({
      container: ui.pdfContainer, viewer: ui.pdfViewer, eventBus, linkService, findController,
      textLayerMode: 1, annotationMode: 1, enableScripting: false, enableAutoLinking: false,
      removePageBorders: true, imageResourcesPath: new URL('./assets/vendor/pdfjs/web/images/', import.meta.url).href,
      maxCanvasPixels: 16777216, abortSignal: controller.signal,
    });
    const ready = new Promise(resolve => eventBus.on('pagesinit', resolve, { once: true }));
    linkService.setViewer(viewer);
    pdfRuntime = { viewer, eventBus, linkService, findController, controller, ready: false };
    eventBus.on('pagechanging', ({ pageNumber }) => { if (mode === 'pdf' && pdfRuntime?.ready) setPageState(pageNumber); });
    eventBus.on('scalechanging', ({ scale }) => { if (mode === 'pdf') ui.scale.textContent = `${Math.round(scale * 100)}%`; });
    eventBus.on('updatefindmatchescount', ({ matchesCount }) => {
      if (mode === 'pdf') ui.searchCount.textContent = matchesCount.total ? `${matchesCount.current} מתוך ${matchesCount.total}` : 'לא נמצאו תוצאות';
    });
    eventBus.on('updatefindcontrolstate', ({ state }) => {
      if (mode === 'pdf' && state === 1) ui.searchCount.textContent = 'לא נמצאו תוצאות';
      if (mode === 'pdf' && state === 3) ui.searchCount.textContent = 'מחפשים…';
    });
    const task = pdfjs.getDocument({
      url: PDF_URL, cMapUrl: new URL('./assets/vendor/pdfjs/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('./assets/vendor/pdfjs/standard_fonts/', import.meta.url).href,
      wasmUrl: new URL('./assets/vendor/pdfjs/wasm/', import.meta.url).href,
      iccUrl: new URL('./assets/vendor/pdfjs/iccs/', import.meta.url).href, isEvalSupported: false, enableXfa: false,
    });
    pdfRuntime.task = task;
    const pdf = await task.promise;
    viewer.setDocument(pdf);
    linkService.setDocument(pdf, null);
    await ready;
    pdfRuntime.ready = true;
    return pdfRuntime;
  })().catch(error => {
    pdfRuntime?.controller.abort();
    pdfRuntime?.task?.destroy().catch(() => {});
    pdfRuntime = undefined;
    pdfPromise = undefined;
    ui.pdfViewer.replaceChildren();
    throw error;
  });
  return pdfPromise;
}

async function setMode(nextMode, page = currentPage, retry = false) {
  const request = ++modeRequest;
  const targetPage = clampPage(page);
  mode = nextMode === 'pdf' ? 'pdf' : 'text';
  document.body.dataset.mode = mode;
  ui.textMode.setAttribute('aria-pressed', String(mode === 'text'));
  ui.pdfMode.setAttribute('aria-pressed', String(mode === 'pdf'));
  ui.pdfContainer.hidden = mode !== 'pdf';
  ui.textContainer.hidden = mode !== 'text';
  ui.fit.hidden = mode !== 'pdf';
  loading(mode === 'pdf' ? 'פותחים את תצוגת ה־PDF…' : 'פותחים את החוברת לקריאה…');
  closeSearch(false);
  try {
    await loadManifest(retry);
    if (request !== modeRequest) return;
    if (mode === 'text') {
      buildText();
      ui.scale.textContent = `${textSize}px`;
      clearStatus();
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (request !== modeRequest) return;
      goToPage(targetPage);
    } else {
      const runtime = await loadPdf();
      if (request !== modeRequest) return;
      runtime.viewer.currentScaleValue = 'page-width';
      runtime.viewer.currentPageNumber = targetPage;
      runtime.viewer.update();
      clearStatus();
      setPageState(targetPage);
      ui.scale.textContent = `${Math.round(runtime.viewer.currentScale * 100)}%`;
    }
    updateZoomButtons();
  } catch { if (request === modeRequest) errorState(); }
}
function goToPage(number) {
  const targetPage = clampPage(number);
  if (mode === 'text') {
    const target = $(`#text-page-${targetPage}`);
    if (target) {
      ignoreScrollUntil = performance.now() + 150;
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  } else if (pdfRuntime?.ready) pdfRuntime.viewer.currentPageNumber = targetPage;
  setPageState(targetPage);
}
function updateTextPage() {
  scrollScheduled = false;
  if (mode !== 'text' || !textReady || performance.now() < ignoreScrollUntil) return;
  const threshold = ui.textContainer.getBoundingClientRect().top + 115;
  let selected = 1;
  for (const section of ui.text.children) {
    if (section.getBoundingClientRect().top <= threshold) selected = Number(section.dataset.page);
    else break;
  }
  if (selected !== currentPage) setPageState(selected);
}
ui.textContainer.addEventListener('scroll', () => {
  if (!scrollScheduled) { scrollScheduled = true; requestAnimationFrame(updateTextPage); }
}, { passive: true });

function setContents(open) {
  document.body.classList.toggle('contents-open', mobile.matches && open);
  document.body.classList.toggle('contents-closed', !mobile.matches && !open);
  ui.contentsToggle.setAttribute('aria-expanded', String(open));
  ui.backdrop.hidden = !(mobile.matches && open);
  ui.contents.inert = mobile.matches && !open;
  if (!mobile.matches && pdfRuntime?.ready && mode === 'pdf') requestAnimationFrame(() => {
    if (pdfRuntime.viewer.currentScaleValue === 'page-width') pdfRuntime.viewer.currentScaleValue = 'page-width';
    pdfRuntime.viewer.update();
  });
}
function syncMobileTools() {
  ui.tools.hidden = mobile.matches && ui.settingsToggle.getAttribute('aria-expanded') !== 'true';
}
mobile.addEventListener('change', () => { setContents(!mobile.matches); syncMobileTools(); });
ui.contentsToggle.addEventListener('click', () => setContents(ui.contentsToggle.getAttribute('aria-expanded') !== 'true'));
ui.backdrop.addEventListener('click', () => { setContents(false); ui.contentsToggle.focus(); });
ui.settingsToggle.addEventListener('click', () => {
  ui.settingsToggle.setAttribute('aria-expanded', String(ui.settingsToggle.getAttribute('aria-expanded') !== 'true'));
  syncMobileTools();
});
function updateZoomButtons() {
  ui.smaller.disabled = mode === 'text' ? textSize <= 18 : (pdfRuntime?.viewer.currentScale || 1) <= .5;
  ui.larger.disabled = mode === 'text' ? textSize >= 28 : (pdfRuntime?.viewer.currentScale || 1) >= 3;
}
function changeScale(delta) {
  if (mode === 'text') {
    textSize = Math.min(28, Math.max(18, textSize + delta * 2));
    document.documentElement.style.setProperty('--read-text-size', `${textSize}px`);
    ui.scale.textContent = `${textSize}px`;
  } else if (pdfRuntime?.ready) {
    pdfRuntime.viewer.currentScale = Math.min(3, Math.max(.5, pdfRuntime.viewer.currentScale * (delta > 0 ? 1.2 : 1 / 1.2)));
  }
  updateZoomButtons();
}
ui.smaller.addEventListener('click', () => changeScale(-1));
ui.larger.addEventListener('click', () => changeScale(1));
ui.fit.addEventListener('click', () => { if (pdfRuntime?.ready) { pdfRuntime.viewer.currentScaleValue = 'page-width'; updateZoomButtons(); } });

function clearTextSearch() {
  textSources.forEach((original, element) => { element.textContent = original; });
  matches = [];
  matchIndex = -1;
}
function searchText(query) {
  clearTextSearch();
  if (!query) { ui.searchCount.textContent = ''; return; }
  const lowerQuery = query.toLocaleLowerCase('he');
  textSources.forEach((original, element) => {
    const lower = original.toLocaleLowerCase('he');
    let index = lower.indexOf(lowerQuery), from = 0;
    if (index < 0) return;
    const fragment = document.createDocumentFragment();
    while (index >= 0) {
      fragment.append(document.createTextNode(original.slice(from, index)));
      const mark = document.createElement('mark');
      mark.textContent = original.slice(index, index + query.length);
      fragment.append(mark);
      matches.push(mark);
      from = index + query.length;
      index = lower.indexOf(lowerQuery, from);
    }
    fragment.append(document.createTextNode(original.slice(from)));
    element.replaceChildren(fragment);
  });
  stepTextMatch(1);
}
function stepTextMatch(delta) {
  if (!matches.length) { ui.searchCount.textContent = 'לא נמצאו תוצאות'; return; }
  matches[matchIndex]?.classList.remove('read-match-current');
  matchIndex = (matchIndex + delta + matches.length) % matches.length;
  const match = matches[matchIndex];
  const details = match.closest('details');
  if (details) details.open = true;
  match.classList.add('read-match-current');
  match.scrollIntoView({ behavior: 'instant', block: 'center' });
  const page = match.closest('[data-page]');
  if (page) setPageState(Number(page.dataset.page));
  ui.searchCount.textContent = `${matchIndex + 1} מתוך ${matches.length}`;
}
function searchPdf(query, again = false, previous = false) {
  if (!pdfRuntime?.ready) return;
  if (!query) { pdfRuntime.eventBus.dispatch('findbarclose', { source: window }); ui.searchCount.textContent = ''; return; }
  pdfRuntime.eventBus.dispatch('find', { source: window, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
}
function runSearch(step = 0) {
  clearTimeout(searchTimer);
  const query = ui.search.value.trim();
  const changed = query !== lastQuery;
  if (mode === 'text') {
    if (changed || step === 0) searchText(query);
    else if (query) stepTextMatch(step);
  } else searchPdf(query, !changed && step !== 0, step < 0);
  lastQuery = query;
}
function openSearch() {
  ui.searchbar.hidden = false;
  ui.searchToggle.setAttribute('aria-expanded', 'true');
  ui.search.focus();
}
function closeSearch(focus = true) {
  clearTimeout(searchTimer);
  ui.searchbar.hidden = true;
  ui.searchToggle.setAttribute('aria-expanded', 'false');
  ui.search.value = '';
  ui.searchCount.textContent = '';
  lastQuery = '';
  if (textReady) clearTextSearch();
  pdfRuntime?.eventBus.dispatch('findbarclose', { source: window });
  if (focus) ui.searchToggle.focus();
}
ui.searchToggle.addEventListener('click', () => ui.searchbar.hidden ? openSearch() : closeSearch());
$('#read-search-close').addEventListener('click', () => closeSearch());
ui.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(), 180); });
ui.searchbar.addEventListener('submit', event => { event.preventDefault(); runSearch(1); });
ui.searchPrevious.addEventListener('click', () => runSearch(-1));
ui.search.addEventListener('keydown', event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); runSearch(-1); } });

ui.textMode.addEventListener('click', () => { if (mode !== 'text') setMode('text'); });
ui.pdfMode.addEventListener('click', () => { if (mode !== 'pdf') setMode('pdf'); });
ui.pageForm.addEventListener('submit', event => { event.preventDefault(); goToPage(ui.page.value); });
ui.page.addEventListener('change', () => { if (ui.page.value.trim()) goToPage(ui.page.value); });
ui.page.addEventListener('blur', () => { ui.page.value = String(currentPage); });
ui.previous.addEventListener('click', () => goToPage(currentPage - 1));
ui.next.addEventListener('click', () => goToPage(currentPage + 1));
ui.retry.addEventListener('click', () => setMode(mode, currentPage, true));
ui.fallbackText.addEventListener('click', () => setMode('text'));
addEventListener('hashchange', () => {
  const next = route();
  if (next.mode !== mode) setMode(next.mode, next.page);
  else goToPage(next.page);
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); openSearch(); }
  if (event.key !== 'Escape') return;
  if (!$('#read-copy-dialog').open && !ui.searchbar.hidden) { event.preventDefault(); closeSearch(); }
  else if (mobile.matches && document.body.classList.contains('contents-open')) { setContents(false); ui.contentsToggle.focus(); }
  else if (mobile.matches && !ui.tools.hidden) { ui.settingsToggle.setAttribute('aria-expanded', 'false'); syncMobileTools(); ui.settingsToggle.focus(); }
});

function toast(text) {
  clearTimeout(toastTimer);
  $('#read-toast').textContent = text;
  $('#read-toast').hidden = false;
  toastTimer = setTimeout(() => { $('#read-toast').hidden = true; }, 2600);
}
$('#read-share').addEventListener('click', async () => {
  updateAddress();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(location.href);
    toast('הקישור לעמוד הועתק');
  } catch {
    $('#read-copy-url').value = location.href;
    $('#read-copy-dialog').showModal();
    $('#read-copy-url').focus();
    $('#read-copy-url').select();
  }
});
$('#read-copy-close').addEventListener('click', () => $('#read-copy-dialog').close());
$('#read-copy-dialog').addEventListener('close', () => $('#read-share').focus());

setContents(!mobile.matches);
syncMobileTools();
const initial = route();
currentPage = initial.page;
ui.page.value = String(currentPage);
setMode(initial.mode, initial.page);
