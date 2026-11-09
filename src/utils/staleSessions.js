import { useCallback, useEffect, useState } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadProductionLines } from './useProductionLines';
import { inSectionScope, lineScope } from './sectionScope';

/* ═══════════════════════════════════════════════════════════════════════════
   กะค้างไม่ปิด — กติกา + ตัวโหลดร่วม (แยกออกจาก DailyReport 2026-08-26)
   ใช้ 2 ที่: badge บนแท็บ (หน้า DailyReport) + แท็บ "⏰ กะค้าง" ที่ไล่ปิดจริง
   ⚠️ ห้าม copy เกณฑ์/สูตรอายุไปเขียนซ้ำในหน้าใด — แก้ที่นี่ที่เดียว

   นโยบาย 2026-08-25 (คำสั่ง user "บีบหัวหน้าแผนกให้เร่งทำงานตามเวลา"):
   เตือนดัง **ห้าม auto-ปิด / auto-อนุมัติ** — ปิดกะ = stamp OEE จากยอดที่คนยืนยัน ·
   auto-approve = โกหกว่ามีคนพิจารณา (หลักเดียวกับเคสเคลียร์คิว 4M [Auto] 323 ใบ)
   ═══════════════════════════════════════════════════════════════════════════ */
export const STALE_SESSION_DAYS = 7;

const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// work date ตามกฎ CLAUDE.md: ก่อน 08:00 = วันก่อนหน้า (กะดึกข้ามวัน)
export const workDateOf = (at = new Date()) => {
  const d = new Date(at);
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return localDateStr(d);
};
/** อายุกะค้าง (วัน) เทียบ work date ปัจจุบัน */
export const sessionAgeDays = (wdStr) => {
  if (!wdStr) return 0;
  return Math.max(0, Math.round((new Date(`${workDateOf()}T00:00:00`) - new Date(`${wdStr}T00:00:00`)) / 864e5));
};

/** ลูกบอลอยู่ฝั่งใคร — ไม่บอก คนก็โทษกันไปมา */
export const ballSideText = (s) => s.status === 'pending_close'
  ? `รอ SV อนุมัติ${s.close_requested_by_name ? ` (ขอโดย ${s.close_requested_by_name})` : ''}`
  : 'หัวหน้ากลุ่มยังไม่ขอปิดกะ';

/**
 * โหลด "กะที่ยังไม่ปิดจากวันก่อนๆ" ตาม scope ของผู้ใช้
 * ⚠️ leader ต้องเห็นทั้งครอบครัวไลน์ (กฎ scope ของ leader) — ไลน์แม่ที่ลูกเปิดกะค้าง ต้องนับด้วย
 * คืน rows เรียงเก่าสุดขึ้นบน พร้อม age/section ปัจจุบันของไลน์
 */
export async function fetchStaleSessions({ role, lineId, sections = [], scopeIdx = null }) {
  const [{ data: ln, error: lnErr }, { data: rows, error: sErr }] = await Promise.all([
    /* ทะเบียนไลน์ผ่าน cache กลาง (25/09 · งานลด request) — ตัวนี้ถูกเรียกทุกรอบที่ Daily Report
       โหลดใหม่ ⇒ เคยเป็นจุดที่ยิง production_lines ถี่ที่สุดจุดหนึ่งใน 4,041 ครั้ง/วัน
       ⚠️ คง "โหลดไม่สำเร็จต้องบอก" ไว้เหมือนเดิม — cachedMaster คืน `undefined` เมื่อโหลดพลาด
          และยังไม่เคยมี cache (คนละความหมายกับ `[]` = ทะเบียนว่างจริง) */
    loadProductionLines().then(d => ({
      data: d || [], error: d ? null : new Error('โหลดทะเบียนไลน์ไม่สำเร็จ'),
    })),
    supabaseDR.from('production_sessions')
      .select('id, line_name, shift, work_date, section, status, close_requested_by_name, close_reject_at, close_reject_by_name, close_reject_reason')
      .in('status', ['open', 'pending_close'])
      .lt('work_date', workDateOf())
      .order('work_date', { ascending: true }),
  ]);
  // โหลดไม่สำเร็จ = บอกให้รู้ ห้ามคืนลิสต์ว่างให้ดูเหมือน "ไม่มีกะค้าง"
  if (lnErr || sErr) return { rows: [], error: lnErr || sErr };

  const lm = {};
  (ln || []).forEach(l => { lm[l.name] = l; });
  /* 🔭 ขอบเขตจากของกลาง `lineScope()` (QC audit 09/11 · กวาดรอบ 3)
     เดิมคิดเองที่นี่ ⇒ leader ได้ครอบครัวไลน์ล้วน (ไม่รวมส่วนงานที่กำกับไว้ · กฎ 26/10)
     และไม่รู้จัก `scopeIdx` (แกน Cost Center/ผัง)
     🔴 กติกาเดิมที่คงไว้: leader ที่ชี้ไลน์ไม่ได้เลย = fail-closed (ไม่เห็นกะค้างของใคร)
        · ไม่มี scope เลย = manager/supervisor เห็นทั้งหมด (role อื่นไม่เห็น) */
  const sc = lineScope({ role, lineId, sections, lines: ln || [], scopeIdx });
  const okNames = sc.unlimited ? null : new Set(sc.names);

  const keep = (o) => {
    if (role === 'admin') return true;
    if (okNames) {
      if (okNames.has(o.line_name)) return true;
      /* ไลน์ที่ทะเบียนไม่รู้จัก = ถอยไปตัดด้วยส่วนงาน (เหมือนเดิม) */
      if (sections.length) {
        const liveSection = lm[o.line_name]?.section;
        return inSectionScope(sections, liveSection) || inSectionScope(sections, o.section);
      }
      return false;
    }
    if (role === 'leader') return false;              // ไม่จำกัดแต่ชี้ไลน์ไม่ได้ = fail-closed เดิม
    if (sections.length) {
      const liveSection = lm[o.line_name]?.section;
      return inSectionScope(sections, liveSection) || inSectionScope(sections, o.section);
    }
    // ไม่มี scope: manager/supervisor เห็นทั้งหมด (พฤติกรรมเดิม)
    return role === 'manager' || role === 'supervisor';
  };

  return {
    rows: (rows || []).filter(keep).map(o => ({
      ...o,
      age: sessionAgeDays(o.work_date),
      liveSection: lm[o.line_name]?.section || o.section || null,
      group: lm[o.line_name]?.parent_line_name || o.line_name,
    })).sort((a, b) => b.age - a.age || a.line_name.localeCompare(b.line_name)),
    error: null,
  };
}

/** hook สำหรับ badge/แท็บ — โหลดครั้งเดียวตอน mount + มี reload() ให้เรียกหลังปิด/อนุมัติกะ */
export default function useStaleSessions({ role, lineId, sections, scopeIdx = null }) {
  const [state, setState] = useState({ rows: [], error: null, loading: true });
  const secKey = (sections || []).join('|');
  /* 🔴 deps ห้ามมี object (กฎเขียน DB ข้อ 9) ⇒ ใช้ "มีผังไหม" เป็นคีย์ · ผังมาทีหลัง = โหลดซ้ำรอบเดียว */
  const idxKey = scopeIdx ? 'idx' : '-';
  const reload = useCallback(async () => {
    const r = await fetchStaleSessions({ role, lineId, sections: secKey ? secKey.split('|') : [], scopeIdx });
    setState({ rows: r.rows, error: r.error, loading: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, lineId, secKey, idxKey]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
