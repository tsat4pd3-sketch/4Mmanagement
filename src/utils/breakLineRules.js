/* ═══════════════════════════════════════════════════════════════════════════════
   break_line_rules — "ไลน์นี้พักรายการนี้กี่นาที" (ข้อยกเว้นรายไลน์ของ break_policies)
   2026-10-20 · feedback หน้างาน: *"บางไลน์เค้าทำ5สก่อนเลิกงานแค่ 10นาที หรือ5นาทีก็มี"*

   🔴 กฎทั้งหมดของ "ไลน์นี้พักกี่นาที" อยู่ที่ไฟล์นี้ **ที่เดียว** — ห้ามไล่สายไลน์เองในหน้า
   ⇒ จอ/สูตรเอาไปใช้แค่ 2 ตัว:
       buildBreakLineRuleIndex(rows, lines)      ← ทำครั้งเดียวตอนโหลด (ไล่สายแม่-ลูกให้เสร็จที่นี่)
       applyBreakLineRules(policies, idx, line)  ← คืน policies ที่ใส่ค่าของไลน์นั้นแล้ว

   กติกา (เคาะกับ user 20/10):
     1. ตั้งทับได้ **ทุกรายการพัก** (5ส. · เบรค · พักเที่ยง · ประชุมแถว) ไม่ใช่เฉพาะ 5ส.
     2. **ไลน์ลูกได้ตามไลน์แม่** — ตั้งที่แม่ครั้งเดียว ลูกใต้มันได้ตามกันหมด
        🔴 **ลูกที่ตั้งเองไว้ ตัวเองชนะแม่** (กฎเดียวกับ "ชื่อไลน์ตัวเองชนะไลน์แม่เสมอ" · CLAUDE.md)
     3. ไลน์ที่ไม่มีแถว = ใช้ค่ากลางของ `break_policies` **เหมือนวันนี้เป๊ะ**
        ⇒ `applyBreakLineRules` คืน **array เดิม (===)** เมื่อไม่มีอะไรทับ — ของเดิมไม่ขยับแม้แต่ byte เดียว
     4. `duration_min = 0` = "ไลน์นี้ไม่มีพักรายการนี้" (ค่าที่ตั้งใจได้ ไม่ใช่ค่าว่าง)
        ⇒ ช่วงพักยาว 0 → `breakIntervalsIn` ทิ้งเอง (e > s เป็นเท็จ) = ไม่หักพักรายการนั้น

   🔚 พักที่ `anchor = 'shift_end'` (5ส. ท้ายกะ) — **รักษาระยะถึงปลายกะ**
      gap = offset_min − duration_min ของค่ากลาง · ไลน์ตั้ง d นาที ⇒ offset ใหม่ = d + gap
        ค่ากลาง 20/20 (จบพอดีเลิกกะ) · ไลน์ตั้ง 10 → offset 10 ยาว 10 = 10 นาทีสุดท้ายของกะ ✔
        ถ้าใช้ offset เดิม (20) จะได้ 17:10–17:20 แล้วเหลือช่องว่าง 10 นาทีก่อนเลิกงาน = ผิดเจตนา
      ⇒ ไม่มีคอลัมน์ offset ในตารางนี้ (ช่องที่ไม่มีใครกรอก = ช่องตาย · กฎโปรเจค)

   ⚠️ `isOt` (ตีว่ากะนี้ทำโอไหม) ต้องตัดสินจาก **ค่ากลาง** ก่อนทับรายไลน์ — ดู `breakIntervalsIn`
      ไลน์ที่ตั้งพักโอเป็น 0 แปลว่า "ไลน์นี้ไม่พักรอบนั้น" **ไม่ใช่ "ไลน์นี้ไม่ได้ทำโอ"**
      ถ้าเอาค่าหลังทับไปตัดสิน จะปลุกนโยบาย `no_ot` กลับมา = หักพักซ้ำเงียบๆ
   ═══════════════════════════════════════════════════════════════════════════════ */
import { getAncestorNames } from './lineHierarchy.js';

/** นาทีที่รับได้ของกฎรายไลน์ (ตรงกับ CHECK ฝั่ง DB: 0..480) */
export const BREAK_RULE_MIN = 0;
export const BREAK_RULE_MAX = 480;

/** นาทีที่ใช้ได้จริงจากแถวกฎ — แกะไม่ออก/นอกช่วง = `null` (🔴 ห้ามเดา 0 · 0 มีความหมายของมันเอง) */
export function ruleDurationOf(row) {
  const raw = row?.duration_min;
  /* 🔴 `Number(null)` และ `Number('')` = **0** — ถ้าปล่อยผ่าน "ไม่ได้กรอก" จะกลายเป็น
     "พัก 0 นาที" = ลบพักของไลน์นั้นทิ้งเงียบๆ (0 เป็นค่าที่ตั้งใจได้ ห้ามเกิดจากค่าว่าง) */
  if (raw === null || raw === undefined || raw === '') return null;
  const d = Number(raw);
  if (!Number.isFinite(d) || d < BREAK_RULE_MIN || d > BREAK_RULE_MAX) return null;
  return Math.round(d);
}

const nameKey = (s) => String(s ?? '').trim();

/**
 * ทำดัชนีกฎรายไลน์ — **ไล่สายแม่-ลูกให้เสร็จที่นี่** ตัวที่เอาไปใช้แค่ lookup ตรงๆ
 * @param {Array} rows   แถวจาก `break_line_rules` ({ policy_id, line_name, duration_min })
 * @param {Array} lines  ทะเบียนไลน์ ({ name, parent_line_name }) — อ่านผ่าน useProductionLines/loadProductionLines
 * @returns {{ byLine: Map<string, Map<string, number>>, orphanLines: string[], ruleCount: number }}
 *   · `byLine`      ชื่อไลน์ → (policy_id → นาทีของไลน์นั้น) · รวมที่ตกทอดจากแม่แล้ว
 *   · `orphanLines` ไลน์ที่มีกฎแต่**ไม่อยู่ในทะเบียน** (เปลี่ยนชื่อ/ลบไลน์ทิ้ง) — จอต้องเขียนบอก ห้ามกลืน
 *     🔴 กฎของไลน์กำพร้ายัง**ใช้ได้แบบตรงชื่อ** (ไม่ตกทอดลงลูก เพราะไม่รู้ว่าลูกคือใคร)
 */
export function buildBreakLineRuleIndex(rows = [], lines = []) {
  const exact = new Map();         // lineName → Map(policyId → min)
  for (const r of rows || []) {
    const ln = nameKey(r?.line_name);
    const pid = r?.policy_id == null ? '' : String(r.policy_id);
    const d = ruleDurationOf(r);
    if (!ln || !pid || d === null) continue;
    if (!exact.has(ln)) exact.set(ln, new Map());
    exact.get(ln).set(pid, d);
  }
  if (!exact.size) return { byLine: new Map(), orphanLines: [], ruleCount: 0 };

  const reg = (lines || []).filter(l => nameKey(l?.name));
  const known = new Set(reg.map(l => nameKey(l.name)));
  const byLine = new Map();

  /* ทุกไลน์ในทะเบียน: เดินสาย ตัวเอง → แม่ → ปู่ · เจอ policy ไหนก่อน ตัวนั้นชนะ (ใกล้ชนะไกล) */
  for (const l of reg) {
    const self = nameKey(l.name);
    const chain = [self, ...getAncestorNames(reg, self).map(nameKey)];
    const merged = new Map();
    for (const step of chain) {
      const m = exact.get(step);
      if (!m) continue;
      for (const [pid, d] of m) if (!merged.has(pid)) merged.set(pid, d);
    }
    if (merged.size) byLine.set(self, merged);
  }

  /* ไลน์ที่มีกฎแต่ไม่อยู่ในทะเบียน — ยังใช้ได้แบบตรงชื่อ แต่ต้องรายงานให้คนเห็น */
  const orphanLines = [];
  for (const [ln, m] of exact) {
    if (known.has(ln)) continue;
    orphanLines.push(ln);
    byLine.set(ln, new Map(m));
  }

  let ruleCount = 0;
  for (const m of exact.values()) ruleCount += m.size;
  return { byLine, orphanLines: orphanLines.sort(), ruleCount };
}

/** กฎของไลน์นี้ (รวมที่ตกทอดจากแม่) → Map(policyId → นาที) · ไม่มี = `null` */
export function breakRulesForLine(index, lineName) {
  const ln = nameKey(lineName);
  if (!ln || !index?.byLine?.size) return null;
  const m = index.byLine.get(ln);
  return m && m.size ? m : null;
}

/**
 * คืน `policies` ที่ใส่นาทีของไลน์นี้แล้ว
 * 🔴 ไม่มีอะไรทับ = คืน **array เดิม (===)** — ไลน์ที่ไม่ตั้งข้อยกเว้นได้พฤติกรรมเดิมเป๊ะ
 * @param {Array} policies แถว `break_policies` ที่ active
 * @param {object|null} index ผลจาก `buildBreakLineRuleIndex`
 * @param {string|null} lineName ชื่อไลน์ของกะ/ของจอนั้น
 */
export function applyBreakLineRules(policies = [], index = null, lineName = null) {
  const m = breakRulesForLine(index, lineName);
  if (!m) return policies;
  let hit = false;
  for (const p of policies) {
    const d = m.get(String(p?.id ?? ''));
    if (d !== undefined && d !== Number(p?.duration_min)) { hit = true; break; }
  }
  if (!hit) return policies;
  return policies.map(p => {
    const d = m.get(String(p?.id ?? ''));
    if (d === undefined || d === Number(p?.duration_min)) return p;
    /* `line_rule_min` = นาทีที่ไลน์นี้ตั้งเอง · `line_rule_central_min` = ค่ากลางที่ถูกทับ
       ⇒ จอที่วาดแถบเงา (บอร์ดไทม์ไลน์) เขียนเทียบได้ "ตั้งเอง 10 จากค่ากลาง 20" โดยไม่ต้องอ่านทะเบียนเอง
       🔴 แปะเฉพาะตัวที่ **ต่างจากค่ากลางจริง** (เช็คไปแล้วข้างบน) — ตั้งเท่าค่ากลาง = ไม่มีป้าย */
    const out = { ...p, duration_min: d, line_rule_min: d, line_rule_central_min: Number(p?.duration_min) || 0 };
    /* 🔚 พักท้ายกะ — เลื่อนให้เองโดยรักษาระยะถึงปลายกะ (gap ของค่ากลาง) */
    if (p?.anchor === 'shift_end') {
      const gap = Math.max(0, (Number(p.offset_min) || 0) - (Number(p.duration_min) || 0));
      out.offset_min = d + gap;
    }
    return out;
  });
}

/* ═══ ป้ายบน "แถบเงาเวลาพัก" ของบอร์ดไทม์ไลน์ — 3 จอต้องเขียนเหมือนกัน ═══════════════
   `/dashboard` · `/management` · `/heijunka-kanban` วาดแถบเดียวกัน ⇒ ข้อความต้องมาจากที่นี่
   🔴 **ห้ามจอไหนจับคู่ "แถบนี้คือพักอะไร" ด้วยการเทียบเวลาเอง** — พัก `anchor='shift_end'`
      มี `start_time = null` และไลน์ที่ตั้งเองยังเลื่อน offset อีก ⇒ จับคู่ไม่ติด = tooltip "undefined"
      (บั๊กจริงบนบอร์ดทั้ง 3 จอ ก่อน 20/10) · ชื่อพักมาจาก `band.policies` ที่ `breakBandsIn` ติดมาให้ */

const bandHhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** ชื่อรายการพักของแถบ (ช่วงที่ทับกันถูกรวม ⇒ ต่อด้วย " + ") · ไม่รู้ชื่อ = `'พัก'` ห้ามคืนว่าง */
export function breakBandName(band) {
  const names = [...new Set((band?.policies || [])
    .map(p => p?.name_th || p?.name_en || p?.name).filter(Boolean))];
  return names.length ? names.join(' + ') : 'พัก';
}

/**
 * tooltip ของแถบพัก: ชื่อ + ช่วงเวลา + (ถ้ามี) "ไลน์นี้ตั้งเอง N นาที จากค่ากลาง M"
 * 🔴 ไลน์ที่ตั้งเองแล้ว**ต้องเขียนบอก** — ไม่งั้นคนเห็นแถบไม่เท่าไลน์ข้างๆ แล้วนึกว่าจอเพี้ยน
 * @param {object} band ผลจาก `breakBandsIn`/`halfDayBreakBands` ({ s, e, policies, lineRuleMin, centralMin })
 * @param {string|null} lineName ชื่อไลน์ของแถวนั้น (ใส่ในข้อความให้รู้ว่าเป็นของไลน์ไหน)
 */
export function breakBandTitle(band, lineName = null) {
  if (!band) return 'พัก';
  let t = `${breakBandName(band)} ${bandHhmm(band.s)}–${bandHhmm(band.e)}`;
  if (band.lineRuleMin !== null && band.lineRuleMin !== undefined) {
    t += ` · 🏭 ${lineName || 'ไลน์นี้'} ตั้งเอง ${band.lineRuleMin} นาที`
       + ` (ค่ากลาง ${band.centralMin} นาที)`;
  }
  return t;
}

/** มีกฎรายไลน์อยู่จริงไหม (จอใช้ตัดสินว่าจะเขียนป้าย "ไลน์นี้ตั้งเอง" ไหม) */
export const hasBreakLineRules = (index) => !!index?.byLine?.size;

/**
 * "ไลน์ไหนตกทอดจากกฎของไลน์ไหน" — สำหรับ**จอตั้งค่า**เอาไปเขียนให้คนเห็นก่อนกดบันทึก
 * 🔴 อยู่ที่นี่เพราะกฎ "ใกล้ชนะไกล" ต้องมีเจ้าของเดียว — จอคิดเองจะ drift กับตัวที่คิด %A/%P
 * @returns {Map<string, string[]>} ชื่อไลน์ที่มีกฎ → รายชื่อไลน์ลูก/หลานที่ได้ตามกฎนั้น (เรียงแล้ว)
 */
export function breakRuleFollowers(rows = [], lines = [], policyId = null) {
  const pid = policyId == null ? null : String(policyId);
  const own = new Set();
  for (const r of rows || []) {
    if (pid !== null && String(r?.policy_id ?? '') !== pid) continue;
    if (ruleDurationOf(r) === null) continue;
    const ln = nameKey(r?.line_name);
    if (ln) own.add(ln);
  }
  const out = new Map();
  if (!own.size) return out;
  const reg = (lines || []).filter(l => nameKey(l?.name));
  for (const l of reg) {
    const self = nameKey(l.name);
    if (own.has(self)) continue;                     // ตั้งเองไว้ = ไม่ได้ตกทอดจากใคร
    const hit = getAncestorNames(reg, self).map(nameKey).find(a => own.has(a));   // ใกล้ชนะไกล
    if (!hit) continue;
    if (!out.has(hit)) out.set(hit, []);
    out.get(hit).push(self);
  }
  for (const arr of out.values()) arr.sort();
  return out;
}

/* ═══ ทะเบียนกลางระดับโมดูล — แพทเทิร์นเดียวกับ `utils/processTypes.js` (cache + …Sync()) ═══
   🔴 **เหตุผลที่ต้องเป็นทะเบียนกลาง ไม่ใช่ prop ที่ไล่ส่งทีละจอ:**
   จุดคิดเวลาพักกระจายอยู่ 15 จุด / 21 จอ — ถ้าต้องส่ง `lineRules` เข้าไปเองทุกจุด
   **พลาดจุดเดียว = ไลน์นั้นกลับไปใช้ค่ากลางเงียบๆ** %A/%P ดูปกติแต่ผิด หาไม่เจอด้วย
   ⇒ สูตร OEE (`computeLiveOee`/`computeSessionOee`/`dtMinBySession`/`sessionDowntimeMin`)
     รู้ `session.line_name` อยู่แล้ว ⇒ อ่านทะเบียนนี้เองได้ **จอไม่ต้องรู้เรื่องเลย**
   · ยังไม่โหลด/โหลดไม่ได้ = `null` ⇒ `applyBreakLineRules` คืน array เดิม = **พฤติกรรมเดิมเป๊ะ**
     (ไม่พ่น error ไม่พ่น NaN — แย่สุดคือเห็นค่ากลาง 1 รอบ render แล้วตรงเองเมื่อทะเบียนมาถึง)
   · ค่าที่ **เขียนลงฐาน** (stamp `oee_a` ตอนปิดกะ) ปลอดภัย: DailyReport เรียก `loadBreakPolicies()`
     ตอน load() ซึ่งปลุกทะเบียนนี้ให้เสร็จก่อนคนจะกดปิดกะได้นานมาก
   · เทส/ตัวที่อยาก pin ค่าเอง ส่ง `lineRules` เข้าไปตรงๆ ได้เหมือนเดิม (ชนะทะเบียนกลาง) */
let ambient = null;

/** ตั้งทะเบียนกลาง — เรียกจาก `oeeMasters.primeBreakRuleIndex()` ที่เดียว (ห้ามเรียกจากหน้า) */
export function setBreakLineRuleIndex(index) { ambient = index?.byLine?.size ? index : null; }

/** ทะเบียนกลางที่โหลดล่าสุด · ยังไม่มี = `null` (= ใช้ค่ากลางเหมือนวันนี้) */
export function breakLineRuleIndexSync() { return ambient; }
