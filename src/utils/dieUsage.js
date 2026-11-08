/* ═══════════════════════════════════════════════════════════════════════════
   ยอดใช้งานของ "แม่พิมพ์" — นับจากพาร์ทของชุด ไม่ใช่ยอดทั้งไลน์      2026-11-08 · คำสั่ง user

   user 08/11: "ไลน์ 800 ผลิตงาน a100, b100 เครื่องทำ 200 shot แต่ a ไม่ได้เท่ากับ 200"
   ⇒ เครื่องจักร/จิ๊ก ยังนับระดับไลน์ (pmUsage.js · กติกา 15/09) · **แม่พิมพ์นับจาก MAT ของชุดที่มันอยู่**
   วัดจริง 08/11 (120 วัน) ชุด EB3B-41108A70 AA/71AA: ยอดไลน์ 191,190 vs ยอดพาร์ทจริง 12,880 (~15 เท่า)

   ⚠️ pure ทั้งไฟล์ (ไม่ import supabase) — เทส `__tests__/dieUsage.test.mjs`

   ── ทำไมต้อง "คิดย้อนตามสาย" (user 05/11) ──
   OP10 draw (เข้า 1 ออก 1) → OP20 trim (1→1) → OP30 separate ตัดแยก LH/RH (เข้า 1 ออก 2)
   ผลิต LH+RH 2,000 ชิ้น = ทุก OP ทำงาน 1,000 shot · ถ้าหาร "ชิ้นออก" ของ OP10 (=1) ตรงๆ จะได้ 2,000 = ผิด 2 เท่า
   ⇒ ชิ้นที่ออกจาก OP k = ชิ้นสำเร็จ ÷ Π (ออก/เข้า) ของ OP ที่อยู่หลัง k · shot ของ OP k = ชิ้นที่ออกจาก k ÷ ชิ้นออก/shot ของ k

   ── 2 โหมด (ห้ามปน) ──
   · `legacy` — ไม่มี OP ไหนในชุดกรอก "ชิ้นเข้า" เลย ⇒ ใช้ความหมายเดิมของ "ชิ้น/stroke" (ชิ้นสำเร็จต่อ 1 shot
     เท่ากันทุก OP = ไม่มีการตัดแยก) ผ่าน `ppsOf(die, set)` — พฤติกรรมเดิมเป๊ะ จอต้องบอกว่าคิดแบบไม่มีการตัดแยก
   · `chain`  — มี OP ใดกรอกชิ้นเข้าแล้ว ⇒ ต้องรู้ เข้า/ออก ของทุก OP ที่อยู่หลัง k + ชิ้นออกของ k เอง (ราย OP ไม่ถอยไปชุด)
     ขาดตัวไหน = `null` + บอกว่าขาดอะไร **ห้ามเดา ratio = 1**
   🔴 ไม่รู้ = null ห้ามคืน 0 · ชุดไม่ผูก MAT = นับไม่ได้ (ห้ามถอยไปใช้ยอดไลน์ — คือตัวเลขที่ user บอกว่าผิด)
   ═══════════════════════════════════════════════════════════════════════════ */
import { sumUsage, ppsOf } from './pmUsage.js';

const pos = (v) => {
  if (v == null || v === '') return null;          // ⚠️ Number(null) = 0
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const normMat = (m) => String(m ?? '').trim().toUpperCase();

/** MAT ที่ชุดนี้ทำ (ตัดว่าง/ซ้ำ · normalize แบบเดียวกับ RPC pm_usage_daily_by_mat) */
export const setMatsOf = (set) => [...new Set([set?.mat_no, set?.mat_no_2].map(normMat).filter(Boolean))];

/**
 * ยอดชิ้นสำเร็จของชุด (ผลรวมทุก MAT ของชุด · ทุกไลน์) ในช่วง (since, until]
 * @param rows [{ mat_no, work_date, qty }] จาก RPC pm_usage_daily_by_mat
 * @returns null เมื่อชุดยังไม่ผูก MAT (= นับไม่ได้) · ไม่งั้น { qty, days, firstDate, lastDate }
 */
export function setFinishedUsage(rows = [], set, { since = null, until = null } = {}) {
  const mats = setMatsOf(set);
  if (!mats.length) return null;
  // ใช้ sumUsage ตัวเดียวกับยอดไลน์ (exclusive ที่ since · กติกาเดียวกันทุกจอ) โดยให้ MAT ทำหน้าที่เป็น "ไลน์"
  return sumUsage(rows.map(r => ({ line_name: normMat(r.mat_no), work_date: r.work_date, qty: r.qty })),
    { lines: mats, since, until });
}

/**
 * ตัวคูณ "shot ของ OP นี้ ต่อ 1 ชิ้นสำเร็จของชุด"
 * @param members [{ die: { ext }, opSeq }] สมาชิกของชุด (จาก membersBySet)
 * @param dieId   แม่พิมพ์ที่ถาม
 * @param set     แถว die_sets (ค่าสำรอง pieces_per_stroke ของโหมด legacy)
 * @returns { factor: number|null, mode: 'legacy'|'chain', why: string|null }
 */
export function opShotFactor(members = [], dieId, set) {
  const me = members.find(m => m.die?.id === dieId);
  if (!me) return { factor: null, mode: null, why: 'ไม่อยู่ในชุดนี้' };
  const chainMode = members.some(m => pos(m.die?.ext?.pieces_in_per_stroke) != null);

  if (!chainMode) {
    const pps = ppsOf(me.die?.ext, set);
    return pps == null
      ? { factor: null, mode: 'legacy', why: 'ยังไม่ระบุชิ้น/shot' }
      : { factor: 1 / pps, mode: 'legacy', why: null };
  }

  // chain — ต้องรู้ลำดับ OP ของทุกตัวก่อน (ไม่รู้ว่าใครอยู่หลังใคร = คิดย้อนไม่ได้)
  if (members.some(m => m.opSeq == null)) return { factor: null, mode: 'chain', why: 'บาง OP ในชุดยังไม่ระบุเลข OP' };
  const outK = pos(me.die?.ext?.pieces_per_stroke);
  if (outK == null) return { factor: null, mode: 'chain', why: `OP${me.opSeq} ยังไม่ระบุชิ้นออก/shot` };
  let ratio = 1;                                   // Π (ออก/เข้า) ของ OP ที่อยู่หลัง k
  for (const m of members) {
    if (m.opSeq <= me.opSeq || m.die?.id === dieId) continue;
    const e = m.die?.ext || {};
    if (e.feed_type === 'coil') return { factor: null, mode: 'chain', why: `OP${m.opSeq} ป้อนจากม้วน แต่อยู่หลัง OP${me.opSeq} — ตรวจลำดับ OP` };
    const i = pos(e.pieces_in_per_stroke), o = pos(e.pieces_per_stroke);
    if (i == null || o == null) return { factor: null, mode: 'chain', why: `OP${m.opSeq} ยังไม่ระบุชิ้นเข้า/ออก ครบ` };
    ratio *= o / i;
  }
  return { factor: 1 / (ratio * outK), mode: 'chain', why: null };
}

/**
 * ยอดใช้งานของแม่พิมพ์ 1 ตัว — รวมทุกชุดที่ใช้มัน (ชุดบ้าน + ชุดที่ยืม · common die)
 * @param memberships [{ set, members }] ชุดที่แม่พิมพ์นี้เป็นสมาชิก
 * @returns {
 *   pieces: ชิ้นสำเร็จของพาร์ทที่ผ่านแม่พิมพ์นี้ (null = ไม่มีชุดไหนผูก MAT)
 *   shots:  shot ของแม่พิมพ์นี้ (null = คิดไม่ได้ครบ — ดู why)
 *   lastDate, days, sets: จำนวนชุด, noMatSets: ชุดที่ยังไม่ผูก MAT, why: [เหตุผลที่คิด shot ไม่ได้],
 *   legacy: true ถ้ามีชุดที่คิดแบบไม่มีการตัดแยก }
 */
export function dieUsage(dieId, memberships = [], rows = [], { since = null, until = null } = {}) {
  let pieces = null, shots = 0, shotsOk = true, lastDate = null, days = 0, legacy = false;
  const noMatSets = [], why = [];
  for (const { set, members } of memberships) {
    const u = setFinishedUsage(rows, set, { since, until });
    if (!u) { noMatSets.push(set?.set_code || set?.part_name || '?'); shotsOk = false; continue; }
    pieces = (pieces || 0) + u.qty;
    days = Math.max(days, u.days);
    if (u.lastDate && (!lastDate || u.lastDate > lastDate)) lastDate = u.lastDate;
    const f = opShotFactor(members, dieId, set);
    if (f.mode === 'legacy') legacy = true;
    if (f.factor == null) { shotsOk = false; why.push(`${set?.set_code || set?.part_name || '?'}: ${f.why}`); continue; }
    shots += u.qty * f.factor;
  }
  return {
    pieces, shots: shotsOk && pieces != null ? Math.round(shots) : null,
    lastDate, days, sets: memberships.length, noMatSets, why, legacy,
  };
}
