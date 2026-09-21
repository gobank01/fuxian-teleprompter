# Fuxian 100-Section Live Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the built-in 37-section Fuxian script with exactly 100 varied, independent, live-shopping-ready sections using only verified product and offer facts.

**Architecture:** Keep the dependency-free single-file application and its existing `SEED3` template-literal format. Add one Node-based content integrity test that reads the real HTML seed and keyword database, then update the seed migration and README without changing the runtime shuffle algorithm or user-created scripts.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, Node.js built-ins (`fs`, `vm`, `assert`), existing `keywords.js`, Chrome DevTools Protocol for final browser verification.

---

### Task 1: Add a failing seed-content integrity test

**Files:**
- Create: `tests/seed-content.test.mjs`
- Read: `index.html`
- Read: `keywords.js`

- [ ] **Step 1: Create the test harness before changing `SEED3`**

The test reads the actual seed from `index.html`, splits it exactly as the application does, and checks the approved content contract. Implement these assertions in `tests/seed-content.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const keywordsSource = fs.readFileSync(new URL('../keywords.js', import.meta.url), 'utf8');
const seedMatch = html.match(/const SEED3 = `([\s\S]*?)`;\nconst makeSeedScript/);
assert.ok(seedMatch, 'SEED3 must remain a template literal before makeSeedScript');

const seed = seedMatch[1].trim();
const sections = seed.split(/\n(?=# )/).map(block => block.trim()).filter(Boolean);
const headings = sections.map(block => block.split('\n')[0]);
const bodies = sections.map(block => block.split('\n').slice(1).join('\n'));
const whitelist = [
  'ไม่มีผลป้องกันหรือรักษาโรค',
  'ไม่มีผลในการป้องกันหรือรักษาโรค',
  'ผลิตภัณฑ์เสริมอาหาร ไม่ใช่ยา',
  'มีโรคประจำตัว',
  'ปรึกษาคุณหมอ',
  'ปรึกษาแพทย์'
];

assert.equal(sections.length, 100, 'built-in live library must contain exactly 100 sections');
assert.equal(new Set(headings).size, 100, 'all section headings must be unique');
assert.equal(new Set(bodies).size, 100, 'all section bodies must be unique');

for (const [index, section] of sections.entries()) {
  const lines = section.split('\n');
  const spoken = lines.slice(1);
  assert.match(lines[0], /^# \p{Extended_Pictographic}/u, `section ${index + 1} heading must start with # and an emoji`);
  assert.ok(spoken.length >= 2 && spoken.length <= 4, `section ${index + 1} must contain 2–4 spoken lines`);
  for (const line of spoken) {
    assert.match(line, /^\p{Extended_Pictographic}/u, `section ${index + 1} spoken line must start with an emoji`);
    assert.ok(line.length <= 110, `section ${index + 1} line is too long for live delivery`);
  }
  assert.match(bodies[index], /\*[^*]+\*/, `section ${index + 1} must highlight at least one useful phrase`);
  assert.match(bodies[index], /(แม่|น้อง)/, `section ${index + 1} must sound addressed to a live audience`);
}

assert.doesNotMatch(seed, /[๐-๙]/, 'all numbers must use Arabic numerals');
assert.doesNotMatch(
  seed,
  /เดี๋ยวน้อง|ท่อนถัด|ต่อไปน้อง|ต่อจากนี้แม่ฟัง|ให้ฟังต่อ|วน(?:ข้อมูล|สรุป).*ต่อ|กลับไป.*วนข้อมูล/,
  'shuffled sections must not promise content in a later section'
);
assert.doesNotMatch(seed, /วันละ\s*\d+\s*เม็ด|\d+\s*เม็ดก่อนนอน|เช้า\s*\*?\d+\s*เม็ด|หลังมื้อสุดท้าย/, 'unverified dosage must be omitted');
assert.doesNotMatch(seed, /4\s*แถม\s*2|2,350|392\s*บาท|ประหยัด\s*590/, 'unverified 4+2 promotion must be omitted');
assert.match(seed, /\*490 บาท\*/, 'verified single-jar price must be present');
assert.match(seed, /\*2 แถม 1\*/, 'verified 2+1 bundle must be present');
assert.match(seed, /\*1,290 บาท\*/, 'verified bundle price must be present');
assert.match(seed, /ผลิตภัณฑ์เสริมอาหาร ไม่ใช่ยา/, 'mandatory product disclaimer must be present');
assert.match(seed, /ไม่มีผลป้องกันหรือรักษาโรค/, 'mandatory disease disclaimer must be present');

const keywordContext = { window: {} };
vm.runInNewContext(keywordsSource, keywordContext);
let scanText = seed;
for (const phrase of whitelist) scanText = scanText.split(phrase).join(' ');
scanText = scanText.toLowerCase();
const hits = keywordContext.window.FX_KEYWORDS.filter(item => scanText.includes(item.term.toLowerCase()));
const hitTerms = Array.from(hits, item => item.term);
assert.deepEqual(hitTerms, [], `seed contains prohibited/risky terms: ${hitTerms.join(', ')}`);

assert.match(html, /name:'Multi-Oil LIVE 100 ท่อน'/, 'default seed name must identify the live 100-section library');
assert.match(html, /storageGet\('fx_seed_v'\)!=='8'/, 'seed migration gate must be version 8');
assert.match(html, /\['fx_seed_v','8'\]/, 'stored seed migration version must be 8');

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1])
  .filter(source => source.trim());
for (const source of inlineScripts) new Function(source);

console.log(`PASS: ${sections.length} live sections; ${hits.length} keyword hits; JavaScript syntax valid`);
```

- [ ] **Step 2: Run the test and verify the red baseline**

Run:

```bash
node tests/seed-content.test.mjs
```

Expected: FAIL at the exact-count assertion because the existing seed has 37 sections. This proves the test is reading the production seed before the new corpus exists.

### Task 2: Replace the built-in corpus and seed migration

**Files:**
- Modify: `index.html` at the `SEED3`, `makeSeedScript`, and `fx_seed_v` migration blocks
- Test: `tests/seed-content.test.mjs`

- [ ] **Step 1: Replace `SEED3` with the approved 100-section live corpus**

Write exactly 100 independent blocks in this source order so even the unshuffled source alternates live beats while preserving the approved category counts:

```text
rounds 1–10:  welcome → product → question → offer → close
rounds 11–15: welcome → product → question → offer → returning-viewer reset
rounds 16–20: welcome → product → returning-viewer reset → offer → returning-viewer reset
```

This produces exactly 20 welcome, 20 product, 15 question, 20 offer, 15 returning-viewer/reset, and 10 closing sections. Each block has one unique emoji heading, 2–4 short emoji-led spoken lines, at least one `*highlight*`, and at least one natural “แม่” or “น้อง” address. Vary the live mechanism across cycles: greeting, province prompt, first-time viewer, returning viewer, basket orientation, pack choice, price recap, label reminder, registration check, package-size check, seller check, question invitation, comment prompt, heart/share prompt, calm reassurance, objection handling, decision close, recap, and re-entry.

Use only these product/offer facts:

```text
Fuxian Multi-Oil Holistic
ผลิตภัณฑ์เสริมอาหาร
ซอฟต์เจล
30 ซอฟต์เจลต่อกระปุก
เลขสารบบอาหาร 73-1-02663-5-0172
1 กระปุก 490 บาท
2 แถม 1 รวม 3 กระปุก 1,290 บาท
ราคาเฉลี่ยของชุด 2 แถม 1 คือ 430 บาทต่อกระปุก
```

For usage questions, use the exact safe direction `อ่านฉลากก่อนรับประทาน` or `รับประทานตามฉลาก` and never add a capsule count or time of day. Do not state ingredient outcomes, medical outcomes, weight/body outcomes, delivery speed, stock scarcity, limited-time urgency, purchase popularity, or unverified bundle offers.

- [ ] **Step 2: Update the built-in seed identity and migration**

Change the runtime constants to this exact shape:

```js
const makeSeedScript = () => ({id:Date.now(),name:'Multi-Oil LIVE 100 ท่อน',text:SEED3,pos:0});

/* sync สคริปต์ตัวอย่าง — v8: คลัง LIVE 100 ท่อนอิสระ ใช้เฉพาะข้อมูลสินค้าที่ตรวจสอบแล้ว */
const legacySeedFingerprints=new Set(['5227:8bccc03','5236:d993c96a','4111:3dd19c98']);
const legacyAuxSeedFingerprints=new Map([
  ['Multi-Oil รอบ 5 นาที','1929:45cd000f'],
  ['Multi-Oil Hook + Q&A','2857:81ae2cf5']
]);
function seedFingerprint(text){
  let hash=2166136261;
  for(let i=0;i<text.length;i++){ hash^=text.charCodeAt(i); hash=Math.imul(hash,16777619); }
  return text.length+':'+(hash>>>0).toString(16);
}
function isBuiltInSeed(s){
  if(s.name==='Multi-Oil LIVE 100 ท่อน'&&s.text===SEED3) return true;
  const oldName=s.name==='Multi-Oil คลังวน 37 ท่อน'||s.name==='Multi-Oil คลังวน 32 ท่อน';
  return oldName&&legacySeedFingerprints.has(seedFingerprint(s.text));
}
function isBuiltInAuxSeed(s){ return legacyAuxSeedFingerprints.get(s.name)===seedFingerprint(s.text); }
if(storageGet('fx_seed_v')!=='8'){
  scripts=scripts.filter(s=>!isBuiltInAuxSeed(s));
  let s3=scripts.find(isBuiltInSeed);
  if(s3){ s3.name='Multi-Oil LIVE 100 ท่อน'; s3.text=SEED3; s3.pos=0; }
  else { s3={id:Date.now(),name:'Multi-Oil LIVE 100 ท่อน',text:SEED3,pos:0}; scripts.push(s3); }
  curId=s3.id;
  if(saveScripts()) storageSet([['fx_seed_v','8']]);
}
```

The name-and-fingerprint lookup migrates only known built-in seed bodies. A user script whose name merely starts with “Multi-Oil คลังวน” or “Multi-Oil LIVE”, including an edited copy of an old seed, remains byte-for-byte untouched.

- [ ] **Step 3: Run the focused test until green**

Run:

```bash
node tests/seed-content.test.mjs
```

Expected: `PASS: 100 live sections; 0 keyword hits; JavaScript syntax valid`.

### Task 3: Update project documentation

**Files:**
- Modify: `README.md` in the overview, `SEED3` map, content rules, and manual-test checklist
- Test: `tests/seed-content.test.mjs`

- [ ] **Step 1: Bring README facts in line with the verified corpus**

Make these exact documentation changes:

```text
Multi-Oil คลังวน 37 ท่อน  → Multi-Oil LIVE 100 ท่อน
fx_seed_v '7'             → fx_seed_v '8'
อย่างน้อย 30 ท่อน         → 100 ท่อน
remove dosage examples such as วันละ 2 เม็ด
remove the unverified 4 แถม 2 / 2,350 / 392 price rule
add: วิธีรับประทานให้ยึดตามฉลาก ห้ามเดาจำนวนเม็ดหรือช่วงเวลา
add: prices currently used by the seed are 1 jar 490 and 2+1 at 1,290 (430 average)
```

Update the first manual check to expect `Multi-Oil LIVE 100 ท่อน` and a clean keyword result.

- [ ] **Step 2: Re-run the focused test**

Run:

```bash
node tests/seed-content.test.mjs
```

Expected: PASS with 100 sections and 0 keyword hits.

### Task 4: Run full static and browser verification

**Files:**
- Verify: `index.html`
- Verify: `keywords.js`
- Verify: `README.md`
- Verify: `tests/seed-content.test.mjs`

- [ ] **Step 1: Run deterministic content and whitespace checks**

Run:

```bash
node tests/seed-content.test.mjs
git diff --check
git status --short
```

Expected: the test passes; whitespace check emits nothing; status lists only the intended new test, seed/docs edits, plus any pre-existing preserved changes.

- [ ] **Step 2: Verify migration and shuffle in an installed browser**

Serve the project at `http://127.0.0.1:8231`, launch the installed Chromium browser with a temporary profile and remote debugging, and inspect the page through CDP. In a clean origin, assert:

```js
localStorage.getItem('fx_seed_v') === '8'
document.querySelector('#scriptName').value === 'Multi-Oil LIVE 100 ท่อน'
document.querySelector('#scriptText').value.split(/\n(?=# )/).length === 100
document.querySelector('#kwWarn').textContent.includes('ไม่พบคำเสี่ยง')
```

Start prompt mode twice from the top and collect `.sec` heading order. Expected: both runs contain 100 unique headings, and the second order differs from the first because `roundText()` shuffles the sections.

- [ ] **Step 3: Confirm migration preserves user-authored scripts**

In the same browser origin, test authentic v5, v6, and v7 built-in fixtures. The authentic v5 case must include its original main, 5-minute, and Hook + Q&A bodies and leave only the upgraded main. For v7, combine one normal custom script, edited scripts using the two historical auxiliary names, custom scripts whose names begin `Multi-Oil LIVE` and exactly match the historical main name but have edited text, plus the authentic built-in. Test the custom-first and built-in-first orderings, reload, and assert:

```js
scripts.length === 6
scripts.some(script => script.name === 'สคริปต์ของฉัน' && script.text === '# เนื้อหาของฉัน')
scripts.some(script => script.name === 'Multi-Oil รอบ 5 นาที' && script.text === '# รอบที่ผู้ใช้แก้เอง')
scripts.some(script => script.name === 'Multi-Oil Hook + Q&A' && script.text === '# คำถามที่ผู้ใช้แก้เอง')
scripts.some(script => script.name === 'Multi-Oil LIVE สูตรของฉัน' && script.text === '# ห้ามทับเนื้อหานี้')
scripts.some(script => script.name === 'Multi-Oil คลังวน 37 ท่อน' && script.text === '# ฉบับที่ผู้ใช้แก้เอง')
scripts.some(script => script.name === 'Multi-Oil LIVE 100 ท่อน')
localStorage.getItem('fx_seed_v') === '8'
```

Expected: the custom script is byte-for-byte preserved and only the built-in seed is upgraded.
