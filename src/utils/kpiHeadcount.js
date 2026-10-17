/* ══ 👥 กำลังคนจากทะเบียนพนักงาน → ตัวแปรฐาน `manpower` อัตโนมัติ (2026-10-15 · user: "จำนวนคน sale/head อีก") ══════════
   ESM มีทะเบียน `employees` (is_active · section · department · start_date) ⇒ เติมตัวหารของ "ยอดขาย/หัว" ให้เองเมื่อไม่มีใครกรอก
   · ค่ากรอกมือใน kpi_base_inputs **ชนะเสมอ** (ทะเบียนอาจไม่ครบ — PD1 ในทะเบียน 32 คน) · จอต้องติดป้ายว่า "≈ จากทะเบียน"
   · กำลังคนของเดือน = พนักงาน active ที่ start_date ≤ สิ้นเดือน (start_date ว่าง/อนาคต (บั๊ก พ.ศ.) = นับ) — **ไม่รู้วันออก** (ทะเบียนไม่มี)
     ⇒ เดือนย้อนหลังเป็นค่าประมาณ · ขอบเขต: ทั้งโรงงาน = ทุกคน · section = `employees.section` · department = `employees.department` ·
     ระดับอื่น (ไลน์/CC) = ไม่รู้ → null (ไม่เดา) · pure · เทส `kpiHeadcount.test.mjs` */
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s&_\-]+/g, '');

const monthEnd = (year, m) => `${year}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, '0')}`;

/**
 * @param employees แถว employees (id, section, department, is_active, start_date)
 * @returns { get(scopeKey, month) → number|null, size }
 */
export function headcountAuto(employees = [], { year, today = null } = {}) {
  const act = (employees || []).filter(e => e && e.is_active !== false);
  const validStart = (s) => !!s && /^\d{4}-\d{2}-\d{2}/.test(s) && (!today || s <= today);
  const inScope = (e, sk) => {
    if (sk === 'plant') return true;
    const i = sk.indexOf(':'); if (i < 0) return false;
    const kind = sk.slice(0, i), val = norm(sk.slice(i + 1));
    if (kind === 'section') return norm(e.section) === val;
    if (kind === 'department') return norm(e.department) === val;
    return null;   // ไลน์/กลุ่มไลน์/CC — ทะเบียนไม่มีคอลัมน์ให้เทียบตรงๆ
  };
  const cache = new Map();
  const get = (sk, month) => {
    const key = `${sk}|${month}`;
    if (cache.has(key)) return cache.get(key);
    const end = monthEnd(year, month);
    let n = 0, known = false;
    for (const e of act) {
      const ok = inScope(e, sk);
      if (ok == null) { cache.set(key, null); return null; }
      if (!ok) continue;
      known = true;
      if (!validStart(e.start_date) || e.start_date <= end) n += 1;
    }
    const v = known ? n : null;
    cache.set(key, v);
    return v;
  };
  return { get, size: act.length };
}

/** ตัวเสียบเข้า buildBaseIndex({ auto }) — ตอบเฉพาะ manpower */
export const headcountAutoVar = (hc) => (sk, varKey, month) => (varKey === 'manpower' && hc ? hc.get(sk, month) : null);
