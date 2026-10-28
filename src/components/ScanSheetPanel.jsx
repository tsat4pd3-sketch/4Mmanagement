import { useContext, useEffect, useMemo, useState } from 'react';
import { UserContext } from '../App';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import LineSelect, { scopeLines as pickerLines } from './LineSelect';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { lineProcessTypes, typeFitsLine, defaultSheetPicks } from '../utils/scanSheet';
import { buildScanSheetHtml } from '../lib/scanSheetPrint';
import { withDocFoot, docFormSync, fullCode } from '../utils/docForms';

/* 🗒️ แท็บ "ใบสแกนประจำไลน์ (A4)" ใน /qr-labels — เฟส 2 (2026-10-28 · คำสั่ง user: A4 แผ่นแยกตามไลน์)
   เลือกไลน์ → ระบบติ๊กประเภท Downtime/งานเสียที่เป็นของไลน์นั้นไว้ให้ (กติกาเดียวกับ dropdown ใน Daily Report)
   → ติ๊กเพิ่ม/เอาออก → พิมพ์ · กติกา `utils/scanSheet.js` · ตัวพิมพ์ `lib/scanSheetPrint.js` · ทะเบียนเอกสาร `scan_sheet` */
export default function ScanSheetPanel({ lines, canPrint }) {
  const { role, lineId, sections, scopeIdx } = useContext(UserContext);
  const [lineName, setLineName] = useState('');
  const [dt, setDt] = useState([]);
  const [ng, setNg] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [pickDt, setPickDt] = useState(() => new Set());
  const [pickNg, setPickNg] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [a, b, c] = await Promise.all([
        supabaseDR.from('dr_downtime_types').select('id, name_th, category, process_type, is_active, sort_order').eq('is_active', true).order('sort_order'),
        supabaseDR.from('dr_defect_types').select('id, name_th, process_type, is_active, sort_order').eq('is_active', true).order('sort_order'),
        supabaseDR.from('machines').select('line_name, process_type, equipment_kind, is_active').eq('is_active', true),
      ]);
      if (!alive) return;
      const err = a.error || b.error || c.error;
      // 🔴 อ่านไม่ได้ต้องบอก — ลิสต์ว่างจะอ่านว่า "ไลน์นี้ไม่มีประเภท" แล้วพิมพ์แผ่นเปล่าไปติดหน้างาน
      setLoadErr(err ? `โหลดทะเบียนไม่สำเร็จ: ${err.message}` : '');
      setDt(a.data || []); setNg(b.data || []); setMachines(c.data || []);
    })();
    return () => { alive = false; };
  }, []);

  // ขอบเขตไลน์ = ของกลาง (มีตาข่าย "กรองแล้วไม่เหลือ = ไม่กรอง" — ส่วนงานที่ไม่มีไลน์ผลิตยังเลือกได้)
  const visLines = useMemo(() => pickerLines(lines || [], { role, lineId, sections, scopeIdx }), [lines, role, lineId, sections, scopeIdx]);
  const line = visLines.find(l => l.name === lineName) || null;
  const pts = useMemo(() => (lineName ? lineProcessTypes(machines, getLineFamilyNames(lines || [], lineName)) : new Set()), [lineName, machines, lines]);

  // เลือกไลน์ใหม่ = ติ๊กชุดของไลน์นั้นให้ใหม่ (คนแก้ต่อได้)
  useEffect(() => {
    setPickDt(defaultSheetPicks(dt, pts));
    setPickNg(defaultSheetPicks(ng, pts));
  }, [pts, dt, ng]);

  const flip = (setFn) => (id) => setFn(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const print = async () => {
    if (!line) return toast.error('เลือกไลน์ก่อน');
    setBusy(true);
    try {
      const QR = (await import('qrcode')).default;
      const df = docFormSync('scan_sheet', { form_code: null, title: 'ใบสแกนประจำไลน์' });
      const html = await buildScanSheetHtml({
        line,
        downtime: dt.filter(t => pickDt.has(String(t.id))),
        defects: ng.filter(t => pickNg.has(String(t.id))),
        formCode: fullCode(df),
        printedAt: new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' }),
        toSvg: (p) => QR.toString(p, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }),
      });
      const w = window.open('', '_blank');
      if (!w) { toast.error('เบราว์เซอร์บล็อก popup — อนุญาตแล้วลองใหม่'); return; }
      w.document.write(withDocFoot(html, 'scan_sheet'));
      w.document.close();
    } catch (e) {
      toast.error(`สร้างใบสแกนไม่สำเร็จ: ${e?.message || e}`);
    } finally { setBusy(false); }
  };

  const section = (title, rows, picks, setPicks) => {
    const mine = rows.filter(t => typeFitsLine(t, pts));
    const others = rows.filter(t => !typeFitsLine(t, pts));
    const box = (t) => (
      <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border)', background: picks.has(String(t.id)) ? 'var(--accent-dim)' : 'var(--bg2)', cursor: 'pointer', fontSize: 13 }}>
        <input type="checkbox" checked={picks.has(String(t.id))} onChange={() => flip(setPicks)(String(t.id))} />
        <span style={{ minWidth: 0 }}>{t.name_th}{t.category === 'planned' && <span style={{ color: 'var(--muted)', fontSize: 11 }}> · ในแผน</span>}</span>
      </label>
    );
    return (
      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>{title}</b>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>เลือก {picks.size} รายการ</span>
          <span className="spacer" style={{ marginLeft: 'auto' }} />
          <button type="button" className="tbtn" onClick={() => setPicks(defaultSheetPicks(rows, pts))} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer' }}>↺ ของไลน์นี้</button>
          <button type="button" className="tbtn" onClick={() => setPicks(new Set())} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer' }}>ล้าง</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, alignContent: 'start' }}>{mine.map(box)}</div>
        {others.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>กระบวนการอื่น ({others.length}) — ไม่ได้ติ๊กให้ เลือกเพิ่มได้</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginTop: 6, alignContent: 'start' }}>{others.map(box)}</div>
          </details>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--text2)', background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '9px 12px', marginBottom: 12, lineHeight: 1.7 }}>
        🗒️ <b>ใบสแกนประจำไลน์ (A4)</b> — ติดข้างไลน์ แล้วหน้างาน <b>ยิงเหตุผลจากแผ่น</b> แทนการไล่หาในลิสต์ยาว
        (Daily Report → บันทึก Downtime / งานเสีย → แตะ 📷 ข้างช่องประเภท หรือกดปุ่มสแกนข้างเครื่อง)
        · ระบบติ๊กประเภทที่เป็นของไลน์นี้ไว้ให้ (ตามกระบวนการของเครื่องในไลน์) · แก้ทะเบียนประเภทเมื่อไหร่ ให้พิมพ์แผ่นใหม่ (ประเภทที่ถูกปิดใช้ ยิงแล้วระบบไม่รับ)
      </div>
      {loadErr && <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 10 }}>⚠️ {loadErr} — ยังพิมพ์ไม่ได้</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <LineSelect lines={visLines} value={lineName} onChange={setLineName} placeholder="— เลือกไลน์ —" />
        {line && <span style={{ fontSize: 12, color: 'var(--muted)' }}>กระบวนการของไลน์: {pts.size ? [...pts].join(', ') : 'ไม่พบ (ติ๊กเฉพาะประเภทกลาง)'}</span>}
        <span style={{ marginLeft: 'auto' }} />
        {canPrint && (
          <button type="button" onClick={print} disabled={!line || busy || !!loadErr}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 13.5, fontWeight: 800, cursor: line && !busy ? 'pointer' : 'not-allowed', background: line && !loadErr ? 'var(--accent)' : 'var(--bg3)', color: line && !loadErr ? 'var(--accent-ink)' : 'var(--muted)' }}>
            {busy ? 'กำลังสร้าง…' : `🖨️ พิมพ์ใบสแกน (${pickDt.size + pickNg.size} ช่อง)`}
          </button>
        )}
      </div>
      {line ? (<>
        {section('⏱ ประเภท Downtime', dt, pickDt, setPickDt)}
        {section('🔴 ประเภทงานเสีย', ng, pickNg, setPickNg)}
      </>) : (
        <div style={{ fontSize: 13, color: 'var(--muted)', padding: 16 }}>เลือกไลน์เพื่อดูประเภทที่จะลงในแผ่น</div>
      )}
    </div>
  );
}
