/* 🔨 "แม่พิมพ์ของงานที่กำลังผลิต" — ของกลางสำหรับช่องเลือกแม่พิมพ์ (2026-11-08 · คำสั่ง user)
   *"ถ้าเลือกจากแม่พิมพ์ ควรจะออโต้เลือกชุดแม่พิมพ์จากรายการที่กำลังผลิต ไม่ใช่ขึ้นทุกตัวของไลน์"*
   เคสจริง 05/11: แม่พิมพ์ OP20 แตกบนเครื่อง 8B02 · พนักงานหาแม่พิมพ์ในลิสต์ 59 ตัวไม่เจอ
   เลยลง downtime ที่ 8B02 ⇒ ประวัติแม่พิมพ์ไม่เคยเกิด

   โซ่: MAT ที่ผลิตอยู่ → `die_sets` → `equipment_die.die_set_id` → แม่พิมพ์ทุก OP (แถว `machines`)
   วัดฐาน 05/11: แม่พิมพ์→ชุด ผูกแล้ว 260/276 · ชุด→MAT กรอกแค่ 2/92 ⇒ ต้องมี 2 ชั้น ห้ามยุบรวม:
     · `linked` — ทะเบียนชุดบอกไว้ว่าทำ MAT นี้ (`dieSetMats` · คนกรอก = ความจริง)
     · `guess`  — ชุดยังไม่ผูก MAT เลย แต่ `die_sets.part_no` (แยกด้วย `/`) ตรง `dr_products.p_no`
                  **ตรงตัวทั้งคำ** ⇒ จอต้องติดป้าย "ระบบเดา ไม่ได้ยืนยัน" · 🔴 **ห้ามเขียนผลเดากลับฐาน**
   🔴 ชุดที่ผูก MAT อื่นไว้แล้ว = ไม่ใช่ของงานนี้ (กฎเดียวกับ `dieSetsForMat`) ห้ามเดาทับ
   🔴 ห้ามตัดคำต่อท้าย/ตัดขีดของ p_no เพื่อให้จับได้มากขึ้น (เช่น "- STEP 1") = เดาเกินหลักฐาน */
import { dieSetMats } from './dieSetMats.js';

const norm = (v) => String(v ?? '').trim().toUpperCase();

/** เลขพาร์ทใน `die_sets.part_no` — ชุดงานคู่เขียน "BHS08555/BHS07706" */
export function setPartNos(set) {
  return String(set?.part_no ?? '').split('/').map(norm).filter(Boolean);
}

/**
 * @param runMats   MAT ที่กำลังผลิตในกะนี้
 * @param pnoOfMat  (mat) => p_no ของพาร์ทนั้น (ไม่รู้ = null)
 * @param sets      แถว `die_sets` (id, set_code, part_no, mat_no, mat_no_2, is_active)
 * @param dieRows   [{ machine_no, die_set_id }] — แม่พิมพ์รายตัว + ชุดของมัน
 * @returns { byMachine: Map(machine_no → { tier, set, mats }), coverage: { total, linked, guess, none: [mat] } }
 */
export function dieCandidatesForMats({ runMats = [], pnoOfMat = () => null, sets = [], dieRows = [] } = {}) {
  const mats = [...new Set(runMats.map(norm).filter(Boolean))];
  /* นับเฉพาะชุดที่มีแม่พิมพ์รายตัวผูกอยู่จริง — ชุดที่ไม่มีแม่พิมพ์ในทะเบียน = เลือกอะไรไม่ได้
     ถ้านับเป็น "หาเจอ" จอจะบอกว่าเจอ ทั้งที่ลิสต์ว่าง (เจอจริงใน mock 08/11) */
  const withDies = new Set((dieRows || []).filter(r => r?.machine_no && r.die_set_id != null).map(r => r.die_set_id));
  const setTier = new Map();             // set.id → { tier, set, mats }
  const matHit = new Map();              // mat → 'linked' | 'guess'
  for (const s of sets || []) {
    if (!s || s.is_active === false || !withDies.has(s.id)) continue;
    const own = dieSetMats(s);
    if (own.length) {
      const hit = mats.filter(m => own.includes(m));
      if (hit.length) { setTier.set(s.id, { tier: 'linked', set: s, mats: hit }); hit.forEach(m => matHit.set(m, 'linked')); }
      continue;                          // ผูก MAT อื่นไว้ = ไม่ใช่ของงานนี้
    }
    const pnos = setPartNos(s);
    if (!pnos.length) continue;
    const hit = mats.filter(m => { const p = norm(pnoOfMat(m)); return p && pnos.includes(p); });
    if (hit.length) {
      setTier.set(s.id, { tier: 'guess', set: s, mats: hit });
      hit.forEach(m => { if (matHit.get(m) !== 'linked') matHit.set(m, 'guess'); });
    }
  }
  const byMachine = new Map();
  for (const r of dieRows || []) {
    const t = r?.die_set_id != null ? setTier.get(r.die_set_id) : null;
    if (t && r.machine_no) byMachine.set(r.machine_no, t);
  }
  const vals = [...matHit.values()];
  return {
    byMachine,
    coverage: {
      total: mats.length,
      linked: vals.filter(v => v === 'linked').length,
      guess: vals.filter(v => v === 'guess').length,
      none: mats.filter(m => !matHit.has(m)),
    },
  };
}
