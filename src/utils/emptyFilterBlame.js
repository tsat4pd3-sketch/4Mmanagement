/* 🕳️ กรองแล้วว่าง — จอต้องบอกว่า "ตัวกรองไหนตัดทิ้ง" ห้ามขึ้นแค่ "ไม่มีรายการ"
   (กฎความซื่อสัตย์ของจอ · CLAUDE.md — "กรองแถวออกแล้วต้องเขียนบนจอว่าซ่อนกี่รายการ")

   เคสจริง 2026-10-26 (user): ป้าย "รอคุณเซ็นรับทราบ" ในคิวงานพาไป `/mtn-repair?ack=pending`
   แต่ช่อง "ทีมช่าง" ของหน้านั้นตั้งต้นเป็นทีมของ user เอง (ผจก.ฝ่ายผลิต ⇒ PRODUCTION)
   ใบที่ป้ายนับเป็น **ใบฟอร์มทีม MTN ล้วน** ⇒ production ∩ maintenance = 0 ใบเสมอ ไม่ว่าเลือกวันไหน
   จอขึ้น "ไม่มีรายการ" เฉยๆ ⇒ คนอ่านว่า "ไม่มีงานค้าง" ทั้งที่มี 48 ใบรออยู่

   pure ล้วน — ไม่รู้จัก React / URL / Supabase ⇒ เอาไปใช้ซ้ำได้ทุกหน้าที่มีตัวกรองหลายชั้น */

/** ตัวกรอง 1 ตัวที่ "เปิดอยู่"
 *  @typedef {{ key:string, label:string, value?:string, on?:boolean, removable?:boolean,
 *              test:(row:any)=>boolean }} ActiveFilter */

/**
 * ตอบ 2 คำถามของจอว่าง: "ตกเหลือ 0 ตรงไหน" และ "ปลดตัวไหนแล้วได้ของคืน"
 *
 * @param {any[]} rows   ใบทั้งหมดที่โหลดมา (ก่อนกรอง)
 * @param {ActiveFilter[]} filters ตัวกรองทุกชั้น **เรียงตามลำดับที่จอกรองจริง**
 * @returns {{ empty:boolean, total:number, needsMulti:boolean,
 *             ladder:{key:string,label:string,value?:string,n:number}[],
 *             culprits:{key:string,label:string,value?:string,n:number,removable:boolean}[] }}
 *   · `ladder` = จำนวนใบที่เหลือหลังใส่ตัวกรองทีละตัว (ตัวแรกคือ "ทั้งหมดที่โหลดมา")
 *   · `culprits` = ปลดตัวนี้ตัวเดียว (ตัวอื่นคงเดิม) แล้วเหลือกี่ใบ — เอาเฉพาะตัวที่ได้ของคืน เรียงมาก→น้อย
 *   · `needsMulti` = ว่างจริง แต่ปลดตัวเดียวไม่พอ ต้องปลด ≥ 2 ตัว (จอต้องเสนอ "ล้างตัวกรอง" แทน)
 *
 * 🔴 ว่างเพราะ "ไม่มีข้อมูลเลย" (rows ว่าง) ≠ ว่างเพราะตัวกรอง — คืน `total:0` ให้จอเขียนคนละแบบ
 */
export function blameEmpty(rows, filters) {
  const all = Array.isArray(rows) ? rows : [];
  const on = (Array.isArray(filters) ? filters : [])
    .filter(f => f && f.on !== false && typeof f.test === 'function');

  const ladder = [{ key: '', label: 'ทั้งหมดที่โหลดมา', n: all.length }];
  let cur = all;
  for (const f of on) {
    cur = cur.filter(f.test);
    ladder.push({ key: f.key, label: f.label, value: f.value, n: cur.length });
  }
  if (cur.length) return { empty: false, total: all.length, needsMulti: false, ladder, culprits: [] };

  /* ปลดทีละตัว — ตัวอื่นยังอยู่ครบ ⇒ ตัวเลขที่ได้คือ "กดปุ่มนี้แล้วจะเห็นกี่ใบ" จริงๆ */
  const culprits = [];
  for (const f of on) {
    const n = all.filter(r => on.every(g => g === f || g.test(r))).length;
    if (n > 0) culprits.push({ key: f.key, label: f.label, value: f.value, n, removable: f.removable !== false });
  }
  culprits.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return { empty: true, total: all.length, needsMulti: all.length > 0 && culprits.length === 0, ladder, culprits };
}

/** บันไดแบบย่อสำหรับวาดบนจอ — เก็บเฉพาะขั้นที่ "ตัวเลขขยับ" (ขั้นที่ไม่ตัดอะไรเลยไม่ต้องโชว์)
 *  ขั้นที่ตกเหลือ 0 ตัวเลขขยับเสมอ (ขั้นก่อนหน้า > 0) ⇒ ไม่มีทางหายจากลิสต์ */
export const ladderSteps = (ladder) =>
  (Array.isArray(ladder) ? ladder : []).filter((r, i, a) => i === 0 || r.n !== a[i - 1].n);
