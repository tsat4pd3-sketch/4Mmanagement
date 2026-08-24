/**
 * BBS — แบบฟอร์มสังเกตพฤติกรรมความปลอดภัย (Behavior-Based Safety)
 * แท็บใน /daily-checker (ระบบเช็ครายวันของไลน์ผลิต)
 *
 * ที่มา: user ส่งฟอร์ม Excel มา 2026-08-21 — "เพิ่มเข้าระบบ + link ข้อมูลกับการตรวจ PPE พนักงาน
 * ดึงลายเซ็นหัวหน้าที่ตรวจใส่ให้พร้อมเลย"
 *
 * โครง: 1 ใบ = เดือน × ไลน์/พื้นที่ × กะ · แถว = พนักงาน · คอลัมน์ = วันที่ 1-31
 *
 * ⚠️ กฎเหล็กของหน้านี้
 *  1. ระบบเติมช่องอัตโนมัติได้เฉพาะข้อที่ผูก `bbs_agreements.auto_source` (PPE ที่ระบบเก็บจริง =
 *     หมวก/รองเท้า/ถุงมือ) — **ต้องบอกบนจอ + บนใบพิมพ์เสมอว่าครอบกี่ข้อจากทั้งหมดกี่ข้อ**
 *     ห้ามปล่อยให้ใบดูเหมือนสังเกตครบทุกข้อ
 *  2. **ไม่มีแถว log = ไม่เติมอะไรเลย** ("ไม่รู้" ≠ "ผ่าน") · เติมทับของที่คนกรอกเองไม่ได้
 *  3. หัวใบ (bbs_sheets) เกิดตอน "บันทึกครั้งแรก" เท่านั้น ห้ามสร้างตอนเปิดดู
 *     (หลักเดียวกับ checklist ของ PM ที่เคยสร้างเงาเปล่าค้างจนเครื่องไปโผล่ผิดแท็บ)
 *  4. update ต้องนับแถวที่เขียนจริง (`.select('id')`) — RLS ปฏิเสธ = 0 แถว ไม่ error
 */
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';
import { toast } from '../components/Toast';
import ReadOnlyNote from '../components/ReadOnlyNote';
import { getLineFamilyIds, toHierarchicalOptions } from '../utils/lineHierarchy';
import { inSectionScope } from '../utils/sectionScope';
import { MARKS, MARK_BY_KEY, markGlyph, markColor, daysInMonth, ppeToMark } from '../utils/bbsMarks';
import { printBbsSheet } from '../lib/bbsPrint';

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const cellKey = (empId, day) => `${empId}|${day}`;

export default function BbsCheck() {
  const { role, lineId, sections = [], fullName } = useContext(UserContext);
  const { can } = usePerms();
  const canRecord = can('bbs', 'record');
  const canManage = can('bbs', 'manage');

  const [lines, setLines] = useState([]);
  const [emps, setEmps] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [signers, setSigners] = useState([]);      // profiles ที่มีลายเซ็น
  const [sheet, setSheet] = useState(null);
  const [cells, setCells] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadWarn, setLoadWarn] = useState('');

  const [month, setMonth] = useState(thisMonth);
  const [selLine, setSelLine] = useState('');
  const [shift, setShift] = useState('');
  const [brush, setBrush] = useState('ok');        // สัญลักษณ์ที่จะทา
  const [brushSeq, setBrushSeq] = useState(1);     // เลขข้อ (เมื่อ brush = ng)
  const [showAgree, setShowAgree] = useState(false);

  const days = daysInMonth(month);
  const today = todayLocal();

  /* ── ไลน์ (scope มาตรฐาน: leader = ทั้งครอบครัวไลน์ตัวเอง · อื่น = ตาม sections) ── */
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('production_lines')
        .select('id, name, section, parent_line_name').order('name');
      setLines(data || []);
    })();
  }, []);

  const scopedLines = useMemo(() => {
    if (role === 'leader' && lineId) {
      const fam = getLineFamilyIds(lines, Number(lineId));
      return fam.size ? lines.filter(l => fam.has(l.id)) : lines;
    }
    // ⚠️ ต้องเทียบผ่าน inSectionScope (trim+lowercase) — `section` เป็น free text ที่พิมพ์มือได้
    //    `.includes()` ตรงตัวจะทำให้ 'PD1 ' / 'pd1' หลุด scope เงียบๆ (หัวหน้าเปิดมาแล้วไลน์ตัวเองหาย)
    if (sections.length) return lines.filter(l => inSectionScope(sections, l.section));
    return lines;
  }, [lines, role, lineId, sections]);

  // ค่าที่เลือกไว้หลุด scope (เปลี่ยนตัวแม่แล้วตัวลูกต้องล้าง — UI-CONVENTIONS §5.3)
  useEffect(() => {
    if (!scopedLines.length) return;
    if (!selLine || !scopedLines.some(l => String(l.id) === String(selLine))) {
      setSelLine(String(scopedLines[0].id));
    }
  }, [scopedLines, selLine]);

  const lineObj = useMemo(
    () => scopedLines.find(l => String(l.id) === String(selLine)) || null,
    [scopedLines, selLine],
  );

  /* ── ข้อตกลง + คนที่มีลายเซ็น (โหลดครั้งเดียว) ── */
  const loadStatic = useCallback(async () => {
    const [ag, pf] = await Promise.all([
      supabase.from('bbs_agreements').select('*').eq('is_active', true).order('seq'),
      supabase.from('profiles').select('id, full_name, position, signature_url')
        .not('signature_url', 'is', null),
    ]);
    if (ag.error) setLoadWarn(`โหลดข้อตกลงไม่สำเร็จ: ${ag.error.message}`);
    setAgreements(ag.data || []);
    setSigners(pf.data || []);
  }, []);
  useEffect(() => { loadStatic(); }, [loadStatic]);

  /* ── พนักงาน + ใบของเดือน/ไลน์/กะที่เลือก ── */
  const load = useCallback(async () => {
    if (!lineObj) return;
    setLoading(true); setLoadWarn('');
    try {
      const fam = getLineFamilyIds(lines, lineObj.id);
      let q = supabase.from('employees')
        .select('id, employee_id_code, name, position, line_id')
        .eq('is_active', true);
      q = fam.size ? q.in('line_id', [...fam]) : q.eq('line_id', lineObj.id);
      const { data: empData, error: empErr } = await q.order('employee_id_code');
      if (empErr) setLoadWarn(`โหลดรายชื่อพนักงานไม่สำเร็จ: ${empErr.message}`);
      setEmps(empData || []);

      const { data: sh, error: shErr } = await supabase.from('bbs_sheets').select('*')
        .eq('month_key', month).eq('line_name', lineObj.name).eq('shift', shift)
        .maybeSingle();
      if (shErr && shErr.code !== 'PGRST116') setLoadWarn(`โหลดหัวใบไม่สำเร็จ: ${shErr.message}`);
      setSheet(sh || null);

      if (sh) {
        const { data: obs, error: obErr } = await supabase.from('bbs_observations')
          .select('*').eq('sheet_id', sh.id);
        if (obErr) setLoadWarn(`โหลดผลสังเกตไม่สำเร็จ: ${obErr.message}`);
        const map = {};
        (obs || []).forEach(o => { map[cellKey(o.employee_id, o.day)] = o; });
        setCells(map);
      } else {
        setCells({});
      }
    } finally { setLoading(false); }
  }, [lineObj, lines, month, shift]);
  useEffect(() => { load(); }, [load]);

  /* ── หัวใบ: สร้างตอนบันทึกจริงเท่านั้น (ห้ามสร้างตอนเปิดดู) ── */
  const ensureSheet = useCallback(async () => {
    if (sheet) return sheet;
    if (!lineObj) return null;
    const me = signers.find(s => s.full_name === fullName);
    const payload = {
      month_key: month, line_name: lineObj.name, shift,
      section: lineObj.section || null,
      dept: lineObj.parent_line_name || null,
      inspector_name: fullName || null,
      inspector_sig_url: me?.signature_url || null,
      updated_by_name: fullName || null,
    };
    const { data, error } = await supabase.from('bbs_sheets')
      .upsert(payload, { onConflict: 'month_key,line_name,shift' }).select().single();
    if (error) {
      // ยังไม่ apply migration / RLS ปฏิเสธ — ต้องบอกให้ชัด ห้ามเงียบ
      toast.error(error.code === '42P01'
        ? 'ยังไม่ได้ apply migration ของ BBS — แจ้งผู้ดูแลระบบ'
        : `สร้างใบไม่สำเร็จ: ${error.message}`);
      return null;
    }
    setSheet(data);
    return data;
  }, [sheet, lineObj, month, shift, fullName, signers]);

  /* ── ทาช่อง ── */
  const paint = async (emp, day) => {
    if (!canRecord || busy) return;
    const sh = await ensureSheet();
    if (!sh) return;
    const key = cellKey(emp.id, day);
    const cur = cells[key];

    // คลิกซ้ำที่เดิมด้วยแปรงเดียวกัน = ล้างช่อง (ทางออกจากการทาผิด)
    const same = cur && cur.mark === brush
      && (brush !== 'ng' || cur.agreement_seq === brushSeq);
    if (same) {
      const { error } = await supabase.from('bbs_observations').delete().eq('id', cur.id);
      if (error) return toast.error(`ล้างช่องไม่สำเร็จ: ${error.message}`);
      setCells(c => { const n = { ...c }; delete n[key]; return n; });
      return;
    }

    const payload = {
      sheet_id: sh.id, employee_id: emp.id, day, mark: brush,
      agreement_seq: brush === 'ng' ? brushSeq : null,
      source: 'manual', note: null, updated_by_name: fullName || null,
    };
    const { data, error } = await supabase.from('bbs_observations')
      .upsert(payload, { onConflict: 'sheet_id,employee_id,day' }).select().single();
    if (error) return toast.error(`บันทึกไม่สำเร็จ: ${error.message}`);
    setCells(c => ({ ...c, [key]: data }));
  };

  /* ── เติมจากผลตรวจ PPE ──────────────────────────────────────────────────
     ⚠️ ครอบเฉพาะข้อที่ตั้ง auto_source ไว้ · ไม่ทับช่องที่คนกรอกเอง (source='manual')
        · ไม่มีแถว log = ไม่เติม · ไม่เติมวันในอนาคต */
  const autoAgreements = useMemo(() => agreements.filter(a => a.auto_source), [agreements]);
  const bySrc = useMemo(() => {
    const m = {};
    autoAgreements.forEach(a => { m[a.auto_source] = a.seq; });
    return m;
  }, [autoAgreements]);

  const autoFill = async () => {
    if (!canRecord || !lineObj) return;
    if (!autoAgreements.length) {
      return toast.error('ยังไม่มีข้อตกลงข้อไหนผูกกับผลตรวจ PPE — ตั้งที่ปุ่ม 📋 ข้อตกลง');
    }
    setBusy(true);
    try {
      const sh = await ensureSheet();
      if (!sh) return;

      const from = `${month}-01`;
      const to = `${month}-${String(days).padStart(2, '0')}`;
      let q = supabase.from('daily_production_logs')
        .select('employee_id, work_date, is_present, has_helmet, has_boots, has_gloves, shift')
        .gte('work_date', from).lte('work_date', to)
        .in('employee_id', emps.map(e => e.id));
      if (shift) q = q.eq('shift', shift);
      const { data: logs, error } = await q;
      if (error) { toast.error(`อ่านผลตรวจ PPE ไม่สำเร็จ: ${error.message}`); return; }

      const rows = []; let skipManual = 0;
      (logs || []).forEach(l => {
        if (l.work_date > today) return;                       // ไม่เติมวันอนาคต
        const day = Number(String(l.work_date).slice(8, 10));
        const key = cellKey(l.employee_id, day);
        if (cells[key]?.source === 'manual') { skipManual++; return; }  // ห้ามทับของที่คนกรอก
        const m = ppeToMark(l, bySrc);
        if (!m) return;
        rows.push({ sheet_id: sh.id, employee_id: l.employee_id, day, ...m, updated_by_name: fullName || null });
      });

      if (!rows.length) {
        toast.info(skipManual
          ? `ไม่มีอะไรให้เติม — ${skipManual} ช่องเป็นของที่กรอกเอง (ระบบไม่ทับ)`
          : 'ไม่มีข้อมูลการตรวจ PPE ของเดือน/ไลน์/กะนี้');
        return;
      }

      const { data, error: upErr } = await supabase.from('bbs_observations')
        .upsert(rows, { onConflict: 'sheet_id,employee_id,day' }).select();
      if (upErr) { toast.error(`เติมไม่สำเร็จ: ${upErr.message}`); return; }

      setCells(c => {
        const n = { ...c };
        (data || []).forEach(o => { n[cellKey(o.employee_id, o.day)] = o; });
        return n;
      });
      const ng = rows.filter(r => r.mark === 'ng').length;
      toast.success(`เติม ${data?.length ?? 0} ช่อง (พบไม่สวม PPE ${ng} ช่อง)`
        + (skipManual ? ` · ข้ามของที่กรอกเอง ${skipManual} ช่อง` : ''));
    } finally { setBusy(false); }
  };

  /* ── ผู้ตรวจสอบ + ลายเซ็น ── */
  const setInspector = async (profileId) => {
    if (!canRecord) return;
    const sh = await ensureSheet();
    if (!sh) return;
    const p = signers.find(s => s.id === profileId);
    const patch = {
      inspector_name: p?.full_name || null,
      inspector_sig_url: p?.signature_url || null,
      updated_by_name: fullName || null,
    };
    const { data, error } = await supabase.from('bbs_sheets')
      .update(patch).eq('id', sh.id).select('id');
    if (error) return toast.error(`บันทึกผู้ตรวจไม่สำเร็จ: ${error.message}`);
    if (!data?.length) return toast.error('บันทึกไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์แก้ใบนี้');
    setSheet(s => ({ ...s, ...patch }));
    toast.success('บันทึกผู้ตรวจสอบแล้ว');
  };

  const setInspectorCode = async (code) => {
    const sh = sheet; if (!sh) return;
    const { data, error } = await supabase.from('bbs_sheets')
      .update({ inspector_code: code || null, updated_by_name: fullName || null })
      .eq('id', sh.id).select('id');
    if (error || !data?.length) return toast.error('บันทึกรหัสพนักงานไม่สำเร็จ');
  };

  /* ── สรุปเดือน (นับเฉพาะช่องที่มีข้อมูล — ไม่เดาช่องว่าง) ── */
  const stat = useMemo(() => {
    const s = { ok: 0, ng: 0, fixed: 0, na: 0, auto: 0, manual: 0 };
    Object.values(cells).forEach(c => {
      s[c.mark] = (s[c.mark] || 0) + 1;
      if (c.source === 'ppe') s.auto++; else s.manual++;
    });
    return s;
  }, [cells]);

  const doPrint = async () => {
    if (!sheet) return toast.error('ยังไม่มีใบของเดือน/ไลน์นี้ — บันทึกอย่างน้อย 1 ช่องก่อน');
    const ok = await printBbsSheet({
      sheet, days, employees: emps, cells, agreements, autoCount: autoAgreements.length,
    });
    if (!ok) toast.error('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup ของเว็บนี้ก่อน');
  };

  const wrap = { padding: 'clamp(10px,2.5vw,18px) clamp(12px,3vw,24px)', maxWidth: 'min(98vw,2400px)', margin: '0 auto' };
  const lbl = { fontSize: 11, color: 'var(--muted)', fontWeight: 700, display: 'block', marginBottom: 3 };

  return (
    <div style={wrap}>
      <ReadOnlyNote show={!canRecord} role={role} what="บันทึกผลสังเกต BBS" permKey="bbs:record" />

      {loadWarn && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
          ⚠️ {loadWarn} — ตัวเลขบนหน้านี้อาจไม่ครบ
        </div>
      )}

      {/* ── แถบเลือกใบ ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div>
          <label style={lbl}>เดือน</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{ width: 150, padding: '7px 9px', fontSize: 13 }} />
        </div>
        <div>
          <label style={lbl}>พื้นที่ / ไลน์</label>
          <select value={selLine} onChange={e => setSelLine(e.target.value)}
            style={{ width: 230, padding: '7px 9px', fontSize: 13 }}>
            {toHierarchicalOptions(scopedLines).map(({ line: l, depth }) => (
              <option key={l.id} value={l.id}>{' '.repeat(depth * 3)}{l.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={lbl}>กะ</label>
          <select value={shift} onChange={e => setShift(e.target.value)}
            style={{ width: 120, padding: '7px 9px', fontSize: 13 }}>
            <option value="">ทั้งวัน</option>
            <option value="day">กะเช้า</option>
            <option value="night">กะดึก</option>
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowAgree(true)} style={btn()}>📋 ข้อตกลง ({agreements.length})</button>
        {canRecord && (
          <button onClick={autoFill} disabled={busy || !emps.length} style={btn('var(--accent)')}>
            {busy ? 'กำลังเติม…' : '⚡ เติมจากผลตรวจ PPE'}
          </button>
        )}
        <button onClick={doPrint} disabled={!sheet} style={btn()}>🖨️ พิมพ์ / PDF</button>
      </div>

      {/* ── ผู้ตรวจสอบ + ขอบเขตที่ระบบเติมได้ ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <label style={lbl}>ผู้ตรวจสอบ (ดึงลายเซ็นจากโปรไฟล์)</label>
            <select disabled={!canRecord} value={signers.find(s => s.full_name === sheet?.inspector_name)?.id || ''}
              onChange={e => setInspector(e.target.value)}
              style={{ width: 210, padding: '6px 8px', fontSize: 12.5 }}>
              <option value="">— เลือกผู้ตรวจสอบ —</option>
              {signers.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>รหัสพนักงาน</label>
            <input defaultValue={sheet?.inspector_code || ''} disabled={!canRecord || !sheet}
              onBlur={e => setInspectorCode(e.target.value.trim())}
              placeholder="เช่น 61234"
              style={{ width: 110, padding: '6px 8px', fontSize: 12.5 }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <label style={lbl}>ลายเซ็น</label>
            {sheet?.inspector_sig_url
              ? <img src={sheet.inspector_sig_url} alt="ลายเซ็น" style={{ height: 34, background: '#fff', borderRadius: 4, padding: 2 }} />
              : <div style={{ fontSize: 11, color: 'var(--muted)', padding: '9px 0' }}>
                  {signers.length ? 'ยังไม่เลือกผู้ตรวจ' : 'ยังไม่มีใครบันทึกลายเซ็นในโปรไฟล์'}
                </div>}
          </div>
        </div>

        {/* ⚠️ ขอบเขตของการเติมอัตโนมัติ — ห้ามถอด (กันใบอ้างเกินจริง) */}
        <div style={{
          background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8,
          padding: '8px 12px', fontSize: 12, lineHeight: 1.6, maxWidth: 420,
        }}>
          ⚡ <b>ระบบเติมให้ได้ {autoAgreements.length} ข้อ จากทั้งหมด {agreements.length} ข้อ</b>
          {autoAgreements.length > 0 && <> (ข้อ {autoAgreements.map(a => a.seq).join(', ')} — มาจากการตรวจ PPE รายวัน)</>}
          <div style={{ color: 'var(--text2)', marginTop: 2 }}>
            ข้อที่เหลือต้องให้ผู้ตรวจสังเกตเองแล้วทาในตาราง · ระบบ<b>ไม่ทับ</b>ช่องที่กรอกเอง
            และ<b>ไม่เติม</b>วันที่ไม่มีบันทึกเช็คชื่อ
          </div>
        </div>
      </div>

      {/* ── แปรง (เลือกสัญลักษณ์ แล้วคลิกช่องเพื่อทา) ── */}
      {canRecord && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>ทาช่องด้วย:</span>
          {MARKS.map(m => {
            const on = brush === m.key;
            return (
              <button key={m.key} onClick={() => setBrush(m.key)} title={m.label} style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${on ? m.color : 'var(--border2)'}`,
                background: on ? m.color : 'var(--bg3)', color: on ? '#fff' : 'var(--text2)',
              }}>
                <b style={{ fontSize: 14 }}>{m.key === 'ng' ? brushSeq : m.glyph}</b> {m.label.split(' (')[0]}
              </button>
            );
          })}
          {brush === 'ng' && (
            <select value={brushSeq} onChange={e => setBrushSeq(Number(e.target.value))}
              style={{ width: 240, padding: '6px 8px', fontSize: 12.5 }}>
              {agreements.length
                ? agreements.map(a => <option key={a.seq} value={a.seq}>{a.seq}. {a.text}</option>)
                : <option value={1}>1. (ยังไม่ได้บันทึกข้อตกลง)</option>}
            </select>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>คลิกช่องเดิมซ้ำด้วยแปรงเดิม = ล้างช่อง</span>
        </div>
      )}

      {/* ── ตาราง ── */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : !emps.length ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border2)', borderRadius: 8 }}>
          ไม่มีพนักงานในไลน์นี้ — ตรวจที่หน้าฐานข้อมูลพนักงานว่าผูก “ไลน์” ไว้แล้วหรือยัง
        </div>
      ) : (
        // จอแคบเลื่อนแนวนอน (ตาราง 31 คอลัมน์ — ข้อยกเว้นตาม UI-CONVENTIONS §6)
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="table-sticky" style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th(190, 'left')}>พนักงาน</th>
                {Array.from({ length: days }, (_, i) => i + 1).map(d => (
                  <th key={d} style={{ ...th(26), color: `${month}-${String(d).padStart(2, '0')}` === today ? 'var(--accent)' : undefined }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {emps.map((e, i) => (
                <tr key={e.id}>
                  <td style={{ ...td(), textAlign: 'left', whiteSpace: 'nowrap', paddingLeft: 6 }}>
                    <span style={{ color: 'var(--muted)', marginRight: 5 }}>{i + 1}</span>
                    <b style={{ fontSize: 11 }}>{e.employee_id_code}</b> {e.name}
                  </td>
                  {Array.from({ length: days }, (_, k) => k + 1).map(d => {
                    const c = cells[cellKey(e.id, d)];
                    return (
                      <td key={d} onClick={() => paint(e, d)}
                        title={c ? `${MARK_BY_KEY[c.mark]?.label || c.mark}${c.agreement_seq ? ` (ข้อ ${c.agreement_seq})` : ''}`
                          + `\n${c.source === 'ppe' ? 'เติมอัตโนมัติจากผลตรวจ PPE' : 'กรอกเอง'}${c.note ? `\n${c.note}` : ''}` : ''}
                        style={{
                          ...td(), cursor: canRecord ? 'pointer' : 'default',
                          color: markColor(c), fontWeight: 700,
                          // ช่องที่ระบบเติมให้ = พื้นจาง ๆ แยกจากที่คนกรอกเอง (โปร่งใส ห้ามกลืนกัน)
                          background: c?.source === 'ppe' ? 'rgba(34,197,94,0.07)' : undefined,
                        }}>{markGlyph(c)}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── สรุป + legend ── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 12, alignItems: 'center' }}>
        {MARKS.map(m => (
          <span key={m.key} style={{ color: 'var(--text2)' }}>
            <b style={{ color: m.color, fontSize: 14 }}>{m.key === 'ng' ? '1-13' : m.glyph}</b> {m.label}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--muted)' }}>
          เดือนนี้: ✓ {stat.ok} · ไม่เหมาะสม {stat.ng} · ปรับแก้ {stat.fixed} · ไม่ได้ตรวจ {stat.na}
          {' · '}เติมอัตโนมัติ {stat.auto} / กรอกเอง {stat.manual} ช่อง
        </span>
      </div>

      {showAgree && (
        <AgreementsModal agreements={agreements} canManage={canManage} role={role}
          onClose={() => { setShowAgree(false); loadStatic(); }} />
      )}
    </div>
  );
}

const btn = (accent) => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${accent || 'var(--border2)'}`,
  background: accent ? 'var(--accent-dim)' : 'var(--bg3)', color: accent || 'var(--text2)',
});
const th = (w, align) => ({
  border: '1px solid var(--border)', background: 'var(--bg3)', padding: '5px 2px',
  fontSize: 11, width: w, minWidth: w, textAlign: align || 'center',
});
const td = () => ({
  border: '1px solid var(--border)', padding: '3px 2px', textAlign: 'center', height: 26,
});

/* ── จัดการข้อตกลง 13 ข้อ ────────────────────────────────────────────────────
   ข้อความ 13 ข้อในไฟล์ Excel ต้นฉบับฝังเป็น OLE object แกะไม่ได้ → ให้กรอกเองที่นี่
   (ดีกว่า hardcode อยู่แล้ว — โรงงาน/แผนกอื่นข้อไม่เหมือนกัน) */
const AUTO_OPTS = [
  { v: '', t: '— ไม่มีข้อมูลในระบบ (ผู้ตรวจสังเกตเอง) —' },
  { v: 'helmet', t: 'หมวกนิรภัย (จากการตรวจ PPE)' },
  { v: 'boots', t: 'รองเท้านิรภัย (จากการตรวจ PPE)' },
  { v: 'gloves', t: 'ถุงมือนิรภัย (จากการตรวจ PPE)' },
];

function AgreementsModal({ agreements, canManage, role, onClose }) {
  const [rows, setRows] = useState(agreements);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setRows(agreements); }, [agreements]);

  const nextSeq = () => (rows.length ? Math.max(...rows.map(r => r.seq)) + 1 : 1);
  const add = () => setRows(r => [...r, { _new: true, seq: nextSeq(), text: '', auto_source: null, is_active: true }]);
  const patch = (i, p) => setRows(r => r.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const save = async () => {
    setSaving(true);
    try {
      const bad = rows.filter(r => !String(r.text || '').trim());
      if (bad.length) { toast.error('มีข้อที่ยังไม่ได้พิมพ์ข้อความ'); return; }
      const seqs = rows.map(r => r.seq);
      if (new Set(seqs).size !== seqs.length) { toast.error('เลขข้อซ้ำกัน'); return; }

      const up = rows.map(({ _new, ...r }) => ({
        ...(r.id ? { id: r.id } : {}),
        seq: r.seq, text: String(r.text).trim(), auto_source: r.auto_source || null, is_active: true,
      }));
      const { error } = await supabase.from('bbs_agreements').upsert(up).select('id');
      if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }

      // ข้อที่ถูกลบออกจากลิสต์ = ปิดใช้งาน (soft delete — ใบเก่าที่อ้างเลขข้อต้องยังอ่านออก)
      const keep = new Set(up.filter(u => u.id).map(u => u.id));
      const gone = agreements.filter(a => !keep.has(a.id));
      if (gone.length) {
        await supabase.from('bbs_agreements').update({ is_active: false })
          .in('id', gone.map(g => g.id));
      }
      toast.success('บันทึกข้อตกลงแล้ว');
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, width: 'min(760px,96vw)', maxHeight: '88vh', overflow: 'auto', padding: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>📋 ข้อตกลงด้านความปลอดภัยในการปฏิบัติงาน</h3>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          เลขข้อนี้คือตัวเลขที่พิมพ์ลงช่องในใบเมื่อพบพฤติกรรมไม่เหมาะสม ·
          ข้อที่ผูกกับ “การตรวจ PPE” ระบบจะเติมช่องให้อัตโนมัติได้
        </p>

        <ReadOnlyNote show={!canManage} role={role} compact
          what="แก้ข้อตกลงด้านความปลอดภัย" permKey="bbs:manage" />

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr>
            <th style={{ ...th(46), textAlign: 'center' }}>ข้อ</th>
            <th style={{ ...th(null, 'left'), paddingLeft: 6 }}>สิ่งที่ควรทำ</th>
            <th style={{ ...th(210, 'left'), paddingLeft: 6 }}>เติมอัตโนมัติจาก</th>
            {canManage && <th style={th(40)} />}
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || `n${i}`}>
                <td style={td()}>
                  <input type="number" value={r.seq} disabled={!canManage}
                    onChange={e => patch(i, { seq: Number(e.target.value) })}
                    style={{ width: 40, padding: '4px', fontSize: 12, textAlign: 'center' }} />
                </td>
                <td style={{ ...td(), textAlign: 'left' }}>
                  <input value={r.text || ''} disabled={!canManage}
                    onChange={e => patch(i, { text: e.target.value })}
                    placeholder="เช่น สวมใส่อุปกรณ์ป้องกันเสียงในพื้นที่กำหนด"
                    style={{ width: '100%', padding: '5px 7px', fontSize: 12.5 }} />
                </td>
                <td style={{ ...td(), textAlign: 'left' }}>
                  <select value={r.auto_source || ''} disabled={!canManage}
                    onChange={e => patch(i, { auto_source: e.target.value || null })}
                    style={{ width: '100%', padding: '5px 7px', fontSize: 12 }}>
                    {AUTO_OPTS.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
                  </select>
                </td>
                {canManage && (
                  <td style={td()}>
                    <button onClick={() => setRows(rr => rr.filter((_, k) => k !== i))}
                      title="เอาออก (ปิดใช้งาน — ใบเก่ายังอ่านออก)"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14 }}>🗑</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {!rows.length && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
            ยังไม่มีข้อตกลง — กด “＋ เพิ่มข้อ” แล้วพิมพ์ตามใบของแผนก
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          {canManage && <button onClick={add} style={btn()}>＋ เพิ่มข้อ</button>}
          <button onClick={onClose} style={btn()}>ปิด</button>
          {canManage && (
            <button onClick={save} disabled={saving} style={btn('var(--accent)')}>
              {saving ? 'กำลังบันทึก…' : '💾 บันทึก'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
