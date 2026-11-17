/* Google Apps Script V8. Keep configuration in Script Properties, never in Form.html. */
const LEAD_HEADERS_ = ['תאריך ושעת הפנייה', 'שם מלא', 'טלפון', 'אימייל', 'שירות מבוקש', 'הודעה', 'מקור הפנייה', 'סטטוס טיפול', '_request_id', '_payload_hash', '_notification_status', '_notification_updated_at'];
const LEAD_SERVICES_ = ['ניהול נכס', 'ייעוץ', 'ליווי', 'שאלה אחרת'];
const LEAD_LIMITS_ = { fullName: 80, phone: 30, email: 254, message: 2000 };
const LEAD_SITE_ = 'https://huxhkuh.github.io/israel-portnoy-booklet/';
const LEAD_ZONE_ = 'Asia/Jerusalem';
const UPDATES_HEADERS_ = ['תאריך ושעת ההרשמה', 'שם מלא', 'אימייל', 'מקור ההרשמה', 'סטטוס הרשמה', 'נוסח ההסכמה', 'גרסת ההסכמה', '_request_id', '_payload_hash'];
const UPDATES_CONSENT_VERSION_ = 'updates-v1';
const UPDATES_CONSENT_TEXT_ = 'אני מסכים/ה לקבל במייל עדכונים ותוכן מישראל פורטנוי, ולשמירת הפרטים לצורך זה. אפשר לבקש הסרה בכל עת במייל לישראל.';
const UPDATES_LEGACY_TEST_ID_ = '417412e4-e685-4aba-a8f0-8e4127d3a941';

function doGet(e) {
  const props = PropertiesService.getScriptProperties();
  const siteUrl = siteUrl_(props.getProperty('SITE_URL') || LEAD_SITE_);
  const parameters = e && e.parameter || {};
  const mode = parameters.mode === 'contact' ? 'contact' : 'updates';
  const config = {
    mode: mode,
    embedded: parameters.embed === '1',
    siteUrl: siteUrl,
    siteOrigin: /^(https:\/\/[^/]+)/.exec(siteUrl)[1],
    fontUrl: siteUrl + 'assets/fonts/body.woff2',
    source: mode === 'updates' ? (parameters.source === 'exit' ? 'exit' : 'updates') : (parameters.source === 'booklet' ? 'booklet' : 'contact'),
    services: LEAD_SERVICES_, limits: LEAD_LIMITS_, minFillMs: 1200, renderedAt: Date.now(),
  };
  if (mode === 'updates') {
    config.consentText = UPDATES_CONSENT_TEXT_;
    config.consentVersion = UPDATES_CONSENT_VERSION_;
  }
  const template = HtmlService.createTemplateFromFile('Form');
  template.publicConfigJson = safeJson_(config);
  return template.evaluate().setTitle(mode === 'updates' ? 'עדכונים מישראל פורטנוי' : 'יצירת קשר — ישראל פורטנוי')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Legacy contact operation. Never return lead data or internal errors. */
function submitLead(input) {
  const validation = validateLead_(input);
  if (!validation.ok) return validation;
  const lead = validation.lead;
  let config;
  try { config = leadConfig_(); }
  catch (error) { return failure_('UNAVAILABLE'); }
  const lock = LockService.getScriptLock();
  let locked = false;
  let receivedAt;
  try {
    locked = lock.tryLock(10000);
    if (!locked) return failure_('BUSY');
    const sheet = leadSheet_(config);
    const hash = payloadHash_(lead);
    const existing = findRequestRow_(sheet, lead.requestId);
    if (existing) {
      const storedHash = String(sheet.getRange(existing, 10).getValue());
      if (storedHash !== hash) return failure_('CONFLICT');
      return acknowledgement_(lead.requestId, true);
    }
    if (!consumeRate_(lead.phone)) return failure_('RATE_LIMIT');
    receivedAt = new Date();
    const row = sheet.getLastRow() + 1;
    ensureRow_(sheet, row);
    const values = [receivedAt, safeCell_(lead.fullName), safeCell_(lead.phone), safeCell_(lead.email),
      safeCell_(lead.service), safeCell_(lead.message), lead.source === 'booklet' ? 'הורדת חוברת' : 'טופס יצירת קשר',
      'חדש', lead.requestId, hash, 'pending', receivedAt];
    sheet.getRange(row, 1, 1, LEAD_HEADERS_.length).setValues([values]);
    SpreadsheetApp.flush();
    const confirmation = sheet.getRange(row, 9, 1, 2).getValues()[0];
    if (confirmation[0] !== lead.requestId || confirmation[1] !== hash) throw new Error('Write not confirmed');
  } catch (error) {
    console.warn('Lead write was not confirmed. Retry with the same request ID.');
    return failure_('UNAVAILABLE');
  } finally {
    if (locked) lock.releaseLock();
  }

  // The row is already committed. Mail failures must not alter that successful outcome.
  let notification = 'sent';
  try { notifyLead_(config, lead, receivedAt); }
  catch (error) { notification = 'failed'; console.warn('Lead notification failed; the lead remains saved.'); }
  try { markNotification_(config, lead.requestId, notification); }
  catch (error) { console.warn('Lead notification state could not be updated; the lead remains saved.'); }
  return acknowledgement_(lead.requestId, false);
}

/** Run once from the Apps Script editor, then deploy. Not callable by google.script.run. */
function setupLeads_() {
  const config = leadConfig_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('הגיליון בשימוש. נסו שוב.');
  try {
    const book = SpreadsheetApp.openById(config.spreadsheetId);
    book.setSpreadsheetTimeZone(LEAD_ZONE_);
    const sheet = book.getSheetByName(config.sheetName) || book.insertSheet(config.sheetName);
    if (sheet.getMaxColumns() < LEAD_HEADERS_.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), LEAD_HEADERS_.length - sheet.getMaxColumns());
    validateHeaders_(sheet, true);
    sheet.setRightToLeft(true);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, LEAD_HEADERS_.length).setValues([LEAD_HEADERS_]).setFontWeight('bold').setBackground('#063f2e').setFontColor('#ffffff').setWrap(true);
    sheet.setRowHeight(1, 42);
    const rows = Math.max(1, sheet.getMaxRows() - 1);
    sheet.getRange(2, 1, rows, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sheet.getRange(2, 2, rows, 10).setNumberFormat('@');
    sheet.getRange(2, 12, rows, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sheet.getRange(2, 6, rows, 1).setWrap(true);
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(['חדש', 'בטיפול', 'טופל'], true).setAllowInvalid(false).build();
    sheet.getRange(2, 8, rows, 1).setDataValidation(rule);
    [185, 170, 145, 230, 150, 340, 170, 125].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.hideColumns(9, 4);
    const filter = sheet.getFilter();
    if (!filter) sheet.getRange(1, 1, sheet.getMaxRows(), LEAD_HEADERS_.length).createFilter();
    else if (filter.getRange().getColumn() !== 1 || filter.getRange().getRow() !== 1 || filter.getRange().getNumColumns() !== LEAD_HEADERS_.length) {
      // Do not silently replace someone else's filter or detach hidden IDs when sorting.
      throw new Error('יש להגדיר מסנן על A:L, כולל העמודות הטכניות המוסתרות. הנתונים לא נמחקו.');
    }
    SpreadsheetApp.flush();
    return { ok: true, spreadsheetUrl: book.getUrl(), sheetName: sheet.getName() };
  } finally { lock.releaseLock(); }
}

/** Optional recovery from the editor. Mail delivery itself has no exactly-once guarantee. */
function retryNotifications_() {
  const config = leadConfig_();
  const result = { sent: 0, failed: 0 };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) break;
    let candidate;
    try {
      const sheet = leadSheet_(config);
      if (sheet.getLastRow() < 2) break;
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, LEAD_HEADERS_.length).getValues();
      for (let index = 0; index < rows.length; index += 1) {
        const values = rows[index];
        const stale = values[11] instanceof Date && Date.now() - values[11].getTime() > 600000;
        if (!values[8] || (values[10] !== 'failed' && !(['pending', 'retrying'].indexOf(values[10]) !== -1 && stale))) continue;
        const restore = function (value) { return String(value || '').replace(/^'(?=[=+\-@])/, ''); };
        candidate = { requestId: String(values[8]), receivedAt: values[0], fullName: restore(values[1]), phone: restore(values[2]),
          email: validEmail_(restore(values[3])) ? restore(values[3]) : '', service: LEAD_SERVICES_.indexOf(values[4]) !== -1 ? values[4] : 'שאלה אחרת',
          message: restore(values[5]), source: values[6] === 'הורדת חוברת' ? 'booklet' : 'contact' };
        sheet.getRange(index + 2, 11, 1, 2).setValues([['retrying', new Date()]]);
        SpreadsheetApp.flush();
        break;
      }
    } finally { lock.releaseLock(); }
    if (!candidate) break;
    let state = 'sent';
    try { notifyLead_(config, candidate, candidate.receivedAt instanceof Date ? candidate.receivedAt : new Date()); result.sent += 1; }
    catch (error) { state = 'failed'; result.failed += 1; }
    markNotification_(config, candidate.requestId, state);
    // Stop after a failure rather than immediately retrying the same row twenty times.
    if (state === 'failed') break;
  }
  return result;
}

function leadConfig_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = (props.getProperty('SPREADSHEET_ID') || '').trim();
  const recipient = (props.getProperty('NOTIFICATION_EMAIL') || '').trim();
  const sheetName = (props.getProperty('SHEET_NAME') || 'פניות').trim();
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(spreadsheetId) || !validEmail_(recipient) || !sheetName || sheetName.length > 80 || /[\[\]:*?\/\\\u0000-\u001f]/.test(sheetName)) {
    throw new Error('Configure SPREADSHEET_ID, NOTIFICATION_EMAIL and SHEET_NAME in Script Properties.');
  }
  return { spreadsheetId: spreadsheetId, recipient: recipient, sheetName: sheetName };
}

function siteUrl_(value) {
  const site = String(value).trim();
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::[0-9]{1,5})?(?:\/[^?#\s<>"']*)?$/.test(site)) throw new Error('SITE_URL must be the public HTTPS website URL.');
  return site.replace(/\/?$/, '/');
}

function safeJson_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function cleanField_(value, multiline) {
  if (typeof value !== 'string') return null;
  let text = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  if (!multiline) text = text.replace(/\s+/g, ' ');
  return text.trim();
}

function validateLead_(input) {
  if (!input || Object.prototype.toString.call(input) !== '[object Object]') return failure_('VALIDATION');
  const errors = {};
  const lead = {};
  ['fullName', 'phone', 'email', 'message'].forEach(function (field) {
    const value = input[field] === undefined && (field === 'email' || field === 'message') ? '' : input[field];
    if (typeof value !== 'string' || value.length > LEAD_LIMITS_[field]) {
      errors[field] = 'יש להזין ערך תקין באורך המותר.';
      lead[field] = '';
    } else lead[field] = cleanField_(value, field === 'message');
  });
  if (!errors.fullName && (lead.fullName.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’"״׳\-–]*$/u.test(lead.fullName))) errors.fullName = 'יש להזין שם מלא תקין.';
  const phone = lead.phone.replace(/[\s().-]/g, '');
  if (!errors.phone && !/^\+?[0-9]{8,15}$/.test(phone)) errors.phone = 'יש להזין מספר טלפון תקין.';
  lead.phone = phone;
  if (!errors.email && lead.email && !validEmail_(lead.email)) errors.email = 'יש להזין כתובת מייל תקינה או להשאיר את השדה ריק.';
  lead.service = cleanField_(input.service, false);
  if (LEAD_SERVICES_.indexOf(lead.service) === -1) errors.service = 'יש לבחור שירות מהרשימה.';
  if (input.consent !== true) errors.consent = 'יש לאשר את שמירת הפרטים לצורך טיפול בפנייה.';
  lead.source = input.source;
  if (['contact', 'booklet'].indexOf(lead.source) === -1) return failure_('VALIDATION');
  if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) return failure_('VALIDATION');
  lead.requestId = input.requestId.toLowerCase();
  if (input.website !== undefined && input.website !== '') return failure_('VALIDATION');
  const startedAt = input.startedAt;
  // This is only a best-effort bot signal. renderedAt is supplied by the server, not the device clock.
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0 || Date.now() - startedAt < 1200) return failure_('VALIDATION');
  if (Object.keys(errors).length) return { ok: false, code: 'VALIDATION', message: 'יש לבדוק את הפרטים המסומנים ולנסות שוב.', fieldErrors: errors };
  return { ok: true, lead: lead };
}

function validEmail_(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const local = parts[0], domain = parts[1];
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/.test(local) || local.charAt(0) === '.' || local.endsWith('.') || local.indexOf('..') !== -1) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every(function (label) { return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label); });
}

function safeCell_(value) {
  return /^[=+\-@]/.test(value.trimStart()) ? "'" + value : value;
}

function payloadHash_(lead) {
  const content = JSON.stringify([lead.fullName, lead.phone, lead.email, lead.service, lead.message, lead.source, true]);
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, content, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function leadSheet_(config) {
  const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(config.sheetName);
  if (!sheet) throw new Error('Run setupLeads_ from the editor first.');
  validateHeaders_(sheet, false);
  return sheet;
}

function validateHeaders_(sheet, initialize) {
  if (!sheet.getLastRow() && initialize) return;
  const headers = sheet.getRange(1, 1, 1, LEAD_HEADERS_.length).getValues()[0];
  const coreMatches = LEAD_HEADERS_.slice(0, 8).every(function (header, index) { return headers[index] === header; });
  const metaMatches = LEAD_HEADERS_.slice(8).every(function (header, index) { return headers[index + 8] === header; });
  const emptyMeta = headers.slice(8).every(function (value) { return !value; });
  if (!coreMatches || (!metaMatches && !(initialize && emptyMeta))) throw new Error('Unexpected spreadsheet headers. No data was overwritten.');
}

function ensureRow_(sheet, row) {
  if (row > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), 100);
    const first = sheet.getMaxRows() - 99;
    sheet.getRange(first, 1, 100, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sheet.getRange(first, 2, 100, 10).setNumberFormat('@');
    sheet.getRange(first, 12, 100, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    // Extending the filter preserves existing criteria. Hidden IDs stay part of row sorting.
    const filter = sheet.getFilter();
    if (filter) {
      const criteria = LEAD_HEADERS_.map(function (_, index) { return filter.getColumnFilterCriteria(index + 1); });
      filter.remove();
      const next = sheet.getRange(1, 1, sheet.getMaxRows(), LEAD_HEADERS_.length).createFilter();
      criteria.forEach(function (criterion, index) { if (criterion) next.setColumnFilterCriteria(index + 1, criterion); });
    }
  }
}

function findRequestRow_(sheet, requestId) {
  if (sheet.getLastRow() < 2) return 0;
  const found = sheet.getRange(2, 9, sheet.getLastRow() - 1, 1).createTextFinder(requestId).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function consumeRate_(phone) {
  // Anonymous Apps Script requests have no dependable client IP. This is best-effort, not bot-proof.
  try {
    const cache = CacheService.getScriptCache();
    const key = 'lead-phone:' + payloadHash_({ fullName: '', phone: phone, email: '', service: '', message: '', source: 'rate' });
    const count = Number(cache.get(key)) || 0;
    if (count >= 3) return false;
    cache.put(key, String(count + 1), 900);
  } catch (error) { console.warn('Lead rate limiting is temporarily unavailable.'); }
  return true;
}

function notifyLead_(config, lead, receivedAt) {
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Mail quota exhausted');
  const lines = [
    'התקבלה פנייה חדשה באתר של ישראל פורטנוי.', '',
    'מועד: ' + Utilities.formatDate(receivedAt, LEAD_ZONE_, 'dd/MM/yyyy HH:mm'),
    'שם: ' + lead.fullName, 'טלפון: ' + lead.phone, 'מייל: ' + (lead.email || 'לא נמסר'),
    'שירות: ' + lead.service, 'מקור: ' + (lead.source === 'booklet' ? 'הורדת חוברת' : 'טופס יצירת קשר'),
    '', 'הודעה:', lead.message || 'לא נמסרה', '',
    'הפנייה נשמרה בגיליון. סטטוס טיפול: חדש.',
  ];
  const message = { to: config.recipient, subject: 'פנייה חדשה מהאתר — ' + lead.service, body: lines.join('\n'), name: 'האתר של ישראל פורטנוי' };
  if (lead.email) message.replyTo = lead.email;
  MailApp.sendEmail(message);
}

function markNotification_(config, requestId, state) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Notification status is busy');
  try {
    const sheet = leadSheet_(config);
    const row = findRequestRow_(sheet, requestId);
    if (!row) throw new Error('Saved lead could not be found');
    sheet.getRange(row, 11, 1, 2).setValues([[state, new Date()]]);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

function acknowledgement_(requestId, duplicate) {
  return { ok: true, saved: true, requestId: requestId, duplicate: duplicate };
}

function failure_(code) {
  const messages = {
    VALIDATION: 'לא ניתן לשלוח את הפנייה עם הפרטים האלה. יש לבדוק את השדות ולנסות שוב.',
    BUSY: 'המערכת מטפלת כרגע בפנייה נוספת. אפשר לנסות שוב בעוד כמה שניות.',
    RATE_LIMIT: 'התקבלו כמה פניות בזמן קצר. אפשר להמתין מעט ולנסות שוב, או ליצור קשר בטלפון.',
    CONFLICT: 'פרטי הפנייה השתנו לאחר ניסיון שליחה. יש לרענן את הטופס לפני פנייה חדשה.',
    UNAVAILABLE: 'לא התקבל אישור שמירה. אפשר לנסות שוב; ניסיון חוזר עם אותם פרטים לא ייצור פנייה כפולה.',
  };
  return { ok: false, code: code, message: messages[code] || messages.UNAVAILABLE };
}

/** Register consent for future email updates. This operation sends no email. */
function subscribeUpdates(input) {
  const validation = validateUpdates_(input);
  if (!validation.ok) return validation;
  const subscriber = validation.subscriber;
  let config;
  try { config = updatesConfig_(); }
  catch (error) { return updatesFailure_('UNAVAILABLE'); }
  const lock = LockService.getScriptLock();
  let locked = false;
  let receivedAt;
  try {
    locked = lock.tryLock(10000);
    if (!locked) return updatesFailure_('BUSY');
    const sheet = updatesSheet_(config);
    const hash = updatesPayloadHash_(subscriber);
    const byRequest = findUpdatesRow_(sheet, 8, subscriber.requestId);
    if (byRequest) {
      const previous = sheet.getRange(byRequest, 5, 1, 5).getValues()[0];
      if (String(previous[4]) !== hash || previous[0] !== 'רשום') return updatesFailure_('CONFLICT');
      return acknowledgement_(subscriber.requestId, true);
    }
    const byEmail = findUpdatesEmailRow_(sheet, subscriber.email);
    if (byEmail) {
      const status = sheet.getRange(byEmail, 5).getValue();
      if (status === 'רשום') return acknowledgement_(subscriber.requestId, true);
      // A new explicit opt-in can re-register an address removed manually; retain its old consent row.
      if (status !== 'הוסר') return updatesFailure_('UNAVAILABLE');
    }
    if (!consumeUpdatesRate_(subscriber.email)) return updatesFailure_('RATE_LIMIT');
    receivedAt = new Date();
    const row = sheet.getLastRow() + 1;
    ensureUpdatesRow_(sheet, row);
    const values = [receivedAt, safeCell_(subscriber.fullName), safeCell_(subscriber.email),
      subscriber.source === 'exit' ? 'באנר יציאה' : 'עמוד החוברת', 'רשום', UPDATES_CONSENT_TEXT_, UPDATES_CONSENT_VERSION_,
      subscriber.requestId, hash];
    sheet.getRange(row, 1, 1, UPDATES_HEADERS_.length).setValues([values]);
    SpreadsheetApp.flush();
    const confirmation = sheet.getRange(row, 8, 1, 2).getValues()[0];
    if (confirmation[0] !== subscriber.requestId || confirmation[1] !== hash) throw new Error('Subscription write not confirmed');
  } catch (error) {
    console.warn('Subscription write was not confirmed. Retry with the same request ID.');
    return updatesFailure_('UNAVAILABLE');
  } finally {
    if (locked) lock.releaseLock();
  }
  return acknowledgement_(subscriber.requestId, false);
}

/** Run from a temporary editor wrapper, then remove the wrapper before deployment. */
function setupUpdates_() {
  const config = updatesConfig_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('הרשימה בשימוש. נסו שוב.');
  try {
    const book = SpreadsheetApp.openById(config.spreadsheetId);
    // Use the existing configured sheet. Never create another mailing list automatically.
    const sheet = book.getSheetByName(config.sheetName);
    if (!sheet) throw new Error('לא נמצאה לשונית הרשימה שהוגדרה. לא נוצרה רשימה נוספת.');
    const lastRow = sheet.getLastRow();
    const headers = sheet.getRange(1, 1, 1, Math.min(LEAD_HEADERS_.length, sheet.getMaxColumns())).getValues()[0];
    const updates = UPDATES_HEADERS_.every(function (header, index) { return headers[index] === header; }) && headers.slice(UPDATES_HEADERS_.length).every(function (value) { return !value; });
    const legacy = LEAD_HEADERS_.every(function (header, index) { return headers[index] === header; });
    const empty = !lastRow;
    if (!updates && !legacy && !empty) throw new Error('כותרות הרשימה אינן תואמות. לא שונו נתונים.');
    if (typeof sheet.getLastColumn === 'function' && sheet.getLastColumn() > LEAD_HEADERS_.length) throw new Error('נמצאו נתונים מחוץ לטבלת הרשימה. לא שונו נתונים.');
    if (legacy) {
      if (lastRow > 2) throw new Error('נמצאו פניות קיימות. המרת הרשימה נעצרה ללא שינוי.');
      if (lastRow === 2) {
        const previous = sheet.getRange(2, 1, 1, LEAD_HEADERS_.length).getValues()[0];
        const knownTest = { fullName: 'בדיקת מערכת', phone: '0500000000', email: '', service: 'שאלה אחרת',
          message: 'בדיקת מערכת יזומה — נא להתעלם. זו אינה פנייה של לקוח. בדיקת התקנה לשמירה בגיליון ולהתראה במייל.', source: 'contact' };
        if (previous[8] !== UPDATES_LEGACY_TEST_ID_ || previous[1] !== knownTest.fullName || String(previous[2]) !== knownTest.phone || previous[3] !== '' ||
            previous[4] !== knownTest.service || previous[5] !== knownTest.message || previous[6] !== 'טופס יצירת קשר' || previous[7] !== 'חדש' || previous[9] !== payloadHash_(knownTest) ||
            ['sent', 'pending', 'failed', 'retrying'].indexOf(previous[10]) === -1) {
          throw new Error('נמצאו נתונים שאינם רשומת הבדיקה המוכרת. לא שונו נתונים.');
        }
      }
    }
    const filter = sheet.getFilter();
    if (filter && (filter.getRange().getColumn() !== 1 || filter.getRange().getRow() !== 1 || filter.getRange().getNumColumns() !== (legacy ? LEAD_HEADERS_.length : UPDATES_HEADERS_.length))) {
      throw new Error('המסנן אינו תואם לרשימה. לא שונו נתונים.');
    }
    // All destructive migration checks precede the first write. Only the known synthetic test is cleared.
    if (legacy) {
      if (filter) filter.remove();
      sheet.getRange(1, 1, lastRow, LEAD_HEADERS_.length).clearContent();
      sheet.getRange(1, 1, sheet.getMaxRows(), LEAD_HEADERS_.length).clearDataValidations();
    }
    if (sheet.getMaxColumns() < UPDATES_HEADERS_.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), UPDATES_HEADERS_.length - sheet.getMaxColumns());
    book.setSpreadsheetTimeZone(LEAD_ZONE_);
    sheet.setRightToLeft(true);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, UPDATES_HEADERS_.length).setValues([UPDATES_HEADERS_]).setFontWeight('bold').setBackground('#063f2e').setFontColor('#ffffff').setWrap(true);
    sheet.setRowHeight(1, 42);
    const rows = Math.max(1, sheet.getMaxRows() - 1);
    sheet.getRange(2, 1, rows, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sheet.getRange(2, 2, rows, 8).setNumberFormat('@');
    sheet.getRange(2, 6, rows, 1).setWrap(true);
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(['רשום', 'הוסר'], true).setAllowInvalid(false).build();
    sheet.getRange(2, 5, rows, 1).setDataValidation(rule);
    [185, 170, 260, 170, 115, 420, 150].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.showColumns(1, Math.min(12, sheet.getMaxColumns()));
    sheet.hideColumns(8, 2);
    if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), UPDATES_HEADERS_.length).createFilter();
    SpreadsheetApp.flush();
    return { ok: true, spreadsheetUrl: book.getUrl(), sheetName: sheet.getName() };
  } finally { lock.releaseLock(); }
}

function validateUpdates_(input) {
  if (!input || Object.prototype.toString.call(input) !== '[object Object]') return updatesFailure_('VALIDATION');
  const errors = {};
  const subscriber = {};
  ['fullName', 'email'].forEach(function (field) {
    const value = input[field] === undefined && field === 'fullName' ? '' : input[field];
    if (typeof value !== 'string' || value.length > LEAD_LIMITS_[field]) {
      errors[field] = 'יש להזין ערך תקין באורך המותר.';
      subscriber[field] = '';
    } else subscriber[field] = cleanField_(value, false);
  });
  if (!errors.fullName && subscriber.fullName && (subscriber.fullName.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’"״׳\-–]*$/u.test(subscriber.fullName))) errors.fullName = 'יש להזין שם תקין או להשאיר את השדה ריק.';
  if (!errors.email && !validEmail_(subscriber.email)) errors.email = 'יש להזין כתובת מייל תקינה לקבלת העדכונים.';
  subscriber.email = subscriber.email.toLowerCase();
  if (input.consent !== true) errors.consent = 'יש לאשר קבלת עדכונים במייל ושמירת הפרטים לצורך זה.';
  if (['updates', 'exit'].indexOf(input.source) === -1 || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId)) return updatesFailure_('VALIDATION');
  if (input.website !== undefined && input.website !== '') return updatesFailure_('VALIDATION');
  if (typeof input.startedAt !== 'number' || !Number.isFinite(input.startedAt) || input.startedAt <= 0 || Date.now() - input.startedAt < 1200) return updatesFailure_('VALIDATION');
  if (Object.keys(errors).length) return { ok: false, code: 'VALIDATION', message: 'יש לבדוק את הפרטים המסומנים ולנסות שוב.', fieldErrors: errors };
  subscriber.source = input.source;
  subscriber.requestId = input.requestId.toLowerCase();
  return { ok: true, subscriber: subscriber };
}

function updatesConfig_() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = (props.getProperty('SPREADSHEET_ID') || '').trim();
  const sheetName = (props.getProperty('SHEET_NAME') || 'פניות').trim();
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(spreadsheetId) || !sheetName || sheetName.length > 80 || /[\[\]:*?\/\\\u0000-\u001f]/.test(sheetName)) {
    throw new Error('Configure SPREADSHEET_ID and SHEET_NAME in Script Properties.');
  }
  return { spreadsheetId: spreadsheetId, sheetName: sheetName };
}

function updatesPayloadHash_(subscriber) {
  return updatesDigest_([subscriber.fullName, subscriber.email, subscriber.source, UPDATES_CONSENT_VERSION_, true]);
}

function updatesDigest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function updatesSheet_(config) {
  const sheet = SpreadsheetApp.openById(config.spreadsheetId).getSheetByName(config.sheetName);
  if (!sheet) throw new Error('Run setupUpdates_ from the editor first.');
  const headers = sheet.getRange(1, 1, 1, Math.min(LEAD_HEADERS_.length, sheet.getMaxColumns())).getValues()[0];
  if (!UPDATES_HEADERS_.every(function (header, index) { return headers[index] === header; }) || headers.slice(UPDATES_HEADERS_.length).some(function (value) { return value; })) throw new Error('Unexpected subscription headers. No data was overwritten.');
  return sheet;
}

function findUpdatesRow_(sheet, column, value) {
  if (sheet.getLastRow() < 2) return 0;
  const found = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).createTextFinder(value).matchEntireCell(true).findNext();
  return found ? found.getRow() : 0;
}

function findUpdatesEmailRow_(sheet, email) {
  if (sheet.getLastRow() < 2) return 0;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, UPDATES_HEADERS_.length).getValues();
  let latestRow = 0;
  let latestTime = -Infinity;
  let latestId = '';
  // Users may sort the sheet. Consent chronology comes from column A, not physical row order.
  rows.forEach(function (values, index) {
    if (String(values[2]).replace(/^'(?=[=+\-@])/, '').trim().toLowerCase() !== email) return;
    if (!(values[0] instanceof Date) || !Number.isFinite(values[0].getTime())) throw new Error('Subscription consent time is invalid');
    const time = values[0].getTime();
    const requestId = String(values[7]);
    // Request IDs provide a stable tie-break for identical timestamps, independent of sorting.
    if (time > latestTime || (time === latestTime && requestId > latestId)) {
      latestRow = index + 2;
      latestTime = time;
      latestId = requestId;
    }
  });
  return latestRow;
}

function ensureUpdatesRow_(sheet, row) {
  if (row <= sheet.getMaxRows()) return;
  sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  const first = sheet.getMaxRows() - 99;
  sheet.getRange(first, 1, 100, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  sheet.getRange(first, 2, 100, 8).setNumberFormat('@');
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['רשום', 'הוסר'], true).setAllowInvalid(false).build();
  sheet.getRange(first, 5, 100, 1).setDataValidation(rule);
  const filter = sheet.getFilter();
  if (filter) {
    const criteria = UPDATES_HEADERS_.map(function (_, index) { return filter.getColumnFilterCriteria(index + 1); });
    filter.remove();
    const next = sheet.getRange(1, 1, sheet.getMaxRows(), UPDATES_HEADERS_.length).createFilter();
    criteria.forEach(function (criterion, index) { if (criterion) next.setColumnFilterCriteria(index + 1, criterion); });
  }
}

function consumeUpdatesRate_(email) {
  try {
    const cache = CacheService.getScriptCache();
    const keys = ['updates-global', 'updates-email:' + updatesDigest_(email)];
    const limits = [30, 3];
    const counts = keys.map(function (key) { return Number(cache.get(key)) || 0; });
    if (counts.some(function (count, index) { return count >= limits[index]; })) return false;
    keys.forEach(function (key, index) { cache.put(key, String(counts[index] + 1), 900); });
  } catch (error) { console.warn('Subscription rate limiting is temporarily unavailable.'); }
  return true;
}

function updatesFailure_(code) {
  const messages = {
    VALIDATION: 'לא ניתן להירשם עם הפרטים האלה. יש לבדוק את השדות ולנסות שוב.',
    BUSY: 'המערכת עסוקה כרגע. אפשר לנסות שוב בעוד כמה שניות.',
    RATE_LIMIT: 'התקבלו כמה בקשות בזמן קצר. אפשר להמתין מעט ולנסות שוב.',
    CONFLICT: 'פרטי ההרשמה השתנו. יש לרענן את הטופס לפני ניסיון חדש.',
    UNAVAILABLE: 'לא התקבל אישור שמירה. אפשר לנסות שוב עם אותם פרטים בלי ליצור הרשמה כפולה.',
  };
  return { ok: false, code: code, message: messages[code] || messages.UNAVAILABLE };
}
