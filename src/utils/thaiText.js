/* ═══ 🇹🇭 ชั้นภาษา — ตัดคำไทย · เชื่อมคำทับศัพท์ไทย↔อังกฤษ · ทนคำพิมพ์ผิด ═══ 2026-09-24

   ที่มา (คำสั่ง user): *"หาหลักการหรือทฤษฎีจากภายนอกมาช่วยสนับสนุนการจับกลุ่มคำ
   ให้เก่งกว่านี้ได้มั้ย เรื่องภาษา แก้เลย ทำยังไงให้รวมได้"*

   ── โจทย์จริงจากหน้างาน (วัดจาก downtime_logs + mtn_orders) ──
   ช่างพิมพ์ศัพท์เครื่องจักรเป็น **คำอังกฤษที่เขียนด้วยอักษรไทย** และเขียนติดกันไม่มีช่องว่าง
     "คอนเวเย่ออาราม" = conveyor alarm · "เลเซอร์05อารามtc" = laser 05 alarm TC
     "เบนดิ่ง06อารามแกนx" = bending 06 alarm axis X · "โพคาโยเกะอาราม" = poka-yoke alarm
     "เซ็นเซอร์จับเมนเดลเบนดิ่งlhอราม" · "สายไฮดรอลิคเเตก" (พิมพ์ เเ แทน แ)
   ⇒ ตัวจับคำแบบเทียบตัวอักษรตรงๆ มองว่า "คอนเวเย่ออาราม" กับ "conveyor alarm"
     เป็นคำละเรื่องกันคนละตัว ทั้งที่ช่างหมายถึงสิ่งเดียวกัน

   ── 4 ทฤษฎี/มาตรฐานจากภายนอกที่เอามาใช้ (ไม่เพิ่ม dependency) ──
   1. **Unicode NFC + grapheme/word segmentation (UAX #29 + ICU dictionary-based Thai break)**
      ไทยไม่มีช่องว่างระหว่างคำ ⇒ `.split(' ')` ได้ 1 token เสมอ · ใช้ `Intl.Segmenter('th')`
      ที่ผูกกับ ICU ในตัวเบราว์เซอร์/Node (Chromium 87+ · เพดานจอ TV ของเรา = Cr 94 ⇒ ใช้ได้)
      วัดจริง: "คอนเวเย่ออาราม" → คอน | เว | เย่อ | **อาราม** (แยก "อาราม" ออกมาได้)
   2. **Phonetic matching (Soundex 1918 / Metaphone 1990) — ดัดแปลงเป็น "ข้ามสคริปต์"**
      Soundex ย่อคำเป็นโครงพยัญชนะเพื่อให้คำที่ *ออกเสียงเหมือนกัน* ชนกัน · ที่นี่ทำแบบเดียวกัน
      แต่ย่อ **ทั้งไทยและอังกฤษ** ลงโครงเดียวกัน ⇒ ทับศัพท์กับคำอังกฤษได้คีย์เท่ากัน
        อาราม → RM  ·  alarm → RM   (ล/ร = เสียงเดียวกันในคำทับศัพท์ไทย)
        เลเซอร์ → LSR · laser → LSR  ·  เบนดิ่ง → BNDN · bending → BNDN
        ไฮดรอลิค → HDRK · hydraulic → HDRK · เซ็นเซอร์ → SNSR · sensor/senser → SNSR
   3. **Approximate string matching (Levenshtein 1965 / Damerau 1964)**
      ปิดส่วนที่เหลือของคำพิมพ์ผิด: conyeyor · bemding · Srcap · คอนเวเย่า · คออนเวเย่อ
   4. **กฎอักขรวิธีไทยที่ต้องใช้ ไม่ใช่การเดา** — ห นำ (ห + สระ/สอนอรลว = ห ไม่ออกเสียง:
      "หรีด" = reed) · ทร = ซ ("ทราบ") · ์ (ทัณฑฆาต) ในคำทับศัพท์ = ตัวอักษรอังกฤษจริง
      ("เลเซอร์" ร์ = R ของ laser) **ห้ามตัดทิ้ง** · เเ (สระเอ 2 ตัว) = แ ที่พิมพ์ผิด

   ── 🔴 สิ่งที่ไฟล์นี้ *ไม่* ทำ ──
   **ไม่มีพจนานุกรมศัพท์โรงงานสักคำ** — ไม่มีลิสต์ "conveyor/laser/bending" ที่นี่เลย
   มันแค่ทำให้ "คำ 2 คำที่ออกเสียงเหมือนกัน" เทียบกันได้ · หมวดหมู่ยังมาจากทะเบียนของโรงงาน
   เท่านั้น (กฎ CLAUDE.md: ห้าม AI เดา taxonomy) · ตารางเสียงข้างล่างเป็น**อักขรวิธีของภาษา**
   ไม่ใช่ศัพท์เฉพาะทาง — เติมได้เฉพาะกฎเสียง ห้ามเติมชื่ออุปกรณ์

   ⚠️ pure — ห้าม import supabase (ต้องเทสได้ด้วย `node --test` ตรงๆ)                */

const THAI = '฀-๿';
const TH_RE = new RegExp(`[${THAI}]`);
/** สระ/วรรณยุกต์/เครื่องหมายที่ไม่ใช่พยัญชนะ (ไม่รวม ์ ที่ต้องดูตัวก่อนหน้า) */
const TH_MARKS = /[ะ-ฺ็-๎เ-ไฤฦ]/;

/** ── 1) normalize ─────────────────────────────────────────────────────────
 *  NFC + ตัดอักขระล่องหน + แก้ เเ→แ + แยกรอยต่อไทย↔อังกฤษ↔เลข
 *  🔴 ต้องแยกรอยต่อ**ก่อน**ส่ง Intl.Segmenter — วัดจริง "เลเซอร์05อารามtc" ถ้าไม่แยกก่อน
 *     ICU คืนก้อนเดียวทั้งสตริง (ตัวเลข/อักษรละตินกลางคำทำให้ dictionary break ยอมแพ้) */
export function normalizeThai(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[​-‍﻿­]/g, '')        // ZWSP/ZWNJ/ZWJ/BOM/soft hyphen
    .replace(/เเ/g, 'แ')                  // เเ → แ (พิมพ์ผิดคลาสสิก)
    .replace(/ํ(?=[่-๋]?า)/g, 'า') // นิคหิต + า → ำ ที่แตกออกมา
    .toLowerCase()
    .replace(new RegExp(`([${THAI}])([a-z0-9])`, 'g'), '$1 $2')
    .replace(new RegExp(`([a-z0-9])([${THAI}])`, 'g'), '$1 $2')
    .replace(new RegExp(`[^a-z0-9${THAI}]+`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ── 2) ตัดคำ ────────────────────────────────────────────────────────────
 *  ไทย: `Intl.Segmenter` (ICU dictionary) · อังกฤษ/เลข: ช่องว่างพอ
 *  fallback เมื่อไม่มี Intl.Segmenter = คืนก้อนเดิม (พฤติกรรมเท่าโค้ดก่อนหน้านี้ ไม่แย่ลง) */
let _seg = null;
function segmenter() {
  if (_seg !== null) return _seg;
  try { _seg = new Intl.Segmenter('th', { granularity: 'word' }); }
  catch { _seg = false; }
  return _seg;
}
export function segmentWords(text) {
  const norm = normalizeThai(text);
  if (!norm) return [];
  const out = [];
  for (const chunk of norm.split(' ')) {
    if (!chunk) continue;
    if (!TH_RE.test(chunk)) { out.push(chunk); continue; }
    const sg = segmenter();
    if (!sg) { out.push(chunk); continue; }
    for (const p of sg.segment(chunk)) if (p.isWordLike) out.push(p.segment);
  }
  return out;
}

/** ── 3) คำทับศัพท์ถูกตัดเป็นเศษ ⇒ ต้องลองต่อเศษที่อยู่ติดกันกลับเป็นคำ ──────
 *  ICU ไม่มีคำยืมในพจนานุกรม: "คอนเวเย่อ" → คอน|เว|เย่อ ⇒ ถ้าดูแต่ unigram จะไม่มีวันเจอ conveyor
 *  ⇒ คืน unigram + n-gram ของเศษที่ **ติดกัน** (ไม่ข้ามช่องว่าง) ยาวถึง `maxN` ชิ้น
 *  ⚠️ เพดาน maxN 4 — สูงกว่านี้จำนวน candidate โตแบบ n×maxN แล้วเริ่มจับคำข้ามคำจริง */
export function candidateTerms(text, { maxN = 4, isStop = null } = {}) {
  const norm = normalizeThai(text);
  const out = new Set();
  for (const chunk of norm.split(' ')) {
    if (!chunk) continue;
    const parts = TH_RE.test(chunk) ? segmentWords(chunk) : [chunk];
    for (let i = 0; i < parts.length; i++) {
      /* 🔴 คำที่ขึ้นต้นด้วยคำโหล/คำเชื่อม ไม่ใช่ "คำ" — ห้ามเอาไปเทียบเสียง
         วัดจริง 24/09: "ไม่ทัน" (ไม่ + ทัน) ได้คีย์เสียง mtn เท่ากับ "meeting" เป๊ะ
         ⇒ "พนักงานใหม่เคาะงาน 2คนไม่ทัน" ถูกจับเข้า "Meeting ก่อนเริ่มงาน" */
      if (isStop && isStop(parts[i])) continue;
      let glue = '';
      for (let n = 0; n < maxN && i + n < parts.length; n++) {
        const last = parts[i + n];
        glue += last;
        if (!(isStop && isStop(last))) out.add(glue);
      }
    }
  }
  return [...out];
}

/* ── 4) คีย์เสียงข้ามสคริปต์ (Soundex/Metaphone ดัดแปลง) ───────────────────
   คลาสเสียงที่ยุบเข้าหากัน — **เหตุผลทางภาษา ไม่ใช่ศัพท์โรงงาน**:
     k ← ก ข ค ฆ g q c(แข็ง) ck   (ไทยไม่มีเสียง g แยก ⇒ gripper เขียน กริปเปอร์)
     r ← ร ล ฬ l                  (คำทับศัพท์ไทยสลับ ล/ร เสมอ ⇒ alarm → อาราม)
     w ← ว v w                    (ไทยไม่มีเสียง v ⇒ conveyor → คอนเวเย่อ)
     s ← ส ศ ษ ซ s z x(=ks ย่อ)
     c ← จ ฉ ช ฌ ch sh j
     t ← ต ฏ ถ ท ธ ฐ ฑ ฒ t d? (ไม่ยุบ d — ดาย/die กับ ทิป/tip ต้องต่างกัน)
   ตัดสระ/วรรณยุกต์ทั้งหมด แล้วยุบตัวซ้ำติดกัน (stopper → stpr = สต็อปเปอร์)          */
const TH_CONS = {
  ก: 'k', ข: 'k', ฃ: 'k', ค: 'k', ฅ: 'k', ฆ: 'k', ง: 'n',
  จ: 'j', ฉ: 'j', ช: 'j', ซ: 's', ฌ: 'j', ญ: 'y',
  ฎ: 'd', ฏ: 't', ฐ: 't', ฑ: 't', ฒ: 't', ณ: 'n',
  ด: 'd', ต: 't', ถ: 't', ท: 't', ธ: 't', น: 'n',
  บ: 'b', ป: 'p', ผ: 'p', ฝ: 'f', พ: 'p', ฟ: 'f', ภ: 'p', ม: 'm',
  ย: 'y', ร: 'r', ล: 'r', ว: 'w', ศ: 's', ษ: 's', ส: 's',
  ห: 'h', ฬ: 'r', อ: '', ฮ: 'h',
};
/** ห นำ — ห + พยัญชนะเสียงสนิท = ห ไม่ออกเสียง (กฎอักขรวิธีไทย) */
const H_LEAD_NEXT = /[งญณนมยรลวฬ]/;

function thaiKey(word) {
  let out = '';
  let first = true;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (TH_MARKS.test(ch) || ch === '฿' || ch === '๏' || ch === '๚' || ch === '๛') continue;
    if (ch === 'ๆ') continue;                       // ๆ = เครื่องหมายซ้ำคำ ไม่ใช่เสียง
    const c = TH_CONS[ch];
    if (c === undefined) continue;
    if (ch === 'ห' && H_LEAD_NEXT.test(word[i + 1] || '')) continue;   // ห นำ
    // y = สระเมื่อไม่ได้ขึ้นต้นคำ — กฎเดียวกับฝั่งอังกฤษ ต้องสมมาตรไม่งั้นคีย์ 2 ฝั่งไม่ตรงกัน
    // (โพคาโยเกะ / pokayoke · โซลินอยด์ / solenoid)
    if (c === 'y' && !first) continue;
    if (c) first = false;
    out += c;
  }
  return out;
}

function latinKey(word) {
  let w = word.replace(/[^a-z]/g, '');
  if (!w) return '';
  const initialY = w[0] === 'y';
  w = w
    // ① digram ที่ออกเสียงเป็นเสียงเดียว (ต้องแทนก่อนตัวเดี่ยวเสมอ)
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'kw')
    .replace(/sh/g, 'j').replace(/ch/g, 'j').replace(/th/g, 't')
    .replace(/wh/g, 'w').replace(/ng/g, 'n').replace(/gh/g, '')
    // ② c อ่อน/แข็ง ตามหลักการอ่านอังกฤษ (c + e/i/y = เสียง s · นอกนั้น = เสียง k)
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/x/g, 'ks')
    // ③ ตัดสระ — y เป็น "สระ" เมื่อไม่ได้ขึ้นต้นคำ (hydraulic · system) ตามหลักการอ่านอังกฤษ
    .replace(/[aeiou]/g, '');
  w = (initialY ? w[0] + w.slice(1).replace(/y/g, '') : w.replace(/y/g, ''));
  return w
    .replace(/[gq]/g, 'k')
    .replace(/[lr]/g, 'r').replace(/[vw]/g, 'w').replace(/[sz]/g, 's');
}

/**
 * คีย์เสียงของคำ — ไทยหรืออังกฤษก็ได้ คำที่ออกเสียงเหมือนกันต้องได้คีย์เท่ากัน
 * @returns {string} '' = คำนี้ไม่มีพยัญชนะให้จับ (เลขล้วน/สระล้วน)
 */
export function phoneticKey(word) {
  const w = normalizeThai(word).replace(/\s+/g, '');
  if (!w) return '';
  const raw = TH_RE.test(w) ? thaiKey(w) : latinKey(w);
  return raw.replace(/(.)\1+/g, '$1');                   // ยุบตัวซ้ำ (pallet → prt)
}

/** ── 5) ระยะห่างคำ (Damerau–Levenshtein แบบตัดที่เพดาน) ─────────────────── */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > max) return max + 1;
  /* 3 แถวหมุน: row0 = แถว i-2 (ต้องมีไว้ทำ transposition) · row1 = i-1 · row2 = แถวปัจจุบัน
     ⚠️ เคยเขียนพลาดตรงนี้: เซ็ต row0 = null หลังรอบแรก แล้วรอบที่ 2 อ่าน null → TypeError
        (ไม่โผล่ตอนเทสคู่คำสั้นๆ เพราะออกทาง early-exit ก่อน) */
  let row0 = null;
  let row1 = new Array(n + 1);
  for (let j = 0; j <= n; j++) row1[j] = j;
  for (let i = 1; i <= m; i++) {
    const row2 = new Array(n + 1);
    row2[0] = i;
    let best = row2[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(row1[j] + 1, row2[j - 1] + 1, row1[j - 1] + cost);
      // transposition (Damerau) — "conyeyor" vs "conveyor" = สลับตัวอักษร ไม่ใช่ผิด 2 ตัว
      if (i > 1 && j > 1 && row0 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, row0[j - 2] + 1);
      }
      row2[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    row0 = row1; row1 = row2;
  }
  return row1[n];
}

/**
 * คำ 2 คำนี้ "คำเดียวกัน" ไหม (สำหรับจับคำในข้อความ ไม่ใช่ค้นหา)
 * ชั้น 1 ตัวอักษรตรงกัน → ชั้น 2 คีย์เสียงตรงกัน → ชั้น 3 คีย์เสียงต่างกันไม่เกิน 1 ตัว
 * 🔴 คีย์สั้นห้ามใช้ชั้น 3 — ตัดสระออกแล้วคำสั้นชนกันง่ายมาก (nut/not/net → nt · tip/top → tp)
 *    ⇒ ยอมพลาดดีกว่าจับผิด (กฎเดียวกับ "ก้ำกึ่ง → null" ใน autoCategory)
 */
export function sameWord(a, b) {
  const na = normalizeThai(a).replace(/\s+/g, ''), nb = normalizeThai(b).replace(/\s+/g, '');
  if (!na || !nb) return false;
  if (na === nb) return true;

  const aTh = TH_RE.test(na), bTh = TH_RE.test(nb);

  /* ── กรณี A: สคริปต์เดียวกัน = ปัญหา "พิมพ์ผิด" → เทียบ **ตัวอักษรจริง** ──────────
     🔴 ห้ามเทียบด้วยคีย์เสียงในกรณีนี้ (เคยทำแล้วพังจริง 24/09):
        คีย์เสียงตัดสระทิ้ง ซึ่งภาษาไทยพึ่งสระหนักมาก ⇒ คำไทยคนละเรื่องได้คีย์เท่ากันเพียบ
        วัดจริงตอนปล่อยให้เทียบเสียงในสคริปต์เดียวกัน: "คอนเวเย่ออาราม" ถูกจับเข้า
        "Meeting ก่อนเริ่มงาน" · "แก้ไขงานยุบ" → "รอ Kanban" · "ช่างใหม่แควหัว" → "ราง Conveyor"
     การเทียบเสียงมีไว้แก้ "ทับศัพท์" เท่านั้น ⇒ ใช้เมื่อข้ามสคริปต์ (กรณี B) */
  if (aTh === bTh) {
    const lo = Math.min(na.length, nb.length), hi = Math.max(na.length, nb.length);
    if (lo < 4) return false;
    const d = editDistance(na, nb, 2);
    return d <= 2 && 1 - d / hi >= 0.8;      // คอนเวเย่า/คอนเวเย่อ · conyeyor/conveyor
  }

  /* ── กรณี B: ไทย ↔ อังกฤษ = ปัญหา "ทับศัพท์" → เทียบด้วยคีย์เสียง ─────────────────
     🔴 MIN_LEN — ต้นฉบับต้องยาว ≥ 4 ตัวอักษรทั้งคู่ เพราะตัดสระแล้วคำสั้นชนกันหมด
        และเป็นการชนที่อันตรายจริงในข้อมูลชุดนี้: ลม (air) → rm ชนกับ อาราม (alarm) → rm
        ⇒ "ลมตก" จะกลายเป็น alarm · nut/not → nt · tip/top → tp · ราง/รอง → rn */
  if (na.length < 4 || nb.length < 4) return false;
  /* 🔴 ข้ามสคริปต์ต้อง **คีย์ตรงเป๊ะ** ห้ามเผื่อ (วัดจริง 24/09 — เคยเผื่อไว้ 1 ตัวแล้วพังหนัก)
     โครงพยัญชนะสั้นมาก (3-5 ตัว) ⇒ ผิดได้ 1 ตัว = เปิดประตูให้คำคนละเรื่องชนกันเพียบ:
       เครื่อง (krn) ↔ clearance (krns) · คอนโทน (kntn) ↔ kanban (knbn)
       ก่อนเริ่ม (knrm) ↔ conveyor (knwr) · สต็อปเป่อ (stp) ↔ strip (strp)
     ราคาที่จ่าย: เสียคู่ที่สะกดตกไป 1 เสียง (คอนเวเย่อ knw ↔ conveyor knwr) — ยอมรับได้
     ตามกฎ "ตกถังดีกว่าเดาผิด" · ความยาวต้นฉบับต้องใกล้กันด้วย (ทับศัพท์ ≈ ยาวพอๆ กัน) */
  if (Math.abs(na.length - nb.length) > 3) return false;
  const ka = phoneticKey(na), kb = phoneticKey(nb);
  /* คีย์ต้องมีพยัญชนะ ≥ 3 ตัวถึงจะเชื่อ — 2 ตัวคือข้อมูลน้อยเกินไป (rm/nt/tp ชนกันเพียบ) */
  if (!ka || !kb || Math.max(ka.length, kb.length) < 3) return false;
  if (ka === kb) return true;
  /* 🇹🇭 **r ท้ายคำเป็นตัวเลือก** — กฎการรับคำยืมของภาษาไทย (non-rhotic loanword adaptation):
     เสียง /r/ ท้ายพยางค์ของอังกฤษ ไทยไม่ออกเสียง จะเขียน ร์ (ทัณฑฆาต) หรือ **ตัดทิ้งไปเลย**
     ก็ได้ และช่างเขียนทั้ง 2 แบบจริง:  เลเซอร์ (เก็บ ร์) ↔ laser  ·  คอนเวเย่อ (ตัดทิ้ง) ↔ conveyor
     ⇒ ยอมให้ต่างกันได้เฉพาะ "r ตัวสุดท้าย" ตัวเดียวเท่านั้น (ไม่ใช่เผื่อ 1 ตัวที่ตำแหน่งไหนก็ได้
        ซึ่งเคยทำแล้วพัง: เครื่อง krn ↔ clearance krns)
     🔴 ไม่ใช่ศัพท์โรงงาน — เป็นกฎเสียงของภาษา จึงอยู่ในไฟล์นี้ได้ */
  return ka === `${kb}r` || `${ka}r` === kb;
}

/** ยาวพอจะเชื่อ "เสียง" ได้ไหม — ตัดสระทิ้งแล้วคำสั้นชนกันเละ (ดู MIN_LEN ใน sameWord) */
export const longEnoughForSound = (w) => normalizeThai(w).replace(/\s+/g, '').length >= 4;
