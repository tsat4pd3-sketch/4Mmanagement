/* 📦 เบิก-ส่งพาร์ท "เต็มกล่องเท่านั้น" + ทดเศษไปรอบถัดไป (2026-11-04 · คำสั่ง user)
   user: *"เปิด order ผลิต เบิก 120 แต่ packing std. 100 … จะส่งให้ครบ 120 ก็ไม่ได้ ส่งเกินเป็น 200 ก็ไม่ได้
          ควรจะหักส่งมาเบิก 100 และ 20 ทดไว้รอให้ครบในครั้งถัดไป"*
   กติกา (user เคาะ 04/11):
   1. packing std = `parts_master.qty_per_pkg` เท่านั้น — **ห้ามใช้ `kanban_standards.qty_per_kanban`** (user: "นั่นคือ lot size")
   2. ยอดรวมไม่ถึง 1 กล่อง = **ยังไม่ส่ง รอรอบถัดไป** (ไม่มีปุ่มส่งเศษ)
   3. ยอดทดนับแยก **ไลน์ + พาร์ท** ห้ามปนข้ามไลน์ (`carryKey`)
   🔴 ไม่รู้ packing std (ว่าง/≤0/อ่านไม่ได้) = `state:'no_pkg'` · send/carry = null — **ห้ามเดา ห้ามถอยไปส่งเต็มยอด**
      จอต้องเขียนว่าพาร์ทนี้ยังไม่ตั้งขนาดกล่อง */

const EPS = 1e-9;

/** คีย์ยอดทด — ไลน์ + พาร์ท (trim) · ห้ามใช้ MAT อย่างเดียว */
export const carryKey = (lineName, matNo) => `${String(lineName || '').trim()}|${String(matNo || '').trim()}`;

/** ขนาดกล่องที่ใช้ได้ หรือ null (ไม่รู้) */
export function packSizeOf(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * แบ่งยอดที่ต้องการเป็น "ส่งได้ (เต็มกล่อง)" + "ทดไว้"
 * @param {number} demand  ยอดต้องการรวม (รวมยอดทดยกมาแล้ว)
 * @param {number|null} pkgRaw  packing std (`parts_master.qty_per_pkg`)
 * @returns {{ state:'send'|'wait'|'none'|'no_pkg', send:number|null, carry:number|null, packs:number|null, pkg:number|null }}
 *   send  = จำนวนที่ส่งรอบนี้ (ทวีคูณของกล่อง)
 *   carry = เศษที่ทดไปรอบถัดไป
 *   state: send = มีของต้องส่ง · wait = ไม่ถึง 1 กล่อง รอรอบหน้า · none = ไม่มีความต้องการ · no_pkg = ไม่รู้ขนาดกล่อง
 */
export function packSplit(demand, pkgRaw) {
  const d = Number(demand);
  const need = Number.isFinite(d) && d > 0 ? d : 0;
  const pkg = packSizeOf(pkgRaw);
  if (!need) return { state: 'none', send: 0, carry: 0, packs: 0, pkg };
  if (pkg == null) return { state: 'no_pkg', send: null, carry: null, packs: null, pkg: null };
  const packs = Math.floor(need / pkg + EPS);
  const send = packs * pkg;
  // ปัดเศษทศนิยมจากการลบ (เช่น 0.1+0.2) ให้เหลือ 6 ตำแหน่ง
  const carry = Math.max(0, Math.round((need - send) * 1e6) / 1e6);
  return { state: packs > 0 ? 'send' : 'wait', send, carry, packs, pkg };
}

/**
 * รวมความต้องการใหม่เข้ากับยอดทดยกมา แล้วแบ่ง — ใช้ตอนเปิด/เติมใบ
 * @param {number} carryIn ยอดทดยกมาของไลน์+พาร์ทนี้
 * @param {number} newDemand ความต้องการใหม่
 */
export function packWithCarry(carryIn, newDemand, pkgRaw) {
  const c = Number(carryIn) > 0 ? Number(carryIn) : 0;
  const n = Number(newDemand) > 0 ? Number(newDemand) : 0;
  return { carryIn: c, newDemand: n, total: c + n, ...packSplit(c + n, pkgRaw) };
}

/** ป้ายบนจอ — ที่เดียว ห้ามแต่งเองในหน้า */
export function packSplitText(r, fmt = (x) => Number(x).toLocaleString('th-TH')) {
  if (!r) return '';
  switch (r.state) {
    case 'send': return `ส่ง ${fmt(r.send)} (${r.packs} กล่อง × ${fmt(r.pkg)})${r.carry > 0 ? ` · ทด ${fmt(r.carry)} ไปรอบหน้า` : ''}`;
    case 'wait': return `ยังไม่ถึง 1 กล่อง (${fmt(r.pkg)}) — รอรอบหน้า · สะสมแล้ว ${fmt(r.carry)}`;
    case 'no_pkg': return 'ยังไม่ได้ตั้งขนาดกล่อง (packing std) ของพาร์ทนี้ — ตั้งที่ทะเบียนพาร์ทก่อน';
    default: return '';
  }
}

/* ═══ 🔁 วางแผนใบเบิกจาก "ใบผลิตที่เปิดอยู่" (2026-11-05 · คำสั่ง user) ═══════════════════════
   user: *"เมื่อกดเปิด order ระบบจะแตก bom ไปเรียกลูกที่จะใช้งาน และคิดกับ wip ค้างในไลน์ว่าพอมั้ย ถ้าไม่พอ
          จะสะสมจนครบ packing std. เมื่อครบจะแจ้งไปหาส่วนสโตร์ … หรือสามารถกดเบิกเองจากช่องด้านขวา ด้วยหลักการเดียวกัน"*
   ต่อ ไลน์ + พาร์ท (stateless — คิดใหม่ทั้งก้อนทุกครั้ง ไม่มีตัวสะสมที่ต้องดูแล):
     need     = Σ(ยอดใบผลิตที่เปิดอยู่ × qty_per_unit ลูกตรง) + ยอดที่ขอเพิ่มเอง (manual)
     base     = max(0, ยอดหน้าไลน์)   ← ติดลบ (backflush ยังไม่ครบ) ห้ามนับเป็นของ
     short    = need − base            ← "สะสม" = ใบผลิตเปิดเพิ่ม → short โตขึ้นเอง
     target   = ปัดลงเต็มกล่อง(short)  ← ไม่ถึง 1 กล่อง = รอ (user เคาะ 04/11)
   ใบ "ยังไม่หยิบ" (pending) มีได้ใบเดียวต่อ ไลน์+พาร์ท ⇒ ไม่มี = เปิดใหม่ · มีแต่น้อยกว่า target = เพิ่มยอด · **ห้ามลดเอง**
   (ใบที่หยิบแล้ว ยอดย้ายเข้าไลน์ไปแล้ว ⇒ อยู่ใน base แล้ว ไม่นับซ้ำ) */
export function planLineRequest({ need, onHand, pendingQty = 0, pkg, coil = false }) {
  const n = Number(need) > 0 ? Number(need) : 0;
  const base = Math.max(0, Number(onHand) || 0);
  const short = Math.max(0, Math.round((n - base) * 1e6) / 1e6);
  const pend = Number(pendingQty) > 0 ? Number(pendingQty) : 0;
  /* 🧲 05/11 — เหล็ก coil (kg) "จ่ายเป็นม้วน" (user เลือก): ไม่ปัดกล่อง · ขาดเท่าไหร่ขอเท่านั้น (ปัด kg ขึ้นที่กรัม)
     สโตร์เลือกม้วนแล้วกรอกน้ำหนักจริงตอนหยิบ (เกินได้ — `checkPickQty`) · ส่วนเกินอยู่ใน base รอบหน้า */
  if (coil) {
    const q = Math.ceil(Math.round(short * 1e6) / 1e3) / 1e3;
    const out = { need: n, base, short, state: q > 0 ? 'send' : 'none', send: q, carry: 0, packs: null, pkg: null, pending: pend, coil: true };
    if (!n || !q) return { ...out, action: 'covered' };
    if (!pend) return { ...out, action: 'insert', qty: q };
    if (pend < q) return { ...out, action: 'raise', qty: q };
    return { ...out, action: 'covered' };
  }
  const split = packSplit(short, pkg);
  const out = { need: n, base, short, ...split, pending: pend };
  if (!n || !short) return { ...out, action: 'covered' };
  if (split.state === 'no_pkg') return { ...out, action: 'no_pkg' };
  if (split.state === 'wait') return { ...out, action: pend ? 'covered' : 'wait' };
  if (!pend) return { ...out, action: 'insert', qty: split.send };
  if (pend < split.send) return { ...out, action: 'raise', qty: split.send };
  return { ...out, action: 'covered' };
}
