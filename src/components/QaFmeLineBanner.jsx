/**
 * QaFmeLineBanner — ป้ายเตือนฝั่งผลิต "รุ่นนี้ QA ยังไม่ตรวจ First" (2026-11-16)
 * คำสั่ง user 13/11: **First ยังไม่ผ่าน = เตือนเฉยๆ ไม่ล็อก** ⇒ ป้ายนี้ไม่มีปุ่ม ไม่บล็อกการสแกน/เปิดใบ
 * แหล่งข้อมูล = `qa_fme_obligations` (Main) ของ ไลน์ × วันงาน × กะ ที่เปิดอยู่ · ตัดสินที่ `utils/qaFmeLineWarn.js`
 * 🔴 อ่านไม่ได้ = เขียนบอกบนจอ ห้ามซ่อนเงียบ · ไม่มีงาน First ค้าง = ไม่วาดอะไร
 * 🔴 ไม่กระพริบ (UI §2 กระพริบสงวนให้เครื่องหยุดค้าง)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useLiveBoard } from '../utils/useLiveBoard';
import { LIVE, RATE } from '../utils/refreshRates';
import { firstWarnings } from '../utils/qaFmeLineWarn';
import { tr, dateLocale } from '../utils/i18n';

const hhmm = (iso) => (iso
  ? new Date(iso).toLocaleTimeString(dateLocale(), { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false })
  : '—');

const TONE = {
  ng:   { c: 'var(--red)',   bg: 'var(--red-dim)',   line: 'var(--red-line)' },
  late: { c: 'var(--red)',   bg: 'var(--red-dim)',   line: 'var(--red-line)' },
  wait: { c: 'var(--amber)', bg: 'var(--amber-dim)', line: 'var(--amber-line)' },
};

export default function QaFmeLineBanner({ lineName, workDate, shift }) {
  const [rows, setRows] = useState(null);     // null = ยังไม่โหลด
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!lineName || !workDate || !shift) { setRows([]); return; }
    const { data, error } = await supabase.from('qa_fme_obligations')
      .select('id, stage, status, product_name, mat_no, triggered_at, due_at, line_name, work_date, shift')
      .eq('line_name', lineName).eq('work_date', workDate).eq('shift', shift).eq('stage', 'first')
      .limit(50);
    // ตารางยังไม่มี (42P01) = ระบบ FME ยังไม่ติดตั้ง → ไม่ต้องเตือนอะไร
    if (error?.code === '42P01') { setErr(null); setRows([]); return; }
    if (error) { setErr(error.message); return; }
    setErr(null);
    // กันคำตอบเก่ามาทับ (สลับกะเร็วๆ) — แถวต้องตรงกับกะที่ถามจริง
    setRows((data || []).filter(o => o.line_name === lineName && o.work_date === workDate && o.shift === shift));
  }, [lineName, workDate, shift]);

  useLiveBoard(load, { tables: ['qa_fme_obligations'], topic: 'qa-fme-line-banner', client: supabase, tier: LIVE.PAGE, rate: RATE.BACKUP });
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const warns = useMemo(() => firstWarnings(rows || [], now), [rows, now]);

  if (err) {
    return (
      <div style={{ marginBottom: 10, padding: '6px 12px', fontSize: 12, color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 'var(--r-md)' }}>
        {tr('อ่านสถานะการตรวจ First ของ QA ไม่ได้ — ตรวจสอบกับ QA โดยตรง')} ({err})
      </div>
    );
  }
  if (!warns.length) return null;

  const top = warns[0].level;
  const tone = TONE[top];
  const title = top === 'ng'
    ? tr('⛔ QA ตรวจชิ้นแรก (First) ไม่ผ่าน — ติดต่อ QA/หัวหน้าก่อนผลิตต่อ')
    : tr('⚠️ รุ่นนี้ QA ยังไม่ตรวจชิ้นแรก (First)');
  return (
    <div role="status" style={{ marginBottom: 10, padding: '8px 12px', background: tone.bg, border: `1px solid ${tone.line}`, borderRadius: 'var(--r-md)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tone.c }}>{title}</div>
      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {warns.map(w => (
          <div key={w.id} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
            <b>{w.product}</b>
            {w.mat && w.mat !== w.product && <span style={{ color: 'var(--muted)' }}> · {w.mat}</span>}
            {' — '}
            {w.level === 'ng' && <span style={{ color: 'var(--red)', fontWeight: 700 }}>{tr('ไม่ผ่าน')}</span>}
            {w.level === 'late' && <span style={{ color: 'var(--red)', fontWeight: 700 }}>{tr('เลยกำหนดตรวจ')} {w.lateMin} {tr('นาที')}</span>}
            {w.level === 'wait' && (
              <span>{w.status === 'acked' ? tr('QA รับงานแล้ว กำลังตรวจ') : tr('รอ QA มาตรวจ')} · {tr('กำหนดภายใน')} {hhmm(w.dueAt)}</span>
            )}
            <span style={{ color: 'var(--muted)' }}> · {tr('เรียกเมื่อ')} {hhmm(w.triggeredAt)}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
        {tr('ป้ายนี้เตือนอย่างเดียว ไม่ล็อกการผลิต · หายเองเมื่อ QA ปิดใบตรวจผ่าน')}
      </div>
    </div>
  );
}
