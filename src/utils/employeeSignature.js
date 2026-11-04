/* ══ ✍️ employeeSignature — "รหัสพนักงาน → ชื่อ + ลายเซ็น" สำหรับเอกสาร export (2026-11-03 · ประชุม 02/11 C1) ══
   ความต้องการ: ใบตรวจ (PM/AM/QA/BBS ฯลฯ) ที่ export ออกไปต้องพิมพ์ลายเซ็นของ "ผู้ตรวจ" ได้
   แม้ผู้ตรวจไม่มีบัญชี login (พนักงานหน้างาน/ผู้รับเหมา) — ตัวตนบนหน้างาน = **รหัสพนักงาน**
   (QR บนบัตร = รหัสพนักงานล้วน · ชุดเดียวกับเช็คชื่อ `utils/badgeCheckin.js` · ผู้รับเหมาไม่มีบัตร = พิมพ์รหัสเอง)

   ที่เก็บ: `employees.signature_url` (Main · migration `20261103_employee_signature_main.sql`)
     ไฟล์อยู่ bucket `signatures` path `emp/<employee_id>/<ts>.png` (คนละโฟลเดอร์กับ `<uid>/…` ของโปรไฟล์)

   🔴 ลำดับ "ลายเซ็นของคนนี้" (`signatureOfPerson`): โปรไฟล์ (คนเซ็นเองที่เมนูบัญชี) ชนะ → ลายเซ็นในฐานพนักงาน
      → ค่าที่ใบเก็บไว้ (`stored` — ของเดิมก่อนมีระบบนี้) · ไม่มีเลย = `null` = เว้นช่องให้เซ็นมือ **ห้ามคืนสตริงว่าง**
   🔴 จับคู่รหัส **ตรงเป๊ะหลังปรับรูป** ผ่าน `normBadgeCode` เท่านั้น · รหัสซ้ำ 2 คน = ไม่เดา (`ambiguous`)
   🔴 คอลัมน์ยังไม่ apply (42703 / PGRST204) = **ไม่ล้มทั้งใบ** แต่คืน `sigColumnMissing` ให้จอ/ใบเขียนบอก ห้ามเงียบ
   ════════════════════════════════════════════════════════════════════════════════════════════════════ */
import { normBadgeCode } from './badgeCheckin.js';

/** สถานะของผู้เซ็น 1 คน — จอ/ใบพิมพ์อ่าน `SIGNER_NOTE[state]` ไปเขียนบอก */
export const SIGNER_STATES = ['ok', 'no_signature', 'not_found', 'ambiguous', 'no_code', 'unknown'];
export const SIGNER_NOTE = {
  ok: '',
  no_signature: 'พนักงานคนนี้ยังไม่มีลายเซ็นในระบบ — เว้นช่องให้เซ็นมือ (ตั้งลายเซ็นได้ที่หน้าฐานพนักงาน)',
  not_found: 'ไม่พบรหัสพนักงานนี้ในทะเบียน — ตรวจรหัสอีกครั้ง',
  ambiguous: 'รหัสนี้ซ้ำกันหลายคนในทะเบียน — ระบบไม่เดา เว้นช่องให้เซ็นมือ',
  no_code: '',
  unknown: 'ยังโหลดลายเซ็นในฐานพนักงานไม่ได้ (ระบบยังไม่ได้เปิดคอลัมน์ลายเซ็น หรือโหลดไม่สำเร็จ) — เว้นช่องให้เซ็นมือ',
};

/** คอลัมน์ไม่มี (ยังไม่ apply migration) — PostgREST ตอบได้ 2 แบบ */
export const isMissingColumnError = (err) => !!err && (err.code === '42703' || err.code === 'PGRST204'
  || /column .*signature_url.* does not exist|Could not find the 'signature_url' column/i.test(String(err.message || '')));

/**
 * ตัดสินผู้เซ็นจากรหัส (pure)
 * @param {string} code รหัสที่สแกน/พิมพ์มา
 * @param {Array<{id, employee_id_code, name, signature_url?}>} rows แถวพนักงานที่โหลดมา
 * @param {{ sigColumnMissing?: boolean }} o
 * @returns {{ code, state, employeeId, name, signatureUrl, note }}
 */
export function signerFromRows(code, rows, { sigColumnMissing = false } = {}) {
  const q = normBadgeCode(code);
  const base = { code: q || null, employeeId: null, name: null, signatureUrl: null };
  if (!q) return { ...base, state: 'no_code', note: SIGNER_NOTE.no_code };
  const hits = (rows || []).filter(e => e?.employee_id_code && normBadgeCode(e.employee_id_code) === q);
  if (!hits.length) return { ...base, state: 'not_found', note: SIGNER_NOTE.not_found };
  if (hits.length > 1) return { ...base, state: 'ambiguous', note: SIGNER_NOTE.ambiguous };
  const e = hits[0];
  const who = { ...base, employeeId: e.id, name: e.name || null };
  if (sigColumnMissing) return { ...who, state: 'unknown', note: SIGNER_NOTE.unknown };
  const url = String(e.signature_url || '').trim();
  return url
    ? { ...who, signatureUrl: url, state: 'ok', note: '' }
    : { ...who, state: 'no_signature', note: SIGNER_NOTE.no_signature };
}

/**
 * ลายเซ็นที่ควรพิมพ์ของคนหนึ่ง (pure) — โปรไฟล์ → ฐานพนักงาน → ค่าที่ใบเก็บไว้ → null
 * @param {{ profileSig?: string|null, employeeSig?: string|null, stored?: string|null }} p
 */
export function signatureOfPerson({ profileSig = null, employeeSig = null, stored = null } = {}) {
  const pick = [profileSig, employeeSig, stored].map(v => String(v || '').trim()).find(Boolean);
  return pick || null;
}

const SEL_FULL = 'id, employee_id_code, name, signature_url';
const SEL_BASE = 'id, employee_id_code, name';

/**
 * โหลดพนักงานด้วยรหัสหรือ id (ใช้ตอนกด export เท่านั้น — ไม่ใช่จอรายการ)
 * @param {object} client supabase (Main)
 * @param {{ codes?: string[], ids?: string[] }} q
 * @returns {Promise<{ rows: object[], sigColumnMissing: boolean, error: string|null }>}
 *   `error` = อ่านไม่ได้จริง (ไม่ใช่แค่คอลัมน์ขาด) — ผู้เรียกต้องเขียนบอก ห้ามพิมพ์ใบเหมือนไม่มีลายเซ็นเฉยๆ
 */
export async function loadEmployeeSigners(client, { codes = [], ids = [] } = {}) {
  const codeList = [...new Set((codes || []).map(c => String(c || '').trim()).filter(Boolean))];
  const idList = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!codeList.length && !idList.length) return { rows: [], sigColumnMissing: false, error: null };
  /* รหัสบนบัตรอาจพิมพ์ต่างรูป (ช่องว่าง/ขีด/ตัวเล็ก) ⇒ ค้นด้วยค่าดิบ + ค่าที่ปรับรูปแล้ว แล้วตัดสินซ้ำด้วย normBadgeCode */
  const codeKeys = [...new Set(codeList.flatMap(c => [c, normBadgeCode(c)]))];
  const run = async (sel) => {
    const out = [];
    if (codeKeys.length) {
      const r = await client.from('employees').select(sel).in('employee_id_code', codeKeys);
      if (r.error) return { error: r.error };
      out.push(...(r.data || []));
    }
    if (idList.length) {
      const r = await client.from('employees').select(sel).in('id', idList);
      if (r.error) return { error: r.error };
      out.push(...(r.data || []));
    }
    const seen = new Set();
    return { rows: out.filter(e => (seen.has(e.id) ? false : seen.add(e.id))) };
  };
  let r = await run(SEL_FULL);
  if (r.error && isMissingColumnError(r.error)) {
    const b = await run(SEL_BASE);
    if (b.error) return { rows: [], sigColumnMissing: true, error: b.error.message || String(b.error) };
    return { rows: b.rows, sigColumnMissing: true, error: null };
  }
  if (r.error) return { rows: [], sigColumnMissing: false, error: r.error.message || String(r.error) };
  return { rows: r.rows, sigColumnMissing: false, error: null };
}

/** รหัสเดียว → ผู้เซ็น (โหลด + ตัดสิน) · อ่านไม่ได้ = state `unknown` พร้อม `error` */
export async function resolveEmployeeSigner(client, code) {
  if (!normBadgeCode(code)) return signerFromRows('', []);
  const res = await loadEmployeeSigners(client, { codes: [code] });
  if (res.error) return { code: normBadgeCode(code), employeeId: null, name: null, signatureUrl: null,
    state: 'unknown', note: SIGNER_NOTE.unknown, error: res.error };
  return signerFromRows(code, res.rows, { sigColumnMissing: res.sigColumnMissing });
}
