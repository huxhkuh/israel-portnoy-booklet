const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../integrations/google-apps-script/Code.gs'), 'utf8');
const HEADERS = ['תאריך ושעת ההרשמה', 'שם מלא', 'אימייל', 'מקור ההרשמה', 'סטטוס הרשמה', 'נוסח ההסכמה', 'גרסת ההסכמה', '_request_id', '_payload_hash'];
const OLD_HEADERS = ['תאריך ושעת הפנייה', 'שם מלא', 'טלפון', 'אימייל', 'שירות מבוקש', 'הודעה', 'מקור הפנייה', 'סטטוס טיפול', '_request_id', '_payload_hash', '_notification_status', '_notification_updated_at'];
const TEST_ID = '417412e4-e685-4aba-a8f0-8e4127d3a941';
const uuid = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const input = (changes = {}) => ({ fullName: 'בדיקת מערכת', email: 'Reader@Example.invalid', source: 'updates', consent: true, website: '', requestId: uuid(1), startedAt: Date.now() - 3000, ...changes });
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const knownMessage = 'בדיקת מערכת יזומה — נא להתעלם. זו אינה פנייה של לקוח. בדיקת התקנה לשמירה בגיליון ולהתראה במייל.';
const knownTest = () => [new Date(), 'בדיקת מערכת', '0500000000', '', 'שאלה אחרת', knownMessage, 'טופס יצירת קשר', 'חדש', TEST_ID,
  digest(['בדיקת מערכת', '0500000000', '', 'שאלה אחרת', knownMessage, 'contact', true]), 'sent', new Date()];

function sandbox(options = {}) {
  const state = { grid: (options.grid || [HEADERS]).map(row => row.slice()), writes: 0, clears: 0, sent: [], quotaCalls: 0, warnings: [], formats: [],
    rate: new Map(), lockCalls: 0, releases: 0, flushes: 0, maxRows: options.maxRows || 1000, maxColumns: options.maxColumns || 26,
    zone: null, frozen: 0, hidden: null, filter: null, insertedSheets: 0,
    properties: { SPREADSHEET_ID: 'private-test-spreadsheet', SHEET_NAME: 'פניות', ...options.properties } };
  const lastRow = () => { for (let index = state.grid.length - 1; index >= 0; index--) if (state.grid[index].some(value => value !== '' && value !== null && value !== undefined)) return index + 1; return 0; };
  const ensureCell = (row, column) => { while (state.grid.length < row) state.grid.push([]); while (state.grid[row - 1].length < column) state.grid[row - 1].push(''); };
  function range(row, column, rows = 1, columns = 1) {
    assert.ok(row > 0 && column > 0 && rows > 0 && columns > 0);
    assert.ok(row + rows - 1 <= state.maxRows && column + columns - 1 <= state.maxColumns);
    return {
      getValues() {
        const values = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => state.grid[row + r - 1]?.[column + c - 1] ?? ''));
        if (options.badReadback && row > 1 && column === 8 && columns === 2) values[0][0] = 'wrong';
        return values;
      },
      getValue() { return this.getValues()[0][0]; },
      setValues(values) {
        assert.equal(values.length, rows); assert.ok(values.every(value => value.length === columns));
        if (row > 1 && column === 1) { if (options.failWrite) throw new Error('Private spreadsheet failure'); state.writes++; }
        values.forEach((valuesRow, r) => valuesRow.forEach((value, c) => { ensureCell(row + r, column + c); state.grid[row + r - 1][column + c - 1] = value; }));
        return this;
      },
      clearContent() { state.clears++; for (let r = row; r < row + rows; r++) for (let c = column; c < column + columns; c++) { ensureCell(r, c); state.grid[r - 1][c - 1] = ''; } return this; },
      clearDataValidations() { return this; },
      setNumberFormat(format) { state.formats.push({ row, column, rows, columns, format }); return this; },
      setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setWrap() { return this; }, setDataValidation() { return this; },
      getRow: () => row, getColumn: () => column, getNumColumns: () => columns, getNumRows: () => rows,
      createTextFinder(text) { return { matchEntireCell() { return this; }, findNext() { for (let r = row; r < row + rows; r++) if (state.grid[r - 1]?.[column - 1] === text) return { getRow: () => r }; return null; } }; },
      createFilter() {
        state.filter = { getRange: () => range(row, column, rows, columns), getColumnFilterCriteria: () => null, setColumnFilterCriteria() {}, remove() { state.filter = null; } };
        return state.filter;
      },
    };
  }
  const sheet = { getRange: range, getName: () => 'פניות', getLastRow: lastRow, getMaxRows: () => state.maxRows, getMaxColumns: () => state.maxColumns,
    getLastColumn: () => Math.max(0, ...state.grid.map(row => { for (let index = row.length - 1; index >= 0; index--) if (row[index] !== '' && row[index] !== null && row[index] !== undefined) return index + 1; return 0; })),
    insertRowsAfter(_, count) { state.maxRows += count; }, insertColumnsAfter(_, count) { state.maxColumns += count; },
    setRightToLeft(value) { state.rtl = value; }, setFrozenRows(value) { state.frozen = value; }, setRowHeight() {}, setColumnWidth() {},
    showColumns(start, count) { state.shown = [start, count]; }, hideColumns(start, count) { state.hidden = [start, count]; }, getFilter: () => state.filter };
  if (options.filterColumns) range(1, 1, state.maxRows, options.filterColumns).createFilter();
  const book = { getSheetByName: name => options.missingSheet || name !== 'פניות' ? null : sheet, insertSheet() { state.insertedSheets++; throw new Error('A separate sheet must not be created'); },
    setSpreadsheetTimeZone(value) { state.zone = value; }, getUrl: () => 'https://docs.google.com/spreadsheets/d/private-test-spreadsheet/edit' };
  const lock = { tryLock() { state.lockCalls++; return !options.busy; }, releaseLock() { state.releases++; } };
  const validation = { requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } };
  const template = { evaluate() { return { setTitle(value) { state.title = value; return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }; } };
  const context = vm.createContext({ Date, console: { warn(message) { state.warnings.push(message); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => state.properties[name] || null }) },
    LockService: { getScriptLock: () => lock },
    SpreadsheetApp: { openById: id => { assert.equal(id, 'private-test-spreadsheet'); return book; }, newDataValidation: () => validation,
      flush() { state.flushes++; if (options.failFlushOnce && state.flushes === 1) throw new Error('Ambiguous flush'); } },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (algorithm, content) => [...crypto.createHash(algorithm).update(content).digest()] },
    CacheService: { getScriptCache: () => ({ get: key => state.rate.get(key) || null, put(key, value, seconds) { assert.equal(seconds, 900); state.rate.set(key, value); } }) },
    MailApp: { getRemainingDailyQuota() { state.quotaCalls++; throw new Error('Subscription must not access MailApp'); }, sendEmail(message) { state.sent.push(message); throw new Error('Subscription must not send email'); } },
    HtmlService: { createTemplateFromFile: () => template, XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' } },
  });
  vm.runInContext(script, context, { filename: 'Code.gs' });
  return { state, context, sheet, template };
}

test('subscription stores explicit consent in the existing sheet without sending any email', () => {
  const { state, context } = sandbox();
  const result = context.subscribeUpdates(input());
  assert.equal(result.saved, true); assert.equal(result.requestId, uuid(1)); assert.equal(result.duplicate, false);
  const row = state.grid[1]; assert.equal(row.length, 9); assert.ok(row[0] instanceof Date); assert.equal(row[1], 'בדיקת מערכת'); assert.equal(row[2], 'reader@example.invalid');
  assert.equal(row[3], 'עמוד החוברת'); assert.equal(row[4], 'רשום'); assert.match(row[5], /לקבל במייל עדכונים/); assert.match(row[5], /לבקש הסרה/); assert.equal(row[6], 'updates-v1');
  assert.equal(row[7], uuid(1)); assert.match(row[8], /^[0-9a-f]{64}$/); assert.equal(state.quotaCalls, 0); assert.deepEqual(state.sent, []);
  assert.equal(state.insertedSheets, 0); assert.equal(state.lockCalls, state.releases); assert.equal(JSON.stringify(result).includes('@'), false);
});

test('name is optional and exit banner source is retained', () => {
  const { state, context } = sandbox();
  assert.equal(context.subscribeUpdates(input({ fullName: undefined, source: 'exit' })).saved, true);
  assert.equal(state.grid[1][1], ''); assert.equal(state.grid[1][3], 'באנר יציאה');
});

test('retry and case-insensitive email duplicates add no rows or email', () => {
  const { state, context } = sandbox(); const payload = input();
  assert.equal(context.subscribeUpdates(payload).saved, true);
  assert.equal(context.subscribeUpdates(payload).duplicate, true);
  const duplicate = context.subscribeUpdates(input({ requestId: uuid(2), email: 'READER@EXAMPLE.INVALID', source: 'exit', fullName: '' }));
  assert.equal(duplicate.saved, true); assert.equal(duplicate.requestId, uuid(2)); assert.equal(duplicate.duplicate, true);
  assert.equal(state.writes, 1); assert.equal(state.grid.length, 2); assert.equal(state.quotaCalls, 0); assert.equal(state.sent.length, 0);
  assert.equal(context.subscribeUpdates(input({ email: 'other@example.invalid' })).code, 'CONFLICT');
});

test('missing or invalid email, consent, source, ID, types and excessive lengths fail before saving', () => {
  const invalid = [null, [], input({ email: undefined }), input({ email: '' }), input({ email: 'not-an-email' }), input({ email: 'a,b@example.invalid' }),
    input({ email: 'x@example.invalid\r\nBcc: other@example.invalid' }), input({ email: 'x'.repeat(255) }), input({ email: { value: 'x@example.invalid' } }),
    input({ fullName: 'א' }), input({ fullName: 'א'.repeat(81) }), input({ fullName: '=IMPORTXML()' }), input({ consent: false }), input({ consent: 'true' }),
    input({ source: 'contact' }), input({ requestId: 'invalid' }), input({ website: 'spam' }), input({ startedAt: Date.now() }), input({ startedAt: Infinity })];
  for (const value of invalid) { const { state, context } = sandbox(); const result = context.subscribeUpdates(value); assert.equal(result.ok, false); assert.equal(result.code, 'VALIDATION'); assert.equal(state.writes, 0); assert.equal(state.sent.length, 0); }
});

test('formula-prefixed email is escaped and its normalized duplicate is still recognized', () => {
  const { state, context } = sandbox();
  assert.equal(context.subscribeUpdates(input({ email: '+tag@Example.invalid' })).saved, true);
  assert.equal(state.grid[1][2], "'+tag@example.invalid");
  assert.equal(context.subscribeUpdates(input({ requestId: uuid(2), email: '+TAG@example.invalid' })).duplicate, true); assert.equal(state.writes, 1);
});

test('write failure, unreadable confirmation, missing configuration and contention never falsely succeed', () => {
  for (const options of [{ failWrite: true }, { badReadback: true }, { properties: { SPREADSHEET_ID: '' } }, { busy: true }, { missingSheet: true }]) {
    const { state, context } = sandbox(options); assert.equal(context.subscribeUpdates(input()).saved, undefined); assert.equal(state.sent.length, 0);
    if (!options.busy) assert.equal(state.lockCalls, state.releases);
    assert.equal(state.warnings.some(line => /בדיקת מערכת|reader@/.test(line)), false);
  }
});

test('an ambiguous commit is acknowledged on retry without duplicating the subscriber', () => {
  const { state, context } = sandbox({ failFlushOnce: true });
  assert.equal(context.subscribeUpdates(input()).code, 'UNAVAILABLE'); assert.equal(state.grid.length, 2);
  assert.equal(context.subscribeUpdates(input()).duplicate, true); assert.equal(state.writes, 1); assert.equal(state.quotaCalls, 0);
});

test('global rate limit applies to distinct new emails while registered subscribers can retry', () => {
  const { state, context } = sandbox();
  for (let index = 1; index <= 30; index++) assert.equal(context.subscribeUpdates(input({ requestId: uuid(index), email: `reader${index}@example.invalid` })).saved, true);
  assert.equal(context.subscribeUpdates(input({ requestId: uuid(31), email: 'reader31@example.invalid' })).code, 'RATE_LIMIT');
  assert.equal(context.subscribeUpdates(input({ requestId: uuid(1), email: 'reader1@example.invalid' })).duplicate, true);
  assert.ok([...state.rate.keys()].every(key => !key.includes('@'))); assert.equal(state.writes, 30);
});

test('manual removal is respected by old retries, and new consent can be recorded separately', () => {
  const { state, context } = sandbox(); context.subscribeUpdates(input()); state.grid[1][4] = 'הוסר';
  assert.equal(context.subscribeUpdates(input()).code, 'CONFLICT');
  assert.equal(context.subscribeUpdates(input({ requestId: uuid(2) })).duplicate, false); assert.equal(state.grid.length, 3); assert.equal(state.grid[1][4], 'הוסר'); assert.equal(state.grid[2][4], 'רשום');
  assert.equal(context.subscribeUpdates(input({ requestId: uuid(3) })).duplicate, true); assert.equal(state.grid.length, 3);
});

test('sorting removed and re-subscribed rows does not change which consent is current', () => {
  const { state, context } = sandbox(); context.subscribeUpdates(input());
  state.grid[1][0] = new Date(Date.now() - 10000); state.grid[1][4] = 'הוסר';
  context.subscribeUpdates(input({ requestId: uuid(2) }));
  const old = state.grid[1]; const latest = state.grid[2];
  assert.equal(latest[4], 'רשום'); assert.ok(latest[0] > old[0]);
  state.grid.splice(1, 2, latest, old);
  const writes = state.writes;
  assert.equal(context.subscribeUpdates(input({ requestId: uuid(3) })).duplicate, true);
  assert.equal(state.writes, writes); assert.equal(state.grid.length, 3);
  // Removing the latest consent remains effective even when an older active row is physically last.
  latest[4] = 'הוסר'; old[4] = 'רשום';
  assert.equal(context.subscribeUpdates(input({ requestId: uuid(4) })).duplicate, false);
  assert.equal(state.writes, writes + 1); assert.equal(state.grid.length, 4);
});

test('identical consent timestamps use the request ID as a sort-independent tie-break', () => {
  const { state, context } = sandbox(); context.subscribeUpdates(input()); state.grid[1][4] = 'הוסר';
  context.subscribeUpdates(input({ requestId: uuid(2) }));
  state.grid[2][0] = state.grid[1][0]; state.grid.splice(1, 2, state.grid[2], state.grid[1]);
  assert.equal(context.subscribeUpdates(input({ requestId: uuid(3) })).duplicate, true); assert.equal(state.grid.length, 3);
});

test('migration replaces only the known synthetic test and retains the original sheet', () => {
  const { state, context } = sandbox({ grid: [OLD_HEADERS, knownTest()], filterColumns: 12 });
  const result = context.setupUpdates_();
  assert.equal(result.ok, true); assert.equal(result.sheetName, 'פניות'); assert.deepEqual(state.grid[0].slice(0, 9), HEADERS); assert.ok(state.grid[0].slice(9).every(value => value === ''));
  assert.ok(state.grid[1].every(value => value === '')); assert.equal(state.insertedSheets, 0); assert.equal(state.zone, 'Asia/Jerusalem'); assert.equal(state.frozen, 1); assert.equal(state.rtl, true);
  assert.deepEqual(state.hidden, [8, 2]); assert.equal(state.filter.getRange().getNumColumns(), 9);
  assert.equal(context.subscribeUpdates(input()).saved, true); assert.equal(state.grid[1][2], 'reader@example.invalid');
});

test('migration refuses real or changed data, unexpected headers and unsafe filters without clearing anything', () => {
  const changedTest = knownTest(); changedTest[3] = 'real@example.invalid';
  const realLead = knownTest(); realLead[8] = uuid(77);
  const unrelated = OLD_HEADERS.slice(); unrelated[0] = 'נתונים אחרים';
  const extraColumn = knownTest(); extraColumn[12] = 'הערה נוספת';
  for (const options of [{ grid: [OLD_HEADERS, realLead] }, { grid: [OLD_HEADERS, knownTest(), knownTest()] }, { grid: [OLD_HEADERS, changedTest] },
    { grid: [unrelated, knownTest()] }, { grid: [OLD_HEADERS, extraColumn] }, { grid: [OLD_HEADERS, knownTest()], filterColumns: 8 }]) {
    const { state, context } = sandbox(options); const before = JSON.stringify(state.grid);
    assert.throws(() => context.setupUpdates_()); assert.equal(JSON.stringify(state.grid), before); assert.equal(state.clears, 0); assert.equal(state.zone, null); assert.equal(state.formats.length, 0); assert.equal(state.insertedSheets, 0);
  }
});

test('setup preserves existing subscriptions and also supports the empty existing sheet', () => {
  const { state, context } = sandbox(); context.subscribeUpdates(input()); const saved = state.grid[1].slice(); context.setupUpdates_(); assert.deepEqual(state.grid[1], saved);
  const empty = sandbox({ grid: [], maxColumns: 9 }); assert.equal(empty.context.setupUpdates_().ok, true); assert.deepEqual(empty.state.grid[0], HEADERS);
  const missing = sandbox({ missingSheet: true }); assert.throws(() => missing.context.setupUpdates_()); assert.equal(missing.state.insertedSheets, 0);
});

test('rendered updates config is public, defaults to signup, and exposes the exact stored consent text', () => {
  const { state, context, template } = sandbox(); context.doGet({ parameter: { source: 'exit', embed: '1' } });
  const config = JSON.parse(template.publicConfigJson);
  assert.equal(config.mode, 'updates'); assert.equal(config.embedded, true); assert.equal(config.source, 'exit'); assert.equal(config.consentVersion, 'updates-v1');
  assert.equal(config.consentText, context.subscribeUpdates(input()).saved && state.grid[1][5]);
  assert.equal(state.title, 'עדכונים מישראל פורטנוי'); assert.equal(template.publicConfigJson.includes('private-test-spreadsheet'), false);
  context.doGet({ parameter: { source: 'attacker' } }); assert.equal(JSON.parse(template.publicConfigJson).source, 'updates');
  context.doGet({ parameter: { mode: 'contact', source: 'booklet' } }); assert.equal(JSON.parse(template.publicConfigJson).source, 'booklet'); assert.equal(state.title, 'יצירת קשר — ישראל פורטנוי');
});
