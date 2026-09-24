/* 🎓 เกรดพนักงานตามผังองค์กรทางการ TSAT4 — src/utils/grades.js      2026-09-24
 *
 * ถอดจากแม่แบบ HR `FM-HRM-1-00102 Organization TSAT4 Rev.03`
 * (sheet "สายโรงงานระดับส่วน") · รายละเอียด → docs/modules/org-hierarchy.md §2-3
 *
 * ── 🔴 กฎเหล็กที่พลาดง่ายที่สุด: เลขน้อย = สูงกว่า ภายในตัวอักษรเดียวกัน ────────
 *   หัวหน้าส่วน `S1` **สูงกว่า** หัวหน้าแผนก `S2-S3`
 *   หัวหน้ากลุ่ม `T1-T3` **สูงกว่า** พนักงานทั่วไป `T6-T8`
 *   ⇒ **ห้ามเทียบด้วย `<` `>` บนสตริง และห้าม `.sort()` ด้วยโค้ด** — ใช้ `gradeRank()` เท่านั้น
 *     (`'S1' < 'S3'` เป็นจริงบังเอิญ แต่ `'T3' < 'T6'` ก็เป็นจริง ทั้งที่ T3 สูงกว่า)
 *
 * ── แกนนี้ไม่ใช่แกนสิทธิ์ ────────────────────────────────────────────────────
 * เกรดบอก "ค่าตัวในองค์กร" ไม่ได้บอกว่าคุมหน่วยไหน — **วิศวกรอาวุโส `S1` กับ
 * หัวหน้าส่วน `S1` เกรดเท่ากันแต่ขอบเขตคนละเรื่อง**
 * ⇒ `scope_depth` ยังต้องมาจาก **ตำแหน่ง** ไม่ใช่เกรด (ดู src/utils/scopeDepth.js)
 * ⇒ เกรดใช้ตอบเรื่อง: ผลิตผังทางการ · ตรวจว่าเกรดตรงตำแหน่งไหม · **ตัดสินเครื่องหมายรักษาการ**
 */
import { supabase } from '../supabaseClient';

let _rows = null;          // cache ทั้งตาราง (20 แถว — เล็กมาก โหลดครั้งเดียวพอ)
let _loading = null;

/** โหลดทะเบียนเกรด (เรียกครั้งเดียวตอน mount ของหน้าที่ใช้) */
export async function loadGrades(force = false) {
  if (_rows && !force) return _rows;
  if (_loading && !force) return _loading;
  _loading = (async () => {
    const { data, error } = await supabase.from('grades')
      .select('code, band, rank, label_th, is_active, sort_order')
      .eq('is_active', true).order('sort_order');
    // ⚠️ ล้มแล้วคืน cache เดิม — ห้ามเขียนทับด้วยลิสต์ว่าง (จอจะกลายเป็น "ไม่มีเกรดให้เลือก")
    if (error || !data) return _rows || [];
    _rows = data;
    return _rows;
  })().then(r => { _loading = null; return r; })
    .catch(() => { _loading = null; return _rows || []; });
  return _loading;
}

/** อ่านแบบ sync หลัง loadGrades() แล้ว */
export const gradesSync = () => _rows || [];
export const gradeRow   = (code) => gradesSync().find(g => g.code === code) || null;
export const gradeLabel = (code) => (code ? `${code}${gradeRow(code) ? ` · ${gradeRow(code).label_th}` : ''}` : '');

/**
 * ลำดับของเกรด — **มาก = สูงกว่า**
 * ไม่รู้จัก/ว่าง = `null` (ไม่ใช่ 0) เพื่อให้ผู้เรียกแยก "ต่ำสุด" ออกจาก "ไม่รู้" ได้
 */
export function gradeRank(code) {
  const r = gradeRow(code);
  return r ? r.rank : null;
}

/** เทียบ 2 เกรด — คืน null เมื่อมีตัวใดตัวหนึ่งไม่รู้จัก (ห้ามเดาว่าเท่ากัน) */
export function compareGrades(a, b) {
  const ra = gradeRank(a), rb = gradeRank(b);
  if (ra === null || rb === null) return null;
  return ra === rb ? 0 : (ra > rb ? 1 : -1);
}

/* ── เครื่องหมายรักษาการ ตามหมายเหตุท้ายแม่แบบ HR ───────────────────────────
   `*`         รักษาการในตำแหน่งที่ **สูงกว่า** ตำแหน่งจริง
   `**`        รักษาการในตำแหน่งที่ **เท่ากับหรือต่ำกว่า** ตำแหน่งจริง
   (ไม่ใส่)    รักษาการในตำแหน่งที่สูงกว่า **แต่อยู่ Cost Center เดียวกัน**
   ⚠️ ช่องเครื่องหมายของเคสที่ 3 ในแม่แบบเขียนว่า `(ไม่ระบุ*)` ซึ่งอ่านได้ว่า
      "ไม่ต้องใส่เครื่องหมาย" — **ยังไม่ได้ยืนยันกับ HR** ถ้าตีความผิดให้แก้ที่ฟังก์ชันนี้จุดเดียว */
export const ACTING_MARKS = {
  higher:      { mark: '*',  label: 'รักษาการในตำแหน่งที่สูงกว่าตำแหน่งจริง' },
  higherSameCc:{ mark: '',   label: 'รักษาการในตำแหน่งที่สูงกว่า (Cost Center เดียวกัน)' },
  equalLower:  { mark: '**', label: 'รักษาการในตำแหน่งที่เท่ากับหรือต่ำกว่าตำแหน่งจริง' },
};

/**
 * เครื่องหมายที่ต้องต่อท้ายตำแหน่งของคนที่รักษาการ
 * @param actualGrade   เกรดจริงของคนคนนั้น (employees.grade)
 * @param actingGrades  เกรดของ "ตำแหน่งที่ไปรักษาการ" (positions.grade_codes)
 * @param opts.sameCostCenter  ตำแหน่งที่ไปรักษาการอยู่ cost center เดียวกันไหม
 * @returns {{kind, mark, label}|null} — null = ข้อมูลไม่พอให้ตัดสิน (ห้ามเดา)
 */
export function actingMark(actualGrade, actingGrades = [], { sameCostCenter = false } = {}) {
  const mine = gradeRank(actualGrade);
  /* ตำแหน่งหนึ่งครอบได้หลายเกรด (เช่น ผู้จัดการ = M1-M3) — เทียบกับ "ตัวต่ำสุดของตำแหน่งนั้น"
     เพราะการขึ้นไปรักษาการ = ไปอยู่ตำแหน่งนั้น ต่อให้ได้เกรดล่างสุดของช่วงก็ถือว่าไปตำแหน่งนั้นแล้ว */
  const ranks = (actingGrades || []).map(gradeRank).filter(r => r !== null);
  if (mine === null || !ranks.length) return null;
  const target = Math.min(...ranks);
  if (target > mine) return { kind: sameCostCenter ? 'higherSameCc' : 'higher',
                              ...ACTING_MARKS[sameCostCenter ? 'higherSameCc' : 'higher'] };
  return { kind: 'equalLower', ...ACTING_MARKS.equalLower };
}

/**
 * เกรดของคนตรงกับตำแหน่งที่แม่แบบกำหนดไหม
 * @returns {'ok'|'mismatch'|'unknown'}  unknown = แม่แบบไม่ได้ระบุ หรือยังไม่กรอกเกรด
 * 🔴 **ผลลัพธ์นี้ใช้ "เตือน" เท่านั้น ห้ามบล็อกการบันทึก** — ของจริงมีข้อยกเว้น (รักษาการ · เคสเฉพาะ)
 */
export function gradeFitsPosition(grade, positionGradeCodes) {
  if (!grade || !positionGradeCodes?.length) return 'unknown';
  return positionGradeCodes.includes(grade) ? 'ok' : 'mismatch';
}
