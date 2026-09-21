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
