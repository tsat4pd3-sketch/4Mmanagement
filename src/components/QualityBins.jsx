/**
 * QualityBins — ถังเหลือง (ชิ้นงานต้องสงสัย) / ถังแดง (ชิ้นงานเสีย) · paperless
 * ฝังเป็นแท็บใน /qa · ตาราง `quality_bin_records` (DR)
 *
 * ⚠️ 2 ถังเป็น "สายงานเดียวกัน" ตามหมายเหตุท้ายฟอร์มกระดาษ:
 *    ต้องสงสัย → ซ่อม → OK = กลับเข้ากระบวนการ · NG = ติดแท็กแดง → ลงถังแดง → Scrap Report
 *    ปุ่ม "→ ลงถังแดง" จึงสร้างแถวถังแดงที่ผูก `from_yellow_id` กลับมาที่ใบเหลือง
 *    (ห้ามให้คนคีย์ใหม่มือเปล่า — จะสืบไม่ได้ว่าของในถังแดงมาจากใบไหน)
 *
 * สิทธิ์: reuse `scrap:record` / `scrap:manage` — เป็น workflow ของเสียชุดเดียวกับใบ Scrap Report
 * (ไม่เพิ่ม permission key ใหม่ เลี่ยงกับดัก seed enum_range ที่ทำให้ role ใหม่ fail-closed)
 */
import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import ReadOnlyNote from './ReadOnlyNote';
import TimeRangeBar from './TimeRangeBar';
import Segmented from './Segmented';
import SearchInput from './SearchInput';
import { ALL } from '../utils/filterLabels';
import useTimeRange from '../utils/useTimeRange';
import LineSelect from './LineSelect';
import ProductSelect from './ProductSelect';
import PersonSelect from './PersonSelect';
import useColumnHistory from '../utils/useColumnHistory'; // 📜 ค่าที่เคยบันทึกใน quality_bin_records — ทะเบียนไม่มีก็ยังเลือกซ้ำได้ (2026-09-07)
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { positionLabel } from '../utils/positions';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { scopedLineNames } from '../utils/sectionScope';
import { printQualityBin } from '../lib/qualityBinPrint';
/* กติกาที่ถอดจาก WI-PD3-069 §5.4/§5.6 + WI-PD3-087 — อายุแท็ก + ผลพิจารณา QA
   ⚠️ ห้าม hardcode 5/1 วัน หรือรายชื่อผลพิจารณาซ้ำในหน้านี้ (2026-09-25) */
import { TAG_MAX_DAYS, QA_DECISIONS, decisionOf, binTagAge, binClosed, SPECIAL_USE_FORM } from '../utils/qualityBin';
import SimpleMasterPanel from './SimpleMasterPanel';
import { notifyEvent } from '../utils/notifyEvent';

const BINS = [
  { key: 'yellow', label: '🟡 ถังเหลือง — ชิ้นงานต้องสงสัย', short: 'ถังเหลือง', color: '#f5b942' },
  { key: 'red',    label: '🔴 ถังแดง — ชิ้นงานเสีย',        short: 'ถังแดง',   color: '#e05252' },
];

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/* ⚠️ work date ต้องตัด 08:00 เหมือนทั้งระบบ — คอลัมน์ `quality_bin_records.work_date` นี้
   ถูกเขียนจาก 2 ทาง: ที่นี่ (QA คีย์เอง) กับ QualityBinLinkModal ที่ใช้ `session.work_date`
   (วันงานของกะ) · เดิมที่นี่ใช้วันปฏิทินดิบ → กะดึกลงถังตอน 01:00-07:59 ได้ "วันถัดไป"
   ส่วนแถวที่ส่งมาจาก Daily Report ได้วันงานจริง = เหตุการณ์เดียวกันมีวันต่างกัน 1 วัน
   ตัวกรองช่วงวันจับไม่ครบ และเทียบกับ defect_logs ไม่ตรง (QC audit 2026-08-24) */
const today = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return ymd(d); };
const daysAgo = n => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); d.setDate(d.getDate() - n); return ymd(d); };
const numOrNull = v => (v === '' || v == null ? null : (Number.isFinite(+v) ? +v : null));

const BLANK = {
  work_date: today(), line_name: '', mat_no: '', part_name: '', part_no: '', qty: '',
  cause: '', reported_by: '', qa_by: '',
  repair_date: '', repair_detail: '', repair_by: '', qty_ok: '', qty_ng: '', return_date: '',
  disposed_by: '', disposed_position: '', note: '',
  qa_decision: '', special_use_doc_no: '',
};

const inp = {
  width: '100%', fontSize: 13, padding: '6px 9px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)',
};
const lbl = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 };
const th = { padding: '7px 8px', fontSize: 11.5, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', fontSize: 12.5, color: 'var(--text)', borderTop: '1px solid var(--border)' };

export default function QualityBins() {
  const { role, lineId, sections, fullName } = useContext(UserContext);
  const canRecord = can('scrap', 'record', role);
  const canManage = can('scrap', 'manage', role);

  const [bin, setBin] = useState('yellow');
  const [lines, setLines] = useState([]);
  // 2026-09-07 ชิ้นงานอ่านผ่าน <ProductSelect> (cache Product Master กลาง — เลิก datalist 400 แถวที่ตัดของหายเงียบ)
  const [matLocked, setMatLocked] = useState(false); // mat_no ตรง Product Master → ชื่อ/Part No. ล็อกตามทะเบียน
  /* 📜 ค่าที่เคยบันทึกใน quality_bin_records (DR) — ชิ้นงาน/ชื่อคนที่กรอกมาก่อนทะเบียนจะครบ ยังเลือกซ้ำได้ ห้ามล้าง/บล็อกเงียบ
     (คำสั่ง user 2026-09-07) · known:false = นอกทะเบียน → ไม่ล็อกชื่อ/Part No. */
  const binMatHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'mat_no', { upper: true });
  const reportedHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'reported_by');
  const qaByHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'qa_by');
  const repairByHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'repair_by');
  const disposedByHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'disposed_by');
  const [rows, setRows] = useState([]);
  const [scrapDocs, setScrapDocs] = useState({});   // scrap_report_id → { doc_no, status } (ถังแดง)
  /* ⏱️ ใบเหลืองที่ถูกย้ายลงถังแดงไปแล้ว = ออกจากถังแล้ว ไม่ต้องนับอายุแท็กต่อ
     (id ของใบเหลืองที่มีแถวแดงชี้กลับมาผ่าน from_yellow_id) */
  const [redChildOf, setRedChildOf] = useState(() => new Set());
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [showWiReg, setShowWiReg] = useState(false);
  /* ⏱️ ช่วงข้อมูล = แถบกลาง (UI §6.16) · ไม่ได้แบ่งถังเวลา ⇒ `scales={null}` */
  const tr = useTimeRange({ defaultDays: 30 });
  const { from, to } = tr;
  const [lineFilter, setLineFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);   // row | 'new' | null
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadLinesRes()
      .then(({ data }) => setLines(data || []));
  }, []);

  // scope มาตรฐาน (helper กลาง) — ผลิตเห็นเฉพาะส่วนงานตัวเอง
  const scopeNames = useMemo(
    () => scopedLineNames({ role, lineId, sections: sections || [], lines }),
    [role, lineId, sections, lines],
  );

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabaseDR.from('quality_bin_records').select('*')
      .eq('bin', bin).eq('is_active', true)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(500);
    if (scopeNames) q = q.in('line_name', scopeNames);
    const { data, error } = await q;
    setLoading(false);
    if (error) {
      // ยังไม่ apply migration = ต้องบอกให้ชัด ห้ามโชว์เป็น "ไม่มีข้อมูล"
      toast.error(error.code === '42P01'
        ? 'ยังไม่ได้ติดตั้งตารางถังเหลือง/แดง — แจ้ง admin ให้ apply migration 20260819_quality_bin_records'
        : error.message);
      setRows([]);
      return;
    }
    setRows(data || []);
    /* 🔴 ถังแดง: ดึงเลขที่ใบรายงานของเสียของแถวที่ผูกแล้ว มาโชว์ให้เห็นว่า "ออกใบขออนุมัติทำลายหรือยัง"
       (WI-PD3-069 §5.5 — ของทุกก้อนในถังแดงต้องมี Scrap Report เพื่อขออนุมัติตาม DOA · 2026-09-25)
       โหลดแยกเพราะ quality_bin_records อยู่คนละ schema ที่ join ตรงไม่ได้ผ่าน PostgREST ที่นี่
       ล้มเหลว = ปล่อยว่าง ไม่บล็อกตาราง แต่ก็ไม่โกหกว่า "ออกใบแล้ว" */
    const repIds = [...new Set((data || []).map(r => r.scrap_report_id).filter(Boolean))];
    if (repIds.length) {
      const { data: reps } = await supabaseDR.from('scrap_reports').select('id, doc_no, status').in('id', repIds);
      setScrapDocs(Object.fromEntries((reps || []).map(r => [r.id, r])));
    } else setScrapDocs({});

    /* 🟡 ใบเหลืองที่ย้ายลงถังแดงไปแล้ว — ต้องหยุดนับอายุแท็ก ไม่งั้นขึ้น "ค้างเกินอายุ" ทั้งที่จัดการไปแล้ว
       (ของค้างเทียมเต็มจอ = คนเลิกเชื่อจอ ซึ่งแย่กว่าไม่มีตัวเตือนเลย)
       เลือกเฉพาะคอลัมน์ที่ใช้จริง — `select('*')` บนตารางกว้างคือตัวกิน egress (กฎเหล็กข้อ 11) */
    if (bin === 'yellow' && (data || []).length) {
      const yIds = (data || []).map(r => r.id);
      const kids = new Set();
      for (let i = 0; i < yIds.length; i += 100) {
        const { data: ch } = await supabaseDR.from('quality_bin_records')
          .select('from_yellow_id').eq('bin', 'red').eq('is_active', true)
          .in('from_yellow_id', yIds.slice(i, i + 100));
        (ch || []).forEach(c => c.from_yellow_id && kids.add(c.from_yellow_id));
      }
      setRedChildOf(kids);
    } else setRedChildOf(new Set());
  }, [bin, from, to, scopeNames]);
  useEffect(() => { load(); }, [load]);

  /* ⏱️ อายุแท็ก/สถานะปิด ของทุกแถว — คิดครั้งเดียว ใช้ทั้งตัวกรอง ป้ายเตือน และตาราง
     `todayWd` เป็นพารามิเตอร์ของ binTagAge (ฟังก์ชันไม่อ่านนาฬิกาเอง — กฎเทสระเบิดเวลา) */
  const todayWd = today();
  const ageMap = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      m[r.id] = {
        age: binTagAge(r, todayWd),
        closed: binClosed(r, { hasRedChild: redChildOf.has(r.id) }),
      };
    });
    return m;
  }, [rows, todayWd, redChildOf]);

  const overdueCount = useMemo(
    () => rows.filter(r => !ageMap[r.id]?.closed && ageMap[r.id]?.age?.over).length,
    [rows, ageMap],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (lineFilter && r.line_name !== lineFilter) return false;
      if (overdueOnly && !(ageMap[r.id]?.age?.over && !ageMap[r.id]?.closed)) return false;
      if (!q) return true;
      return [r.mat_no, r.part_name, r.part_no, r.cause, r.reported_by, r.note]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, lineFilter, overdueOnly, ageMap]);

  // ไลน์ที่เลือกได้ (หลังกรอง scope) — ส่งเป็น "อ็อบเจกต์" ให้ <LineSelect> จัดลำดับชั้นเอง
  const lineObjs = useMemo(
    () => (scopeNames ? lines.filter(l => scopeNames.includes(l.name)) : lines),
    [scopeNames, lines],
  );

  const openNew = () => { setForm({ ...BLANK, reported_by: '' }); setMatLocked(false); setEditing('new'); };
  const openEdit = (r) => {
    setForm(Object.fromEntries(Object.keys(BLANK).map(k => [k, r[k] ?? ''])));
    setMatLocked(false);
    setEditing(r);
  };
  // ครอบครัวไลน์ที่เลือกในฟอร์ม — ให้ picker สินค้า/คน ของไลน์นั้นขึ้นก่อน (ไม่ตัดไลน์อื่น)
  const famLines = useMemo(
    () => (form.line_name ? getLineFamilyNames(lines, form.line_name) : undefined),
    [lines, form.line_name],
  );

  const save = async () => {
    const isY = bin === 'yellow';
    if (!form.work_date) { toast.error('กรอกวันที่ลงถัง'); return; }
    if (!numOrNull(form.qty)) { toast.error('กรอกจำนวนชิ้นงาน'); return; }
    if (!form.part_name.trim() && !form.mat_no.trim()) { toast.error('ระบุชื่อหรือรหัสชิ้นงาน'); return; }
    /* ทาง "ขอใช้" ต้องมีใบ FM-QA-042 อนุมัติ (WI §5.4) — ไม่มีเลขใบ = ยังปิดสายงานไม่ได้
       ⚠️ เตือน ไม่บล็อก: เลขใบอาจยังไม่ออกตอนที่ QA ตัดสิน (กติกาเดียวกับ checkStdSelection) */
    if (isY && form.qa_decision === 'use_as_is' && !form.special_use_doc_no.trim()) {
      toast.info(`บันทึกได้ แต่ยังไม่มีเลขใบ ${SPECIAL_USE_FORM} — รายการนี้จะยังนับเป็นของค้างในถังจนกว่าจะกรอกเลขใบ`);
    }
    setSaving(true);
    const payload = {
      bin,
      work_date: form.work_date,
      line_name: form.line_name || null,
      mat_no: form.mat_no.trim() || null,
      part_name: form.part_name.trim() || null,
      part_no: form.part_no.trim() || null,
      qty: numOrNull(form.qty),
      cause: form.cause.trim() || null,
      reported_by: form.reported_by.trim() || null,
      qa_by: form.qa_by.trim() || null,
      repair_date: form.repair_date || null,
      repair_detail: form.repair_detail.trim() || null,
      repair_by: form.repair_by.trim() || null,
      qty_ok: numOrNull(form.qty_ok),
      qty_ng: numOrNull(form.qty_ng),
      return_date: form.return_date || null,
      disposed_by: form.disposed_by.trim() || null,
      disposed_position: form.disposed_position.trim() || null,
      note: form.note.trim() || null,
    };
    /* ── §5.4 ผลพิจารณาของ QA (ถังเหลือง) ──
       ⚠️ null = "ยังไม่พิจารณา" ไม่ใช่ "ไม่มีผล" — ห้ามเขียน '' ลงไปแทน (จะกลายเป็นค่าที่ตัดสินไม่ได้)
       qa_decision_at เขียนเฉพาะตอน "เพิ่งตัดสิน" — แก้ช่องอื่นทีหลังไม่ขยับเวลาตัดสิน */
    if (isY) {
      const dec = form.qa_decision || null;
      payload.qa_decision = dec;
      payload.special_use_doc_no = dec === 'use_as_is' ? (form.special_use_doc_no.trim() || null) : null;
      const prev = editing === 'new' ? null : (editing.qa_decision || null);
      if (dec && dec !== prev) payload.qa_decision_at = new Date().toISOString();
      else if (!dec) payload.qa_decision_at = null;
    }
    const { error } = editing === 'new'
      ? await supabaseDR.from('quality_bin_records').insert(payload)
      : await supabaseDR.from('quality_bin_records').update(payload).eq('id', editing.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (editing === 'new') notifyEvent({
      event: 'quality_bin_added', type: bin === 'red' ? 'error' : 'info',
      ref_table: 'quality_bin_records', line_name: payload.line_name || null, actor: fullName,
      lines: [
        `${bin === 'red' ? '🔴 ถังแดง (ของเสียยืนยันแล้ว)' : '🟡 ถังเหลือง (ต้องสงสัย)'}`,
        `🏭 ไลน์: ${payload.line_name || '—'} · ${payload.part_name || payload.mat_no || '—'}`,
        `🔢 ${payload.qty} ชิ้น`,
        payload.cause ? `📝 ${payload.cause}` : '',
      ],
    });
    toast.success(editing === 'new' ? 'บันทึกแล้ว' : 'แก้ไขแล้ว');
    setEditing(null); load();
  };

  const remove = async (r) => {
    if (!window.confirm(`ลบรายการ ${r.part_name || r.mat_no} (${r.qty} ชิ้น) ?`)) return;
    // soft delete — ใบเก่าต้องยังสืบย้อนได้ (บันทึกคุณภาพ ห้ามลบทิ้งจริง)
    const { error } = await supabaseDR.from('quality_bin_records')
      .update({ is_active: false }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว'); load();
  };

  /** ซ่อมแล้ว NG → ย้ายลงถังแดง (ตามหมายเหตุท้ายฟอร์มเหลือง) */
  const toRed = async (r) => {
    /* จำนวนที่ย้าย: ซ่อมแล้ว NG มาก่อน · ถ้า QA ชี้ "ทำลาย" ตรงๆ โดยไม่ผ่านการซ่อม ใช้จำนวนทั้งใบ
       (WI §5.4 — ทำลายเป็น 1 ใน 3 ทางที่ QA เลือกได้ ไม่ได้บังคับให้ซ่อมก่อน) */
    const qty = (Number(r.qty_ng) || 0) || (r.qa_decision === 'scrap' ? (Number(r.qty) || 0) : 0);
    if (!qty) { toast.error('ยังไม่ได้กรอกจำนวน NG หลังซ่อม (หรือให้ QA ชี้ผลเป็น 🔴 ทำลาย)'); return; }
    if (!window.confirm(`ย้าย ${qty} ชิ้นลงถังแดง?\n\n${r.part_name || r.mat_no}\nระบบจะสร้างรายการถังแดงที่ผูกกับใบนี้ให้`)) return;
    const { error } = await supabaseDR.from('quality_bin_records').insert({
      bin: 'red', work_date: today(), line_name: r.line_name,
      mat_no: r.mat_no, part_name: r.part_name, part_no: r.part_no,
      qty, cause: [r.cause, (Number(r.qty_ng) || 0) > 0 ? 'ซ่อมแล้ว NG (จากถังเหลือง)' : 'QA ชี้ทำลาย (จากถังเหลือง)'].filter(Boolean).join(' · '),
      reported_by: r.reported_by, qa_by: r.qa_by,
      from_yellow_id: r.id,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('สร้างรายการถังแดงแล้ว — ไปกรอกผู้กำจัดทำลายที่แท็บถังแดง');
    load();   // ใบเหลืองใบนี้ต้องเปลี่ยนเป็น "🔴 ย้ายแล้ว" ทันที ไม่งั้นกดซ้ำได้
  };

  const doPrint = async () => {
    const ok = await printQualityBin({ bin, records: filtered });
    if (!ok) toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ของเว็บนี้ก่อน');
  };

  const B = BINS.find(b => b.key === bin);
  const isY = bin === 'yellow';
  const totalQty = filtered.reduce((a, r) => a + (Number(r.qty) || 0), 0);

  return (
    <div>
      <ReadOnlyNote show={!canRecord} role={role} what="บันทึกถังเหลือง/ถังแดง"
        permKey="scrap:record" />
      {/* ── แถบควบคุม ── */}
      {/* UI-STANDARD 2026-09-24: ตัวกรองของหน้าเป็น children ของ TimeRangeBar = แถบเดียว (เดิมแยก 2 ชั้น) */}
      <TimeRangeBar
        scale={tr.scale} from={from} to={to} today={tr.today} scales={null}
        onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset} style={{ marginBottom: 14 }}
      >
        {/* เลือกถัง = ตัวเลือก 2 ตัวที่เท่ากัน ⇒ Segmented อยู่ในแถบเดียว (เดิมเป็นแถวปุ่มแยกเหนือแถบกรอง) · สีถัง = ความหมาย */}
        <Segmented label="ถัง" value={bin} onChange={setBin}
          options={BINS.map(b => ({ value: b.key, label: b.label, color: b.color }))} />
        <LineSelect lines={lineObjs} value={lineFilter} onChange={setLineFilter} placeholder={ALL.line} />
        <SearchInput value={search} onChange={setSearch} fields="ชิ้นงาน / สาเหตุ / ผู้แจ้ง" />
        {/* ⏱️ ของค้างเกินอายุแท็ก — ปุ่มโผล่เฉพาะเมื่อมีของค้างจริง (ปุ่มที่กดแล้วว่างเปล่าเสมอ = คนเลิกกด)
            ไม่กระพริบ: เป็นงานค้าง ไม่ใช่ alarm (Andon convention) */}
        {overdueCount > 0 && (
          <button onClick={() => setOverdueOnly(v => !v)}
            title={`ของในถังที่เลยอายุแท็กตาม WI-PD3-087 §5.6 (🟡 ${TAG_MAX_DAYS.yellow} วัน · 🔴 ${TAG_MAX_DAYS.red} วัน) และยังไม่ถูกจัดการ`}
            style={{ padding: '7px 13px', borderRadius: 6, fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
              border: '1px solid #f97316', whiteSpace: 'nowrap',
              background: overdueOnly ? '#f97316' : 'transparent', color: overdueOnly ? '#2a1204' : '#f97316' }}>
            ⏱ เกินอายุแท็ก {overdueCount}
          </button>
        )}
        <span className="spacer" />
        {canRecord && <button onClick={openNew} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#08130a', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>+ บันทึกรายการ</button>}
        <button onClick={doPrint} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>🖨️ พิมพ์ใบ {B.short}</button>
        <button onClick={() => setShowWiReg(v => !v)}
          title="ทะเบียน QRs ↔ WI การซ่อม ตาม WI-PD3-069 §6 — อาการไหนซ่อมตาม WI เล่มไหน"
          style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid var(--border)', background: showWiReg ? 'var(--bg2)' : 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          📕 ทะเบียน WI ซ่อม
        </button>
      </TimeRangeBar>

      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>
        {loading ? 'กำลังโหลด…' : `${filtered.length} รายการ · รวม ${totalQty.toLocaleString('th-TH')} ชิ้น`}
        {scopeNames && <span> · 👥 เฉพาะส่วนงานของคุณ ({scopeNames.length} ไลน์)</span>}
        {!loading && overdueCount > 0 && (
          <span style={{ color: '#f97316', fontWeight: 700 }}> · ⏱ เกินอายุแท็ก {overdueCount} รายการ</span>
        )}
        {overdueOnly && <span> · แสดงเฉพาะของค้าง <button onClick={() => setOverdueOnly(false)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, textDecoration: 'underline', padding: 0 }}>แสดงทั้งหมด</button></span>}
      </div>

      {/* ── ตาราง ── */}
      <div style={{ overflowX: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isY ? 1150 : 900 }}>
          <thead><tr style={{ background: 'var(--bg2)' }}>
            {(isY
              ? ['วันที่ลงถัง', 'อายุแท็ก', 'ชิ้นงาน', 'จำนวนรอพิจารณา', 'สาเหตุ', 'ผู้แจ้ง', 'ผล QA', 'ซ่อมเมื่อ', 'ผู้ซ่อม', 'QA', 'OK', 'NG', 'กลับเข้ากระบวนการ', '']
              : ['วันที่ลงถัง', 'อายุแท็ก', 'ชิ้นงาน', 'ไลน์', 'จำนวนเสีย', 'สาเหตุ', 'ผู้แจ้ง', 'QA', 'ผู้กำจัดทำลาย', 'ตำแหน่ง', 'ใบรายงานของเสีย', '']
            ).map((h, i) => <th key={i} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {!loading && !filtered.length && (
              <tr><td colSpan={14} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 28 }}>
                {overdueOnly ? 'ไม่มีของค้างเกินอายุแท็กในช่วงที่เลือก 👍' : 'ไม่มีรายการในช่วงที่เลือก'}
              </td></tr>
            )}
            {filtered.map(r => (
              <tr key={r.id}>
                <td style={td}>{r.work_date}</td>
                {/* ⏱️ อายุแท็ก (WI-PD3-087 §5.6 · เหลือง 5 วัน · แดง 1 วัน) นับจากวันที่ลงถัง
                    ปิดสายงานแล้ว = เทา "จบแล้ว" · เกินอายุ = ส้มเข้ม **ไม่กระพริบ** (งานค้าง ไม่ใช่ alarm — Andon convention)
                    คำนวณไม่ได้ = "—" ห้ามโชว์ 0 วัน (กฎความซื่อสัตย์ของจอ) */}
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{(() => {
                  const { age, closed } = ageMap[r.id] || {};
                  if (!age) return <span style={{ color: 'var(--muted)' }}>—</span>;
                  if (closed) return <span style={{ fontSize: 11.5, color: 'var(--muted)' }} title="ออกจากถังแล้ว — หยุดนับอายุแท็ก">✓ จบแล้ว</span>;
                  return (
                    <span style={{ fontSize: 11.5, fontWeight: age.over ? 800 : 600, color: age.over ? '#f97316' : 'var(--text2)' }}
                      title={`ลงถัง ${r.work_date} · อายุแท็กสูงสุด ${age.limit} วันตาม WI-PD3-087 §5.6`}>
                      {age.over ? '⏱ ' : ''}{age.days} / {age.limit} วัน
                      {age.over && <span style={{ display: 'block', fontSize: 10, fontWeight: 700 }}>เกิน {age.overBy} วัน</span>}
                    </span>
                  );
                })()}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{r.part_name || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.part_no || r.mat_no || ''}</div>
                  {/* มาจากบันทึกงานเสียใน Daily Report — บอกที่มาไว้ กันคีย์ซ้ำ */}
                  {r.defect_log_id && (
                    <div style={{ fontSize: 11, color: '#0ea5e9' }}
                      title="สร้างจากบันทึกงานเสียในหน้า Daily Report — ไม่ได้คีย์ใหม่">
                      📋 จาก Daily Report
                    </div>
                  )}
                </td>
                {!isY && <td style={td}>{r.line_name || '—'}</td>}
                <td style={{ ...td, fontWeight: 700 }}>{Number(r.qty || 0).toLocaleString('th-TH')}</td>
                <td style={td}>{r.cause || '—'}</td>
                <td style={td}>{r.reported_by || '—'}</td>
                {/* §5.4 ผลพิจารณา QA — null = "รอ QA พิจารณา" ห้ามเดาผลให้ (แถวเดิมทั้งหมดเป็น null) */}
                {isY && <td style={{ ...td, whiteSpace: 'nowrap' }}>{(() => {
                  const d = decisionOf(r.qa_decision);
                  if (!d) return <span style={{ fontSize: 11.5, color: '#f59e0b' }}>⏳ รอ QA พิจารณา</span>;
                  return (
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: d.color }} title={d.hint}>
                      {d.label}
                      {r.qa_decision === 'use_as_is' && (
                        r.special_use_doc_no
                          ? <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>{SPECIAL_USE_FORM} {r.special_use_doc_no}</span>
                          : <span style={{ display: 'block', fontSize: 10, color: '#f59e0b' }}>⏳ รอเลขใบ {SPECIAL_USE_FORM}</span>
                      )}
                    </span>
                  );
                })()}</td>}
                {isY && <td style={td}>{r.repair_date || '—'}</td>}
                {isY && <td style={td}>{r.repair_by || '—'}</td>}
                <td style={td}>{r.qa_by || '—'}</td>
                {isY && <td style={{ ...td, color: '#22c55e', fontWeight: 700 }}>{r.qty_ok ?? '—'}</td>}
                {isY && <td style={{ ...td, color: '#ef4444', fontWeight: 700 }}>{r.qty_ng ?? '—'}</td>}
                {isY && <td style={td}>{r.return_date || '—'}</td>}
                {!isY && <td style={td}>{r.disposed_by || '—'}</td>}
                {!isY && <td style={td}>
                  {r.disposed_position || '—'}
                  {r.from_yellow_id && <div style={{ fontSize: 11, color: '#f5b942' }}>🟡 มาจากถังเหลือง</div>}
                </td>}
                {/* 🔴 สาย DOA: ของในถังแดงต้องมีใบรายงานของเสีย (FM-PD2-002) เพื่อขออนุมัติทำลาย
                    ยังไม่ออกใบ = ส้มเตือน (งานค้าง ไม่ใช่ alarm — ไม่กระพริบ ตาม Andon convention) */}
                {!isY && <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {r.scrap_report_id
                    ? <span style={{ fontSize: 11.5, fontWeight: 700, color: '#22c55e' }}>
                        🧾 {scrapDocs[r.scrap_report_id]?.doc_no || 'ออกใบแล้ว'}
                      </span>
                    : <span title="ยังไม่ได้ออกใบรายงานของเสีย — ไปที่หน้า 🗑️ ใบรายงานของเสีย แล้วกด ⤵ ดึงจากถังแดง"
                        style={{ fontSize: 11.5, fontWeight: 700, color: '#f59e0b' }}>
                        ⏳ ยังไม่ออกใบ
                      </span>}
                </td>}
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {canRecord && <button onClick={() => openEdit(r)} title="แก้ไข" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✏️</button>}
                  {/* 🔴 ย้ายลงถังแดง — เดิมโผล่เฉพาะเมื่อกรอก "ซ่อมแล้ว NG" แล้ว
                      แต่ WI §5.4 ให้ QA ชี้ "ทำลาย" ได้ตรงๆ โดยไม่ต้องผ่านการซ่อม ⇒ เปิดปุ่มให้ด้วย */}
                  {canRecord && isY && ((Number(r.qty_ng) || 0) > 0 || r.qa_decision === 'scrap') && !redChildOf.has(r.id) && (
                    <button onClick={() => toRed(r)}
                      title={(Number(r.qty_ng) || 0) > 0 ? 'ซ่อมแล้ว NG → ลงถังแดง' : 'QA ชี้ว่าทำลาย → ลงถังแดง'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>🔴</button>
                  )}
                  {isY && redChildOf.has(r.id) && (
                    <span title="ย้ายลงถังแดงไปแล้ว" style={{ fontSize: 11, color: '#e05252', fontWeight: 700 }}>🔴 ย้ายแล้ว</span>
                  )}
                  {canManage && <button onClick={() => remove(r)} title="ลบ" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>🗑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── 📕 ทะเบียน QRs ↔ WI การซ่อม (WI-PD3-069 §6) ──
          ⚠️ **ไม่ใช่คลัง "วิธีแก้มาตรฐาน"** (ตารางแบบนั้นห้ามสร้าง — จะเป็นที่ที่ 4 ต่อจาก
             mtn_orders.solution / improvements / pe_fmea_items แล้ว drift กัน)
             ตารางนี้เก็บแค่ "อาการนี้อ้าง WI เล่มไหน" — เนื้อหาการซ่อมอยู่ในเล่ม WI ตามเดิม
          ⚠️ data-driven ตั้งแต่วันแรก: WI มีการแก้/เพิ่มรายการทุกปี ห้าม hardcode 6 แถวนี้ในโค้ด
          ชิปแนะนำ WI โผล่ให้หัวหน้ากลุ่มเห็นตอนลงวิธีแก้ไขใน <ProblemFixModal> */}
      {showWiReg && (
        <div style={{ marginBottom: 14 }}>
          <SimpleMasterPanel
            client={supabaseDR} table="repair_wi_registry" keyCol="code"
            canManage={canManage} stampCol="updated_by_name" stampName={fullName}
            title="📕 ทะเบียน QRs ↔ WI การซ่อม"
            help="จาก WI-PD3-069 Rev.02 §6 — อาการที่ซ่อมได้ต้องอ้าง WI เล่มที่กำหนด · หัวหน้ากลุ่มจะเห็นชิปแนะนำ WI ตอนลงวิธีแก้ไขในหน้า Daily Report"
            emptyText="ยังไม่มีรายการ — เพิ่มจากตัว WI-PD3-069 §6"
            offNote="รายการนี้จะไม่ถูกแนะนำในโมดัลลงวิธีแก้ไขอีก (บันทึกเก่าที่อ้าง WI นี้ไว้แล้วไม่กระทบ)"
            fields={[
              { key: 'symptom',   label: 'อาการ', required: true, placeholder: 'Missing nut' },
              { key: 'wi_no',     label: 'WI ซ่อม', required: true, mono: true, placeholder: 'WI-PD3-018 (หลายเล่มคั่นด้วย , )' },
              { key: 'part_name', label: 'ชื่อชิ้นงาน' },
              { key: 'note',      label: 'หมายเหตุ' },
            ]}
          />
        </div>
      )}

      {/* ── modal บันทึก/แก้ไข ── */}
      {editing && (
        <div className="modal-scroll" /* ไม่ปิดจาก backdrop — UI-CONVENTIONS §5: เผลอแตะพื้นหลังแล้วข้อมูลหายทั้งฟอร์ม (ปิดด้วยปุ่มยกเลิก/✕ เท่านั้น) */
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, width: 'min(96vw, 720px)', maxHeight: '92vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>
              {editing === 'new' ? 'บันทึกรายการ' : 'แก้ไขรายการ'} — {B.short}
            </h3>
            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignContent: 'start' }}>
              <div><label style={lbl}>วันที่ลงถัง *</label>
                <input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>ไลน์การผลิต</label>
                <LineSelect lines={lineObjs} value={form.line_name} style={inp}
                  onChange={v => setForm(f => ({ ...f, line_name: v }))} /></div>
              <div><label style={lbl}>จำนวน (ชิ้น) *</label>
                <input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} style={inp} /></div>

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>ชิ้นงาน (เลือกจาก Product Master หรือพิมพ์เอง)</label>
                {/* 2026-09-07 <ProductSelect> — สินค้าของครอบครัวไลน์ที่เลือกขึ้นก่อน · พิมพ์เองได้ (ของที่ยังไม่อยู่ในทะเบียนมาถึงถังจริง) พร้อมป้าย */}
                <ProductSelect value={form.mat_no} lines={famLines} allowFree freeHint="ชิ้นงานที่ยังไม่อยู่ใน Product Master" history={binMatHist}
                  placeholder="MAT / รหัสชิ้นงาน" inputStyle={inp}
                  onChange={({ mat_no, name, p_no, line_name, opt, known }) => {
                    const inReg = !!opt && known !== false; // กลุ่ม 📜 เคยบันทึกไว้ = นอกทะเบียน → ปฏิบัติเหมือนพิมพ์เอง (2026-09-07)
                    setMatLocked(inReg);
                    setForm(f => ({ ...f, mat_no, ...(inReg ? { part_name: name || f.part_name, part_no: p_no || f.part_no, line_name: f.line_name || line_name || '' } : {}) }));
                  }} /></div>
              {/* ตรง Product Master → ชื่อ/Part No. ล็อกตามทะเบียน (ล้าง MAT เพื่อแก้เอง) — กันสะกดชื่อชิ้นงานคนละแบบ */}
              <div><label style={lbl}>ชื่อชิ้นงาน</label>
                <input value={form.part_name} readOnly={matLocked} title={matLocked ? 'ตาม Product Master — ล้างช่อง MAT เพื่อแก้เอง' : ''} onChange={e => setForm(f => ({ ...f, part_name: e.target.value }))} style={{ ...inp, opacity: matLocked ? 0.75 : 1 }} /></div>
              <div><label style={lbl}>Part No. (เลขลูกค้า)</label>
                <input value={form.part_no} readOnly={matLocked} title={matLocked ? 'ตาม Product Master — ล้างช่อง MAT เพื่อแก้เอง' : ''} onChange={e => setForm(f => ({ ...f, part_no: e.target.value }))} style={{ ...inp, opacity: matLocked ? 0.75 : 1 }} /></div>

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>สาเหตุ</label>
                <input value={form.cause} onChange={e => setForm(f => ({ ...f, cause: e.target.value }))} style={inp} /></div>
              {/* 2026-09-07 ชื่อคนเลือกจาก employees+profiles ผ่าน <PersonSelect> (คนในครอบครัวไลน์ขึ้นก่อน · เก็บชื่อ snapshot — ตาราง DR) */}
              <div><label style={lbl}>ผู้แจ้ง (พนักงาน)</label>
                <PersonSelect value={form.reported_by} source="both" lines={famLines} history={reportedHist} inputStyle={inp} onChange={({ name }) => setForm(f => ({ ...f, reported_by: name }))} /></div>
              <div><label style={lbl}>ผู้ตรวจสอบ (QA)</label>
                <PersonSelect value={form.qa_by} source="both" roles={['qa']} lines={famLines} history={qaByHist} inputStyle={inp} onChange={({ name }) => setForm(f => ({ ...f, qa_by: name }))} /></div>

              {isY ? (<>
                {/* ── §5.4 ผลการพิจารณาของ QA — 4 ทางตาม WI (เดิมระบบมีแค่ ซ่อม กับ ทำลาย) ──
                    ยังไม่เลือก = "รอ QA พิจารณา" ซึ่งเป็นสถานะจริง ห้ามบังคับเลือก
                    เลือกแล้วกดซ้ำ = ยกเลิกการตัดสิน (QA เปลี่ยนใจได้ก่อนของออกจากถัง) */}
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
                  ผลการพิจารณาของ QA <span style={{ fontWeight: 400 }}>(WI-PD3-069 §5.4)</span>
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {QA_DECISIONS.map(d => {
                    const on = form.qa_decision === d.value;
                    return (
                      <button key={d.value} type="button" title={d.hint}
                        onClick={() => setForm(f => ({ ...f, qa_decision: on ? '' : d.value }))}
                        style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
                          border: `1px solid ${on ? d.color : 'var(--border2)'}`,
                          background: on ? `${d.color}22` : 'transparent', color: on ? d.color : 'var(--text2)' }}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                {form.qa_decision && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5 }}>
                    ↳ {decisionOf(form.qa_decision)?.hint}
                  </div>
                )}
                {form.qa_decision === 'use_as_is' && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={lbl}>เลขที่ใบ {SPECIAL_USE_FORM} (ใบขออนุมัติใช้ชิ้นส่วนเป็นกรณีพิเศษ)</label>
                    <input value={form.special_use_doc_no} placeholder="ยังไม่ออกใบ = เว้นว่างไว้ก่อน (จะยังนับเป็นของค้างในถัง)"
                      onChange={e => setForm(f => ({ ...f, special_use_doc_no: e.target.value }))} style={inp} />
                  </div>
                )}
                {form.qa_decision === 'scrap' && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: '#f59e0b', lineHeight: 1.5 }}>
                    ⚠ บันทึกแล้วอย่าลืมกดปุ่ม 🔴 ที่แถวนี้เพื่อสร้างรายการถังแดง — ระบบไม่ย้ายให้เอง
                    (“เอาของลงถังแดง” เป็นการกระทำจริงหน้างาน ต้องมีคนกดยืนยัน)
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>ผลการซ่อม</div>
                <div><label style={lbl}>วันที่ซ่อมชิ้นงาน</label>
                  <input type="date" value={form.repair_date} onChange={e => setForm(f => ({ ...f, repair_date: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>ผู้ดำเนินการซ่อม</label>
                  <PersonSelect value={form.repair_by} source="both" lines={famLines} history={repairByHist} inputStyle={inp} onChange={({ name }) => setForm(f => ({ ...f, repair_by: name }))} /></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>รายละเอียดการซ่อมชิ้นงาน</label>
                  <input value={form.repair_detail} onChange={e => setForm(f => ({ ...f, repair_detail: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>ผลซ่อม OK (ชิ้น)</label>
                  <input type="number" value={form.qty_ok} onChange={e => setForm(f => ({ ...f, qty_ok: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>ผลซ่อม NG (ชิ้น)</label>
                  <input type="number" value={form.qty_ng} onChange={e => setForm(f => ({ ...f, qty_ng: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>วันที่นำกลับเข้ากระบวนการ</label>
                  <input type="date" value={form.return_date} onChange={e => setForm(f => ({ ...f, return_date: e.target.value }))} style={inp} /></div>
              </>) : (<>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>การกำจัดทำลาย (ตาม DOA)</div>
                <div><label style={lbl}>ผู้กำจัดทำลาย</label>
                  {/* เลือกคนแล้ว "ตำแหน่ง" เติมจากทะเบียน (positions master) อัตโนมัติ — ยังแก้เองได้ */}
                  <PersonSelect value={form.disposed_by} source="both" lines={famLines} history={disposedByHist} inputStyle={inp}
                    onChange={({ name, position, opt }) => setForm(f => ({ ...f, disposed_by: name, ...(opt && position ? { disposed_position: positionLabel(position) || position } : {}) }))} /></div>
                <div><label style={lbl}>ตำแหน่ง</label>
                  <input value={form.disposed_position} onChange={e => setForm(f => ({ ...f, disposed_position: e.target.value }))}
                    placeholder="ระดับหัวหน้ากลุ่ม-วิศวกรขึ้นไป" style={inp} /></div>
              </>)}

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>หมายเหตุ</label>
                <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inp} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setEditing(null)} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>ยกเลิก</button>
              <button onClick={save} disabled={saving} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#08130a', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
