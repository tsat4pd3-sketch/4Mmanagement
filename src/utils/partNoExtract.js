/* ════════════════════════════════════════════════════════════════════════════
   ถอด "เบอร์พาร์ทลูกค้า (Part No.)" ออกจากข้อความชื่อพาร์ท — 2026-10-05
   คำขอ user: *"ใน SAP ที่ดึงมา part name, part no. มันดันอยู่ใน object description
   ช่องเดียว … พอจะมีอัลกอริทึ่มไปเรียนแล้วไปแยกให้ได้มั้ย และให้คนคอนเฟิมหรือแก้ไขได้มั้ย"*

   ── ทำไมต้องมีไฟล์นี้ ───────────────────────────────────────────────────────
   ไฟล์ Display Multilevel BOM ของ SAP **ไม่มีคอลัมน์ part no.** เลย
   (หัวตารางมีแค่ Plant · SPT · Item · Level · Obj · Object description · Qty · Un
    · CostRel · MS · SLoc · SLoc · Change No. · By · Changed on)
   เบอร์ลูกค้าถูกคนกรอก **ปนอยู่ในข้อความ `Object description`** ตามธรรมเนียม
   เช่น `BRKT RAD SUPT UPR RH(MB3B8226AA)` · `REINF FRT BMPR-N1WB-17A835-RAก่อนชุบ`

   ── กฎเหล็กของไฟล์นี้ ──────────────────────────────────────────────────────
   🔴 **ห้ามฝัง "รายการ" คำนำหน้าของลูกค้าไว้ในโค้ด** — เรียนจากทะเบียนจริงเสมอ
      (`parts_master.part_no` + `dr_products.p_no`) ผ่าน `learnPartNoVocab()`
      โรงงานอื่น/ลูกค้าใหม่ = คำนำหน้าชุดใหม่ ระบบเรียนเองโดยไม่ต้องแก้โค้ด
      (สิ่งที่เขียนไว้ในโค้ดได้คือ **"รูปประโยค"** ซึ่งเป็นความรู้เรื่องงาน ไม่ใช่ข้อมูล)
   🔴 **ไม่มั่นใจ = คืน `null` ห้ามเดา** — เบอร์ผิดแย่กว่าเบอร์ว่าง
      (ว่าง = คนเห็นแล้วไปกรอก · ผิด = ไม่มีใครรู้ว่าผิด แล้วไหลไปทั้งระบบ)
   🔴 **"เสนอ" เท่านั้น ห้ามเขียนลงฐานเอง** — จอต้องให้คนยืนยัน/แก้ก่อนเสมอ
      (หลักเดียวกับ `autoCategory.js` · `pe_master_proposals` · KPI ช่าง)

   ── วัดกับข้อมูลจริง 2026-10-05 (ทะเบียน 357 แถวที่มีทั้งชื่อและเบอร์) ──────
   เรียนได้คำนำหน้า: MB3B 135 · N1WB 134 · RB3B 69 · MB3C 19 · EB3B 13 · TB3C 9
                     · W520 8 · 5306 8 · R1WB 8 · DA6V 7 · SB3C/BHS0/BHV7/PB3C 6 …
   เสนอออกมาได้ 200/357 (ที่เหลือชื่อไม่มีเบอร์จริงๆ — ต้องเงียบ)
   🔎 แถวที่ "ผิด" เปิดดูแล้วส่วนใหญ่เป็น **ทะเบียนเองที่ขัดกับชื่อตัวเอง**
      เช่น ชื่อ `SUPT ASY RAD(MB3B-8A297-CB)` แต่ช่อง part_no กรอก `MB3B-8A297-BC`
      (สลับ CB/BC) · ชื่อ `TB3C-5F094` แต่ part_no `TB3C-5F095`
      ⇒ ตัวถอดไปจับ "ข้อมูลทะเบียนผิด" เจอ — จอจึงต้องโชว์ของเดิมคู่กับที่เสนอเสมอ
      และห้ามทับค่าเดิมเงียบๆ (`conflict` ใน `proposePartNos`)
   ════════════════════════════════════════════════════════════════════════════ */

const PREFIX_LEN = 4;

/** ตัดให้เหลือเฉพาะ A-Z 0-9 ตัวพิมพ์ใหญ่ (ไทย/ขีด/วงเล็บ/ช่องว่าง หายหมด) */
const alnum = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "ทรง" ของสตริง — ตัวอักษร→A เลข→9 (`MB3B8A297CB` → `AA9A9A999AA`) */
export const shapeOf = (s) => String(s ?? '').toUpperCase().replace(/[A-Z]/g, 'A').replace(/[0-9]/g, '9');

/** คำนำหน้าที่ใช้ได้ต้อง "มีทั้งตัวอักษรและตัวเลข" — กันคำอังกฤษล้วน (BRKT/REIN/MOUN)
 *  ที่หลุดเข้ามาเพราะบางแถวในทะเบียนกรอกสลับช่อง (เอาชื่อไปใส่ช่องเบอร์) */
const okPrefix = (p) => p.length === PREFIX_LEN && /[A-Z]/.test(p) && /[0-9]/.test(p);

/* ── ไวยากรณ์เบอร์พาร์ท (user อธิบายเอง 2026-10-05) ────────────────────────────
   *"ส่วนใหญ่ประกอบไปด้วย prefix คือพวก MB3B, N1WB, RB3B … ตามด้วยตัวเลข part no.
     5-6 หลัก อาจจะมี - ขั้นบ้างหรือไม่มี ต่อด้วย suffix คือพวก CB, BC, CE, CF
     แล้วแต่ revision ลูกค้า"*
   ⚠️ ตรวจบน "สตริงที่ตัดขีด/วงเล็บ/ไทยออกแล้ว" ⇒ มีขีดคั่นหรือไม่มีก็เข้ากฎเดียวกัน
      (`MB3B-8A297-CB` กับ `MB3B8A297CB` คือตัวเดียวกัน — ทะเบียนจริงเขียนทั้ง 2 แบบ) */
const GRAMMAR = [
  /* prefix + เลขรุ่น + suffix revision 2 ตัว  →  MB3B8A297CB · RB3BE111E50AB · MB3B16C274CE
     🔑 ตัวก่อน suffix ต้องเป็น **ตัวเลข** — เลขรุ่นจบด้วยเลขเสมอ (user: "ตามด้วยตัวเลข part no.
        5-6 หลัก … ต่อด้วย suffix") ⇒ กันไม่ให้คำอังกฤษท้ายชื่อถูกกินเป็น suffix
        เคสจริง: `W520771-S300 NUT WELD M6 HF 10` เคยถูกอ่านเป็น `W520771-S300 NUT`
        (ฐาน `771S300N` + suffix `UT`) — ตัวก่อน `UT` เป็น `N` ⇒ ตกกฎนี้ */
  { re: /^[A-Z0-9]{4}[A-Z0-9]{3,7}[0-9][A-Z]{2}$/, why: 'prefix + เลขรุ่น + suffix 2 ตัว' },
  /* suffix ตัวเดียว (บางรุ่นลูกค้าออกแค่ตัวเดียว) → MB3B5049C · MB3BS003K16A */
  { re: /^[A-Z0-9]{4}[A-Z0-9]{3,7}[0-9][A-Z]$/, why: 'prefix + เลขรุ่น + suffix 1 ตัว' },
  /* สายงานขึ้นรูป PIA → N1WB17E850RPIA01 · MB3C4C193APIA01 · TB3C5F097XPIA01 */
  { re: /^[A-Z0-9]{4}(?=[A-Z0-9]*[0-9])[A-Z0-9]{3,8}[A-Z]{1,2}PIA[0-9]{2}$/, why: 'prefix + เลขรุ่น + PIA' },
];
const grammarHit = (cand) => GRAMMAR.find(g => g.re.test(cand)) || null;

/**
 * เรียน "คลังคำ" จากเบอร์ที่คนกรอกไว้แล้ว — ไม่มีรายการไหน hardcode
 * @param {string[]} samples ค่า part_no / p_no ที่มีอยู่จริงในทะเบียน
 * @param {{minSeen?:number}} opt `minSeen` = คำนำหน้าต้องเคยเห็นกี่ครั้งถึงจะเชื่อ (default 3)
 */
export function learnPartNoVocab(samples, { minSeen = 3 } = {}) {
  const prefCount = new Map(), shapeCount = new Map();
  const known = new Set();
  let minLen = Infinity, maxLen = 0, n = 0;

  for (const s of samples || []) {
    const k = alnum(s);
    /* สั้นไป/ยาวไป = ไม่ใช่เบอร์พาร์ท (ยาวมาก = คนเอา "ชื่อ" ไปใส่ช่องเบอร์ — มีจริงในทะเบียน) */
    if (k.length < 6 || k.length > 24) continue;
    if (!/[0-9]/.test(k) || !/[A-Z]/.test(k)) continue;
    n++; known.add(k);
    minLen = Math.min(minLen, k.length);
    maxLen = Math.max(maxLen, k.length);
    const p = k.slice(0, PREFIX_LEN);
    if (okPrefix(p)) prefCount.set(p, (prefCount.get(p) || 0) + 1);
    const sh = shapeOf(k);
    shapeCount.set(sh, (shapeCount.get(sh) || 0) + 1);
  }

  const prefixes = new Set([...prefCount].filter(([, c]) => c >= minSeen).map(([p]) => p));
  const shapes = new Set([...shapeCount].filter(([, c]) => c >= Math.min(2, minSeen)).map(([sh]) => sh));
  return { prefixes, shapes, known, minLen: Number.isFinite(minLen) ? minLen : 0, maxLen, n };
}

/** map ตำแหน่งในสตริงที่ตัดอักขระพิเศษออกแล้ว → ตำแหน่งในสตริงต้นฉบับ */
function alnumIndex(text) {
  const idx = [], up = String(text ?? '').toUpperCase();
  for (let i = 0; i < up.length; i++) if (/[A-Z0-9]/.test(up[i])) idx.push(i);
  return idx;
}

/**
 * ถอดเบอร์พาร์ทจากข้อความ 1 บรรทัด
 * @returns {{partNo:string,key:string,confidence:'high'|'medium',reason:string,start:number,end:number}|null}
 *          `null` = ถอดไม่ได้/ไม่มั่นใจ — **จอต้องปล่อยว่าง ห้ามเติมอะไรแทน**
 */
export function extractPartNo(text, vocab) {
  const raw = String(text ?? '');
  if (!raw.trim() || !vocab) return null;
  const idx = alnumIndex(raw), k = alnum(raw);
  if (k.length < 8) return null;

  const span = (at, len) => {
    const start = idx[at], end = idx[at + len - 1];
    const after = raw[end + 1], before = raw[start - 1];
    return {
      start, end, text: raw.slice(start, end + 1),
      edgeR: end + 1 >= raw.length || !/[A-Za-z0-9]/.test(after),
      edgeL: start === 0 || !/[A-Za-z0-9]/.test(before),
    };
  };

  /* ── รอบ ① เบอร์ที่ "มีอยู่จริงในทะเบียน" โผล่ในข้อความตรงๆ ───────────────
     แม่นที่สุดและไม่ต้องพึ่งคำนำหน้าเลย ⇒ จับเบอร์ตระกูลที่ยังมีน้อย
     (เช่น `W715264-S` ที่คำนำหน้า W715 ยังไม่ถึงเกณฑ์ให้เรียน) ได้ด้วย
     ยาวสุดชนะ — `W520771-S300` ต้องชนะ `W520771` ที่ทะเบียนเคยกรอกตกหล่นไว้ */
  let hitA = null;
  for (const key of vocab.known || []) {
    if (key.length < 8) continue;                 // สั้นกว่านี้ชนคำอื่นในชื่อได้ง่าย
    const at = k.indexOf(key);
    if (at === -1) continue;
    if (!hitA || key.length > hitA.key.length) hitA = { key, at };
  }
  if (hitA) {
    const sp = span(hitA.at, hitA.key.length);
    return {
      key: hitA.key, partNo: sp.text, confidence: 'high',
      reason: 'ตรงกับเบอร์ที่มีในทะเบียนอยู่แล้ว', start: sp.start, end: sp.end,
    };
  }

  /* ── รอบ ② ไวยากรณ์ + คำนำหน้าที่เรียนมา (รับพาร์ทใหม่ที่ทะเบียนยังไม่มี) ──
     🔑 **ต้องจบที่ "ขอบคำ"** (วงเล็บ/ขีด/ช่องว่าง/ตัวไทย/ท้ายบรรทัด) —
     นี่คือตัวกันการจับเกินปลายคำ โดยไม่ต้องมีพจนานุกรมคำท้าย (ซึ่งจะกลายเป็นการเดา)
       `…-MB3B-16C274-CE-SODECIA` → `MB3B16C274CESO` เข้าไวยากรณ์ก็จริง
        แต่จบกลางคำ `SODECIA` ⇒ ตก · `MB3B-16C274-CE` จบก่อน `-` ⇒ ผ่าน
     ยาวสุดต่อหนึ่งจุดเริ่ม ชนะ แล้วค่อยเทียบข้ามจุดเริ่มด้วยคะแนน */
  if (!vocab.prefixes?.size) return null;
  const hi = Math.min(Math.max(vocab.maxLen || 0, 18), 24);
  let best = null;
  for (const p of vocab.prefixes) {
    for (let at = k.indexOf(p); at !== -1; at = k.indexOf(p, at + 1)) {
      for (let len = Math.min(hi, k.length - at); len >= 8; len--) {
        const cand = k.slice(at, at + len);
        const gram = grammarHit(cand);
        const seen = vocab.shapes.has(shapeOf(cand));
        if (!gram && !seen) continue;
        const sp = span(at, len);
        if (!sp.edgeR) continue;                  // 🔴 จบกลางคำ = ไม่ใช่เบอร์ ข้ามไป
        const score = (seen ? 120 : 0) + (gram ? 80 : 0) + (sp.edgeL ? 20 : 0) + len;
        if (!best || score > best.score) {
          best = {
            score, key: cand, partNo: sp.text, confidence: 'medium',
            reason: gram ? `${gram.why} — ยังไม่มีเบอร์นี้ในทะเบียน`
                         : `รูปแบบตรงกับเบอร์ที่ใช้อยู่ (${p}…) — ยังไม่มีในทะเบียน`,
            start: sp.start, end: sp.end,
          };
        }
        break;                                    // ตัวยาวสุดของจุดเริ่มนี้ พอแล้ว
      }
    }
  }
  if (!best) return null;
  const { score, ...out } = best; void score;
  return out;
}

/**
 * ตัดเบอร์ออกจากข้อความ เหลือ "ชื่อพาร์ทล้วน"
 * ⚠️ ตัดแล้วเหลือสั้นกว่า 3 ตัว = คืนข้อความเดิม (แปลว่าทั้งบรรทัดคือเบอร์ ไม่ใช่ชื่อ)
 */
export function stripPartNo(text, hit) {
  const raw = String(text ?? '');
  if (!hit) return raw;
  const out = (raw.slice(0, hit.start) + ' ' + raw.slice(hit.end + 1))
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-_/·]+|[\s\-_/·]+$/g, '')
    .trim();
  return out.replace(/[^A-Za-z0-9฀-๿]/g, '').length >= 3 ? out : raw;
}

/**
 * ถอดทั้งใบ แล้วสรุปให้จอเอาไปวาด — **คืนข้อเสนอเท่านั้น ไม่เขียนอะไร**
 * `conflict` = แถวที่มี part_no เดิมอยู่แล้ว **แต่ไม่ตรงกับที่ถอดได้** ⇒ ห้ามทับเงียบ
 */
export function proposePartNos(rows, vocab) {
  const byMat = new Map();
  let proposed = 0, skipped = 0, conflict = 0;
  for (const r of rows || []) {
    const hit = extractPartNo(r?.part_name, vocab);
    if (!hit) { skipped++; continue; }
    const cur = String(r?.part_no ?? '').trim();
    const clash = !!cur && alnum(cur) !== hit.key;
    if (clash) conflict++; else proposed++;
    byMat.set(String(r.mat_no ?? '').trim().toUpperCase(), {
      ...hit, current: cur || null, conflict: clash, cleanName: stripPartNo(r.part_name, hit),
    });
  }
  return { byMat, proposed, skipped, conflict };
}
