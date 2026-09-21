import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const moduleUrl = new URL('../script-transfer.js', import.meta.url);
const fixedNow = 1800000000000;
const source = fs.existsSync(moduleUrl) ? fs.readFileSync(moduleUrl, 'utf8') : '';
const context = { window: {}, TextEncoder, Date: class extends Date { static now() { return fixedNow; } } };
vm.runInNewContext(source, context);
const transfer = context.window.FXTransfer;
const plain = value => JSON.parse(JSON.stringify(value));
const bundle = scripts => JSON.stringify({ format: 'fuxian-teleprompter', version: 1, scripts });
const expectThaiError = action => assert.throws(action, error => /[ก-๙]/.test(error.message));

test('exposes the immutable browser transfer API', () => {
  assert.ok(transfer, 'script-transfer.js must expose window.FXTransfer');
  assert.equal(Object.isFrozen(transfer), true);
  assert.deepEqual(Object.keys(transfer).sort(), ['filenameFor', 'makeBackup', 'mergeScripts', 'parseImport']);
});

test('imports TXT and Markdown with a filename-derived name and exact text', () => {
  assert.deepEqual(plain(transfer.parseImport('เปิดไลฟ์.TXT', '\uFEFF  สวัสดี\r\n\r\nลูกค้า  ')), [
    { name: 'เปิดไลฟ์', text: '  สวัสดี\r\n\r\nลูกค้า  ', pos: 0 }
  ]);
  assert.deepEqual(plain(transfer.parseImport('folder/สคริปต์.v2.md', '# หัวข้อ\n*สำคัญ*')), [
    { name: 'สคริปต์.v2', text: '# หัวข้อ\n*สำคัญ*', pos: 0 }
  ]);
});

test('imports a versioned backup without importing local IDs or reading positions', () => {
  const input = bundle([{ id: 77, name: '  เปิดไลฟ์  ', text: 'เนื้อหา\n', pos: 999, extra: 'ignore' }]);
  assert.deepEqual(plain(transfer.parseImport('backup.json', '\uFEFF' + input)), [
    { name: '  เปิดไลฟ์  ', text: 'เนื้อหา\n', pos: 0 }
  ]);
});

test('imports legacy arrays including a saved blank draft', () => {
  assert.deepEqual(plain(transfer.parseImport('old.json', JSON.stringify([
    { id: 3, name: 'ต้นฉบับ', text: '\uFEFFข้อความ', pos: 8 },
    { id: 4, name: 'แบบร่าง', text: '', pos: 0 }
  ]))), [{ name: 'ต้นฉบับ', text: 'ข้อความ', pos: 0 }, { name: 'แบบร่าง', text: '', pos: 0 }]);
});

test('rejects empty text files and empty JSON collections', () => {
  for (const [name, text] of [['a.txt', ''], ['a.md', '\uFEFF \n\t'], ['a.json', '[]'], ['a.json', bundle([])]]) {
    expectThaiError(() => transfer.parseImport(name, text));
  }
});

test('rejects malformed JSON, unsupported formats and unsupported versions', () => {
  for (const input of ['{bad', 'null', '42', '{}', '{"scripts":[]}',
    JSON.stringify({ format: 'other-app', version: 1, scripts: [{ name: 'a', text: 'b' }] }),
    JSON.stringify({ format: 'fuxian-teleprompter', version: 2, scripts: [{ name: 'a', text: 'b' }] }),
    JSON.stringify({ format: 'fuxian-teleprompter', version: '1', scripts: [{ name: 'a', text: 'b' }] })]) {
    expectThaiError(() => transfer.parseImport('bad.json', input));
  }
});

test('rejects an entire legacy file when any script has an invalid name or text', () => {
  for (const invalid of [null, 4, [], {}, { name: '', text: 'b' }, { name: ' \n ', text: 'b' },
    { name: 4, text: 'b' }, { name: 'a', text: null }, { name: 'a', text: {} },
    { name: 'a', text: 42 }, { name: 'a', text: ['b'] }]) {
    expectThaiError(() => transfer.parseImport('bad.json', JSON.stringify([{ name: 'valid', text: 'keep' }, invalid])));
  }
});

test('rejects unsupported extensions and non-string input', () => {
  for (const [name, text] of [['bad.html', 'hello'], ['noextension', 'hello'], [null, 'hello'], ['a.txt', null]]) {
    expectThaiError(() => transfer.parseImport(name, text));
  }
});

test('retains script, name and text limits for legacy and plain-text imports', () => {
  const valid = Array.from({ length: 200 }, (_, i) => ({ name: 'a' + i, text: 'b' }));
  assert.equal(transfer.parseImport('max.json', JSON.stringify(valid)).length, 200);
  expectThaiError(() => transfer.parseImport('too-many.json', JSON.stringify([...valid, { name: 'extra', text: 'b' }])));
  assert.equal(transfer.parseImport('max.json', JSON.stringify([{ name: 'a'.repeat(200), text: 'b'.repeat(500000) }]))[0].text.length, 500000);
  expectThaiError(() => transfer.parseImport('long.json', JSON.stringify([{ name: 'a'.repeat(201), text: 'b' }])));
  expectThaiError(() => transfer.parseImport('long.json', JSON.stringify([{ name: 'a', text: 'b'.repeat(500001) }])));
  expectThaiError(() => transfer.parseImport('a'.repeat(201) + '.txt', 'body'));
  expectThaiError(() => transfer.parseImport('long.txt', 'b'.repeat(500001)));
});

test('enforces the legacy 2 MiB limit using UTF-8 bytes, not JavaScript character count', () => {
  const input = JSON.stringify([{ name: 'หนึ่ง', text: 'ก'.repeat(350000) }, { name: 'สอง', text: 'ข'.repeat(350000) }]);
  assert.ok(input.length < 2 * 1024 * 1024);
  assert.ok(Buffer.byteLength(input, 'utf8') > 2 * 1024 * 1024);
  expectThaiError(() => transfer.parseImport('large.json', input));
  assert.equal(transfer.parseImport('ok.json', JSON.stringify([{ name: 'หนึ่ง', text: 'ก'.repeat(340000) }, { name: 'สอง', text: 'ข'.repeat(340000) }])).length, 2);
});

test('HTML, script tags and prototype-shaped JSON remain plain data', () => {
  const malicious = '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>';
  const raw = '[{"name":"' + malicious.replaceAll('"', '\\"') + '","text":"' + malicious.replaceAll('"', '\\"') + '","__proto__":{"pwned":true}}]';
  const parsed = transfer.parseImport('data.json', raw);
  assert.equal(parsed[0].name, malicious);
  assert.equal(parsed[0].text, malicious);
  assert.deepEqual(Object.keys(parsed[0]).sort(), ['name', 'pos', 'text']);
  assert.equal(context.window.pwned, undefined);
  assert.equal(vm.runInNewContext('({}).pwned', context), undefined);
});

test('backup contains only portable fields and can be reimported', () => {
  const original = [{ id: 42, name: 'บทพูด', text: '  เนื้อหา\n', pos: 300, secret: 'private' }];
  const saved = JSON.parse(transfer.makeBackup(original));
  assert.equal(saved.format, 'fuxian-teleprompter');
  assert.equal(saved.version, 1);
  assert.equal(new Date(saved.exportedAt).toISOString(), saved.exportedAt);
  assert.deepEqual(saved.scripts, [{ name: 'บทพูด', text: '  เนื้อหา\n' }]);
  assert.deepEqual(plain(transfer.parseImport('backup.json', JSON.stringify(saved))), [{ name: 'บทพูด', text: '  เนื้อหา\n', pos: 0 }]);
  assert.equal(original[0].pos, 300);
  assert.equal(original[0].secret, 'private');
});

test('backup rejects invalid collections', () => {
  expectThaiError(() => transfer.makeBackup([]));
  expectThaiError(() => transfer.makeBackup([{ name: 'bad', text: 3 }]));
});

test('versioned backups round-trip more than 200 records and fields beyond legacy limits', () => {
  const scripts = Array.from({ length: 201 }, (_, i) => ({ id: i, name: 'a' + i, text: 'body', pos: i }));
  scripts[0].name = 'ชื่อ'.repeat(201);
  scripts[0].text = 'ก'.repeat(500001);
  const restored = transfer.parseImport('backup.json', transfer.makeBackup(scripts));
  assert.deepEqual(plain(restored), scripts.map(({ name, text }) => ({ name, text, pos: 0 })));
  const merged = transfer.mergeScripts([], restored);
  assert.equal(merged.added, 201);
  assert.equal(merged.scripts[0].text, scripts[0].text);
  assert.equal(transfer.mergeScripts(merged.scripts, restored).added, 0);
});

test('a combined library over 2 MiB remains exportable and importable as a versioned backup', () => {
  const scripts = [{ name: 'a', text: 'ก'.repeat(400000) }, { name: 'b', text: 'ข'.repeat(400000) }];
  const backup = transfer.makeBackup(scripts);
  assert.ok(Buffer.byteLength(backup, 'utf8') > 2 * 1024 * 1024);
  assert.deepEqual(plain(transfer.parseImport('backup.json', backup)), scripts.map(script => ({ ...script, pos: 0 })));
});

test('versioned backup preserves blank, whitespace and BOM fields through export, import and deduplication', () => {
  const scripts = [
    { id: 1, name: '', text: '', pos: 1 },
    { id: 2, name: '  ', text: '  ', pos: 2 },
    { id: 3, name: '\uFEFFชื่อ', text: '\uFEFFเนื้อหา\r\n ', pos: 3 },
    { id: 4, name: 'ชื่อ', text: 'เนื้อหา\r\n ', pos: 4 },
    { id: 5, name: ' ชื่อ ', text: 'เนื้อหา\r\n ', pos: 5 }
  ];
  const backup = transfer.makeBackup(scripts);
  assert.deepEqual(JSON.parse(backup).scripts, scripts.map(({ name, text }) => ({ name, text })));
  const restored = transfer.parseImport('backup.json', backup);
  assert.deepEqual(plain(restored), scripts.map(({ name, text }) => ({ name, text, pos: 0 })));
  const merged = transfer.mergeScripts(scripts, restored);
  assert.equal(merged.added, 0);
  assert.equal(merged.skipped, scripts.length);
  assert.equal(transfer.mergeScripts([], restored).added, scripts.length);
});

test('versioned backup still rejects malformed records atomically', () => {
  for (const invalid of [null, [], {}, { name: null, text: '' }, { name: '', text: 4 }]) {
    expectThaiError(() => transfer.parseImport('bad.json', bundle([{ name: '', text: '' }, invalid])));
  }
});

test('versioned import and export enforce the same 32 MiB UTF-8 hard limit', () => {
  const scripts = [{ name: 'ใหญ่เกินไป', text: 'a'.repeat(32 * 1024 * 1024) }];
  assert.throws(() => transfer.makeBackup(scripts), /32 MiB/);
  assert.throws(() => transfer.parseImport('large.json', bundle(scripts)), /32 MiB/);
});

test('merge preserves customized built-ins, positions and existing object records exactly', () => {
  const customized = { id: 9, name: 'Multi-Oil LIVE 100 ท่อน', text: 'ฉบับที่ฉันแก้เอง', pos: 88, custom: true };
  const existing = [customized, { id: 10, name: ' บทพูด ', text: 'existing', pos: 17 }];
  const before = JSON.stringify(existing);
  const result = transfer.mergeScripts(existing, [{ name: 'ใหม่', text: 'new', pos: 90 }]);
  assert.equal(result.scripts[0], customized);
  assert.equal(result.scripts[1], existing[1]);
  assert.equal(JSON.stringify(existing), before);
  assert.notEqual(result.scripts, existing);
  assert.equal(result.scripts[2].pos, 0);
  assert.equal(result.added, 1);
  assert.equal(result.skipped, 0);
});

test('merge skips exact duplicates, including repeated imports, but keeps differing text', () => {
  const existing = [{ id: 1, name: 'same', text: 'original', pos: 22 }];
  const incoming = [{ name: 'same', text: 'original' }, { name: 'same', text: 'changed' },
    { name: 'same', text: 'changed' }, { name: 'another', text: 'changed' }];
  const first = transfer.mergeScripts(existing, incoming);
  assert.equal(first.added, 2);
  assert.equal(first.skipped, 2);
  assert.deepEqual(plain(first.scripts.map(item => item.text)), ['original', 'changed', 'changed']);
  const again = transfer.mergeScripts(first.scripts, incoming);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 4);
  assert.equal(again.scripts.length, 3);
});

test('deduplication cannot confuse delimiter characters within a name or text', () => {
  const result = transfer.mergeScripts([{ id: 1, name: 'a\u0000b', text: 'c', pos: 4 }], [{ name: 'a', text: 'b\u0000c' }]);
  assert.equal(result.added, 1);
  assert.equal(result.scripts.length, 2);
});

test('merge creates unique safe numeric IDs beyond existing IDs and the clock', () => {
  const existing = [{ id: fixedNow + 50, name: 'old', text: 'text', pos: 1 },
    { id: fixedNow + 51, name: 'other', text: 'text', pos: 2 }];
  const result = transfer.mergeScripts(existing, [{ id: fixedNow + 51, name: 'new', text: 'a' }, { name: 'new', text: 'b' }]);
  const ids = result.scripts.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of result.scripts.slice(existing.length)) {
    assert.equal(Number.isSafeInteger(item.id), true);
    assert.ok(item.id > fixedNow + 51);
    assert.equal(item.pos, 0);
  }
  const withoutExisting = transfer.mergeScripts([], [{ name: 'new', text: 'a' }]);
  assert.ok(withoutExisting.scripts[0].id > fixedNow);
});

test('merge refuses ID exhaustion and invalid incoming data without modifying existing records', () => {
  const existing = [{ id: Number.MAX_SAFE_INTEGER, name: 'old', text: 'original', pos: 10 }];
  const before = JSON.stringify(existing);
  expectThaiError(() => transfer.mergeScripts(existing, [{ name: 'new', text: 'body' }]));
  assert.equal(JSON.stringify(existing), before);
  expectThaiError(() => transfer.mergeScripts([], [{ name: 'valid', text: 'body' }, { name: 'invalid', text: 4 }]));
});

test('download filenames retain Thai while removing unsafe characters and suffixes', () => {
  assert.equal(transfer.filenameFor('บทพูดใหม่'), 'บทพูดใหม่.txt');
  assert.equal(transfer.filenameFor(' ../ชื่อ<>:"/\\|?*\u0000\u007f\u0085.  ', 'json'), '..ชื่อ.json');
  assert.equal(transfer.filenameFor('...'), 'script.txt');
  assert.equal(transfer.filenameFor('CON'), '_CON.txt');
  assert.equal(transfer.filenameFor('nul', 'json'), '_nul.json');
  assert.equal(transfer.filenameFor(null), 'script.txt');
  assert.equal(transfer.filenameFor('ชื่อ', '../evil:json'), 'ชื่อ.eviljson');
});

test('filename length includes the extension and never breaks emoji surrogate pairs', () => {
  const result = transfer.filenameFor('ก'.repeat(150), 'json');
  assert.equal(Array.from(result).length, 100);
  assert.ok(result.endsWith('.json'));
  const emoji = transfer.filenameFor('😀'.repeat(150));
  assert.equal(Array.from(emoji).length, 100);
  assert.equal(emoji.includes('\uFFFD'), false);
  assert.equal(emoji.slice(0, -4), '😀'.repeat(96));
});
