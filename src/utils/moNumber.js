/* ═══════════════════════════════════════════════════════════════════════════
   เลข MO ออกยังไง — pure · **ต้องตรงกับ SQL `public.mtn_assign_mo_no()` เป๊ะ**  2026-10-14

   ⚠️ ไฟล์นี้ **ไม่ได้ออกเลข** — ตัวออกเลขจริงคือ RPC ฝั่ง DB (atomic กันออกชนกัน 2 เครื่อง)
      ไฟล์นี้มีไว้ให้ **จอบอกความจริงได้ว่า "ใบถัดไปจะเป็นเลขอะไร / ตัวนับอยู่ที่คีย์ไหน"**
      กฎเดียวกับ `snapMachineNo` ↔ `public.machine_key()` — **แก้ฝั่งไหน ต้องแก้อีกฝั่งในคอมมิทเดียวกัน**
      (มีด่าน `mo-number-js-sql-parity` ใน regressionGuards)

   ─── ที่มา (วัดจริง 14/10 · DR `mtn_orders` + `mtn_mo_seq`) ─────────────────────
   จอ "🔢 เลขรัน MO" โกหก **2 ทีมจาก 4** เพราะมันเดาเองว่าเลขออกแบบเดียวทั้งระบบ:

   | ทีม | จอเคยบอก | ของจริง |
   |---|---|---|
   | MTN | เลขล่าสุด 0 · ถัดไป `MTN-BM-141026-0001` | 14 · ถัดไป `MTN.2026/10-15` |
   | PRODUCTION | รหัส `PRD` · ถัดไป `PRD-BM-141026-0001` | รหัสจริง `PRO` · ถัดไป `PRO-...-0709` |

   ต้นเหตุ 2 ชั้น:
     1. ทีม MTN ใช้ **เลขรีเซ็ตรายเดือน** (`MTN.2026/10-14`) ตามฟอร์มกระดาษของเขา ⇒ ตัวนับ
        เก็บคีย์ `MTN:202610` **ไม่ใช่** `MTN` ⇒ จออ่านคีย์ `MTN` เลยได้ 0 เสมอ
        🔴 และ **ช่องกรอก "เลขล่าสุด" ของ MTN เขียนลงคีย์ผิด = กรอกไปไม่มีผลเลย**
        (คำถามช่าง 13/10: *"เวลาจะ Skip เลข MO ต้องไปกรอกตรงไหน"* — คำตอบคือตอนนั้นยังไม่มีที่ให้กรอก)
     2. RPC หาทีมด้วย `where dept_name = mtn_dept` แต่ `mtn_orders.mtn_dept` เก็บ **key**
        (`'production'`) ไม่ใช่ `dept_name` (`'PRODUCTION'`) ⇒ **ไม่เคย match เลย** ⇒ ตกไปใช้กฎ
        "3 ตัวแรกของ key" = `PRO` · JIG/DIE ถูกเพราะ 3 ตัวแรกบังเอิญตรงกับ `mo_code`
        ⇒ migration `20261014_mtn_mo_no_parity.sql` แก้ให้หาด้วย `key` + ตั้ง `mo_code` ของ
          production กลับเป็น `PRO` (เลขที่ออกจึงเหมือนเดิมเป๊ะ ไม่มีใบไหนเปลี่ยน)

   🔴 **ห้ามแก้ `mo_code` ให้ต่างจากที่ออกไปแล้ว** — เลขรันผูกกับ `mo_code` ผ่านคีย์ของ
      `mtn_mo_seq` ⇒ เปลี่ยนรหัส = ตัวนับคนละตัว = **เลขรีสตาร์ทจาก 1** ทั้งที่ออกไปแล้ว 708 ใบ
   ═══════════════════════════════════════════════════════════════════════════ */
import { bkkDateStr } from './workDate.js';

/** ทีมที่ใช้ "เลขรีเซ็ตรายเดือน" (ตามฟอร์มกระดาษของทีมนั้น) — ที่เหลือนับต่อเนื่องไม่รีเซ็ต
 *  🔴 เพิ่มทีมที่นี่ = ต้องเพิ่มใน SQL ด้วย (ลิสต์เดียวกัน) ไม่งั้นจอกับของจริงคนละเรื่อง */
export const MONTHLY_TEAM_KEYS = Object.freeze(['maintenance']);

/** รูปแบบเลขของทีมนี้ — `'monthly'` = `MTN.2026/10-15` · `'running'` = `JIG-BM-141026-0014` */
export const moFormatOf = (teamKey) =>
  (MONTHLY_TEAM_KEYS.includes(String(teamKey || '').trim()) ? 'monthly' : 'running');

/** รหัสทีมที่ใช้จริงในเลข MO — ทะเบียนชนะ · ไม่ตั้งไว้ถอยไป "3 ตัวแรกของ key"
 *  ⚠️ กฎถอยต้องตรงกับ SQL: `upper(substr(regexp_replace(key,'\s','','g'),1,3))` */
export function moCodeOf(team = {}) {
  const set = String(team.mo_code || '').trim().toUpperCase();
  if (set) return set;
  const k = String(team.key || '').replace(/\s/g, '');
  return (k ? k.slice(0, 3) : 'MTN').toUpperCase();
}

/** ส่วนวันของเลข (ตามปฏิทินไทย) — คืน `null` ถ้าอ่านเวลาไม่ออก (ห้ามเดาเป็นวันนี้) */
function bkkParts(at) {
  const iso = bkkDateStr(at);                      // 'YYYY-MM-DD' เวลาไทย (ของกลาง)
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return { y, m, d, ym: `${y}${m}`, period: `${y}/${m}`, ddmmyy: `${d}${m}${y.slice(2)}` };
}

/**
 * คีย์ของตัวนับใน `mtn_mo_seq` สำหรับทีมนี้ ณ เวลานี้
 * · รายเดือน → `'MTN:202610'` (ตัวนับคนละตัวทุกเดือน ⇒ เลขรีเซ็ตเอง)
 * · ต่อเนื่อง → `'JIG'`
 * @param at epoch ms / ISO — **ต้องส่งมา** (เทสรันรอบนาฬิกา +400 วัน · ห้ามอ่าน Date.now() เอง)
 * @returns string | `null` = อ่านเวลาไม่ออก (ผู้เรียกต้องเขียนบนจอว่าตัดสินไม่ได้ ห้ามเดา)
 */
export function moSeqKeyOf(team = {}, at) {
  const code = moCodeOf(team);
  if (moFormatOf(team.key) !== 'monthly') return code;
  const p = bkkParts(at);
  return p ? `${code}:${p.ym}` : null;
}

/**
 * เลข MO ที่จะได้ถ้าตัวนับอยู่ที่ `seq` (ใบถัดไปให้ส่ง `last_seq + 1`)
 * @returns string | `null` = อ่านเวลาไม่ออก **ห้ามคืนสตริงมั่ว** (จอต้องขึ้นว่าตัดสินไม่ได้)
 */
export function moNoOf(team = {}, seq, { at, prefix = 'BM' } = {}) {
  const p = bkkParts(at);
  if (!p || !Number.isFinite(Number(seq))) return null;
  const code = moCodeOf(team);
  const n = Number(seq);
  return moFormatOf(team.key) === 'monthly'
    ? `${code}.${p.period}-${n}`                                   // MTN.2026/10-15 (ไม่ pad — ตามฟอร์มกระดาษ)
    : `${code}-${String(prefix || 'BM')}-${p.ddmmyy}-${String(n).padStart(4, '0')}`;
}

/** คำอธิบายรูปแบบสำหรับโชว์บนจอตั้งค่า (ห้ามพิมพ์รูปแบบซ้ำในหน้า) */
export const moFormatHint = (team = {}) => (moFormatOf(team.key) === 'monthly'
  ? { title: 'รีเซ็ตทุกเดือน', detail: 'รหัสทีม.ปี/เดือน-เลขรัน — ตามฟอร์มกระดาษของทีมนี้' }
  : { title: 'นับต่อเนื่อง ไม่รีเซ็ต', detail: 'รหัสทีม-ประเภท-วันเดือนปี-เลขรัน' });
