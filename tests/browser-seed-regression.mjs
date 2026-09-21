import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxian-cdp-'));
const children = [];
const legacySeedV5 = fs.readFileSync(new URL('./fixtures/seed-v5.txt', import.meta.url), 'utf8').replace(/\n$/, '');
const legacySeedV5Round = fs.readFileSync(new URL('./fixtures/seed-v5-round.txt', import.meta.url), 'utf8').replace(/\n$/, '');
const legacySeedV5Hooks = fs.readFileSync(new URL('./fixtures/seed-v5-hooks.txt', import.meta.url), 'utf8').replace(/\n$/, '');
const legacySeedV6 = fs.readFileSync(new URL('./fixtures/seed-v6.txt', import.meta.url), 'utf8').replace(/\n$/, '');
const legacySeedV7 = fs.readFileSync(new URL('./fixtures/seed-v7.txt', import.meta.url), 'utf8').replace(/\n$/, '');
const operationTimeoutMs = Number(process.env.FUXIAN_CDP_TIMEOUT_MS) || 15_000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const trace = message => { if (process.env.FUXIAN_CDP_TRACE) console.error(`[cdp] ${message}`); };

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(check, label, timeoutMs = operationTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(2_000, () => request.destroy(new Error(`Timed out requesting ${url}`)));
  });
}

async function getStatus(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.setTimeout(2_000, () => request.destroy(new Error(`Timed out requesting ${url}`)));
  });
}

async function stopChild(child) {
  if (child.spawnFailure) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(1_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([once(child, 'exit'), delay(1_000)]);
  }
}

function trackChild(child) {
  child.spawnFailure = null;
  child.on('error', error => { child.spawnFailure = error; });
  children.push(child);
  return child;
}

class CdpClient {
  constructor(url, timeoutMs = operationTimeoutMs) {
    this.socket = new WebSocket(url);
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.close();
        reject(new Error('Timed out opening CDP WebSocket'));
      }, this.timeoutMs);
      const onOpen = () => {
        clearTimeout(timeout);
        this.socket.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        clearTimeout(timeout);
        this.socket.removeEventListener('open', onOpen);
        reject(new Error('Failed to open CDP WebSocket'));
      };
      this.socket.addEventListener('open', onOpen, { once: true });
      this.socket.addEventListener('error', onError, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP WebSocket closed')));
    this.socket.addEventListener('error', () => this.rejectPending(new Error('CDP WebSocket error')));
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) return reject(new Error('CDP WebSocket is not open'));
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP method ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result.value;
  }

  close() {
    this.rejectPending(new Error('CDP client closed'));
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
  }
}

let cdp;
try {
  trace('allocate ports');
  const httpPort = await freePort();
  const debugPort = await freePort();
  trace(`start HTTP server on ${httpPort}`);
  const server = trackChild(spawn('python3', ['-m', 'http.server', String(httpPort), '--bind', '127.0.0.1'], {
    cwd: root,
    stdio: 'ignore'
  }));

  await waitFor(async () => {
    if (server.spawnFailure) throw server.spawnFailure;
    trace('probe HTTP server');
    return await getStatus(`http://127.0.0.1:${httpPort}/index.html`) === 200;
  }, 'local HTTP server');

  assert.equal(typeof WebSocket, 'function', 'Node.js 22+ with global WebSocket is required');
  const browserPath = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe')
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
  assert.ok(browserPath, 'an installed Chromium browser is required; set CHROME_PATH when auto-detection is unavailable');

  const pageUrl = `http://127.0.0.1:${httpPort}/index.html`;
  trace(`start browser on ${debugPort}`);
  const browser = trackChild(spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    pageUrl
  ], { stdio: 'ignore' }));

  const target = await waitFor(async () => {
    if (browser.spawnFailure) throw browser.spawnFailure;
    trace('probe Chrome target list');
    const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
    return targets.find(item => item.type === 'page' && item.url.startsWith(pageUrl));
  }, 'Chrome page target');

  cdp = new CdpClient(target.webSocketDebuggerUrl);
  trace('connect CDP');
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  await waitFor(
    () => cdp.evaluate(`document.readyState === 'complete' && document.querySelector('#scriptName')?.value === 'Multi-Oil LIVE 100 ท่อน'`),
    'clean seed migration'
  );

  const initial = await cdp.evaluate(`(() => ({
    version: localStorage.getItem('fx_seed_v'),
    name: document.querySelector('#scriptName').value,
    sectionCount: document.querySelector('#scriptText').value.split(/\\n(?=# )/).length,
    warning: document.querySelector('#kwWarn').textContent
  }))()`);
  assert.equal(initial.version, '8');
  assert.equal(initial.name, 'Multi-Oil LIVE 100 ท่อน');
  assert.equal(initial.sectionCount, 100);
  assert.match(initial.warning, /ไม่พบคำเสี่ยง/);

  const [firstOrder, secondOrder, thirdOrder] = await cdp.evaluate(`(() => {
    const originalRandom = Math.random;
    const readOrder = () => [...document.querySelectorAll('#ptext .sec')].map(node => node.textContent);
    try {
      Math.random = () => 0;
      buildPrompt();
      const first = readOrder();
      Math.random = () => 0.999999;
      buildPrompt();
      const second = readOrder();
      buildPrompt();
      return [first, second, readOrder()];
    } finally {
      Math.random = originalRandom;
    }
  })()`);
  assert.equal(firstOrder.length, 100);
  assert.equal(new Set(firstOrder).size, 100);
  assert.equal(secondOrder.length, 100);
  assert.equal(new Set(secondOrder).size, 100);
  assert.notDeepEqual(secondOrder, firstOrder, 'consecutive prompt builds must shuffle section order');
  assert.notEqual(thirdOrder[0], secondOrder[0], 'consecutive rounds must not open with the same section');

  await cdp.evaluate(`(() => {
    localStorage.removeItem('fx_settings_v1');
    localStorage.setItem('fx_scripts', JSON.stringify([
      { id: 101, name: 'สคริปต์ของฉัน', text: '# เนื้อหาของฉัน', pos: 17 },
      { id: 121, name: 'Multi-Oil รอบ 5 นาที', text: '# รอบที่ผู้ใช้แก้เอง', pos: 13 },
      { id: 131, name: 'Multi-Oil Hook + Q&A', text: '# คำถามที่ผู้ใช้แก้เอง', pos: 19 },
      { id: 151, name: 'Multi-Oil LIVE สูตรของฉัน', text: '# ห้ามทับเนื้อหานี้', pos: 23 },
      { id: 181, name: 'Multi-Oil คลังวน 37 ท่อน', text: '# ฉบับที่ผู้ใช้แก้เอง', pos: 31 },
      { id: 202, name: 'Multi-Oil คลังวน 37 ท่อน', text: ${JSON.stringify(legacySeedV7)}, pos: 9 }
    ]));
    localStorage.setItem('fx_cur', '101');
    localStorage.setItem('fx_seed_v', '7');
    location.reload();
    return true;
  })()`);

  await waitFor(
    () => cdp.evaluate(`document.readyState === 'complete' && localStorage.getItem('fx_seed_v') === '8'`),
    'version 7 to version 8 migration'
  );

  const migrated = await cdp.evaluate(`(() => {
    const stored = JSON.parse(localStorage.getItem('fx_scripts'));
    return {
      version: localStorage.getItem('fx_seed_v'),
      scripts: stored,
      builtInSections: stored.find(item => item.name === 'Multi-Oil LIVE 100 ท่อน')?.text.split(/\\n(?=# )/).length
    };
  })()`);
  assert.equal(migrated.version, '8');
  assert.equal(migrated.scripts.length, 6);
  assert.deepEqual(
    migrated.scripts.find(item => item.name === 'สคริปต์ของฉัน'),
    { id: 101, name: 'สคริปต์ของฉัน', text: '# เนื้อหาของฉัน', pos: 17 }
  );
  assert.deepEqual(
    migrated.scripts.find(item => item.id === 121),
    { id: 121, name: 'Multi-Oil รอบ 5 นาที', text: '# รอบที่ผู้ใช้แก้เอง', pos: 13 }
  );
  assert.deepEqual(
    migrated.scripts.find(item => item.id === 131),
    { id: 131, name: 'Multi-Oil Hook + Q&A', text: '# คำถามที่ผู้ใช้แก้เอง', pos: 19 }
  );
  assert.deepEqual(
    migrated.scripts.find(item => item.name === 'Multi-Oil LIVE สูตรของฉัน'),
    { id: 151, name: 'Multi-Oil LIVE สูตรของฉัน', text: '# ห้ามทับเนื้อหานี้', pos: 23 }
  );
  assert.deepEqual(
    migrated.scripts.find(item => item.id === 181),
    { id: 181, name: 'Multi-Oil คลังวน 37 ท่อน', text: '# ฉบับที่ผู้ใช้แก้เอง', pos: 31 }
  );
  assert.equal(migrated.builtInSections, 100);

  await cdp.evaluate(`(() => {
    localStorage.removeItem('fx_settings_v1');
    localStorage.setItem('fx_scripts', JSON.stringify([
      { id: 202, name: 'Multi-Oil คลังวน 37 ท่อน', text: ${JSON.stringify(legacySeedV7)}, pos: 9 },
      { id: 121, name: 'Multi-Oil รอบ 5 นาที', text: '# รอบที่ผู้ใช้แก้เอง', pos: 13 },
      { id: 131, name: 'Multi-Oil Hook + Q&A', text: '# คำถามที่ผู้ใช้แก้เอง', pos: 19 },
      { id: 151, name: 'Multi-Oil LIVE สูตรของฉัน', text: '# ห้ามทับเนื้อหานี้', pos: 23 },
      { id: 181, name: 'Multi-Oil คลังวน 37 ท่อน', text: '# ฉบับที่ผู้ใช้แก้เอง', pos: 31 },
      { id: 101, name: 'สคริปต์ของฉัน', text: '# เนื้อหาของฉัน', pos: 17 }
    ]));
    localStorage.setItem('fx_cur', '202');
    localStorage.setItem('fx_seed_v', '7');
    location.reload();
    return true;
  })()`);

  await waitFor(
    () => cdp.evaluate(`document.readyState === 'complete' && localStorage.getItem('fx_seed_v') === '8'`),
    'reversed-order version 7 to version 8 migration'
  );

  const reversed = await cdp.evaluate(`(() => JSON.parse(localStorage.getItem('fx_scripts')))()`);
  assert.equal(reversed.length, 6);
  assert.deepEqual(
    reversed.find(item => item.id === 151),
    { id: 151, name: 'Multi-Oil LIVE สูตรของฉัน', text: '# ห้ามทับเนื้อหานี้', pos: 23 }
  );
  assert.deepEqual(
    reversed.find(item => item.id === 181),
    { id: 181, name: 'Multi-Oil คลังวน 37 ท่อน', text: '# ฉบับที่ผู้ใช้แก้เอง', pos: 31 }
  );
  assert.deepEqual(
    reversed.find(item => item.id === 121),
    { id: 121, name: 'Multi-Oil รอบ 5 นาที', text: '# รอบที่ผู้ใช้แก้เอง', pos: 13 }
  );
  assert.deepEqual(
    reversed.find(item => item.id === 131),
    { id: 131, name: 'Multi-Oil Hook + Q&A', text: '# คำถามที่ผู้ใช้แก้เอง', pos: 19 }
  );
  assert.equal(reversed.find(item => item.id === 202)?.name, 'Multi-Oil LIVE 100 ท่อน');

  for (const fixture of [
    { version: '5', name: 'Multi-Oil คลังวน 32 ท่อน', seed: legacySeedV5, id: 305 },
    { version: '6', name: 'Multi-Oil คลังวน 37 ท่อน', seed: legacySeedV6, id: 306 }
  ]) {
    await cdp.evaluate(`(() => {
      localStorage.removeItem('fx_settings_v1');
      localStorage.setItem('fx_scripts', JSON.stringify([
        { id: ${fixture.id}, name: ${JSON.stringify(fixture.name)}, text: ${JSON.stringify(fixture.seed)}, pos: 11 }
      ]));
      localStorage.setItem('fx_cur', ${JSON.stringify(String(fixture.id))});
      localStorage.setItem('fx_seed_v', ${JSON.stringify(fixture.version)});
      location.reload();
      return true;
    })()`);
    await waitFor(
      () => cdp.evaluate(`document.readyState === 'complete' && localStorage.getItem('fx_seed_v') === '8'`),
      `version ${fixture.version} to version 8 migration`
    );
    const historical = await cdp.evaluate(`(() => JSON.parse(localStorage.getItem('fx_scripts')))()`);
    assert.equal(historical.length, 1, `v${fixture.version} built-in must be replaced, not duplicated`);
    assert.equal(historical[0].id, fixture.id);
    assert.equal(historical[0].name, 'Multi-Oil LIVE 100 ท่อน');
    assert.equal(historical[0].text.split(/\n(?=# )/).length, 100);
  }

  await cdp.evaluate(`(() => {
    localStorage.removeItem('fx_settings_v1');
    localStorage.setItem('fx_scripts', JSON.stringify([
      { id: 405, name: 'Multi-Oil คลังวน 32 ท่อน', text: ${JSON.stringify(legacySeedV5)}, pos: 7 },
      { id: 406, name: 'Multi-Oil รอบ 5 นาที', text: ${JSON.stringify(legacySeedV5Round)}, pos: 8 },
      { id: 407, name: 'Multi-Oil Hook + Q&A', text: ${JSON.stringify(legacySeedV5Hooks)}, pos: 9 }
    ]));
    localStorage.setItem('fx_cur', '405');
    localStorage.setItem('fx_seed_v', '5');
    location.reload();
    return true;
  })()`);
  await waitFor(
    () => cdp.evaluate(`document.readyState === 'complete' && localStorage.getItem('fx_seed_v') === '8'`),
    'authentic three-script version 5 migration'
  );
  const authenticV5 = await cdp.evaluate(`(() => JSON.parse(localStorage.getItem('fx_scripts')))()`);
  assert.equal(authenticV5.length, 1, 'authentic v5 auxiliary seeds must be removed');
  assert.equal(authenticV5[0].id, 405);
  assert.equal(authenticV5[0].name, 'Multi-Oil LIVE 100 ท่อน');
  assert.equal(authenticV5[0].text.split(/\n(?=# )/).length, 100);
  console.log('PASS: browser seed migration, keyword status, 100-section rendering, shuffle, and custom-script preservation');

  const missingControls = await cdp.evaluate(`[
    'settingShuffle','settingLoop','settingCountdown','settingAlign','btnDuplicate',
    'btnExportText','btnBackup','btnImport','importFile','scriptStats','saveStatus',
    'btnHelp','helpDialog','btnCloseHelp'
  ].filter(id => !document.getElementById(id))`);
  assert.deepEqual(missingControls, [], 'the script sharing and reading controls must be present');

  async function reloadAndWait(label) {
    await cdp.evaluate('window.__beforeTestReload = true');
    await cdp.send('Page.reload');
    await waitFor(
      () => cdp.evaluate(`!window.__beforeTestReload && document.readyState === 'complete' && typeof readingSettings === 'object'`),
      label
    );
  }
  const defaultSettings = { speed: 60, font: 52, mirror: false, shuffle: true, loop: true, countdown: 3, align: 'center' };
  assert.deepEqual(await cdp.evaluate('readingSettings'), defaultSettings);
  const changedSettings = { speed: 90, font: 64, mirror: true, shuffle: false, loop: false, countdown: 0, align: 'left' };
  const editedSettings = await cdp.evaluate(`(() => {
    for (const [id, value] of [['rSpeed','90'],['rFont','64']]) {
      const input=document.getElementById(id); input.value=value;
      input.dispatchEvent(new Event('input', {bubbles:true}));
    }
    for (const id of ['settingShuffle','settingLoop']) {
      const input=document.getElementById(id); input.checked=false;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }
    for (const [id, value] of [['settingCountdown','0'],['settingAlign','left']]) {
      const input=document.getElementById(id); input.value=value;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }
    document.getElementById('bMirror').click();
    return JSON.parse(localStorage.getItem('fx_settings_v1'));
  })()`);
  assert.deepEqual(editedSettings, changedSettings, 'reading controls must persist their values');
  await reloadAndWait('saved reading settings');
  const restoredSettings = await cdp.evaluate(`({
    settings: readingSettings,
    speed: document.getElementById('rSpeed').value,
    font: document.getElementById('rFont').value,
    renderedFont: getComputedStyle(ptextEl).fontSize,
    renderedAlign: getComputedStyle(ptextEl).textAlign,
    scrollSpeed: speed,
    mirror: scrollerEl.classList.contains('mirror'),
    shuffle: document.getElementById('settingShuffle').checked,
    loop: document.getElementById('settingLoop').checked,
    countdown: document.getElementById('settingCountdown').value,
    align: document.getElementById('settingAlign').value
  })`);
  assert.deepEqual(restoredSettings, {
    settings: changedSettings, speed: '90', font: '64', renderedFont: '64px', renderedAlign: 'left', scrollSpeed: 90, mirror: true,
    shuffle: false, loop: false, countdown: '0', align: 'left'
  });
  await cdp.evaluate(`localStorage.setItem('fx_settings_v1', '{broken json')`);
  await reloadAndWait('corrupt reading settings fallback');
  assert.deepEqual(await cdp.evaluate('readingSettings'), defaultSettings);

  const deniedSettings = await cdp.evaluate(`(() => {
    const originalSetItem=Storage.prototype.setItem;
    try {
      Storage.prototype.setItem=function(){throw new DOMException('Test denied', 'QuotaExceededError')};
      const input=document.getElementById('rSpeed'); input.value='110';
      input.dispatchEvent(new Event('input', {bubbles:true}));
      return {speed:readingSettings.speed, status:document.getElementById('saveStatus').textContent};
    } finally { Storage.prototype.setItem=originalSetItem; }
  })()`);
  assert.equal(deniedSettings.speed, 110, 'storage failure must not disable reading controls');
  assert.match(deniedSettings.status, /ไม่ได้|ไม่สำเร็จ|ผิดพลาด|ไม่สามารถ|เฉพาะรอบนี้/, 'storage denial must be visible');

  const customScript = { id: 9001, name: 'สคริปต์ของฉัน <safe>', text: '# One\nhello\n\n# Two\nworld', pos: 29 };
  await cdp.evaluate(`(() => {
    localStorage.setItem('fx_scripts', JSON.stringify([${JSON.stringify(customScript)}]));
    localStorage.setItem('fx_cur', '9001');
    localStorage.setItem('fx_seed_v', '8');
    localStorage.removeItem('fx_settings_v1');
  })()`);
  await reloadAndWait('custom editor fixture');

  const duplicateResult = await cdp.evaluate(`(() => {
    document.getElementById('btnDuplicate').click();
    return {scripts:JSON.parse(localStorage.getItem('fx_scripts')), selected:curId,
      name:document.getElementById('scriptName').value, text:document.getElementById('scriptText').value,
      stats:document.getElementById('scriptStats').textContent, status:document.getElementById('saveStatus').textContent};
  })()`);
  assert.equal(duplicateResult.scripts.length, 2);
  assert.deepEqual(duplicateResult.scripts.find(item => item.id === customScript.id), customScript, 'duplicate must preserve original data and position');
  const duplicate = duplicateResult.scripts.find(item => item.id !== customScript.id);
  assert.ok(Number.isFinite(duplicate.id));
  assert.notEqual(duplicate.name, customScript.name, 'copy needs a distinguishable name');
  assert.equal(duplicate.text, customScript.text);
  assert.equal(duplicate.pos, 0);
  assert.equal(duplicateResult.selected, duplicate.id);
  assert.equal(duplicateResult.name, duplicate.name);
  assert.equal(duplicateResult.text, customScript.text);
  assert.match(duplicateResult.stats, /2/);
  assert.match(duplicateResult.stats, new RegExp(String(Array.from(customScript.text).length)));
  assert.match(duplicateResult.status, /บันทึก/);
  assert.doesNotMatch(duplicateResult.status, /ไม่ได้|ไม่สำเร็จ|ผิดพลาด/);

  const deniedEdit = await cdp.evaluate(`(() => {
    const originalSetItem=Storage.prototype.setItem, before=localStorage.getItem('fx_scripts');
    const input=document.getElementById('scriptText'), originalText=input.value;
    let result;
    try {
      Storage.prototype.setItem=function(){throw new DOMException('Test denied', 'QuotaExceededError')};
      input.value=originalText+'\\nunsaved edit';input.dispatchEvent(new Event('input',{bubbles:true}));
      result={retained:curScript().text===input.value,persistedUnchanged:localStorage.getItem('fx_scripts')===before,
        status:document.getElementById('saveStatus').textContent};
    } finally {
      Storage.prototype.setItem=originalSetItem;
      input.value=originalText;input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    result.recoveredStatus=document.getElementById('saveStatus').textContent;
    return result;
  })()`);
  assert.equal(deniedEdit.retained, true, 'failed saves must retain the current edit in memory');
  assert.equal(deniedEdit.persistedUnchanged, true, 'failed saves must not damage the saved script');
  assert.match(deniedEdit.status, /ไม่ได้|ไม่สำเร็จ|ผิดพลาด|ไม่สามารถ|เฉพาะรอบนี้/);
  assert.doesNotMatch(deniedEdit.recoveredStatus, /ไม่ได้|ไม่สำเร็จ|ผิดพลาด/);

  const exports = await cdp.evaluate(`(async () => {
    const originalCreate=URL.createObjectURL, originalClick=HTMLAnchorElement.prototype.click;
    const blobs=[], links=[];
    try {
      URL.createObjectURL=function(blob){blobs.push(blob);return originalCreate.call(URL,blob)};
      HTMLAnchorElement.prototype.click=function(){links.push({name:this.download,href:this.href})};
      document.getElementById('btnExportText').click();
      document.getElementById('btnBackup').click();
      return {links, contents:await Promise.all(blobs.map(async blob=>({type:blob.type,text:await blob.text()})))};
    } finally {URL.createObjectURL=originalCreate;HTMLAnchorElement.prototype.click=originalClick;}
  })()`);
  assert.equal(exports.links.length, 2, 'both export buttons must prepare a download');
  assert.match(exports.links[0].name, /\.txt$/i);
  assert.match(exports.links[1].name, /\.json$/i);
  assert.equal(exports.contents[0].text.replace(/^\uFEFF/, ''), customScript.text);
  const backup = JSON.parse(exports.contents[1].text);
  assert.equal(backup.format, 'fuxian-teleprompter');
  assert.equal(backup.version, 1);
  assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
  assert.deepEqual(backup.scripts, duplicateResult.scripts.map(({ name, text }) => ({ name, text })));

  const importButton = await cdp.evaluate(`(() => {
    const input=document.getElementById('importFile'), originalClick=input.click;
    let clicked=false;
    try {input.click=()=>{clicked=true};document.getElementById('btnImport').click();}
    finally {input.click=originalClick;}
    return {clicked,accept:input.accept};
  })()`);
  assert.equal(importButton.clicked, true, 'import button must open its file picker');
  for (const extension of ['.txt','.md','.json']) assert.ok(importButton.accept.includes(extension));

  const plainText = '# Imported\nเนื้อหาที่นำเข้า';
  const textImport = await cdp.evaluate(`(async () => {
    const accepted=await importScriptFile(new File([${JSON.stringify(plainText)}], 'imported.txt', {type:'text/plain'}));
    return {accepted,scripts:JSON.parse(localStorage.getItem('fx_scripts')),
      text:document.getElementById('scriptText').value, warning:document.getElementById('kwWarn').textContent};
  })()`);
  assert.equal(textImport.accepted, true);
  assert.equal(textImport.text, plainText);
  assert.equal(textImport.scripts.length, 3);
  assert.deepEqual(textImport.scripts.find(item => item.id === customScript.id), customScript);
  assert.match(textImport.warning, /ไม่พบคำเสี่ยง/);

  const unsafeName = '<img src=x onerror="window.__importXss=true">';
  const unsafeText = '# <svg onload="window.__importXss=true">\n<script>window.__importXss=true</script>\nรักษาโรค';
  const importBackup = JSON.stringify({ format: 'fuxian-teleprompter', version: 1, exportedAt: '2026-09-21T00:00:00.000Z', scripts: [{ name: unsafeName, text: unsafeText }] });
  const backupImport = await cdp.evaluate(`(async () => {
    const accepted=await importScriptFile(new File([${JSON.stringify(importBackup)}], 'restore.json', {type:'application/json'}));
    buildPrompt();
    return {accepted,scripts:JSON.parse(localStorage.getItem('fx_scripts')),name:document.getElementById('scriptName').value,
      text:document.getElementById('scriptText').value,warning:document.getElementById('kwWarn').textContent,
      injected:!!window.__importXss, executableNodes:document.querySelectorAll('#scriptSel img,#scriptSel script,#ptext svg,#ptext script').length};
  })()`);
  assert.equal(backupImport.accepted, true);
  assert.equal(backupImport.scripts.length, 4);
  assert.equal(new Set(backupImport.scripts.map(item => item.id)).size, 4);
  assert.equal(backupImport.name, unsafeName);
  assert.equal(backupImport.text, unsafeText);
  assert.equal(backupImport.injected, false);
  assert.equal(backupImport.executableNodes, 0);
  assert.doesNotMatch(backupImport.warning, /ไม่พบคำเสี่ยง/, 'import must refresh keyword warning');
  for (const original of textImport.scripts) assert.deepEqual(backupImport.scripts.find(item => item.id === original.id), original, 'restore must retain all existing scripts');
  const repeatedImport = await cdp.evaluate(`(async () => {
    await importScriptFile(new File([${JSON.stringify(importBackup)}], 'restore.json', {type:'application/json'}));
    return JSON.parse(localStorage.getItem('fx_scripts'));
  })()`);
  assert.deepEqual(repeatedImport, backupImport.scripts, 'importing the same backup twice must add zero duplicates');
  const rejectedImports = await cdp.evaluate(`(async () => {
    const before=JSON.stringify(scripts);
    const malformed=await importScriptFile(new File(['{oops'], 'broken.json', {type:'application/json'}));
    const oversized=await importScriptFile(new File(['x'.repeat(2*1024*1024+1)], 'large.txt', {type:'text/plain'}));
    return {malformed,oversized,unchanged:JSON.stringify(scripts)===before};
  })()`);
  assert.deepEqual(rejectedImports, { malformed: false, oversized: false, unchanged: true });
  console.log('PASS: reading settings persistence, storage denial, duplicate, downloads, imports, deduplication, and escaped content');

  const readingText = '# First\n' + 'hello world '.repeat(100) + '\n\n# Second\n' + 'read here '.repeat(100);
  const sequential = await cdp.evaluate(`(() => {
    const text=document.getElementById('scriptText');text.value=${JSON.stringify(readingText)};
    text.dispatchEvent(new Event('input',{bubbles:true}));
    for (const id of ['settingShuffle','settingLoop']) {
      const input=document.getElementById(id);input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const countdown=document.getElementById('settingCountdown');countdown.value='0';countdown.dispatchEvent(new Event('change',{bubbles:true}));
    return [roundText(),roundText()];
  })()`);
  assert.deepEqual(sequential, [readingText, readingText], 'disabled shuffle must preserve exact original order');
  await cdp.evaluate(`document.getElementById('btnStart').click()`);
  await waitFor(() => cdp.evaluate(`playing && document.getElementById('countdown').style.display === 'none'`), 'zero-countdown reading start');
  await waitFor(() => cdp.evaluate('scrollerEl.scrollTop > 1'), 'automatic reading progress');
  const pausedAuto = await cdp.evaluate(`(() => {
    document.getElementById('bPlay').click();
    const paused=!playing, before=scrollerEl.scrollTop;
    lastT=performance.now()-1000;holdUntil=0;step();
    const unchanged=scrollerEl.scrollTop===before;
    document.getElementById('bPlay').click();
    return {paused,unchanged,resumed:playing};
  })()`);
  assert.deepEqual(pausedAuto, {paused:true,unchanged:true,resumed:true}, 'pause must hold position and resume must restart reading');
  const completedAuto = await cdp.evaluate(`(() => {
    stopLoop();holdUntil=0;lastT=performance.now()-1000;
    const before=ptextEl.textContent;scrollerEl.scrollTop=scrollerEl.scrollHeight;
    step();
    return {playing,bottom:scrollerEl.scrollTop >= scrollerEl.scrollHeight-scrollerEl.clientHeight-2,unchanged:ptextEl.textContent===before};
  })()`);
  assert.deepEqual(completedAuto, { playing: false, bottom: true, unchanged: true }, 'non-looping auto reading must pause at the end');
  const completedVoice = await cdp.evaluate(`(() => {
    const original=window.SpeechRecognition;
    let stopped=0;
    try {
      window.SpeechRecognition=class {start(){} stop(){stopped++}};
      document.getElementById('bVoice').click();
      setCur(wordEls.length-1,{scroll:false});
      return {voiceOn,playing,stopped,pendingRound:voiceRoundT!==null};
    } finally {window.SpeechRecognition=original;setVoice(false);}
  })()`);
  assert.deepEqual(completedVoice, { voiceOn: false, playing: false, stopped: 1, pendingRound: false }, 'non-looping voice reading must stop recognition at the final word');

  const pausedVoiceRound = await cdp.evaluate(`(async () => {
    const original=window.SpeechRecognition;
    const loop=document.getElementById('settingLoop');loop.checked=true;loop.dispatchEvent(new Event('change',{bubbles:true}));
    let started=0,stopped=0;
    try {
      window.SpeechRecognition=class {start(){started++} stop(){stopped++}};
      document.getElementById('bVoice').click();
      const lastWord=wordEls.length-1, firstNode=ptextEl.firstChild;
      setCur(lastWord,{scroll:false});
      const initiallyScheduled=voiceRoundT!==null;
      document.getElementById('bPlay').click();
      const pauseClearedTimer=voiceRoundT===null;
      await new Promise(resolve=>setTimeout(resolve,2200));
      const paused={playing,voiceOn,atLastWord:curIdx===lastWord,unchanged:ptextEl.firstChild===firstNode};
      document.getElementById('bPlay').click();
      const resumeScheduled=voiceRoundT!==null;
      await new Promise(resolve=>setTimeout(resolve,2200));
      return {initiallyScheduled,pauseClearedTimer,paused,resumeScheduled,
        resumed:{playing,voiceOn,newRound:curIdx===-1&&ptextEl.firstChild!==firstNode},started,stopped};
    } finally {window.SpeechRecognition=original;setVoice(false);setPlaying(false);}
  })()`);
  assert.deepEqual(pausedVoiceRound, {
    initiallyScheduled:true,pauseClearedTimer:true,
    paused:{playing:false,voiceOn:true,atLastWord:true,unchanged:true},resumeScheduled:true,
    resumed:{playing:true,voiceOn:true,newRound:true},started:2,stopped:1
  }, 'pausing at the final voice word must preserve the current round and resume must advance after its delay');
  await cdp.evaluate(`document.getElementById('bExit').click()`);

  await cdp.evaluate(`(() => {
    const countdown=document.getElementById('settingCountdown');countdown.value='5';
    countdown.dispatchEvent(new Event('change',{bubbles:true}));
    window.__countdownTest=enterPrompt(false);
  })()`);
  await waitFor(() => cdp.evaluate(`document.getElementById('countdown').style.display==='flex' && document.getElementById('countdown').textContent==='5' && !playing`), 'configured five-second countdown');
  const cancelledCountdown = await cdp.evaluate(`(async () => {
    document.getElementById('bExit').click();
    await window.__countdownTest;
    delete window.__countdownTest;
    return {playing,voiceOn,countdown:document.getElementById('countdown').style.display,
      prompt:document.getElementById('prompt').style.display,loopStopped:rafId===null&&intId===null};
  })()`);
  assert.deepEqual(cancelledCountdown, {playing:false,voiceOn:false,countdown:'none',prompt:'none',loopStopped:true}, 'exit must cancel a pending countdown without starting a background reading loop');

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobileEditor = await cdp.evaluate(`(() => {
    const rect=document.getElementById('scriptText').getBoundingClientRect();
    document.getElementById('btnHelp').click();
    return {viewport:innerWidth,width:document.documentElement.scrollWidth,textarea:{width:rect.width,height:rect.height},helpOpen:document.getElementById('helpDialog').open};
  })()`);
  assert.equal(mobileEditor.viewport, 390);
  assert.ok(mobileEditor.width <= 391, `mobile editor overflows: ${mobileEditor.width}px`);
  assert.ok(mobileEditor.textarea.width >= 300, 'mobile textarea must remain wide enough to edit');
  assert.ok(mobileEditor.textarea.height >= 180, 'mobile textarea must remain tall enough to edit');
  assert.equal(mobileEditor.helpOpen, true);
  assert.equal(await cdp.evaluate(`(() => {document.getElementById('btnCloseHelp').click();return document.getElementById('helpDialog').open})()`), false);
  console.log('PASS: sequential reading, auto and voice pause/resume, non-looping completion, countdown cancellation, mobile editor, and help dialog');
} finally {
  cdp?.close();
  for (const child of children.reverse()) await stopChild(child);
  fs.rmSync(profileDir, { recursive: true, force: true });
}
