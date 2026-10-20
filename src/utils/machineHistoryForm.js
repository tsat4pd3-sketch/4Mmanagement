/* ═══ ใบบันทึกประวัติการซ่อมและการทำ PM MACHINE (FM-MTN-005) — แปลงใบ MO เป็นแถวของฟอร์ม (pure · 2026-10-20) ═══
   user ส่งฟอร์มจริงมา: "ฟอร์มประวัติการซ่อมเครื่องจักร ดูเรื่อง export ประวัติ ต้องได้แบบนี้"
   ไฟล์นี้ตัดสิน "ช่องไหนใส่อะไร" ที่เดียว · ตัววาด Excel = `src/lib/mtnMachineHistoryExcel.js`

   🔴 กฎ:
     · เวลาที่ใช้ = `techRepairMin()` (เวลาของช่าง หักช่วงรออะไหล่ PR/อยู่กับ supplier) — **ห้ามลบเวลาเองที่นี่**
       หักไปเท่าไหร่ต้องเขียนในหมายเหตุ (ไม่งั้นคนเทียบ "เริ่ม→เสร็จ" แล้วตัวเลขไม่ตรง = คิดว่าระบบผิด)
     · ไม่รู้ = ช่องว่าง ห้ามเขียน 0 (ใบยังไม่ซ่อมเสร็จ = ไม่มีเวลาที่ใช้)
     · ใบตีกลับ (rejected) ไม่ใช่งานซ่อม ⇒ ไม่ลงประวัติ · ใบที่ยังเปิด = ลง + หมายเหตุ "ยังไม่ปิดใบ"
     · เรียงเก่า → ใหม่ (สมุดประวัติ) · 1 หน้า = 15 แถว ตามฟอร์มกระดาษ
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { techRepairMin, grossRepairMin } from './mtnVendor.js';
import { isMoOpen } from './mtnStepPerm.js';
import { problemLabelOf } from './machineRepairHistory.js';
import { assignedTechsOf, prNumbersOf } from './mtnPurchase.js';
import { UNGROUPED_LABEL } from './unclassified.js';

export const ROWS_PER_PAGE = 15;

const TZ = 'Asia/Bangkok';
/** ว/ด/ป (พ.ศ. แบบใบ MO) + เวลา 24 ชม. · ไม่มีค่า = '' */
export function splitDateTime(v) {
  if (!v) return { d: '', t: '' };
  const dt = new Date(v);
  if (!Number.isFinite(dt.getTime())) return { d: '', t: '' };
  const d = dt.toLocaleDateString('th-TH', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
  const t = dt.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  return { d, t };
}
/** นาที → "ชม:นาที" (ช่อง "ชั่วโมง/นาที") · null = '' */
export const hhmm = (min) => (min == null ? '' : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`);

/** ประเภทงานซ่อมแบบย่อสำหรับช่องหมายเหตุ — ชื่ออังกฤษหลายคำ = อักษรตัวแรก (Breakdown Maintenance → BM) · อื่นๆ คงเดิม */
export function repairTypeShort(t) {
  const s = String(t || '').trim();
  const w = s.split(/\s+/);
  return /^[A-Za-z ]+$/.test(s) && w.length > 1 ? w.map(x => x[0].toUpperCase()).join('') : s;
}

/**
 * @param orders   ใบ MO ของเครื่อง (จาก RPC — ครบคอลัมน์)
 * @param opts     { partsBy: {orderId:[{part_name,qty,unit}]}, prsBy, now }
 * @returns [{ id, rep:{d,t}, start:{d,t}, done:{d,t}, used, problem, cause, fix, parts, techs, moNo, note }]
 */
export function machineHistoryRows(orders = [], { partsBy = {}, prsBy = {}, now = Date.now() } = {}) {
  return (orders || [])
    .filter(o => o && o.status !== 'rejected')
    .sort((a, b) => String(a.report_at || '').localeCompare(String(b.report_at || '')))
    .map(o => {
      const used = techRepairMin(o, now);
      const gross = grossRepairMin(o);
      const held = used != null && gross != null ? gross - used : 0;
      const prob = problemLabelOf(o);
      const detail = String(o.report_note || '').trim();
      const cause = [o.cause_category, o.cause_other, o.root_cause].map(x => String(x || '').trim()).filter(Boolean);
      const parts = (partsBy[o.id] || []).map(p => `${p.part_name || 'อะไหล่'} ×${p.qty ?? ''}${p.unit ? ` ${p.unit}` : ''}`.trim());
      const prs = prNumbersOf(o, prsBy[o.id] || []);
      const note = [
        repairTypeShort(o.repair_type),
        held > 0 ? `หักรออะไหล่/ภายนอก ${hhmm(held)}` : '',
        o.supplier && o.vendor_sent_at ? `ส่งซ่อม ${o.supplier}` : '',
        prs.length ? `PR ${prs.join(', ')}` : '',
        isMoOpen(o) ? 'ยังไม่ปิดใบ' : '',
      ].filter(Boolean).join(' · ');
      return {
        id: o.id,
        rep: splitDateTime(o.report_at),
        start: splitDateTime(o.repair_start_at || o.accept_at),
        done: splitDateTime(o.repair_done_at),
        used: hhmm(used),
        problem: [prob === UNGROUPED_LABEL ? '' : prob, detail].filter(Boolean).join(' — '),
        cause: [...new Set(cause)].join(' · '),
        fix: String(o.solution || '').trim(),
        parts: parts.join(', '),
        techs: (assignedTechsOf(o).length ? assignedTechsOf(o) : [o.tech_main, o.tech_secondary].filter(Boolean)).join(', '),
        moNo: o.mo_no || '',
        note,
      };
    });
}

/** แบ่งหน้า 15 แถว — อย่างน้อย 1 หน้าเสมอ (ใบเปล่าก็พิมพ์ฟอร์มว่างได้) */
export function paginate(rows = [], per = ROWS_PER_PAGE) {
  const pages = [];
  for (let i = 0; i < rows.length; i += per) pages.push(rows.slice(i, i + per));
  return pages.length ? pages : [[]];
}
