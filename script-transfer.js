(function () {
  'use strict';

  const FORMAT = 'fuxian-teleprompter';
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
  const MAX_SCRIPTS = 200;
  const MAX_NAME = 200;
  const MAX_TEXT = 500000;
  const stripBOM = value => value.replace(/^\uFEFF/, '');

  function checkSize(text, limit = MAX_BYTES) {
    if (new TextEncoder().encode(text).byteLength > limit) {
      throw new Error('ไฟล์มีขนาดเกิน ' + (limit / 1024 / 1024) + ' MiB กรุณาแบ่งสคริปต์เป็นไฟล์ที่เล็กลง');
    }
  }

  function validateScripts(scripts, allowEmpty = false) {
    if (!Array.isArray(scripts) || (!allowEmpty && scripts.length === 0)) {
      throw new Error('ไฟล์ต้องมีรายการสคริปต์อย่างน้อย 1 รายการ');
    }
    return scripts.map((script, index) => {
      if (!script || Array.isArray(script) || typeof script !== 'object' ||
          typeof script.name !== 'string' || typeof script.text !== 'string') {
        throw new Error('สคริปต์รายการที่ ' + (index + 1) + ' ต้องมี name และ text เป็นข้อความ');
      }
      return { name: script.name, text: script.text, pos: 0 };
    });
  }

  function normalizeScripts(scripts) {
    const valid = validateScripts(scripts);
    if (valid.length > MAX_SCRIPTS) throw new Error('หนึ่งไฟล์มีสคริปต์ได้ไม่เกิน 200 รายการ');
    return valid.map((script, index) => {
      const label = 'สคริปต์รายการที่ ' + (index + 1);
      const name = stripBOM(script.name).trim();
      const text = stripBOM(script.text);
      if (!name) throw new Error(label + ' ไม่มีชื่อ กรุณาระบุชื่อสคริปต์');
      if (script.name.length > MAX_NAME) throw new Error(label + ' มีชื่อยาวเกิน 200 ตัวอักษร');
      if (text.length > MAX_TEXT) throw new Error(label + ' มีเนื้อหายาวเกิน 500,000 ตัวอักษร');
      return { name, text, pos: 0 };
    });
  }

  function parseImport(filename, text) {
    if (typeof filename !== 'string' || typeof text !== 'string') {
      throw new Error('ไม่สามารถอ่านชื่อไฟล์หรือข้อความในไฟล์ได้');
    }
    const basename = filename.split(/[\\/]/).pop();
    const extension = basename.match(/\.([^.]+)$/)?.[1].toLowerCase();
    checkSize(text, extension === 'json' ? MAX_BACKUP_BYTES : MAX_BYTES);
    const content = stripBOM(text);
    if (!content.trim()) throw new Error('ไฟล์ว่าง กรุณาเลือกไฟล์ที่มีเนื้อหาสคริปต์');
    if (extension === 'txt' || extension === 'md') {
      const name = basename.replace(/\.[^.]+$/, '').trim() || 'script';
      return normalizeScripts([{ name, text: content }]);
    }
    if (extension !== 'json') throw new Error('รองรับเฉพาะไฟล์ .txt, .md และ .json');
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      throw new Error('ไฟล์ JSON ไม่ถูกต้อง กรุณาตรวจสอบไฟล์หรือส่งออกไฟล์สำรองใหม่');
    }
    if (Array.isArray(data)) {
      checkSize(text);
      return normalizeScripts(data);
    }
    if (!data || typeof data !== 'object' || data.format !== FORMAT) {
      throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ Fuxian Teleprompter');
    }
    if (data.version !== 1) throw new Error('ยังไม่รองรับไฟล์สำรองเวอร์ชันนี้ (รองรับเวอร์ชัน 1)');
    return validateScripts(data.scripts);
  }

  function makeBackup(scripts) {
    // Backups preserve the exact saved strings; import-only cleanup would lose data.
    const portable = validateScripts(scripts).map(({ name, text }) => ({ name, text }));
    const backup = JSON.stringify({
      format: FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      scripts: portable
    }, null, 2);
    checkSize(backup, MAX_BACKUP_BYTES);
    return backup;
  }

  function mergeScripts(existing, incoming) {
    if (!Array.isArray(existing)) throw new Error('รายการสคริปต์เดิมไม่ถูกต้อง');
    // Validate the whole import before allocating IDs or changing the collection.
    const validated = validateScripts(incoming, true);
    const scripts = existing.slice();
    const seen = new Set(existing.map(script => JSON.stringify([script.name, script.text])));
    const ids = new Set(existing.map(script => script.id));
    let nextId = Date.now();
    for (const script of existing) {
      if (typeof script.id === 'number' && Number.isFinite(script.id)) nextId = Math.max(nextId, script.id);
    }
    let added = 0;
    let skipped = 0;
    for (const script of validated) {
      const key = JSON.stringify([script.name, script.text]);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      do {
        nextId = Math.floor(nextId) + 1;
        if (!Number.isSafeInteger(nextId)) throw new Error('ไม่สามารถสร้างรหัสสคริปต์ใหม่ได้ รหัสเดิมมีค่ามากเกินไป');
      } while (ids.has(nextId));
      ids.add(nextId);
      seen.add(key);
      scripts.push({ id: nextId, name: script.name, text: script.text, pos: 0 });
      added++;
    }
    return { scripts, added, skipped };
  }

  function filenameFor(name, extension = 'txt') {
    const suffix = typeof extension === 'string' ? extension.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toLowerCase() : '';
    const ext = suffix || 'txt';
    let safe = typeof name === 'string' ? name.replace(/[\u0000-\u001F\u007F-\u009F<>:"/\\|?*]/g, '').trim() : '';
    safe = safe.replace(/[. ]+$/, '') || 'script';
    // Windows device names remain reserved even when a file extension is added.
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) safe = '_' + safe;
    safe = Array.from(safe).slice(0, 99 - ext.length).join('').replace(/[. ]+$/, '') || 'script';
    return safe + '.' + ext;
  }

  window.FXTransfer = Object.freeze({ parseImport, makeBackup, mergeScripts, filenameFor });
})();
