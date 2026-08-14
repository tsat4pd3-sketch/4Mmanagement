/* ══ 🎲 Seeded random — ตัวเลขจำลองที่ "นิ่ง" ══════════════════════════════════════════
   ใช้กับหน้า mockup/สาธิตที่ต้องปั้นตัวเลขให้ดู (GroupOverview, AdoptionOutlook)

   ทำไมต้อง seeded: ถ้าใช้ Math.random() ตัวเลขจะดิ้นทุกครั้งที่ re-render/refresh
   → ตอนสาธิตให้ผู้บริหารดู กดกลับมาหน้าเดิมแล้วเลขไม่เหมือนเดิม = ความน่าเชื่อถือหายทันที
   seed เดียวกัน → ค่าเดิมเสมอ (เหมือนข้อมูลจริงที่นิ่ง)

   วิธีตั้ง seed: ประกอบจากสิ่งที่ระบุตัวตนของค่านั้น เช่น `${บริษัท}|${ไลน์}|${วัน}`
   — เปลี่ยนวัน ตัวเลขขยับ (ดูมีชีวิต) แต่เปิดซ้ำวันเดิมได้ค่าเดิม

   ⚠️ ห้ามใช้กับข้อมูลจริง — นี่คือของสำหรับ "จำลอง" เท่านั้น และทุกจอที่ใช้ต้องติดป้าย
      บอกผู้ใช้ว่าเป็นตัวเลขจำลอง (กติกาเดียวกับ /group-overview และ /adoption-outlook)
   ═════════════════════════════════════════════════════════════════════════════════════════ */

/* FNV-1a 32-bit — เร็ว กระจายดีพอสำหรับงานแสดงผล (ไม่ใช่ crypto ห้ามเอาไปใช้ด้านความปลอดภัย) */
export function hash32(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 0..1 คงที่ต่อ seed */
export const rnd = (seed) => (hash32(seed) % 100000) / 100000;

/** ตัวคูณ 1 ± spread/2 — ใช้ทำให้ค่าดู "ไม่กลมเกินไป" */
export const jit = (seed, spread) => 1 + (rnd(seed) - 0.5) * spread;

/** จำนวนเต็มในช่วง [lo, hi] คงที่ต่อ seed */
export const rint = (seed, lo, hi) => lo + Math.floor(rnd(seed) * (hi - lo + 1));

/** หยิบสมาชิกจาก array แบบคงที่ต่อ seed — array ว่างคืน fallback (ห้าม crash ตอนฐานยังไม่มีข้อมูล) */
export const pick = (arr, seed, fallback = null) =>
  (arr && arr.length) ? arr[hash32(seed) % arr.length] : fallback;
