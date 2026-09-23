/* ═══ 🔎 เดาหมวดจาก "คำที่พนักงานพิมพ์เอง" ก่อนตกถัง "อื่นๆ" ═══════ 2026-09-23

   ที่มา (คำสั่ง user): *"อื่นๆ ยังมาอันดับ 1 เช็คอัลกอริทึมให้ที — ต้องหาคำอื่น
   เพื่อจับหมวดให้ได้ก่อน · 'อื่นๆ' ต้องเป็นของที่หาที่ลงไม่ได้จริงๆ"*

   ── ทำไมของเดิมยังไม่พอ ──
   `utils/unclassified.js` แค่ **แยกกอง** (ok / อื่นๆ-มีข้อความ / ไม่กรอกเลย / ตามแผน)
   มันบอกได้ว่า "ใบนี้ยังจับกลุ่มต่อได้" แต่ไม่เคย*จับ*ให้ ⇒ แท่ง "อื่นๆ" ยังอันดับ 1
   วัดจริง 90 วัน (23/09): 103 ใบกลุ่ม "อื่นๆ" — **89 ใบเลือก "อื่นๆ" ที่ช่องอาการด้วย**
   แต่ช่อง `report_note` / `root_cause` เขียนไว้ชัดเจนแทบทุกใบ เช่น
     "Alarm Observeline ตัดขาด" · "พาเลทไม่ไหล / Sensor on ค้าง" · "ลวดเชื่อมละลายติด
      Contact tip" · "Bending Alarm" · "เปลี่ยน Guide Pin ตามรอบ" · "ลมรั่ว"
   ⇒ ข้อมูลมีครบ ขาดแค่ตัวจับคำ

   ── 🔴 กฎเหล็กของไฟล์นี้: พจนานุกรม "มาจากทะเบียนของโรงงาน" เท่านั้น ──
   CLAUDE.md: **ห้าม AI เดา taxonomy ของโรงงาน** ⇒ ที่นี่จึง **ไม่มีคำศัพท์ hardcode
   สักคำ** · คำทุกคำถอดมาจากป้ายที่โรงงานเขียนเองในทะเบียน:
     · `mtn_problem_types.characteristic` → `group_name`   (ทะเบียนอาการของช่าง)
     · `dr_downtime_types.name_th`        → `mo_problem_group` (ทะเบียนดาวน์ไทม์)
   ป้าย "เครื่อง Laser มีปัญหา" → กลุ่ม "เลเซอร์ (Laser)" แปลว่าโรงงานประกาศเองว่า
   คำว่า *laser* = กลุ่มเลเซอร์ — เราแค่เอาไปใช้กับข้อความอิสระ **ไม่ได้ตั้งหมวดใหม่**
   ⇒ โรงงานเพิ่มแถวในทะเบียนเมื่อไหร่ ตัวจับคำเก่งขึ้นเองทันที ไม่ต้องแก้โค้ด

   ── ทำไมต้อง substring ไม่ใช่ตัดคำ ──
   ไทยเขียนติดกันไม่มีช่องว่าง ("ลวดเชื่อมละลายติด") ⇒ tokenizer ธรรมดาใช้ไม่ได้
   ที่นี่จึงเอา**คำจากทะเบียน**ไปหาเป็น substring ใน**ข้อความของพนักงาน** (ทิศทางนี้
   ทนการเขียนติดกัน) · คำอังกฤษใช้ขอบคำ (\b) กัน "pin" ไปโดน "spin"

   ── กันเดามั่ว 3 ชั้น ──
   1. คำสั้น/คำโหล ถูกตัดทิ้ง (`STOP` + ความยาวขั้นต่ำ) — ถอดจากป้ายด้วย regex
      ไม่ใช่ลิสต์ศัพท์เทคนิค ⇒ ไม่ใช่การเดา taxonomy
   2. คำที่ชี้ได้หลายกลุ่ม (เช่น "ลม" อยู่ทั้ง ระบบลม / สาธารณูปโภค) ถูกตัดทิ้ง
      เหลือเฉพาะคำที่ชี้กลุ่มเดียวชัดๆ (`DOMINANCE`) — คำยาวกว่าชนะเสมอเพราะให้น้ำหนัก
      ตามความยาว ("ลมรั่ว" อยู่รอด "ลม" ไม่รอด)
   3. ต้องชนะขาด: คะแนนถึงขั้นต่ำ **และ** ทิ้งอันดับ 2 ตามอัตราส่วน ไม่งั้นคืน null
      (= ยอมให้ตกถัง "อื่นๆ" ดีกว่าเดาผิด — จอต้องบอกความจริง)

   ⚠️ pure — ห้าม import supabase (ต้องเทสได้ด้วย `node --test` ตรงๆ)
   ⚠️ **ผลลัพธ์คือ "ข้อเสนอ" ไม่ใช่การแก้ข้อมูล** — ห้ามเอาไป update ฐานเงียบๆ
      จอที่ใช้ต้องบอกว่าใบไหนถูกเดา + เดาจากคำอะไร (ดู `MtnAnalysis` มิติ 🔎)      */

import { PLANNED_GROUP, isVague } from './unclassified.js';

const THAI = '฀-๿';
const TH_RE = new RegExp(`[${THAI}]`);

/** ทำข้อความให้เทียบกันได้ — lower + แยกรอยต่อไทย↔อังกฤษ + เหลือแต่ตัวอักษร/เลข
 *  (ทะเบียนเขียนติดกันบ่อย เช่น "เครื่องBending มีปัญหา" ⇒ ต้องแยก bending ออกมาให้ได้) */
export function normText(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(new RegExp(`([${THAI}])([a-z0-9])`, 'g'), '$1 $2')
    .replace(new RegExp(`([a-z0-9])([${THAI}])`, 'g'), '$1 $2')
    .replace(new RegExp(`[^a-z0-9${THAI}]+`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* คำเชื่อม/คำโหลที่ "ไม่บอกหมวด" — ตัดทิ้งก่อนแตกคำ
   ⚠️ ทั้งหมดเป็น**คำกลางของภาษา** (มีปัญหา/ชำรุด/ระบบ/หัก/แตก/the/from)
      **ไม่ใช่ศัพท์เฉพาะโรงงาน** — ห้ามเติมชื่ออุปกรณ์/อาการลงที่นี่ นั่นคือการเดา taxonomy
   ที่ต้องมีเพราะวัดจริงแล้วคำพวกนี้ "ดูเหมือนชี้กลุ่มได้" จากความบังเอิญของกลุ่มตัวอย่าง
   (เช่น "หัก" บังเอิญอยู่ในใบกลุ่มเชื่อม 11 ใบ · "the/from/system" มาจากข้อความ alarm
    ภาษาอังกฤษของเครื่องเลเซอร์) ⇒ ปล่อยไว้จะเดาผิดเวลาโรงงานมีข้อมูลชุดใหม่ */
const FILLER = new RegExp(
  ['มีปัญหา', 'มีปํญหา', 'มัปัญหา', 'ผิดปกติ', 'ไม่ระบุสาเหตุ', 'ไม่ระบุ', 'แจ้งเตือน',
    'นอกแผน', 'ในแผน', 'อื่นๆ', 'อื่น ๆ', 'ระบบ', 'เครื่อง', 'ปัญหา'].join('|'), 'g');

const STOP = new Set([
  // ไทย — คำเชื่อม/กริยาอาการกลางๆ ที่ใช้กับอุปกรณ์อะไรก็ได้
  'ที่', 'ของ', 'และ', 'หรือ', 'ไม่', 'มี', 'เป็น', 'ให้', 'จาก', 'แบบ', 'ขอ', 'ใช้',
  'ใช้งาน', 'ได้', 'การ', 'ตัว', 'ชุด', 'หัว', 'งาน', 'ชนิด', 'อื่น', 'ทำงาน',
  'เปลี่ยน', 'ปรับ', 'แก้ไข', 'แก้', 'ชำรุด', 'เสียหาย', 'เสีย', 'ตรวจสอบ', 'ทดลอง',
  'หัก', 'แตก', 'ขาด', 'ติด', 'ค้าง', 'ตก', 'สึก', 'หล่น', 'หลวม', 'หมด', 'ไหม้',
  'รั่ว', 'ตัด', 'เข้า', 'ออก', 'จับ', 'ล่วง', 'ร่วง', 'เยื้อง', 'พบอาการ', 'อาการ',
  'ไม่เข้า', 'ไม่ตรง', 'ไม่ทำงาน', 'ไม่ได้', 'ตำแหน่ง', 'ระยะ', 'สัญญาณ',
  // อังกฤษ — function word มาตรฐาน (โผล่จากข้อความ alarm ของเครื่อง ไม่ได้ชี้หมวด)
  'the', 'and', 'for', 'from', 'not', 'has', 'was', 'with', 'this', 'that', 'out',
  'off', 'time', 'core', 'system', 'machine', 'device', 'activity', 'hold', 'effect',
  'group', 'closed', 'reported', 'cause', 'check', 'test', 'new', 'old', 'job',
  'error', 'fault', 'stop', 'open', 'close', 'part', 'alarm', 'alarms',
]);

/** คำยาวแค่ไหนถึงเชื่อถือได้ (ไทยกับอังกฤษใช้เกณฑ์เดียวกัน — สั้นกว่านี้ชนง่าย) */
const MIN_TERM = 3;
/** คำต้องชี้กลุ่มเดียวเกินสัดส่วนนี้ ไม่งั้นถือว่ากำกวม ตัดทิ้ง */
const DOMINANCE = 0.8;
/** คำที่ "เรียนจากใบที่จัดกลุ่มแล้ว" ต้องเจออย่างน้อยกี่ใบถึงจะเชื่อ (ทะเบียนไม่ต้อง — คนตั้งใจเขียน) */
const MIN_SEEN = 2;

/** แตกป้าย 1 ป้าย → คำที่ใช้ชี้หมวดได้ */
export function termsOfLabel(label) {
  const clean = normText(label).replace(FILLER, ' ');
  const out = new Set();
  for (const t of clean.split(/\s+/)) {
    if (t.length < MIN_TERM) continue;
    if (STOP.has(t)) continue;
    if (/^\d+$/.test(t)) continue;            // เลขล้วน (172 / 120 / rb35 ยังเก็บ) ไม่บอกหมวด
    out.add(t);
  }
  return [...out];
}

/**
 * สร้างพจนานุกรม คำ → กลุ่ม จาก "ข้อมูลของโรงงาน" 2 แหล่ง
 *   · `kind:'registry'` = ทะเบียน taxonomy (คนตั้งใจเขียน) — เชื่อได้ทันที
 *   · `kind:'seen'`     = ใบที่ช่าง**จัดกลุ่มไปแล้ว** + ข้อความอิสระของใบนั้น
 *                         (ศัพท์ที่คนหน้างานใช้จริง เช่น "observeline" · "พาเลทไม่ไหล"
 *                          ซึ่งไม่มีวันอยู่ในทะเบียน) — ต้องเจอซ้ำ ≥ MIN_SEEN ใบถึงจะเชื่อ
 * @param {Array} entries  [{ label, group, team?, shared_teams?, kind? }]
 * @returns {{ terms: Array<{term, weight, ascii, hits: Array}> }}
 */
export function buildCategoryIndex(entries = []) {
  const byTerm = new Map();
  for (const e of entries) {
    const group = String(e?.group ?? '').trim();
    if (!group || isVague(group)) continue;          // ป้ายถังขยะสอนอะไรไม่ได้
    const registry = e?.kind !== 'seen';
    for (const term of termsOfLabel(e?.label)) {
      if (!byTerm.has(term)) byTerm.set(term, []);
      byTerm.get(term).push({
        group, registry,
        team: e?.team ?? null, shared_teams: e?.shared_teams ?? null,
      });
    }
  }
  const terms = [];
  for (const [term, hits] of byTerm) {
    // คำที่มาจากการเรียนล้วน + เจอครั้งเดียว = บังเอิญ ทิ้ง
    if (!hits.some(h => h.registry) && hits.length < MIN_SEEN) continue;
    terms.push({ term, weight: Math.min(term.length, 12), hits, ascii: !TH_RE.test(term) });
  }
  // คำยาวก่อน — อ่านง่ายตอน debug (ไม่กระทบคะแนน)
  terms.sort((a, b) => b.term.length - a.term.length);
  return { terms };
}

/** คำนี้อยู่ในข้อความไหม — อังกฤษใช้ขอบคำ (กัน "pin" โดน "spin") · ไทยใช้ substring (เขียนติดกัน) */
function hasTerm(normalized, t) {
  if (!t.ascii) return normalized.includes(t.term);
  return new RegExp(`(^| )${t.term}( |$)`).test(normalized);
}

/**
 * เดาหมวดจากข้อความ
 * @param {string} text        ข้อความที่พนักงานพิมพ์ (note + root cause ฯลฯ)
 * @param {object} index       ผลจาก buildCategoryIndex
 * @param {object} opt
 *   @param {string} [opt.team]            ทีมช่างของใบนี้ (กรองทะเบียนให้ตรงขอบเขตที่คนกรอกเห็น)
 *   @param {(hit,team)=>boolean} [opt.scopeOf]  ตัวตัดสินว่าแถวทะเบียนนี้อยู่ในขอบเขตทีมไหม
 *                                         (ส่ง `visibleToTeam` จาก utils/mtnTeams เข้ามา —
 *                                          ไฟล์นี้ไม่ import เองเพื่อให้ reuse กับโมดูลอื่นได้)
 *   @param {number} [opt.minScore=4]      คะแนนขั้นต่ำของผู้ชนะ
 *   @param {number} [opt.margin=1.4]      ต้องชนะอันดับ 2 กี่เท่า
 * @returns {{group:string, score:number, terms:string[]}|null}  null = จับไม่ได้จริงๆ
 */
export function classifyText(text, index, opt = {}) {
  const { team = null, scopeOf = null, minScore = 4, margin = 1.5 } = opt;
  const norm = normText(text);
  if (!norm || !index?.terms?.length) return null;

  const score = new Map();     // group → คะแนน
  const why = new Map();       // group → คำที่ทำให้ได้คะแนน
  for (const t of index.terms) {
    if (!hasTerm(norm, t)) continue;
    const hits = (team && scopeOf) ? t.hits.filter(h => scopeOf(h, team)) : t.hits;
    if (!hits.length) continue;
    // คำกำกวม (ชี้หลายกลุ่มไม่ชัด) = ตัดทิ้ง ไม่ให้คะแนนใคร
    const tally = new Map();
    hits.forEach(h => tally.set(h.group, (tally.get(h.group) || 0) + 1));
    let top = null, topN = 0;
    for (const [g, n] of tally) if (n > topN) { top = g; topN = n; }
    if (topN / hits.length < DOMINANCE) continue;
    score.set(top, (score.get(top) || 0) + t.weight);
    if (!why.has(top)) why.set(top, []);
    why.get(top).push(t.term);
  }
  if (!score.size) return null;

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [bestGroup, bestScore] = ranked[0];
  const second = ranked[1]?.[1] || 0;
  if (bestScore < minScore) return null;
  if (second > 0 && bestScore < second * margin) return null;   // ก้ำกึ่ง = ไม่เดา
  return { group: bestGroup, score: bestScore, terms: why.get(bestGroup) || [] };
}

/* ── งานตามแผน (PM) ────────────────────────────────────────────────────────────
   user ตัดสินไว้แล้ว 23/09: *"เปลี่ยนตามรอบ = งานตามแผน แยกออก ไม่ใช่ปัญหา"*
   (ตอนนั้นแยกได้เฉพาะใบที่ *เลือกกลุ่ม* "งานตามแผน (PM)" มาแล้ว — ใบที่เลือก "อื่นๆ"
    แต่เขียนว่า "ตามรอบ" ยังหล่นอยู่ในพาเรโตปัญหา วัดจริง 9 ใบ)
   คำพวกนี้เป็น**คำบอกความถี่ ไม่ใช่ taxonomy อุปกรณ์** ⇒ ไม่เข้าข่ายห้ามเดา
   🔴 ต้องตัดสินก่อน classifyText เสมอ — "เปลี่ยน Guide Pin ตามรอบ" มีคำว่า guide pin
      ที่ทะเบียนชี้ไปกลุ่มเชื่อม ถ้าปล่อยให้จับคำก่อน งานตามแผนจะกลายเป็นปัญหา */
const PLANNED_RE = /ตามรอบ|ถึงรอบ|ครบรอบ|ตามแผน|ถึงระยะเปลี่ยน|ครบกำหนด|preventive/;
export const looksPlanned = (text) => PLANNED_RE.test(normText(text));

/**
 * เติมหมวดให้แถวที่ยังเป็น "อื่นๆ / ไม่ระบุ" — ตัวช่วยสำเร็จรูปสำหรับจอวิเคราะห์
 * **ไม่แก้แถวเดิม** — คืนแถวใหม่ที่มี `group` (หลังเติม) + `autoFrom` (คำที่ใช้เดา)
 * @returns {{rows:Array, filled:number, plannedFound:number, stuck:number}}
 */
export function fillCategories(rows = [], index, opt = {}) {
  const { labelOf = (r) => r?.group, textOf = (r) => r?.note, teamOf = (r) => r?.team,
    ...rest } = opt;
  let filled = 0, plannedFound = 0, stuck = 0;
  const out = rows.map((r) => {
    const label = labelOf(r);
    if (!isVague(label)) return r;
    const text = textOf(r);
    if (looksPlanned(text)) {
      plannedFound++;
      return { ...r, group: PLANNED_GROUP, autoFrom: { from: label, terms: ['ตามรอบ/ตามแผน'] } };
    }
    const hit = classifyText(text, index, { team: teamOf(r), ...rest });
    if (!hit) { stuck++; return r; }
    filled++;
    return { ...r, group: hit.group, autoFrom: { from: label, terms: hit.terms, score: hit.score } };
  });
  return { rows: out, filled, plannedFound, stuck };
}
