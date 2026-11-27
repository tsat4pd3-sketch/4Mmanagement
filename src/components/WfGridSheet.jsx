/* ═══════════════════════════════════════════════════════════════════════════════
   🧩 ใบตรวจแบบตาราง (คน × วัน) — จอเดียวของทุกใบที่ออกแบบใน /workflow-designer (2026-11-26)
   คำสั่ง user: "สร้างใบตรวจแบบตารางได้ทุกแบบ · ไม่อยากให้มีฟอร์มที่เขียนด้วยโค้ดสด · ผ่าน e-workflow ให้หมดเพื่อคุมเอกสาร"

   · หน้าตา/สัญลักษณ์/หัวข้อ/สิทธิ์/ตัวเติม/แจ้งเตือน = จากช่อง `checkgrid` ของใบงาน (ไม่มีอะไร hardcode ที่นี่)
   · สายเซ็น = ขั้นของใบงานเดียวกัน (`<WfRoundPanel defKey>`) · มีคนเซ็นแล้ว = ล็อก (DB trigger `wf_grid_lock` · จอบอกก่อนกด)
   · ชั้นสิทธิ์: ② `recordPerm` ของฟอร์ม · ③ `canWriteLine` (ใบของไลน์นี้เป็นของหน่วยงานเราไหม) — เช็คซ้ำตอนเขียนจริง
   · stale guard: ใบที่โชว์ ≠ ไลน์/เดือนที่เลือก = ห้ามเขียน (กฎเขียน DB ข้อ 4)
   · อ่านไม่ได้ = เขียนบนจอ ห้ามโชว์ตารางว่างเหมือน "ยังไม่กรอก"
   ═══════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { usePerms } from '../utils/usePerms';
import { toast } from './Toast';
import NoticeBar from './NoticeBar';
import PageHeader from './PageHeader';
import WfRoundPanel from './WfRoundPanel';
import { fetchAllPages } from '../utils/fetchByIds';
import { getLineFamilyIds, getLineFamilyNames } from '../utils/lineHierarchy';
import { canWriteLine, writeBlockText } from '../utils/writeScope';
import { loadRunDays, ranOn } from '../utils/runDays';
import { loadCompanyCalendar } from '../utils/companyCalendar';
import { checkDayState, CHECK_DAY } from '../utils/dailyCheckDay';
import { getWorkDate } from '../utils/workDate';
import useIsMobile from '../utils/useIsMobile';
import { askConfirm } from '../utils/askConfirm';
import { notifyEvent } from '../utils/notifyEvent';
import { gridOf, markOf, cellGlyph, colorOf, daysOfMonth, ppeToGridCell, autofillOf, gridTally } from '../utils/checkGrid';
import { loadRoundSignoff } from '../lib/wfSignoff';
import { printGridSheet } from '../lib/gridPrint';
import { tr } from '../utils/i18n';

const ck = (row, col) => `${row}|${col}`;
const pad = (n) => String(n).padStart(2, '0');

/**
 * @param defKey  ใบงาน (wf_defs.key) ที่มีช่อง checkgrid · เช่น 'bbs_grid'
 * @param lineObj ไลน์ที่เลือก (แถวทะเบียนไลน์) · @param lines ทะเบียนไลน์ทั้งหมด (หาไลน์ลูก)
 * @param month   'YYYY-MM' (รอบรายเดือน)
 * @param filters แถบกรองของหน้าแม่ (ไลน์/เดือน) — วางใต้หัวเพจตามลำดับมาตรฐาน
 * @param title/icon หัวเพจ
 */
export default function WfGridSheet({ defKey, lineObj, lines = [], month, filters = null, title, icon }) {
  const { role, sections = [], fullName, section: homeSection, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  const { can } = usePerms();
  const isMobile = useIsMobile();

  /* ── นิยามใบงาน ── */
  const [def, setDef] = useState(null);       // { id, name, form }
  const [defErr, setDefErr] = useState('');
  useEffect(() => {
    let alive = true;
    supabase.from('wf_defs').select('id, key, name, status, wf_versions!wf_defs_current_version_fk(form_schema, flow_schema)')
      .eq('key', defKey).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setDefErr(error.message); return; }
        if (!data || data.status !== 'active') { setDefErr(tr('ใบงานนี้ยังไม่เปิดใช้ (ตรวจที่หน้าออกแบบใบงาน)')); return; }
        setDef({ id: data.id, name: data.name, form: data.wf_versions?.form_schema, flow: data.wf_versions?.flow_schema });
      });
    return () => { alive = false; };
  }, [defKey]);
  const cfg = useMemo(() => gridOf(def?.form), [def]);
  const marks = cfg?.marks || [];
  const items = cfg?.items || [];
  const [perm1, perm2] = String(cfg?.recordPerm || ':').split(':');
  const canRecord = !!cfg?.recordPerm && can(perm1, perm2);
  const af = cfg?.autofill ? autofillOf(cfg.autofill) : null;
  const autoItems = items.filter(it => it.auto);

  const days = daysOfMonth(month);
  const from = `${month}-01`, to = `${month}-${pad(days)}`;
  const today = getWorkDate();

  /* ── ข้อมูลใบ ── */
  const [emps, setEmps] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [cells, setCells] = useState({});
  const [notes, setNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadWarn, setLoadWarn] = useState('');
  const [busy, setBusy] = useState(false);
  const viewKey = `${defKey}|${lineObj?.name || ''}|${month}`;
  const viewRef = useRef(viewKey);
  viewRef.current = viewKey;
  const matches = (s) => !!s && `${s.def_key}|${s.line_name}|${String(s.period_from).slice(0, 7)}` === viewRef.current;

  const load = useCallback(async () => {
    if (!lineObj || !days) return;
    const my = `${defKey}|${lineObj.name}|${month}`;
    setLoading(true); setLoadWarn('');
    try {
      const fam = getLineFamilyIds(lines, lineObj.id);
      let q = supabase.from('employees').select('id, employee_id_code, name, line_id').eq('is_active', true);
      q = fam.size ? q.in('line_id', [...fam]) : q.eq('line_id', lineObj.id);
      const { data: e, error: eErr } = await q.order('employee_id_code');
      if (viewRef.current !== my) return;
      if (eErr) setLoadWarn(`${tr('โหลดรายชื่อพนักงานไม่สำเร็จ')}: ${eErr.message}`);
      setEmps(e || []);
      const { data: sh, error: sErr } = await supabase.from('wf_grid_sheets').select('*')
        .eq('def_key', defKey).eq('line_name', lineObj.name).eq('period_from', `${month}-01`).maybeSingle();
      if (viewRef.current !== my) return;
      if (sErr) { setLoadWarn(`${tr('โหลดหัวใบไม่สำเร็จ')}: ${sErr.message}`); setSheet(null); setCells({}); setNotes({}); return; }
      setSheet(sh || null);
      if (!sh) { setCells({}); setNotes({}); return; }
      const cRes = await fetchAllPages(() => supabase.from('wf_grid_cells')
        .select('id, row_key, col, mark, item_seq, note, source').eq('sheet_id', sh.id), { orderBy: ['col', 'row_key'] });
      const nRes = await supabase.from('wf_grid_row_notes').select('row_key, note').eq('sheet_id', sh.id);
      if (viewRef.current !== my) return;
      if (cRes.error) setLoadWarn(`${tr('โหลดผลตรวจไม่สำเร็จ')}: ${cRes.error}`);
      else if (cRes.truncated) setLoadWarn(tr('ผลตรวจของใบนี้เยอะเกินกว่าจะโหลดครบ — ช่องที่ว่างอาจมีข้อมูลอยู่จริง'));
      if (nRes.error) setLoadWarn(`${tr('โหลดหมายเหตุไม่สำเร็จ')}: ${nRes.error.message}`);
      const m = {}; (cRes.rows || []).forEach(c => { m[ck(c.row_key, c.col)] = c; });
      const n = {}; (nRes.data || []).forEach(r => { n[r.row_key] = r.note || ''; });
      setCells(m); setNotes(n);
    } finally { if (viewRef.current === my) setLoading(false); }
  }, [defKey, lineObj, lines, month, days]);
  useEffect(() => { load(); }, [load]);

  /* ── ล็อก (มีคนเซ็นแล้ว) ── */
  const [lock, setLock] = useState(null);
  const [lockTick, setLockTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLock(null);
    if (!lineObj?.name) return undefined;
    supabase.rpc('wf_grid_locked', { p_def_key: defKey, p_line: lineObj.name, p_from: `${month}-01` })
      .then(({ data, error }) => { if (alive && !error) setLock(typeof data === 'string' && data ? data : null); });
    return () => { alive = false; };
  }, [defKey, lineObj?.name, month, lockTick]);

  /* ── ด่านเขียน (ชั้น ③ + ล็อก + stale) — ทุกขาเขียนผ่าน ensureSheet ── */
  const wCtx = { role, section: homeSection, sections, allUnits, respCostCenters, scopeIdx };
  const lineWrite = canWriteLine(wCtx, lineObj?.name, lines);
  const ensureSheet = async () => {
    if (!canRecord) { toast.error(`${tr('ไม่มีสิทธิ์บันทึก')} (${cfg?.recordPerm || '-'})`); return null; }
    if (!lineWrite.ok) { toast.error(writeBlockText(lineWrite, { what: `${def?.name || ''} ${lineObj?.name || ''}`, unit: lineObj?.section || '' })); return null; }
    if (lock) { toast.error(`${tr('ใบนี้เซ็นแล้ว')} (${lock}) — ${tr('ให้ผู้เซ็นตีกลับ/เพิกถอนก่อนแก้')}`); return null; }
    if (matches(sheet)) return sheet;
    if (sheet) { toast.error(tr('ใบที่แสดงไม่ตรงกับไลน์/เดือนที่เลือก — รอโหลดใหม่แล้วกดอีกครั้ง')); return null; }
    const { data, error } = await supabase.from('wf_grid_sheets').upsert({
      def_key: defKey, line_name: lineObj.name, section: lineObj.section || null,
      period_from: from, period_to: to, updated_by_name: fullName || null,
    }, { onConflict: 'def_key,line_name,period_from' }).select().single();
    if (error) { toast.error(`${tr('สร้างใบไม่สำเร็จ')}: ${error.message}`); return null; }
    if (!matches(data)) return null;
    setSheet(data);
    return data;
  };

  /* ── แจ้งเตือน (สัญลักษณ์ที่ติ๊ก alert · ผู้รับตามทะเบียน notification_rules ของ alertEvent) ── */
  const notifyAlert = (list) => {
    if (!cfg?.alertEvent || !list.length || !lineObj?.name) return;
    const itText = (seq) => items.find(i => i.seq === seq)?.text || '';
    notifyEvent({
      event: cfg.alertEvent, type: 'error', ref_table: 'wf_grid_sheets', line_name: lineObj.name, actor: fullName,
      link: '/daily-checker?tab=bbs',
      title: `${def?.name || ''} — ${tr('พบ')} ${list.length} ${tr('ช่อง')} · ${lineObj.name}`,
      lines: [`🏭 ${tr('ไลน์')}: ${lineObj.name} · 📅 ${month}`,
        ...list.slice(0, 8).map(it => `  • ${it.name || '-'} (${tr('วันที่')} ${it.day}) — ${it.seq != null ? `${tr('ข้อ')} ${it.seq} ${itText(it.seq)}` : it.label}`.trim()),
        list.length > 8 ? `  • …${tr('และอีก')} ${list.length - 8} ${tr('ช่อง')}` : ''],
    });
  };

  /* ── ทาช่อง ── */
  const [brush, setBrush] = useState(null);
  const [brushSeq, setBrushSeq] = useState(null);
  const curBrush = brush || marks[0]?.key || null;
  const curSeq = brushSeq ?? items[0]?.seq ?? null;
  const paint = async (emp, day, markKey, seqOverride) => {
    if (busy) return;
    const mk = markKey || curBrush;
    const m = markOf(cfg, mk);
    if (!m) return;
    const seq = m.needsItem ? (seqOverride ?? curSeq) : null;
    if (m.needsItem && seq == null) { toast.error(tr('ยังไม่มีหัวข้อให้เลือก — ตั้งที่หน้าออกแบบใบงาน')); return; }
    const sh = await ensureSheet();
    if (!sh) return;
    const key = ck(emp.id, day);
    const cur = cells[key];
    if (cur && cur.mark === mk && (!m.needsItem || cur.item_seq === seq)) {
      if (isMobile && !await askConfirm(tr('ล้างเครื่องหมายช่องนี้?'))) return;
      const { data, error } = await supabase.from('wf_grid_cells').delete().eq('id', cur.id).select('id');
      if (error || !data?.length) { toast.error(`${tr('ล้างช่องไม่สำเร็จ')}: ${error?.message || tr('ไม่มีสิทธิ์')}`); return; }
      setCells(c => { const n = { ...c }; delete n[key]; return n; });
      return;
    }
    const { data, error } = await supabase.from('wf_grid_cells').upsert({
      sheet_id: sh.id, row_key: emp.id, col: day, mark: mk, item_seq: seq, source: 'manual', note: null, updated_by_name: fullName || null,
    }, { onConflict: 'sheet_id,row_key,col' }).select('id, row_key, col, mark, item_seq, note, source').single();
    if (error) { toast.error(`${tr('บันทึกไม่สำเร็จ')}: ${error.message}`); return; }
    setCells(c => ({ ...c, [key]: data }));
    if (m.alert && !(cur?.mark === mk && cur?.item_seq === seq)) notifyAlert([{ name: emp.name, day, seq, label: m.label }]);
  };

  const saveNote = async (empId, text) => {
    const cur = notes[empId] || '';
    if (cur === text) return;
    const sh = await ensureSheet();
    if (!sh) return;
    setNotes(n => ({ ...n, [empId]: text }));
    const { error } = await supabase.from('wf_grid_row_notes').upsert(
      { sheet_id: sh.id, row_key: empId, note: text || null, updated_by_name: fullName || null }, { onConflict: 'sheet_id,row_key' });
    if (error) { setNotes(n => ({ ...n, [empId]: cur })); toast.error(`${tr('บันทึกหมายเหตุไม่สำเร็จ')}: ${error.message}`); }
  };

  /* ── เติมอัตโนมัติ (ตัวเติมที่ลงทะเบียน · ไม่ทับของที่กรอกเอง · ไม่มีข้อมูล = ไม่เติม · ไม่เติมวันอนาคต) ── */
  const autoFill = async () => {
    if (!af || !lineObj) return;
    if (!autoItems.length) { toast.error(tr('ยังไม่มีหัวข้อที่ผูกกับตัวเติมอัตโนมัติ — ตั้งที่หน้าออกแบบใบงาน')); return; }
    setBusy(true);
    try {
      const sh = await ensureSheet();
      if (!sh) return;
      const lp = await fetchAllPages(() => supabase.from('daily_production_logs')
        .select('employee_id, work_date, is_present, has_helmet, has_boots, has_gloves')
        .gte('work_date', from).lte('work_date', to).in('employee_id', emps.map(e => e.id)), { orderBy: ['work_date', 'employee_id'] });
      if (lp.error) { toast.error(`${tr('อ่านข้อมูลต้นทางไม่สำเร็จ')}: ${lp.error}`); return; }
      if (lp.truncated) { toast.error(tr('ข้อมูลต้นทางเยอะเกินกว่าจะโหลดครบ — ยังเติมอัตโนมัติไม่ได้')); return; }
      const rows = []; let skipManual = 0;
      lp.rows.forEach(l => {
        if (l.work_date > today) return;
        const day = Number(String(l.work_date).slice(8, 10));
        const key = ck(l.employee_id, day);
        if (cells[key] && cells[key].source === 'manual') { skipManual += 1; return; }
        const c = ppeToGridCell(l, cfg);
        if (!c) return;
        rows.push({ sheet_id: sh.id, row_key: l.employee_id, col: day, ...c, updated_by_name: fullName || null });
      });
      if (!rows.length) { toast.info(skipManual ? `${tr('ไม่มีอะไรให้เติม')} — ${skipManual} ${tr('ช่องเป็นของที่กรอกเอง (ระบบไม่ทับ)')}` : tr('ไม่มีข้อมูลต้นทางของเดือน/ไลน์นี้')); return; }
      const { data, error } = await supabase.from('wf_grid_cells').upsert(rows, { onConflict: 'sheet_id,row_key,col' })
        .select('id, row_key, col, mark, item_seq, note, source');
      if (error) { toast.error(`${tr('เติมไม่สำเร็จ')}: ${error.message}`); return; }
      const name = (id) => emps.find(e => e.id === id)?.name;
      const fresh = rows.filter(r => markOf(cfg, r.mark)?.alert && cells[ck(r.row_key, r.col)]?.mark !== r.mark);
      notifyAlert(fresh.map(r => ({ name: name(r.row_key), day: r.col, seq: r.item_seq, label: markOf(cfg, r.mark)?.label })));
      setCells(c => { const n = { ...c }; (data || []).forEach(o => { n[ck(o.row_key, o.col)] = o; }); return n; });
      toast.success(`${tr('เติม')} ${data?.length ?? 0} ${tr('ช่อง')}${skipManual ? ` · ${tr('ข้ามของที่กรอกเอง')} ${skipManual}` : ''}`);
    } finally { setBusy(false); }
  };

  /* ── สรุป + ตัวหาร (วันที่ผ่านมา × คน · ไม่นับวันหยุด/ไลน์ไม่เดิน · ไม่รู้ = เขียนบนจอ) ── */
  const [runs, setRuns] = useState(null);
  const [cal, setCal] = useState(null);
  const famKey = useMemo(() => (lineObj ? getLineFamilyNames(lines, lineObj.name).join('|') : ''), [lines, lineObj]);
  useEffect(() => { let a = true; loadCompanyCalendar().then(m => { if (a) setCal(m); }); return () => { a = false; }; }, []);
  useEffect(() => {
    if (!famKey || !days) { setRuns(null); return undefined; }
    let a = true; setRuns(null);
    loadRunDays({ lineNames: famKey.split('|'), from, to }).then(r => { if (a) setRuns(r); });
    return () => { a = false; };
  }, [famKey, from, to, days]);
  const stat = useMemo(() => {
    const t = gridTally(cfg, cells);
    const elapsed = today.slice(0, 7) === month ? Math.min(days, Number(today.slice(8, 10))) : (month < today.slice(0, 7) ? days : 0);
    const withCell = new Set(Object.values(cells).map(c => c.col));
    const isOff = (ds) => { const ty = cal?.get(ds); if (ty) return ty !== 'working'; const w = new Date(`${ds}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };
    const due = new Set(); let off = 0, noRun = 0, unk = 0;
    for (let d = 1; d <= elapsed; d += 1) {
      const ds = `${month}-${pad(d)}`;
      const st = checkDayState({ hasResult: withCell.has(d), isOff: isOff(ds), ran: ranOn(runs, ds) });
      if (st === CHECK_DAY.done || st === CHECK_DAY.missed) due.add(d);
      else if (st === CHECK_DAY.off) off += 1; else if (st === CHECK_DAY.no_run) noRun += 1; else if (st === CHECK_DAY.unknown) unk += 1;
    }
    const filled = Object.values(cells).filter(c => due.has(c.col)).length;
    return { ...t, due: due.size * emps.length, filled, elapsed, off, noRun, unk, runsFailed: runs != null && runs.days == null };
  }, [cfg, cells, month, days, today, cal, runs, emps.length]);

  /* ── พิมพ์ ── */
  const doPrint = async () => {
    if (!sheet) { toast.error(tr('ยังไม่มีใบของเดือน/ไลน์นี้ — บันทึกอย่างน้อย 1 ช่องก่อน')); return; }
    const so = await loadRoundSignoff(supabase, { subject: 'grid', defKey, line: lineObj.name, date: from });
    if (so?.error) toast.error(`${tr('อ่านลายเซ็นตามสายเซ็นไม่สำเร็จ — ใบจะเว้นช่องเซ็น')}: ${so.error}`);
    const ok = await printGridSheet({ defName: def?.name, cfg, sheet, month, days, employees: emps, cells, notes,
      signoff: so && !so.error ? so : null, autoSourceLabel: af?.label || '' });
    if (!ok) toast.error(tr('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — อนุญาต popup ของเว็บนี้ก่อน'));
  };

  /* ── หน้าตา ── */
  const glyphColor = (c) => (c ? colorOf(markOf(cfg, c.mark)?.color).css : undefined);
  const header = (
    <PageHeader title={title || def?.name || tr('ใบตรวจแบบตาราง')} icon={icon}
      actions={<>
        {canRecord && af && <button type="button" className="pg-btn primary" onClick={autoFill} disabled={busy || !emps.length || !!lock}>
          {busy ? tr('กำลังเติม…') : `${tr('เติมจาก')}${af.label.split(' (')[0]}`}</button>}
        <button type="button" className="pg-btn" onClick={doPrint} disabled={!sheet}>{tr('พิมพ์ / PDF')}</button>
      </>} />
  );
  if (defErr || (def && !cfg)) {
    return <>{header}{filters}<NoticeBar tone="bad">{defErr || tr('ใบงานนี้ไม่มีช่อง "ตารางตรวจ" — ตั้งที่หน้าออกแบบใบงาน')}</NoticeBar></>;
  }
  const th = (w, al) => ({ border: '1px solid var(--border)', background: 'var(--bg3)', padding: '5px 2px', fontSize: 11, width: w, minWidth: w, textAlign: al || 'center' });
  const td = { border: '1px solid var(--border)', padding: '3px 2px', textAlign: 'center', height: 26 };
  return (
    <>
      {header}
      {filters}
      {canRecord && lineObj && !lineWrite.ok && <NoticeBar tone="warn" style={{ marginBottom: 12 }}>🔒 {writeBlockText(lineWrite, { what: `${def?.name || ''} ${lineObj.name}`, unit: lineObj.section || '' })}</NoticeBar>}
      {loadWarn && <NoticeBar tone="bad" style={{ marginBottom: 12 }}>{loadWarn} {tr('— ตัวเลขบนหน้านี้อาจไม่ครบ')}</NoticeBar>}
      <WfRoundPanel subject="grid" defKey={defKey} line={lineObj?.name || ''} date={from}
        hasData={sheet ? Object.keys(cells).length > 0 : false} openOnlyWithData
        summary={`${emps.length} ${tr('คน')} · ${Object.values(cells).filter(c => markOf(cfg, c.mark)?.alert).length} ${tr('ช่องที่ต้องแจ้ง')}`}
        onChanged={() => setLockTick(x => x + 1)} />
      {lock && <NoticeBar tone="info" icon="🔒" style={{ marginBottom: 12 }}>{tr('ใบนี้เซ็นแล้ว')} ({lock}) — {tr('แก้ไม่ได้จนกว่าผู้เซ็นจะตีกลับ/เพิกถอน')}</NoticeBar>}
      {!canRecord && cfg && <NoticeBar tone="info" style={{ marginBottom: 12 }}>{tr('ดูอย่างเดียว — บันทึกต้องมีสิทธิ์')} {cfg.recordPerm}</NoticeBar>}

      {af && (
        <div style={{ background: 'var(--amber-dim)', border: '1px solid var(--amber)', borderRadius: 'var(--r-md)', padding: '8px 12px', fontSize: 12, lineHeight: 1.6, maxWidth: 520, marginBottom: 10 }}>
          <b>{tr('ระบบเติมให้ได้')} {autoItems.length} {tr('ข้อ จากทั้งหมด')} {items.length} {tr('ข้อ')}</b>
          {autoItems.length > 0 && <> ({tr('ข้อ')} {autoItems.map(i => i.seq).join(', ')} — {af.label})</>}
          <div style={{ color: 'var(--text2)' }}>{tr('ข้อที่เหลือต้องสังเกตเองแล้วทาในตาราง · ระบบไม่ทับช่องที่กรอกเอง และไม่เติมวันที่ไม่มีข้อมูลต้นทาง')}</div>
        </div>
      )}

      {canRecord && !isMobile && !lock && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{tr('ทาช่องด้วย:')}</span>
          {marks.map(m => {
            const on = curBrush === m.key; const c = colorOf(m.color);
            return (
              <button key={m.key} type="button" onClick={() => setBrush(m.key)} title={m.label} style={{
                padding: '6px 12px', borderRadius: 'var(--r-md)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${on ? c.css : 'var(--border2)'}`, background: on ? c.dim : 'var(--bg3)', color: on ? c.css : 'var(--text2)' }}>
                <b style={{ fontSize: 14 }}>{m.needsItem ? (curSeq ?? '#') : m.glyph}</b> {m.label.split(' (')[0]}
              </button>
            );
          })}
          {markOf(cfg, curBrush)?.needsItem && (
            <select value={curSeq ?? ''} onChange={e => setBrushSeq(Number(e.target.value))} style={{ width: 260 }}>
              {items.map(i => <option key={i.seq} value={i.seq}>{i.seq}. {i.text}</option>)}
            </select>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr('คลิกช่องเดิมซ้ำด้วยแปรงเดิม = ล้างช่อง')}</span>
        </div>
      )}

      {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{tr('กำลังโหลด...')}</div>
        : !emps.length ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border2)', borderRadius: 'var(--r-md)' }}>{tr('ไม่มีพนักงานในไลน์นี้ — ตรวจที่หน้าฐานข้อมูลพนักงานว่าผูก “ไลน์” ไว้แล้วหรือยัง')}</div>
        : isMobile ? <MobileDay {...{ cfg, marks, items, emps, cells, days, month, today, canRecord: canRecord && !lock, paint }} />
        : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
            <table className="table-sticky" style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
              <thead><tr>
                <th style={th(190, 'left')}>{tr('พนักงาน')}</th>
                {Array.from({ length: days }, (_, i) => i + 1).map(d => <th key={d} style={{ ...th(26), color: `${month}-${pad(d)}` === today ? 'var(--accent)' : undefined }}>{d}</th>)}
                {cfg?.rowNote && <th style={th(150, 'left')}>{tr('หมายเหตุ')}</th>}
              </tr></thead>
              <tbody>
                {emps.map((e, i) => (
                  <tr key={e.id}>
                    <td style={{ ...td, textAlign: 'left', whiteSpace: 'nowrap', paddingLeft: 6 }}>
                      <span style={{ color: 'var(--muted)', marginRight: 5 }}>{i + 1}</span><b style={{ fontSize: 11 }}>{e.employee_id_code}</b> {e.name}
                    </td>
                    {Array.from({ length: days }, (_, k) => k + 1).map(d => {
                      const c = cells[ck(e.id, d)];
                      const m = c ? markOf(cfg, c.mark) : null;
                      return (
                        <td key={d} onClick={() => { if (canRecord && !lock) paint(e, d); }}
                          title={c ? `${m?.label || c.mark}${c.item_seq ? ` (${tr('ข้อ')} ${c.item_seq})` : ''}\n${c.source !== 'manual' ? tr('เติมอัตโนมัติ') : tr('กรอกเอง')}${c.note ? `\n${c.note}` : ''}` : ''}
                          style={{ ...td, cursor: canRecord && !lock ? 'pointer' : 'default', color: glyphColor(c), fontWeight: 700,
                            background: c && c.source !== 'manual' ? 'var(--green-dim)' : undefined }}>{cellGlyph(cfg, c)}</td>
                      );
                    })}
                    {cfg?.rowNote && <td style={{ ...td, padding: 2 }}>
                      <input key={`${sheet?.id || ''}|${e.id}|${notes[e.id] || ''}`} defaultValue={notes[e.id] || ''} readOnly={!canRecord || !!lock}
                        onBlur={ev => { if (canRecord && !lock) saveNote(e.id, ev.target.value.trim()); }} placeholder={canRecord ? '—' : ''}
                        style={{ width: '100%', padding: '3px 5px', fontSize: 11, border: '1px solid transparent', background: 'transparent', color: 'var(--text)' }} />
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 12, alignItems: 'center' }}>
        {marks.map(m => <span key={m.key} style={{ color: 'var(--text2)' }}><b style={{ color: colorOf(m.color).css, fontSize: 14 }}>{m.needsItem ? `1-${items.length || '?'}` : m.glyph}</b> {m.label}</span>)}
        <span style={{ flex: 1 }} />
        <span role="status" style={{ color: 'var(--muted)' }}>
          {tr('เดือนนี้')}: {marks.map(m => `${m.glyph === '#' ? m.label.split(' (')[0] : m.glyph} ${stat.by[m.key] || 0}`).join(' · ')}
          {' · '}{tr('เติมอัตโนมัติ')} {stat.auto} {tr('/ กรอกเอง')} {stat.manual}
          {stat.due > 0 && <>{' · '}{tr('กรอกแล้ว')} <b style={{ color: 'var(--text)' }}>{stat.filled}</b>/{stat.due}
            {stat.due - stat.filled > 0 && <> · <b style={{ color: 'var(--amber)' }}>{tr('ยังไม่กรอก')} {stat.due - stat.filled}</b></>} ({tr('ถึงวันที่')} {stat.elapsed} · {emps.length} {tr('คน')})</>}
          {(stat.off > 0 || stat.noRun > 0) && <>{' · '}{tr('ไม่นับ')}{stat.off > 0 && <> {tr('วันหยุด')} {stat.off}</>}{stat.noRun > 0 && <> {tr('ไม่ได้ผลิต')} {stat.noRun}</>} {tr('วัน')}</>}
          {stat.unk > 0 && runs != null && <b style={{ color: 'var(--amber)' }}>{' · '}❔ {tr('ไม่รู้ว่าไลน์เดินหรือไม่')} {stat.unk} {tr('วัน')}{stat.runsFailed ? ` (${tr('อ่านตารางกะไม่สำเร็จ')})` : ''}</b>}
        </span>
      </div>

      {items.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          <b>{cfg.itemsTitle || tr('หัวข้อตรวจ')}</b>{' '}
          <span style={{ color: 'var(--muted)' }}>({tr('แก้ที่หน้าออกแบบใบงาน → เผยแพร่เวอร์ชันใหม่')})</span>
          <div>{items.map(i => <span key={i.seq} style={{ marginRight: 12 }}><b>{i.seq}.</b> {i.text}{i.auto ? ' ◆' : ''}</span>)}</div>
        </div>
      )}
    </>
  );
}

/* ── มือถือ: เลือกวัน → การ์ดต่อคน → กดชิป (ชิป ≥44px ใส่ถุงมือกดได้) ── */
function MobileDay({ cfg, marks, items, emps, cells, days, month, today, canRecord, paint }) {
  const [sel, setSel] = useState(() => (today.slice(0, 7) === month ? Number(today.slice(8, 10)) : 1));
  const [pick, setPick] = useState(null);
  const day = Math.min(sel, days);
  const done = emps.filter(e => cells[ck(e.id, day)]).length;
  const nav = { width: 46, height: 46, borderRadius: 10, fontSize: 18, cursor: 'pointer', border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)' };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button type="button" onClick={() => setSel(Math.max(1, day - 1))} disabled={day <= 1} style={nav} aria-label={tr('วันก่อนหน้า')}>◀</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{tr('วันที่')} {day}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ทาแล้ว')} {done}/{emps.length} {tr('คน')}</div>
        </div>
        <button type="button" onClick={() => setSel(Math.min(days, day + 1))} disabled={day >= days} style={nav} aria-label={tr('วันถัดไป')}>▶</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, alignContent: 'start' }}>
        {emps.map((e, i) => {
          const c = cells[ck(e.id, day)];
          const cm = c ? markOf(cfg, c.mark) : null;
          return (
            <div key={e.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '10px 12px', background: 'var(--card-surf)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 18 }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{e.employee_id_code}{c && c.source !== 'manual' ? ` · ${tr('เติมอัตโนมัติ')}` : ''}</div>
                </div>
                <span style={{ minWidth: 40, height: 40, borderRadius: 'var(--r-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900,
                  background: cm ? colorOf(cm.color).dim : 'var(--bg3)', color: cm ? colorOf(cm.color).css : 'var(--muted)' }}>{c ? cellGlyph(cfg, c) : '·'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {marks.map(m => {
                  const on = c?.mark === m.key; const col = colorOf(m.color);
                  return (
                    <button key={m.key} type="button" disabled={!canRecord}
                      onClick={() => { if (m.needsItem) { setPick(pick === e.id ? null : e.id); return; } setPick(null); paint(e, day, m.key); }}
                      style={{ flex: '1 1 0', minWidth: 0, minHeight: 44, borderRadius: 10, cursor: canRecord ? 'pointer' : 'default', fontSize: 12, fontWeight: 800,
                        border: `2px solid ${on ? col.css : 'var(--border2)'}`, background: on ? col.dim : 'var(--bg3)', color: on ? col.css : 'var(--text2)' }}>
                      <b style={{ fontSize: 16 }}>{m.needsItem ? (on ? c.item_seq : '#') : m.glyph}</b>
                      <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.15 }}>{m.label.split(' (')[0]}</div>
                    </button>
                  );
                })}
              </div>
              {pick === e.id && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {items.map(it => (
                    <button key={it.seq} type="button" title={it.text} onClick={() => { setPick(null); paint(e, day, marks.find(m => m.needsItem)?.key, it.seq); }}
                      style={{ minWidth: 44, minHeight: 44, borderRadius: 'var(--r-md)', fontSize: 15, fontWeight: 800, cursor: 'pointer', border: '2px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)' }}>{it.seq}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
