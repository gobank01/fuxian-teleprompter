# Fuxian Teleprompter 📖

Teleprompter สำหรับอ่านสคริปต์ตอน **Live ขายของ** — เว็บ static ล้วน ไม่มี build ไม่มี backend

- 🌐 Live: **https://fuxian-teleprompter.vercel.app** (Chrome บนคอม = use case หลัก)
- 📦 Repo: https://github.com/gobank01/fuxian-teleprompter (MIT)
- สินค้าในสคริปต์: Fuxian Multi-Oil Holistic Signature 10X (ซอฟต์เจลน้ำมันสกัดเย็น 10 ชนิด)

## วิธีใช้ (ผู้ใช้)

เปิดเว็บ → กด **"▶ เริ่มอ่าน"** → นับ 3-2-1 → อ่านตามได้เลย ระบบ**วนไม่รู้จบ**: อ่านจบรอบ พัก 2 วิ สับลำดับท่อนใหม่ ขึ้นรอบถัดไปเอง ไม่ต้องกดอะไร

| คีย์ | ทำอะไร |
|---|---|
| `Space` | เล่น / พัก |
| `↑` `↓` | เร็วขึ้น / ช้าลง |
| `←` `→` | ท่อนก่อน / ท่อนถัดไป |
| `Home` / ปุ่ม ⏫ | ขึ้นบนสุด (สับท่อนใหม่ด้วย) |
| `Esc` | ออก (จำตำแหน่งไว้ อ่านต่อได้) |

ปุ่มเสริม: 🎙 ตามเสียง (Web Speech th-TH) · 🪞 กระจก · 🔲 หน้าต่างลอย (Document PiP ลอยทับแอป Live/OBS)

---

## สำหรับ AI / นักพัฒนา ที่มาทำต่อ

### โครงไฟล์ (ตั้งใจให้น้อยที่สุด — อย่าเพิ่มไฟล์/dependency ถ้าไม่จำเป็น)

```
index.html    ← ทั้งแอป: CSS + HTML + JS จบในไฟล์เดียว (~450 บรรทัด)
keywords.js   ← ฐานข้อมูลคำต้องห้ามโฆษณาอาหารเสริม 146 คำ (โหลดโดย index.html)
README.md, LICENSE, .vercelignore
```

Stack: vanilla JS ล้วน ไม่มี framework ไม่มี build step · ฟอนต์ Noto Sans Thai จาก Google Fonts · deploy เป็น static บน Vercel

### แผนที่โค้ดใน index.html (ไล่ตาม comment `/* ===== */`)

| ส่วน | ทำอะไร |
|---|---|
| `scripts storage` | localStorage `fx_scripts` = `[{id,name,text,pos}]`, `fx_cur` = id ที่เลือก, `pos` = scrollTop ที่จำไว้ตอนออก |
| `SEED3` + migration | สคริปต์ตัวอย่าง "Multi-Oil คลังวน 37 ท่อน" · ระบบ sync ผ่าน `fx_seed_v` (ตอนนี้ `'7'`) — **แก้สคริปต์ seed = แก้ SEED3 แล้ว bump เลขเวอร์ชันทั้ง 2 จุด** ระบบจะทับเฉพาะสคริปต์ชื่อขึ้นต้น "Multi-Oil คลังวน" (สคริปต์ที่ผู้ใช้สร้างเองห้ามแตะ) |
| `ตัวตรวจคำเสี่ยง` | สแกน `FX_KEYWORDS` แบบ substring (lowercase) ทุกครั้งที่พิมพ์ (debounce 400ms) · `KW_WHITELIST` = วลี disclaimer บังคับที่มีคำอย่าง "รักษาโรค" อยู่ข้างใน — ตัดออกก่อนสแกน ไม่นับเป็นคำผิด |
| `tokenize / matchPos` | ตัดคำไทยด้วย `Intl.Segmenter('th')` · matcher โหมดตามเสียงเป็น windowed scan (cur-10..cur+80) ต้องตรง ≥2 คำถึงขยับ |
| `roundText()` | หัวใจระบบสุ่ม: แตก text เป็น block ตามบรรทัดขึ้นต้น `#` → ถ้ามี ≥2 ท่อน สับลำดับทั้งหมด (Fisher-Yates) ทุกรอบ + กันเปิดรอบด้วยท่อนเดิมซ้ำ |
| `buildPrompt()` | สร้าง DOM: `#` → `.sec` (หัวทอง) · `*คำ*` → span `.hl` (เหลืองหนา, เครื่องหมาย * ไม่แสดง, ส่วนที่ไม่ใช่คำเช่น `,` ใน `1,290` ก็ต้องเหลือง) · ทุกคำเป็น span คลิกได้เฉพาะโหมดตามเสียง |
| `loop (step/raf)` | เลื่อนด้วย `scrollTop += speed*dt` — dt จากเวลาจริง · rAF + `setInterval(step,250)` สำรอง (rAF หยุดตอนแท็บ hidden) · `holdUntil`: ผู้ใช้ปัด/หมุนลูกกลิ้ง = พัก loop 1.5 วิ ไม่สู้กับนิ้ว · ถึงก้นจอ = `buildPrompt()` รอบใหม่ + พัก 2 วิ |
| `setVoice()` | สร้าง SpeechRecognition ใหม่ต้อง `stopRec()` ตัวเก่าก่อนเสมอ (กัน recognizer ซ้อน) · error ≥3 ครั้ง หรือ not-allowed → ถอยไปโหมดเลื่อนเองอัตโนมัติ + toast (ห้ามใช้ alert — modal จะ freeze ตัวเลื่อน) |
| `openPip()` | Document Picture-in-Picture: ย้าย `#scroller` ไปอีก document → **ต้องใช้ตัวแปร `scrollerEl/ptextEl` ที่จับไว้ตอนโหลด ห้าม getElementById สด** (จะได้ null หลังย้าย) · rAF ต้องวิ่งบนหน้าต่าง pip (`scrollWin`) ไม่งั้นค้างตอนหน้าหลักถูกย่อ |
| `enterPrompt/exitPrompt` | generation token `gen` กัน countdown ค้างแล้วกลับมาสตาร์ทหลังกดออก · โหมดเสียงขอไมค์**ก่อน**นับถอยหลัง · ออก = เซฟ `pos` ไว้อ่านต่อ |

### กับดักที่เคยพังมาแล้ว (อย่าทำซ้ำ)

1. **ห้ามใส่ `scroll-behavior:smooth`** บน `#scroller` และห้ามใช้ `scrollTo({behavior:'smooth'})` ขณะ loop เดิน — instant scroll ของ loop จะ cancel smooth ทิ้งกลางทาง ทำให้ปุ่มข้ามท่อน "ดูเหมือนตาย" → กระโดดด้วย `scrollTop =` ตรงๆ เท่านั้น
2. **PiP กับ element refs** — ตามตารางข้างบน เคยทำ auto-scroll ตายทั้งจอมาแล้ว
3. **ห้าม `alert()`** ในโหมดอ่าน — ใช้ `toast()` เท่านั้น
4. **แตะจอเรียกแถบปุ่มกลับมา ≠ คลิกคำ** — มี `swallowClickUntil` กันไว้ อย่าลบ

### กติกาเนื้อหาสคริปต์ (เจ้าของโปรเจคสั่งไว้ชัด — ห้ามฝ่าฝืน)

- ท่อนสคริปต์เป็น**อิสระต่อกัน ไม่ต่อเนื่อง** อย่างน้อย 30 ท่อน ระบบสุ่มวนเอง
- เรียกลูกค้า **"แม่ / แม่ๆ / แม่ขา"** เรียกตัวเอง **"น้อง"**
- **ตัวเลขเป็นเลขอารบิกเสมอ**: `490 บาท` `1,290` `2 แถม 1` `10 ชนิด` `วันละ 2 เม็ด` `ทำ IF` — ห้ามเขียนคำอ่าน (สี่ร้อยเก้าสิบ ✗)
- **emoji นำหน้าทุกบรรทัด** · `*คำสำคัญ*` ครอบชื่อสินค้า/ราคา/โปร/CF
- **ห้ามคำต้องห้าม TikTok/อย.** — เช็คกับ `keywords.js` เสมอ (ลดน้ำหนัก/ผอม/เบิร์น/รักษา/ที่สุด ✗ → ดูแลรูปร่าง/คุมอาหาร ✓) ยกเว้นวลี disclaimer บังคับ "ผลิตภัณฑ์เสริมอาหาร ไม่ใช่ยา ไม่มีผลป้องกันหรือรักษาโรค" ที่**ต้องมี**ในคลัง
- ราคาจริง: 1 กระปุก 490.- · 2 แถม 1 = 1,290.- (เฉลี่ย 430) · 4 แถม 2 = 2,350.- (เฉลี่ย 392)
- **ไม่มีรีโมทมือถือ** — เคยมี (PeerJS) แล้วเจ้าของสั่งถอดออก อย่าเสนอ/ใส่กลับ

### keywords.js

`window.FX_KEYWORDS = [{term, level:'ban'|'risky', reason, safe?}]` + `FX_KEYWORD_NOTES` (กติกาที่ไม่ใช่คำ เช่น ห้ามภาพ Before/After)
ที่มา: บัญชีแนบท้ายประกาศ อย. เรื่องหลักเกณฑ์โฆษณาอาหาร พ.ศ. 2564 (กลุ่ม 1, 2.1–2.5) + ม.40/41 พ.ร.บ.อาหาร + นโยบาย TikTok Shop ไทย
เพิ่มคำใหม่: เลือก term ให้เฉพาะเจาะจงพอที่ substring match จะไม่จับคำปกติมั่ว (เช่น ใช้ `สุดยอด` ไม่ใช่ `ยอด`)

### Deploy

```bash
cd "Fuxian Teleprompter" && npx vercel@latest deploy --prod --yes --scope bizdrives-projects
```

- Vercel project: `fuxian-teleprompter` (team bizdrives-projects) — deploy จาก CLI ไม่ได้ผูก git auto-deploy → **push GitHub อย่างเดียวเว็บไม่อัปเดต ต้องรัน vercel ด้วย**
- โปรเจคใหม่บน team นี้จะติด SSO protection — ถ้าเจอหน้า login ให้ `PATCH /v9/projects/<name>?teamId=<id>` body `{"ssoProtection":null}`
- ทดสอบ local: `python3 -m http.server 8231` (มี `.claude/launch.json` ชื่อ `fuxian-teleprompter` อยู่แล้ว)

### ทดสอบด้วยมือหลังแก้ (ยังไม่มี test runner — แอปเล็กพอ)

1. โหลดหน้า → สคริปต์ "Multi-Oil คลังวน 37 ท่อน" ขึ้น + ตัวตรวจขึ้น "✅ ไม่พบคำเสี่ยง"
2. พิมพ์ "ลดน้ำหนัก" ในสคริปต์ → ต้องขึ้น 🔴 พร้อมคำแทน แล้วลบ → กลับเป็น ✅
3. เริ่มอ่าน → เลื่อนเอง, กด ⏭ ขณะเล่นต้องกระโดดทันที, ลาก scrollTop ไปก้นจอ → ต้องเด้งขึ้นรอบใหม่เองภายใน ~2 วิ พร้อมลำดับท่อนใหม่
4. Esc → กลับหน้าแก้ไข → เริ่มใหม่ → ต้องอ่านต่อจากตำแหน่งเดิม

## License

MIT
