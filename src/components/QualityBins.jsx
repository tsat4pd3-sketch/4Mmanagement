/**
 * QualityBins — ถังเหลือง (ชิ้นงานต้องสงสัย) / ถังแดง (ชิ้นงานเสีย) · paperless
 * ฝังเป็นแท็บใน /qa · ตาราง `quality_bin_records` (DR)
 *
 * ⚠️ 2 ถังเป็น "สายงานเดียวกัน" ตามหมายเหตุท้ายฟอร์มกระดาษ:
 *    ต้องสงสัย → ซ่อม → OK = กลับเข้ากระบวนการ · NG = ติดแท็กแดง → ลงถังแดง → Scrap Report
 *    ปุ่ม "→ ลงถังแดง" จึงสร้างแถวถังแดงที่ผูก `from_yellow_id` กลับมาที่ใบเหลือง
 *    (ห้ามให้คนคีย์ใหม่มือเปล่า — จะสืบไม่ได้ว่าของในถังแดงมาจากใบไหน)
 *
 * 🏭 **บ้านของเอกสารคือฝ่ายผลิต** (คำสั่ง user 2026-11-06: *"หลักๆอันนี้ต้องอยู่หมวดของผลิตนะ
 *    qa จะไปโชว์แค่พวกงานค้างอนุมัติของแผนก เพราะ หลักๆเอกสารอยู่ที่ผลิต"*)
 *    · `/scrap-report?tab=bins` (หมวด ฝ่ายผลิต) = `mode="full"` — ทะเบียน + ใบ + อายุแท็ก + ทะเบียน WI
 *    · `/qa?tab=bins` = `mode="queue"` — **เฉพาะคิวรอพิจารณา** (งานค้างอนุมัติของแผนก) ไม่มีทะเบียน
 *    🔴 ห้ามเอาทะเบียน/ปุ่มบันทึกกลับเข้าโหมด queue (= บ้านที่สอง · ด่าน `qa-bins-queue-only`)
 *
 * สิทธิ์: reuse `scrap:record` / `scrap:manage` — เป็น workflow ของเสียชุดเดียวกับใบ Scrap Report
 * (ไม่เพิ่ม permission key ใหม่ เลี่ยงกับดัก seed enum_range ที่ทำให้ role ใหม่ fail-closed)
 */
import { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react';
import { Link } from 'react-router-dom';
import ReadOnlyNote from './ReadOnlyNote';
import TimeRangeBar from './TimeRangeBar';
import Segmented from './Segmented';
import SearchInput from './SearchInput';
import { ALL } from '../utils/filterLabels';
import useTimeRange from '../utils/useTimeRange';
import LineSelect from './LineSelect';
import { checkWriteRows } from '../utils/dbWrite';
import { fetchByIds } from '../utils/fetchByIds';   // `.in(ids)` ยาว = URL เกินเพดาน proxy แล้วคืนค่าว่างเงียบ (กฎเขียน DB ข้อ 5)
import ProductSelect from './ProductSelect';
import PersonSelect from './PersonSelect';
import useColumnHistory from '../utils/useColumnHistory'; // 📜 ค่าที่เคยบันทึกใน quality_bin_records — ทะเบียนไม่มีก็ยังเลือกซ้ำได้ (2026-09-07)
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { positionLabel } from '../utils/positions';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can, canAccessPage, canSeeded } from '../utils/permissions';
import { restampSessionQByDefects } from '../lib/restampSessionQ';
import { lineScope } from '../utils/sectionScope';
/* 🔐 ชั้นที่ ③ ของสิทธิ์ — "แถวนี้เป็นของหน่วยงานเราไหม" · ฝั่ง DR เป็น anon ⇒ จอคือด่านเดียว
   🔴 ช่องเลือกไลน์ที่กรอง scope แล้ว **ไม่ใช่ด่าน** (เปิด `?scope=` ตรงได้) — ต้องเช็คซ้ำในฟังก์ชันที่เขียน DB */
import { canWriteLine, writeBlockText } from '../utils/writeScope';
import { printQualityBin } from '../lib/qualityBinPrint';
/* ✍️ ยืนยันก่อน "อนุมัติ/เซ็นรับ" — ของกลาง ห้ามเขียนข้อความเองในหน้า (คำสั่ง user 28/10 · ขยาย 02/11)
   ผลพิจารณาถังเหลืองเขียนชื่อคนกดลงช่อง QA บนใบ = การเซ็น ⇒ ต้องบอก 3 อย่าง: อนุมัติอะไร · ใบไหน · ในนามใคร */
import { confirmSign } from '../utils/signConfirm';
/* กติกาที่ถอดจาก WI-PD3-069 §5.4/§5.6 + WI-PD3-087 — อายุแท็ก + ผลพิจารณา QA
   ⚠️ ห้าม hardcode 5/1 วัน หรือรายชื่อผลพิจารณาซ้ำในหน้านี้ (2026-09-25) */
import { TAG_MAX_DAYS, QA_DECISIONS, decisionOf, binTagAge, binClosed, overdueBins, pendingYellow, SPECIAL_USE_FORM, SCRAP_DRAFT, ncStep, ncFlow } from '../utils/qualityBin';
import StepFlow from './StepFlow';
import SimpleMasterPanel from './SimpleMasterPanel';
import { masterDeleteGuard } from '../utils/masterRefs'; // ด่านนับปลายทางก่อนลบทะเบียนที่จับคู่ด้วยข้อความ — 2026-10-18
/* 📷 รูปหลักฐานของเสีย — ช่องแนบ + ตัวบีบ/อัปโหลด เป็นของกลาง ห้ามเขียนเองในหน้า (2026-10-12) */
import QualityPhotoField from './QualityPhotoField';
import { uploadQualityPhoto, removeQualityImg } from '../utils/qualityImage';
import { notifyEvent } from '../utils/notifyEvent';
import { DeleteButton } from './IconButton';

import { tr as trI18n } from '../utils/i18n';
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

/* ✍️ คำเตือนท้ายกล่องยืนยันของถังเหลือง — **ของจริงแก้ได้** (ต่างจากลายเซ็นใบ MO ที่ one-way)
   ⇒ ห้ามใช้ข้อความ default ของ signConfirm ที่บอกว่า "แก้เองไม่ได้" (คำเตือนที่ไม่จริง = คนเลิกอ่าน) */
const BIN_SIGN_WARN = '⚠️ ชื่อคุณจะไปอยู่ช่อง QA บนใบ — แก้ผลย้อนหลังได้ที่ทะเบียนถังเหลือง (หน้าของเสีย · ฝ่ายผลิต)';

/** ป้ายอ้างอิง "ใบไหน" ในกล่องยืนยัน — ชิ้นงาน + วันที่ลงถัง (ใบถังไม่มีเลขที่เอกสารของตัวเอง) */
const binDocLabel = (r) => [r?.part_no || r?.mat_no || r?.part_name, r?.work_date, r?.line_name]
  .map(v => String(v || '').trim()).filter(Boolean).join(' · ') || '(ไม่ทราบใบ)';

/* 🔴 คอลัมน์ที่จอนี้อ่านจริง — `select('*')` บนตารางกว้าง × 500 แถว × 2 คิวรี คือตัวกิน egress
   (กฎเขียน DB ข้อ 11 · QC audit 09/11) · ชุดนี้ = ทุกคีย์ใน `BLANK` (ฟอร์มแก้ไข) + คีย์ที่ตาราง/ชิปใช้
   🔴 เพิ่มช่องใหม่ในฟอร์ม/ตาราง = ต้องเติมที่นี่ด้วย ไม่งั้นค่าหายเงียบตอนเปิดแก้ไข */
const BIN_COLS = [
  'id', 'bin', 'is_active', 'created_at',
  'work_date', 'line_name', 'mat_no', 'part_name', 'part_no', 'qty', 'cause', 'reported_by',
  'qa_by', 'qa_decision', 'qa_decision_at', 'special_use_doc_no',
  'repair_date', 'repair_detail', 'repair_by', 'qty_ok', 'qty_ng', 'return_date',
  'repair_accepted_by', 'repair_accepted_at', 'repair_reject_note', 'repair_reject_count',
  'disposed_by', 'disposed_position', 'note', 'found_img', 'repair_img',
  'defect_log_id', 'from_yellow_id', 'scrap_report_id',
].join(', ');

const BLANK = {
  work_date: today(), line_name: '', mat_no: '', part_name: '', part_no: '', qty: '',
  cause: '', reported_by: '', qa_by: '',
  repair_date: '', repair_detail: '', repair_by: '', qty_ok: '', qty_ng: '', return_date: '',
  disposed_by: '', disposed_position: '', note: '',
  qa_decision: '', special_use_doc_no: '',
  /* URL รูปที่บันทึกไว้แล้ว — ไฟล์ที่ "เพิ่งเลือก" อยู่ใน state แยก (foundFile/repairFile)
     แยกกันเพราะกดยกเลิกแล้วต้องไม่มีไฟล์ค้างในถัง (อัปโหลดตอนกดบันทึกเท่านั้น) */
  found_img: '', repair_img: '',
};

const inp = {
  width: '100%', fontSize: 13, padding: '6px 9px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)',
};
const lbl = { fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 };
const th = { padding: '7px 8px', fontSize: 11.5, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', fontSize: 12.5, color: 'var(--text)', borderTop: '1px solid var(--border)' };

export default function QualityBins({ mode = 'full' }) {
  /* 'full' = หน้าฝ่ายผลิต (บ้านของเอกสาร) · 'queue' = /qa เห็นแค่คิวรออนุมัติ */
  const queueOnly = mode === 'queue';
  const { role, lineId, sections, fullName, scopeIdx, section: homeSection, allUnits, respCostCenters } = useContext(UserContext);
  const canRecord = can('scrap', 'record', role);
  const canManage = can('scrap', 'manage', role);
  /* ✍️ ตัดสินผลถังเหลือง = QA เท่านั้น (คำสั่ง user 10/11 · WI-PD3-069 §5.4) — คีย์แยก `qa:bin_decide`
     เดิมใช้ `scrap:record` ที่หัวหน้าไลน์ถืออยู่ ⇒ ฝ่ายผลิตตัดสินของตัวเองได้ · ยังไม่ seed = ปิด (ยกเว้น admin) */
  const canDecide = canSeeded('qa', 'bin_decide', role);

  const [bin, setBin] = useState('yellow');
  const [lines, setLines] = useState([]);
  // 2026-09-07 ชิ้นงานอ่านผ่าน <ProductSelect> (cache Product Master กลาง — เลิก datalist 400 แถวที่ตัดของหายเงียบ)
  const [matLocked, setMatLocked] = useState(false); // mat_no ตรง Product Master → ชื่อ/Part No. ล็อกตามทะเบียน
  /* 📜 ค่าที่เคยบันทึกใน quality_bin_records (DR) — ชิ้นงาน/ชื่อคนที่กรอกมาก่อนทะเบียนจะครบ ยังเลือกซ้ำได้ ห้ามล้าง/บล็อกเงียบ
     (คำสั่ง user 2026-09-07) · known:false = นอกทะเบียน → ไม่ล็อกชื่อ/Part No.
     🔴 โหมดคิว (/qa) ไม่มีฟอร์ม ⇒ ปิดทั้ง 5 ตัว (คอลัมน์ละ 3000 แถว = egress ที่ไม่มี picker ไหนใช้) */
  const histOn = { enabled: !queueOnly };
  const binMatHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'mat_no', { ...histOn, upper: true });
  const reportedHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'reported_by', histOn);
  const qaByHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'qa_by', histOn);
  const repairByHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'repair_by', histOn);
  const disposedByHist = useColumnHistory(supabaseDR, 'quality_bin_records', 'disposed_by', histOn);
  const [rows, setRows] = useState([]);
  const [scrapDocs, setScrapDocs] = useState({});   // scrap_report_id → { doc_no, status } (ถังแดง)
  /* ⏱️ ใบเหลืองที่ถูกย้ายลงถังแดงไปแล้ว = ออกจากถังแล้ว ไม่ต้องนับอายุแท็กต่อ
     (id ของใบเหลืองที่มีแถวแดงชี้กลับมาผ่าน from_yellow_id) */
  const [redChildOf, setRedChildOf] = useState(() => new Set());
  const [overdueOnly, setOverdueOnly] = useState(false);
  /* 🟡 คิว "รอพิจารณา" — คิวรีแยก **ไม่ผูกช่วงวันที่** (ของค้างเก่าคือตัวที่ต้องเคลียร์ที่สุด)
     โหลดไม่ได้ = ต้องเขียนบนจอ ห้ามขึ้น "ไม่มีงานค้าง" (กฎความซื่อสัตย์ของจอ) */
  const [pendRows, setPendRows] = useState([]);
  const [pendErr, setPendErr]   = useState('');
  const [pendAll, setPendAll]   = useState(false);   // กางดูทั้งหมด (default โชว์ 8 แถวแรก)
  const [repairing, setRepairing] = useState(null);   // ขั้น 3 ลงผลซ่อม { row, ok, ng, detail }
  const [deciding, setDeciding] = useState('');      // id ที่กำลังเขียนผล — กันกดรัว
  /* ⏱️ ของค้างเกินอายุแท็ก "ทั้งหมด" ไม่ขึ้นกับช่วงวันที่กรอง (QC 05/10 — เดิมนับจากแถวในช่วงที่เลือก
     ⇒ ของค้างที่ลงถังก่อนช่วง 30 วันหายจากป้ายเตือน ทั้งที่ยังค้างอยู่จริง) · null = โหลดไม่ได้ (ต้องเขียนบนจอ) */
  const [overdueRows, setOverdueRows] = useState([]);
  const [overdueErr, setOverdueErr] = useState('');
  const loadReq = useRef(0);   // stale-response guard — เปลี่ยนถัง/ช่วงเร็วๆ ผลเก่าห้ามทับผลใหม่ (กฎเขียน DB ข้อ 4)
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

  /* 🔴 ทะเบียนไลน์โหลดไม่สำเร็จ ≠ "ไม่มีไลน์" — ทิ้ง error ทำให้ `lineScope` คืน unlimited+unsure
     แล้วท้ายโหมดคิวไปเขียนยืนยันว่า "คิวนี้ทั้งโรงงาน" ซึ่งไม่จริง (QC audit 09/11) */
  const [linesErr, setLinesErr] = useState('');
  useEffect(() => {
    loadLinesRes()
      .then(({ data, error }) => { setLines(data || []); setLinesErr(error?.message || ''); });
  }, []);

  /* scope มาตรฐาน (helper กลาง) — ผลิตเห็นเฉพาะส่วนงานตัวเอง
     ใช้ `lineScope()` ตรงๆ เพื่ออ่าน `unsure` มาเขียนบนจอ (`scopedLineNames` กลืนธงนั้นไป)
     🔴 `scopeIdx` ต้องอยู่ใน deps ด้วย — มาแบบ async จาก UserContext */
  const scopeRes = useMemo(
    () => lineScope({ role, lineId, sections: sections || [], lines, scopeIdx }),
    [role, lineId, sections, lines, scopeIdx],
  );
  /* ความหมายเดิมของตัวแปรนี้ทั้งไฟล์: `null` = ไม่จำกัด (เหมือน `scopedLineNames` เป๊ะ) */
  const scopeNames = scopeRes.unlimited ? null : (scopeRes.names.length ? scopeRes.names : null);

  /** 🔐 ด่านชั้น ③ ก่อนเขียนจริง — คืน `true` = เขียนได้ · `false` = บล็อกแล้วขึ้น toast บอกเหตุผล
   *  🔴 ทะเบียนไลน์ยังไม่โหลด = ตัดสินไม่ได้ ⇒ **บล็อก (fail-closed)** ห้ามปล่อยผ่าน
   *  🔴 "ย้ายของ" ต้องเช็ค 2 ฝั่ง — ผู้เรียกส่งทั้งไลน์ต้นทางและไลน์ปลายทางมาได้ (กฎ 19/10) */
  const guardLines = (names, what) => {
    const list = (Array.isArray(names) ? names : [names]);
    if (!lines.length) {
      toast.error('ยังโหลดทะเบียนไลน์ไม่เสร็จ — ยังตัดสินไม่ได้ว่าแถวนี้อยู่ในขอบเขตที่คุณดูแลไหม ลองใหม่อีกครั้ง');
      return false;
    }
    const ctx = { role, section: homeSection, sections: sections || [], allUnits, respCostCenters, scopeIdx };
    for (const n of list) {
      const w = canWriteLine(ctx, n, lines, { unknownTarget: 'block' });
      if (!w.ok) { toast.error(writeBlockText(w, { what, unit: n || '(ไม่ระบุไลน์)' })); return false; }
    }
    return true;
  };

  /** ✍️ ช่อง QA บนใบคือลายเซ็นตาม WI — ไม่รู้ชื่อคนกด = ห้ามเขียนใบที่ "ปิดโดยไม่มีชื่อผู้พิจารณา" */
  const guardSigner = () => {
    if (String(fullName || '').trim()) return true;
    toast.error('บัญชีนี้ยังไม่มีชื่อ-นามสกุลในโปรไฟล์ — ช่องผู้พิจารณา (QA) บนใบต้องมีชื่อ ตั้งชื่อก่อนจึงตัดสินผลได้');
    return false;
  };

  const load = useCallback(async () => {
    const rid = ++loadReq.current;
    const stale = () => rid !== loadReq.current;
    setLoading(true);
    /** ใบเหลืองที่มีลูกเป็นใบแดงแล้ว — ใช้ทั้งตารางของค้าง และคิวรอพิจารณา (คิวรีเดียวกัน ห้ามเขียน 2 ชุด) */
    const redKidsOf = async (ids) => {
      const kids = new Set();
      let err = '';
      for (let i = 0; i < ids.length; i += 100) {
        const { data: ch, error: chErr } = await supabaseDR.from('quality_bin_records')
          .select('from_yellow_id').eq('bin', 'red').eq('is_active', true)
          .in('from_yellow_id', ids.slice(i, i + 100));
        if (chErr) { err = chErr.message; break; }
        (ch || []).forEach(c => c.from_yellow_id && kids.add(c.from_yellow_id));
      }
      return { kids, err };
    };
    /* 🔴 แท็กที่ไม่ระบุไลน์ต้องเห็นด้วย — `IN` ไม่จับ NULL ⇒ ลงถังแล้วหายจากรายการ (audit 19/10) */
    const inScope = scopeNames ? `line_name.is.null,line_name.in.(${scopeNames.map(n => `"${String(n).replace(/"/g, '\\"')}"`).join(',')})` : null;

    /* 🟡 คิวรอพิจารณา — ยังไม่มีผล QA และยังไม่กลับเข้ากระบวนการ · ไม่กรองช่วงวันที่
       (ตั้งแท็กอัตโนมัติตั้งแต่ตอนบันทึกงานเสียแล้ว 05/11 ⇒ คิวนี้คือ "งานที่ต้องเคลียร์" ของ QA/หัวหน้า)
       🔴 โหลดก่อนทะเบียนเสมอ เพราะโหมดคิว (/qa) ใช้แค่ก้อนนี้ก้อนเดียว */
    let pendIds = [];
    if (bin === 'yellow') {
      let pq = supabaseDR.from('quality_bin_records')
        .select('id, work_date, line_name, mat_no, part_name, part_no, qty, cause, reported_by, qa_decision, return_date, defect_log_id, found_img, special_use_doc_no, scrap_report_id, bin, is_active, qty_ok, qty_ng, repair_date, repair_by, repair_detail, repair_reject_note, repair_reject_count')
        .eq('bin', 'yellow').eq('is_active', true)
        /* 🔴 ไม่กรองแค่ "ยังไม่มีผล" — ตัดสินแล้วแต่ยังไม่จบ (ซ่อมยังไม่กลับ/ขอใช้ไม่มีเลขใบ/ทำลายยังไม่ย้ายแดง)
           ต้องค้างในคิวด้วย (บั๊ก A 10/11) · ตัด "งานดี" ฝั่ง server เพราะปิดแน่นอน · ที่เหลือตัดสินด้วย pendingYellow() */
        .or('qa_decision.is.null,qa_decision.neq.good').is('return_date', null)
        .order('work_date', { ascending: true }).limit(300);
      if (inScope) pq = pq.or(inScope);
      const { data: pd, error: pe } = await pq;
      if (stale()) return;
      if (pe) { setPendErr(pe.message); setPendRows([]); }
      else {
        setPendErr((pd || []).length >= 300 ? 'รอพิจารณาเกิน 300 รายการ — แสดง 300 รายการที่เก่าที่สุด' : '');
        setPendRows(pd || []);
        pendIds = (pd || []).map(r => r.id);
      }
    } else { setPendRows([]); setPendErr(''); }

    /* 🏭 โหมดคิว (/qa) — เอกสารตัวจริงอยู่ฝ่ายผลิต ⇒ **ไม่โหลดทะเบียน/ของค้างตามช่วงวันที่เลย**
       (`select('*')` ตารางกว้าง × 500 แถว × 2 คิวรี = egress ที่ไม่มีใครดูบนหน้านี้ · กฎเขียน DB ข้อ 11) */
    if (queueOnly) {
      setRows([]); setOverdueRows([]); setOverdueErr(''); setScrapDocs({});
      /* ใบที่ย้ายลงถังแดงไปแล้วต้องหายจากคิว ⇒ เช็คลูกจาก id ของคิวเอง (ไม่มีชุดแถวในช่วงให้ยืม) */
      const { kids, err } = await redKidsOf(pendIds);
      if (stale()) return;
      if (err) setPendErr(e => e || `เช็คใบที่ย้ายลงถังแดงไม่ได้: ${err}`);
      setRedChildOf(kids);
      setLoading(false);
      return;
    }

    let q = supabaseDR.from('quality_bin_records').select(BIN_COLS)
      .eq('bin', bin).eq('is_active', true)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }).order('created_at', { ascending: false })
      .limit(500);
    if (inScope) q = q.or(inScope);
    /* ⏱️ ของค้างเกินอายุแท็ก — คิวรีแยก ไม่ผูกช่วงวันที่ (ลงถังก่อน "วันนี้ − อายุแท็ก" และยังไม่ปิด)
       กรองฝั่ง server แค่เงื่อนไขปิดที่ชัด (แดง: ยังไม่มีใบ scrap · เหลือง: ยังไม่กลับเข้ากระบวนการ)
       ที่เหลือ (QA ว่างานดี/ขอใช้มีเลขใบ/ย้ายลงแดงแล้ว) ตัดสินด้วย binClosed() ตัวเดียวกับตาราง */
    let oq = supabaseDR.from('quality_bin_records').select(BIN_COLS)
      .eq('bin', bin).eq('is_active', true)
      .lte('work_date', daysAgo((TAG_MAX_DAYS[bin] ?? 0) + 1))
      .order('work_date', { ascending: true })
      .limit(500);
    /* 🔴 ถังแดง: ผูกใบที่ยังเป็น "ร่าง" = ยังไม่ได้ขออนุมัติ ⇒ ยังต้องนับอายุแท็ก (บั๊ก B 10/11)
       ดึง id ใบร่างก่อน (ใบร่างควรมีไม่กี่ใบ — เป็นสถานะชั่วคราว) · อ่านไม่ได้ = ถอยไปเงื่อนไขเดิม + เขียนบนจอ */
    let draftErr = '';
    if (bin === 'red') {
      const { data: drafts, error: dErr } = await supabaseDR.from('scrap_reports')
        .select('id').eq('status', SCRAP_DRAFT).limit(200);
      if (stale()) return;
      const dIds = dErr ? [] : (drafts || []).map(d => d.id);
      if (dErr) draftErr = `อ่านใบรายงานของเสียที่ยังเป็นร่างไม่ได้: ${dErr.message} — ของที่ผูกใบร่างอาจไม่ขึ้นเป็นของค้าง`;
      else if ((drafts || []).length >= 200) draftErr = 'ใบรายงานของเสียที่ยังเป็นร่างเกิน 200 ใบ — ของที่ผูกใบร่างบางรายการอาจไม่ขึ้นเป็นของค้าง';
      oq = dIds.length ? oq.or(`scrap_report_id.is.null,scrap_report_id.in.(${dIds.join(',')})`) : oq.is('scrap_report_id', null);
    } else oq = oq.is('return_date', null);
    if (inScope) oq = oq.or(inScope);
    const [{ data, error }, ores] = await Promise.all([q, oq]);
    if (stale()) return;
    setLoading(false);
    if (ores.error) { setOverdueErr(ores.error.message); setOverdueRows([]); }
    else {
      /* เพดาน 500 แถว (กฎเขียน DB ข้อ 5) — ชนเพดาน = ยอดค้างอาจมากกว่านี้ ต้องบอก */
      setOverdueErr((ores.data || []).length >= 500 ? 'ของค้างเกิน 500 รายการ — แสดงเฉพาะ 500 รายการที่เก่าที่สุด' : draftErr);
      setOverdueRows(ores.data || []);
    }
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
    /* ครอบทั้งแถวในช่วง + แถวค้างเกินอายุ — ต้องรู้สถานะใบ (ร่าง/ส่งแล้ว) ถึงจะตัดสินได้ว่าปิดหรือยัง */
    const repIds = [...new Set([...(data || []), ...(ores.data || [])].map(r => r.scrap_report_id).filter(Boolean))];
    if (repIds.length) {
      /* 🔴 แถวในช่วงมีได้ถึง 500 ⇒ `.in(id, …)` ยาวเกินเพดาน URL ของ proxy แล้ว **คืนค่าว่างเงียบ**
         ⇒ คอลัมน์ "ใบรายงานของเสีย" ว่างทั้งตารางทั้งที่ออกใบแล้ว (กฎเขียน DB ข้อ 5 · QC audit 09/11) */
      const { rows: reps, error: repErr } = await fetchByIds(repIds,
        (part) => supabaseDR.from('scrap_reports').select('id, doc_no, status').in('id', part));
      if (stale()) return;
      /* อ่านไม่ได้ = ไม่รู้ว่าออกใบแล้วหรือยัง — เขียนบนจอ ห้ามปล่อยให้อ่านเป็น "ยังไม่ออกใบ" */
      setOverdueErr(e => e || (repErr ? `อ่านเลขที่ใบรายงานของเสียไม่ได้: ${repErr}` : ''));
      setScrapDocs(Object.fromEntries((reps || []).map(r => [r.id, r])));
    } else setScrapDocs({});

    /* 🟡 ใบเหลืองที่ย้ายลงถังแดงไปแล้ว — ต้องหยุดนับอายุแท็ก ไม่งั้นขึ้น "ค้างเกินอายุ" ทั้งที่จัดการไปแล้ว
       (ของค้างเทียมเต็มจอ = คนเลิกเชื่อจอ ซึ่งแย่กว่าไม่มีตัวเตือนเลย)
       เลือกเฉพาะคอลัมน์ที่ใช้จริง — `select('*')` บนตารางกว้างคือตัวกิน egress (กฎเหล็กข้อ 11)
       ครอบทั้งแถวในช่วง + แถวค้างเกินอายุ (คนละชุดกันได้) */
    const yIds = bin === 'yellow'
      ? [...new Set([...(data || []).map(r => r.id), ...(ores.data || []).map(r => r.id), ...pendIds])]
      : [];
    if (yIds.length) {
      const { kids, err: kidsErr } = await redKidsOf(yIds);
      if (stale()) return;
      /* ไม่รู้ว่าใบไหนย้ายลงแดงแล้ว = ป้ายค้างอาจเกินจริง → เขียนบนจอ ห้ามเงียบ */
      if (kidsErr) setOverdueErr(e => e || `เช็คใบที่ย้ายลงถังแดงไม่ได้: ${kidsErr}`);
      setRedChildOf(kids);
    } else setRedChildOf(new Set());
  }, [bin, from, to, scopeNames, queueOnly]);
  useEffect(() => { load(); }, [load]);

  /* ⏱️ อายุแท็ก/สถานะปิด ของทุกแถว — คิดครั้งเดียว ใช้ทั้งตัวกรอง ป้ายเตือน และตาราง
     `todayWd` เป็นพารามิเตอร์ของ binTagAge (ฟังก์ชันไม่อ่านนาฬิกาเอง — กฎเทสระเบิดเวลา) */
  const todayWd = today();
  /* id ใบรายงานของเสีย → status · ใบร่าง = ของในถังแดงยังไม่ปิด (binClosed) */
  const scrapStatusOf = useMemo(
    () => Object.fromEntries(Object.values(scrapDocs).map(d => [d.id, d.status])), [scrapDocs]);
  const ageMap = useMemo(() => {
    const m = {};
    [...rows, ...overdueRows].forEach(r => {
      m[r.id] = {
        age: binTagAge(r, todayWd),
        closed: binClosed(r, { hasRedChild: redChildOf.has(r.id), scrapStatusOf }),
      };
    });
    return m;
  }, [rows, overdueRows, todayWd, redChildOf, scrapStatusOf]);

  /* ของค้างเกินอายุทั้งหมด (ไม่ผูกช่วงวันที่) — ตัวเดียวกับป้ายเตือน/ปุ่ม/ตารางโหมด "เฉพาะของค้าง" */
  const overdueList = useMemo(
    () => overdueBins(overdueRows, todayWd, redChildOf, scrapStatusOf).map(o => o.row),
    [overdueRows, todayWd, redChildOf, scrapStatusOf],
  );
  const overdueCount = overdueList.length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (overdueOnly ? overdueList : rows).filter(r => {
      if (lineFilter && r.line_name !== lineFilter) return false;
      if (overdueOnly && !(ageMap[r.id]?.age?.over && !ageMap[r.id]?.closed)) return false;
      if (!q) return true;
      return [r.mat_no, r.part_name, r.part_no, r.cause, r.reported_by, r.note]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, overdueList, search, lineFilter, overdueOnly, ageMap]);

  // ไลน์ที่เลือกได้ (หลังกรอง scope) — ส่งเป็น "อ็อบเจกต์" ให้ <LineSelect> จัดลำดับชั้นเอง
  const lineObjs = useMemo(
    () => (scopeNames ? lines.filter(l => scopeNames.includes(l.name)) : lines),
    [scopeNames, lines],
  );

  /* ไฟล์รูปที่เพิ่งเลือก (ยังไม่อัปโหลด) — เปิด/ปิดฟอร์มต้องล้างทุกครั้ง ไม่งั้นรูปของใบก่อนติดมาด้วย */
  const [foundFile, setFoundFile] = useState(null);
  const [repairFile, setRepairFile] = useState(null);
  const setPhotoFiles = () => { setFoundFile(null); setRepairFile(null); };

  /* 📅 วันที่ต้องคิด "ตอนเปิดฟอร์ม" ไม่ใช่ตอนโหลดไฟล์ (2026-10-20) — `BLANK.work_date` ถูกคิดครั้งเดียวตอน import
     ⇒ handheld/จอที่เปิดค้างข้ามวัน ลงถังเหลือง-แดงเป็นวันของเมื่อวานเงียบๆ */
  const openNew = () => { setForm({ ...BLANK, work_date: today(), reported_by: '' }); setMatLocked(false); setPhotoFiles(); setEditing('new'); };
  const openEdit = (r) => {
    setForm(Object.fromEntries(Object.keys(BLANK).map(k => [k, r[k] ?? ''])));
    setMatLocked(false);
    setPhotoFiles();
    setEditing(r);
  };
  // ครอบครัวไลน์ที่เลือกในฟอร์ม — ให้ picker สินค้า/คน ของไลน์นั้นขึ้นก่อน (ไม่ตัดไลน์อื่น)
  const famLines = useMemo(
    () => (form.line_name ? getLineFamilyNames(lines, form.line_name) : undefined),
    [lines, form.line_name],
  );

  const save = async () => {
    /* ด่านชั้น 2 — ซ่อนปุ่มไม่ใช่ด่าน (สิทธิ์เปลี่ยนระหว่างเปิดจอ / โมดัลเปิดค้าง / ยิงตรง)
       ถังเหลือง-แดง = บันทึกคุณภาพที่มีอายุเอกสาร ⇒ คนที่ไม่มี scrap:record ห้ามเขียน */
    if (!canRecord) { toast.error('บัญชีนี้ไม่มีสิทธิ์บันทึกของเสีย (scrap:record)'); return; }
    const isY = bin === 'yellow';
    if (!form.work_date) { toast.error('กรอกวันที่ลงถัง'); return; }
    if (!numOrNull(form.qty)) { toast.error('กรอกจำนวนชิ้นงาน'); return; }
    if ([form.qty, form.qty_ok, form.qty_ng].some(v => (numOrNull(v) ?? 0) < 0)) { toast.error('จำนวนติดลบไม่ได้ — แก้ช่องที่มีเครื่องหมายลบ'); return; }
    if (!form.part_name.trim() && !form.mat_no.trim()) { toast.error('ระบุชื่อหรือรหัสชิ้นงาน'); return; }
    /* ทาง "ขอใช้" ต้องมีใบ FM-QA-042 อนุมัติ (WI §5.4) — ไม่มีเลขใบ = ยังปิดสายงานไม่ได้
       ⚠️ เตือน ไม่บล็อก: เลขใบอาจยังไม่ออกตอนที่ QA ตัดสิน (กติกาเดียวกับ checkStdSelection) */
    if (isY && form.qa_decision === 'use_as_is' && !form.special_use_doc_no.trim()) {
      toast.info(`บันทึกได้ แต่ยังไม่มีเลขใบ ${SPECIAL_USE_FORM} — รายการนี้จะยังนับเป็นของค้างในถังจนกว่าจะกรอกเลขใบ`);
    }
    setSaving(true);
    /* 📷 อัปโหลดรูป **ก่อน** เขียนแถว — อัปล้มแล้วเขียนแถวต่อ = ใบบอกว่ามีรูปแต่เปิดไม่ขึ้น
       ⇒ ล้ม = หยุดทั้งการบันทึก แล้วบอกตรงๆ ว่ายังไม่ได้บันทึก (ห้ามล้มเหลวเงียบ)
       ไฟล์ใหม่ชนะ URL เดิม · ไม่มีทั้งคู่ = null (ผู้ใช้กด "เอารูปออก" แล้ว form.*_img ถูกล้างเป็น '') */
    let foundUrl = form.found_img || null;
    let repairUrl = form.repair_img || null;
    try {
      const key = editing === 'new' ? 'new' : editing.id;
      if (foundFile) foundUrl = await uploadQualityPhoto(foundFile, 'bin', key);
      if (isY && repairFile) repairUrl = await uploadQualityPhoto(repairFile, 'bin', key);
    } catch (e) {
      setSaving(false);
      toast.error(`อัปโหลดรูปไม่สำเร็จ: ${e.message} — ยังไม่ได้บันทึกรายการ ลองกดบันทึกอีกครั้ง`);
      return;
    }
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
      found_img: foundUrl,
      /* ถังแดงไม่มีขั้นซ่อม — เขียน null ไว้เสมอ ไม่ใช่ปล่อยค่าเดิมค้าง (ใบที่ย้ายมาจากเหลืองจะสับสน) */
      repair_img: isY ? repairUrl : null,
    };
    /* 🔐 ชั้น ③ — "ย้ายของ" ต้องเช็ค 2 ฝั่ง: ไลน์ของแถวเดิม + ไลน์ที่กำลังจะเขียนลงไป (กฎ 19/10) */
    if (!guardLines([...(editing !== 'new' && editing?.line_name ? [editing.line_name] : []), form.line_name],
      'รายการในถังเหลือง/ถังแดง')) { setSaving(false); return; }
    /* ── §5.4 ผลพิจารณาของ QA (ถังเหลือง) ──
       ⚠️ null = "ยังไม่พิจารณา" ไม่ใช่ "ไม่มีผล" — ห้ามเขียน '' ลงไปแทน (จะกลายเป็นค่าที่ตัดสินไม่ได้)
       qa_decision_at เขียนเฉพาะตอน "เพิ่งตัดสิน" — แก้ช่องอื่นทีหลังไม่ขยับเวลาตัดสิน */
    if (isY) {
      const dec = form.qa_decision || null;
      const prevDec = editing === 'new' ? null : (editing.qa_decision || null);
      if ((form.return_date || null) !== (editing === 'new' ? null : (editing.return_date || null)) && !canDecide) {
        setSaving(false);
        toast.error('วันกลับเข้ากระบวนการ = QA ตรวจรับ (ขั้น 4) เท่านั้น — ไม่ได้บันทึก');
        return;
      }
      if (dec !== prevDec && !canDecide) {
        setSaving(false);
        toast.error('ผลการพิจารณาเปลี่ยนได้เฉพาะ QA (สิทธิ์ qa:bin_decide) — คืนช่องผลพิจารณาเป็นค่าเดิมแล้วบันทึกใหม่');
        return;
      }
      payload.qa_decision = dec;
      payload.special_use_doc_no = dec === 'use_as_is' ? (form.special_use_doc_no.trim() || null) : null;
      const prev = editing === 'new' ? null : (editing.qa_decision || null);
      if (dec && dec !== prev) payload.qa_decision_at = new Date().toISOString();
      else if (!dec) payload.qa_decision_at = null;
    }
    /* 🔴 UPDATE ที่ถูก RLS ปฏิเสธ = "สำเร็จ 0 แถว ไม่มี error" ⇒ ต้องนับแถว ไม่งั้นขึ้น "แก้ไขแล้ว"
       ทั้งที่ไม่ได้เขียนอะไรเลย (แถวถูก soft-delete/มีคนแก้ไปก่อน) — กฎเขียน DB ข้อ 2 · QC audit 09/11
       INSERT ไม่ต้องนับ (โดน RLS จะโยน 42501 เอง) */
    let ok = true;
    let savedId = editing === 'new' ? null : editing.id;
    if (editing === 'new') {
      const res = await supabaseDR.from('quality_bin_records').insert(payload).select('id').single();
      ok = !res.error;
      if (res.error) toast.error(res.error.message);
      else savedId = res.data?.id || null;
    } else {
      const res = await supabaseDR.from('quality_bin_records').update(payload).eq('id', editing.id).select('id');
      ok = checkWriteRows(res, 'แก้ไขรายการในถัง',
        { zeroMsg: 'แก้ไขไม่สำเร็จ (0 แถว — อาจมีคนลบ/แก้ไปก่อน หรือไม่มีสิทธิ์) · รีเฟรชแล้วลองใหม่' });
    }
    setSaving(false);
    if (!ok) return;
    /* 🔴 ลบไฟล์เก่าได้**หลัง**เขียนแถวสำเร็จเท่านั้น — ลบก่อนแล้วเขียนล้ม = แถวยังชี้ URL ที่ไฟล์หายแล้ว
       (กฎเหล็ก db-write ข้อ 2) · ลบล้มปล่อยเงียบได้ ไฟล์กำพร้าไม่ทำให้จอผิด */
    if (editing !== 'new') {
      if (editing.found_img && editing.found_img !== foundUrl) removeQualityImg(editing.found_img);
      if (editing.repair_img && editing.repair_img !== payload.repair_img) removeQualityImg(editing.repair_img);
    }
    if (editing === 'new' && bin === 'red') notifyRed(payload, payload.qty);
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
    setEditing(null);
    /* 🔴 เลือก "ทำลาย" ในฟอร์มแล้วบันทึก = ต้องย้ายลงถังแดงด้วย (บั๊ก A 10/11)
       เดิมบันทึกแค่ผล ไม่ย้าย ⇒ ใบหลุดคิวรอพิจารณา ไม่มีใบแดง ไม่เข้าสายขออนุมัติทำลาย
       ใช้ `toRed` ตัวเดิม (ถามยืนยันจำนวนก่อนย้าย · กดยกเลิก = ใบยังค้างในคิวพร้อมป้ายบอก ไม่หายเงียบ) */
    const decChanged = isY && editing !== 'new' && (payload.qa_decision || null) !== (editing.qa_decision || null);
    if (decChanged || (isY && editing !== 'new' && (payload.return_date || null) !== (editing.return_date || null))) {
      restampQ([editing.defect_log_id]);
    }
    if (isY && savedId && payload.qa_decision === 'scrap' && !redChildOf.has(savedId)) {
      await toRed({ ...(editing === 'new' ? {} : editing), ...payload, id: savedId });
    }
    load();   // ยกเลิก/ล้มใน toRed ก็ต้องรีเฟรช ให้เห็นใบที่ค้างพร้อมป้าย
  };

  /* 🔁 ผลพิจารณาเปลี่ยน ⇒ %Q ของกะที่ปิดไปแล้วต้องคิดใหม่ (oee.js §7.1/§7.2 · ค่าที่ stamp ตอนปิดกะเป็นค่าชั่วคราว)
     ล้ม = บอกบนจอ ห้ามเงียบ (ผลพิจารณาบันทึกไปแล้ว แต่รายงานยังเป็นเลขเก่า) */
  const restampQ = async (defectIds) => {
    const res = await restampSessionQByDefects(defectIds);
    if (!res.ok) toast.error(`บันทึกผลแล้ว แต่คิด %Q ของกะใหม่ไม่สำเร็จ: ${res.reason} — รายงาน %Q ของกะนั้นยังเป็นเลขเดิม แจ้ง admin`);
    else if (res.changed) toast.info(`อัปเดต %Q ของกะที่ปิดแล้ว ${res.changed} กะ ตามผลพิจารณา`);
  };

  /* 🔔 ของลงถังแดง = หัวหน้าแผนกต้องรู้ เพื่อทวงหัวหน้าไลน์ออกใบรายงานของเสีย (คำสั่ง user 10/11)
     ผู้รับตั้งที่ทะเบียน `notification_rules` (qbin_red_needs_scrap) ห้ามฮาร์ดโค้ด · fire-and-forget */
  const notifyRed = (row, qty) => notifyEvent({
    event: 'qbin_red_needs_scrap', type: 'error', ref_table: 'quality_bin_records',
    line_name: row.line_name || null, actor: fullName,
    lines: [
      `🏭 ไลน์: ${row.line_name || '—'} · ${row.part_no || row.part_name || row.mat_no || '—'}`,
      `🔢 ${qty} ชิ้น · แท็กแดงอายุ ${TAG_MAX_DAYS.red} วัน`,
      '📄 ต้องออกใบรายงานของเสีย (FM-PD2-002) เพื่อขออนุมัติทำลาย',
    ],
  });

  const remove = async (r) => {
    if (!canManage) { toast.error('ลบรายการของเสียต้องมีสิทธิ์ scrap:manage'); return; }
    if (!guardLines(r.line_name, 'การลบรายการในถัง')) return;
    if (!window.confirm(`ลบรายการ ${r.part_name || r.mat_no} (${r.qty} ชิ้น) ?`)) return;
    // soft delete — ใบเก่าต้องยังสืบย้อนได้ (บันทึกคุณภาพ ห้ามลบทิ้งจริง)
    // นับแถวที่เขียนจริง (กฎเขียน DB ข้อ 2) — 0 แถวแล้วขึ้น "ลบแล้ว" = จอโกหก แถวยังอยู่
    if (!checkWriteRows(await supabaseDR.from('quality_bin_records').update({ is_active: false }).eq('id', r.id).select('id'), 'ลบรายการ')) return;
    toast.success('ลบแล้ว'); load();
  };

  /** ซ่อมแล้ว NG → ย้ายลงถังแดง (ตามหมายเหตุท้ายฟอร์มเหลือง) */
  /** @param {{skipConfirm?:boolean}} opt — คนกดยืนยันมาแล้วจากคิวรอพิจารณา ⇒ ห้ามถามซ้ำ
   *  (CLAUDE.md §อนุมัติ: "ห้ามถามพร่ำเพรื่อ" — ถาม 2 กล่องติดกัน คนกดผ่านโดยไม่อ่านทั้งคู่) */
  const toRed = async (r, { skipConfirm = false } = {}) => {
    if (!canRecord) { toast.error('บัญชีนี้ไม่มีสิทธิ์บันทึกของเสีย (scrap:record)'); return; }
    /* จำนวนที่ย้าย: ซ่อมแล้ว NG มาก่อน · ถ้า QA ชี้ "ทำลาย" ตรงๆ โดยไม่ผ่านการซ่อม ใช้จำนวนทั้งใบ
       (WI §5.4 — ทำลายเป็น 1 ใน 3 ทางที่ QA เลือกได้ ไม่ได้บังคับให้ซ่อมก่อน) */
    if (!guardLines(r.line_name, 'การย้ายของลงถังแดง')) return;
    const qty = (Number(r.qty_ng) || 0) || (r.qa_decision === 'scrap' ? (Number(r.qty) || 0) : 0);
    if (!qty) { toast.error('ยังไม่ได้กรอกจำนวน NG หลังซ่อม (หรือให้ QA ชี้ผลเป็น 🔴 ทำลาย)'); return; }
    if (!skipConfirm && !window.confirm(`ย้าย ${qty} ชิ้นลงถังแดง?\n\n${r.part_name || r.mat_no}\nระบบจะสร้างรายการถังแดงที่ผูกกับใบนี้ให้`)) return;
    const { error } = await supabaseDR.from('quality_bin_records').insert({
      bin: 'red', work_date: today(), line_name: r.line_name,
      mat_no: r.mat_no, part_name: r.part_name, part_no: r.part_no,
      qty, cause: [r.cause, (Number(r.qty_ng) || 0) > 0 ? 'ซ่อมแล้ว NG (จากถังเหลือง)' : 'QA ชี้ทำลาย (จากถังเหลือง)'].filter(Boolean).join(' · '),
      reported_by: r.reported_by, qa_by: r.qa_by,
      from_yellow_id: r.id,
      /* 🔴 ส่งต่อ defect_log_id ของใบเหลือง — %Q อ่านคำตัดสินของสงสัยผ่าน embed ด้วยคีย์นี้ (suspectState)
         ไม่ส่ง = ใบแดงไม่โผล่ใน embed ⇒ ของที่ยืนยันเสียแล้วยังขึ้น "รอ QA" ตลอดกาล (QC 05/10) */
      defect_log_id: r.defect_log_id || null,
      /* 📷 รูปตอนพบเป็นของ "ชิ้นงานเดียวกัน" — ใบแดงที่ไม่มีรูปทั้งที่ใบเหลืองมี = หลักฐานขาดกลางทาง
         เก็บเป็น URL เดียวกัน ไม่ copy ไฟล์ (ใบเหลืองยังอ้างอยู่ ลบใบใดใบหนึ่งไม่ลบไฟล์ทิ้ง) */
      found_img: r.found_img || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('สร้างรายการถังแดงแล้ว — ไปกรอกผู้กำจัดทำลายที่แท็บถังแดง');
    notifyRed(r, qty);
    restampQ([r.defect_log_id]);
    load();   // ใบเหลืองใบนี้ต้องเปลี่ยนเป็น "🔴 ย้ายแล้ว" ทันที ไม่งั้นกดซ้ำได้
  };

  /* ═══ 🟡 เคลียร์คิว "รอพิจารณา" (2026-11-05 · คำสั่ง user) ═══════════════════════════
     *"หน้าสรุปงานที่ค้างเคลียร์จากรอพิจารณา เป็น rework ละดี หรือ rework ไม่ได้เป็นเสีย ยังไม่มี"*
     2 ทางหลักที่หน้างานใช้จริง + ทาง "ขอใช้" ที่ต้องมีใบ FM-QA-042 (ทำที่ฟอร์มเต็ม ไม่ใช่ปุ่มด่วน)
     🔴 ทุกปุ่มเขียนผ่าน `checkWriteRows` — RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error"
     🔴 ห้ามเดาผลให้ — ปุ่มคือ "คนกดตัดสิน" · ระบบตั้งแท็กให้เฉยๆ ไม่เคยตัดสินเอง */
  const decide = async (r, kind) => {
    if (!canDecide) { toast.error('ตัดสินผลถังเหลืองได้เฉพาะ QA (สิทธิ์ qa:bin_decide)'); return; }
    if (deciding) return;
    if (!guardLines(r.line_name, 'ผลพิจารณาของในถังเหลือง') || !guardSigner()) return;
    const qty = Number(r.qty) || 0;
    const when = today();
    /* 🔢 สายแบบใบ MO (10/11): "งานดี" = จบ · "ส่งซ่อม" = ขั้น 3 ฝ่ายผลิตซ่อม → ขั้น 4 QA ตรวจรับ
       🔴 ห้ามปิดใบซ่อมในคลิกเดียวอีก (เดิม "ซ่อมแล้วดี" ลงวันซ่อม+OK+กลับเข้ากระบวนการพร้อมกัน =
          ไม่มีใครตรวจรับงานซ่อมจริง) */
    const patch = kind === 'good'
      ? { qa_decision: 'good', qa_decision_at: new Date().toISOString(), qa_by: fullName || null, return_date: when }
      : { qa_decision: 'repair', qa_decision_at: new Date().toISOString(), qa_by: fullName || null };
    const label = kind === 'good' ? 'ตรวจแล้วใช้ได้' : 'ส่งซ่อม';
    if (!confirmSign({
      what: `ผลพิจารณา "${label}" — ${qty.toLocaleString()} ชิ้น`,
      docLabel: 'ใบถังเหลือง', orderNo: binDocLabel(r),
      actor: fullName || '(ไม่รู้ชื่อผู้ใช้)', as: 'ผู้พิจารณา (ช่อง QA บนใบ)',
      effect: kind === 'good'
        ? `ปิดออกจากถังเหลือง · บันทึกว่ากลับเข้ากระบวนการวันที่ ${when}`
        : 'ส่งให้ฝ่ายผลิตซ่อม (ขั้น 3) → ซ่อมเสร็จแล้ว QA ตรวจรับ (ขั้น 4)',
      warn: BIN_SIGN_WARN,
    })) return;
    setDeciding(r.id);
    /* รับผลใส่ตัวแปรก่อนแล้วค่อยส่งให้ `checkWriteRows` — เขียน `await supabase…` ลอยเป็น statement
       จะถูกด่าน `write-result-discarded` จับ (และของจริงคือล้มแล้วเงียบ) */
    const res = await supabaseDR.from('quality_bin_records').update(patch).eq('id', r.id).select('id');
    const ok = checkWriteRows(res, `บันทึกผลพิจารณา "${label}"`,
      { zeroMsg: 'บันทึกผลไม่สำเร็จ (0 แถว — อาจมีคนแก้ไปก่อน) · รีเฟรชแล้วลองใหม่' });
    setDeciding('');
    if (!ok) return;
    if (kind === 'good') {
      toast.success(`✅ ${label} ${qty} ชิ้น — ปิดออกจากถังเหลืองแล้ว`);
      restampQ([r.defect_log_id]);
    } else {
      toast.success(`🔧 ส่งซ่อม ${qty} ชิ้น — รอฝ่ายผลิตลงผลซ่อม แล้ว QA ตรวจรับ`);
      notifyStep('qbin_repair_needed', r, [`🔧 QA ให้ซ่อม ${qty} ชิ้น — ลงผลซ่อมที่ถังเหลือง (ขั้น 3)`]);
    }
    load();
  };

  /* 🔔 แจ้งคนของขั้นถัดไป (แบบใบ MO) — ผู้รับตั้งที่ทะเบียน notification_rules ห้ามฮาร์ดโค้ด */
  const notifyStep = (event, r, extra = []) => notifyEvent({
    event, type: 'info', ref_table: 'quality_bin_records', ref_id: r.id,
    line_name: r.line_name || null, actor: fullName,
    lines: [`🏭 ไลน์: ${r.line_name || '—'} · ${r.part_no || r.part_name || r.mat_no || '—'}`, ...extra],
  });

  /* ═══ ขั้น 3 — ฝ่ายผลิตลงผลซ่อม ═══ */
  const saveRepair = async () => {
    const f = repairing; if (!f) return;
    const r = f.row;
    if (!canRecord) { toast.error('ลงผลซ่อมต้องมีสิทธิ์ scrap:record'); return; }
    if (!guardLines(r.line_name, 'ผลซ่อมของในถังเหลือง') || !guardSigner()) return;
    const okQ = numOrNull(f.ok) ?? 0; const ngQ = numOrNull(f.ng) ?? 0;
    const qty = Number(r.qty) || 0;
    if (okQ < 0 || ngQ < 0) { toast.error('จำนวนติดลบไม่ได้'); return; }
    if (okQ + ngQ !== qty) { toast.error(`ซ่อมดี + ซ่อมไม่ได้ ต้องรวมเท่ากับจำนวนในใบ (${qty} ชิ้น) — ตอนนี้รวม ${okQ + ngQ}`); return; }
    if (!String(f.detail || '').trim()) { toast.error('กรอกรายละเอียดการซ่อม (ทำอะไร ตาม WI ไหน)'); return; }
    setDeciding(r.id);
    const res = await supabaseDR.from('quality_bin_records').update({
      repair_date: today(), repair_by: fullName || null, repair_detail: f.detail.trim(),
      qty_ok: okQ, qty_ng: ngQ, repair_reject_note: null,
    }).eq('id', r.id).eq('qa_decision', 'repair').select('id');
    const ok = checkWriteRows(res, 'ลงผลซ่อม', { zeroMsg: 'ลงผลซ่อมไม่สำเร็จ (0 แถว — QA อาจเปลี่ยนผลพิจารณาไปแล้ว) · รีเฟรชแล้วลองใหม่' });
    setDeciding('');
    if (!ok) return;
    setRepairing(null);
    toast.success(`🔧 ลงผลซ่อมแล้ว (ดี ${okQ} · ไม่ได้ ${ngQ}) — รอ QA ตรวจรับ`);
    notifyStep('qbin_repair_done', r, [`🔎 ซ่อมเสร็จ ดี ${okQ} · ไม่ได้ ${ngQ} ชิ้น — รอ QA ตรวจรับ (ขั้น 4)`, `📝 ${f.detail.trim()}`]);
    load();
  };

  /* ═══ ขั้น 4 — QA ตรวจรับงานซ่อม (ผ่าน = กลับเข้ากระบวนการ · NG ที่เหลือ → ถังแดง) ═══ */
  const acceptRepair = async (r) => {
    if (!canDecide) { toast.error('ตรวจรับงานซ่อมได้เฉพาะ QA (สิทธิ์ qa:bin_decide)'); return; }
    if (deciding) return;
    if (!guardLines(r.line_name, 'ตรวจรับงานซ่อม') || !guardSigner()) return;
    const okQ = Number(r.qty_ok) || 0; const ngQ = Number(r.qty_ng) || 0;
    const when = today();
    if (!confirmSign({
      what: `ตรวจรับงานซ่อม — ดี ${okQ.toLocaleString()} ชิ้น${ngQ ? ` · ซ่อมไม่ได้ ${ngQ.toLocaleString()} ชิ้น` : ''}`,
      docLabel: 'ใบถังเหลือง', orderNo: binDocLabel(r),
      actor: fullName || '(ไม่รู้ชื่อผู้ใช้)', as: 'QA ผู้ตรวจรับ (ติดแท็กเขียว)',
      effect: `ของดีกลับเข้ากระบวนการวันที่ ${when}${ngQ ? ` · ${ngQ} ชิ้นที่ซ่อมไม่ได้ย้ายลงถังแดง` : ''}`,
      warn: BIN_SIGN_WARN,
    })) return;
    setDeciding(r.id);
    const res = await supabaseDR.from('quality_bin_records').update({
      return_date: when, repair_accepted_by: fullName || null, repair_accepted_at: new Date().toISOString(),
    }).eq('id', r.id).not('repair_date', 'is', null).select('id');
    const ok = checkWriteRows(res, 'ตรวจรับงานซ่อม', { zeroMsg: 'ตรวจรับไม่สำเร็จ (0 แถว — ผลซ่อมอาจถูกตีกลับ/แก้ไปแล้ว) · รีเฟรชแล้วลองใหม่' });
    setDeciding('');
    if (!ok) return;
    toast.success(`✅ ตรวจรับแล้ว — ดี ${okQ} ชิ้นกลับเข้ากระบวนการ`);
    if (ngQ > 0 && !redChildOf.has(r.id)) await toRed({ ...r, return_date: when }, { skipConfirm: true });
    else restampQ([r.defect_log_id]);
    load();
  };
  const rejectRepair = async (r) => {
    if (!canDecide) { toast.error('ตีกลับงานซ่อมได้เฉพาะ QA (สิทธิ์ qa:bin_decide)'); return; }
    if (deciding) return;
    if (!guardLines(r.line_name, 'ตีกลับงานซ่อม') || !guardSigner()) return;
    /* ต้องพิมพ์เหตุผล = ด่านอยู่แล้ว ไม่ถามซ้ำ (กฎ "ห้ามถามพร่ำเพรื่อ") */
    const reason = window.prompt('ตีกลับงานซ่อม — เหตุผล (เช่น ยังมีครีบ / ขนาดไม่ได้):');
    if (reason == null) return;
    if (!reason.trim()) { toast.error('ต้องใส่เหตุผลการตีกลับ'); return; }
    setDeciding(r.id);
    const res = await supabaseDR.from('quality_bin_records').update({
      repair_date: null, qty_ok: null, qty_ng: null,
      repair_reject_note: reason.trim(), repair_reject_count: (Number(r.repair_reject_count) || 0) + 1,
    }).eq('id', r.id).is('return_date', null).select('id');
    const ok = checkWriteRows(res, 'ตีกลับงานซ่อม', { zeroMsg: 'ตีกลับไม่สำเร็จ (0 แถว — อาจตรวจรับไปแล้ว) · รีเฟรชแล้วลองใหม่' });
    setDeciding('');
    if (!ok) return;
    toast.success('↩️ ตีกลับให้ฝ่ายผลิตซ่อมใหม่แล้ว');
    notifyStep('qbin_repair_rejected', r, [`↩️ QA ตีกลับงานซ่อม: ${reason.trim()}`]);
    load();
  };

  /** 🔴 เสียแน่ → ตัดสิน scrap แล้วย้ายลงถังแดง (ใช้ตัวเดิม `toRed` ที่ผูก from_yellow_id ให้) */
  const decideScrap = async (r) => {
    if (!canDecide) { toast.error('ตัดสินผลถังเหลืองได้เฉพาะ QA (สิทธิ์ qa:bin_decide)'); return; }
    if (deciding) return;
    if (!guardLines(r.line_name, 'ผลพิจารณาของในถังเหลือง') || !guardSigner()) return;
    /* 🔴 "เสียแน่" = ตัดของทิ้งจริง + เปิดสายขออนุมัติทำลาย ⇒ ต้องถามยืนยันเหมือนกัน (เดิมไม่ถามเลย) */
    if (!confirmSign({
      what: `ผลพิจารณา "เสียแน่ — ซ่อมไม่ได้" ${(Number(r.qty) || 0).toLocaleString()} ชิ้น`,
      docLabel: 'ใบถังเหลือง', orderNo: binDocLabel(r),
      actor: fullName || '(ไม่รู้ชื่อผู้ใช้)', as: 'ผู้พิจารณา (ช่อง QA บนใบ)',
      effect: 'ติดแท็กแดง → ย้ายลงถังแดง เพื่อออกใบขออนุมัติทำลายตาม DOA',
      warn: BIN_SIGN_WARN,
    })) return;
    setDeciding(r.id);
    const res = await supabaseDR.from('quality_bin_records')
      .update({ qa_decision: 'scrap', qa_decision_at: new Date().toISOString(), qa_by: fullName || null })
      .eq('id', r.id).select('id');
    const ok = checkWriteRows(res, 'บันทึกผลพิจารณา "เสียแน่"',
      { zeroMsg: 'บันทึกผลไม่สำเร็จ (0 แถว — อาจมีคนแก้ไปก่อน) · รีเฟรชแล้วลองใหม่' });
    setDeciding('');
    if (!ok) return;
    /* ส่งแถวที่ "ตัดสินแล้ว" เข้า toRed — ไม่งั้นมันอ่าน qa_decision เก่า (null) แล้วหาจำนวนไม่เจอ */
    await toRed({ ...r, qa_decision: 'scrap' }, { skipConfirm: true });   // ถามไปแล้วที่ confirmSign ข้างบน
  };

  const doPrint = async () => {
    const ok = await printQualityBin({ bin, records: filtered });
    if (!ok) toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ของเว็บนี้ก่อน');
  };

  const B = BINS.find(b => b.key === bin);
  const isY = bin === 'yellow';
  const totalQty = filtered.reduce((a, r) => a + (Number(r.qty) || 0), 0);

  /* ═══ 🟡 คิวรอพิจารณา — "เคลียร์ว่ากลับมาดี หรือเสียแน่" (2026-11-05 · คำสั่ง user) ═══════
     ระบบตั้งแท็กเหลืองให้เองทุกครั้งที่ลงงานเสีย ⇒ ที่นี่คือจุดที่คน **ตัดสิน** และเคลียร์ออก
     🔴 โหลดไม่ได้ = เขียนบนจอ ห้ามขึ้น "ไม่มีงานค้าง" · 🔴 ซ่อนแถวที่เหลือต้องบอกจำนวน
     🏭 **หน้านี้ไม่ใช่บ้านของเอกสาร** — ทะเบียน/ใบเต็มอยู่ฝ่ายผลิต `/scrap-report?tab=bins`
        `/qa` เรียกด้วย `mode="queue"` = เห็นแค่คิวรออนุมัติของแผนก (คำสั่ง user 06/11) */
  const renderPendQueue = () => {
        const pend = pendingYellow(pendRows, redChildOf);
        const pcs = pend.reduce((a, r) => a + (Number(r.qty) || 0), 0);
        const over = pend.filter(r => binTagAge(r, todayWd)?.over).length;
        const show = pendAll ? pend : pend.slice(0, 8);
        return (
          <div style={{ background: 'var(--card)', border: '1px solid var(--amber-line)', borderRadius: 'var(--r-md)',
            padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: pend.length ? 10 : 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--amber)' }}>
                🟡 ค้างในสายถังเหลือง {pend.length} {trI18n('รายการ ·')} {pcs.toLocaleString()} ชิ้น
              </span>
              {over > 0 && (
                <span title={`เลยอายุแท็กเหลือง ${TAG_MAX_DAYS.yellow} วันตาม WI-PD3-087 §5.6`}
                  style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--red)', background: 'var(--red-dim)',
                    border: '1px solid var(--red-line)', borderRadius: 'var(--r-pill)', padding: '2px 9px' }}>
                  ⏱ เกินอายุแท็ก {over}
                </span>
              )}
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                ของที่ลงงานเสียแล้วยังไม่ตัดสินว่า <b style={{ color: 'var(--text2)' }}>{trI18n('ซ่อมกลับมาดีได้')}</b> {trI18n('หรือ')} <b style={{ color: 'var(--text2)' }}>{trI18n('เสียแน่')}</b>
              </span>
            </div>
            {/* 🔴 โหลดคิวไม่สำเร็จ ห้ามเงียบ */}
            {pendErr && (
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>
                ⚠️ {pendErr}
              </div>
            )}
            {pend.length === 0 && !pendErr && (
              /* 🔴 ระหว่างโหลดห้ามเขียนว่า "ไม่มีของค้าง" — คิวว่างเทียมคือจอโกหก */
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{loading ? trI18n('กำลังโหลด…') : trI18n('ไม่มีของค้างรอพิจารณา ✓')}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {show.map(r => {
                const age = binTagAge(r, todayWd);
                const busy = deciding === r.id;
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    background: 'var(--bg2)', borderRadius: 'var(--r-md)', padding: '7px 11px',
                    borderLeft: `3px solid ${age?.over ? 'var(--red)' : 'var(--amber)'}` }}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 }}>
                        <b style={{ color: 'var(--text)' }}>{r.part_no || r.part_name || r.mat_no || '—'}</b>
                        {r.part_no && r.part_name && <span style={{ color: 'var(--muted)' }}>{r.part_name}</span>}
                        <span style={{ fontWeight: 800, color: 'var(--amber)' }}>{(Number(r.qty) || 0).toLocaleString()} {trI18n('ชิ้น')}</span>
                        <span style={{ fontSize: 11, color: age?.over ? 'var(--red)' : 'var(--muted)', fontWeight: age?.over ? 800 : 400 }}>
                          {r.work_date}{age ? ` · ค้าง ${age.days} วัน` : ''}
                        </span>
                        {r.line_name && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {r.line_name}</span>}
                      </div>
                      {r.cause && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.cause}</div>}
                      {/* 🔢 ขั้นของใบ (แบบใบ MO) + รอใคร — ตัดสินที่ ncStep() ที่เดียว */}
                      {(() => {
                        const st = ncStep(r, { hasRedChild: redChildOf.has(r.id) });
                        const who = st.owner === 'qa' ? 'QA' : st.owner === 'prod' ? 'ฝ่ายผลิต' : '';
                        const late = st.key === 'repair' && r.repair_reject_note;
                        const flow = ncFlow(r, { hasRedChild: redChildOf.has(r.id) });   // 🪜 UI §6.30 — กฎที่ ncFlow() ที่เดียว
                        return st.step ? (<>
                          <StepFlow compact steps={flow.steps} unknown={!flow.known} style={{ marginTop: 3 }} />
                          <div style={{ fontSize: 11, fontWeight: 700, color: late ? 'var(--red)' : 'var(--text2)', marginTop: 2 }}>
                            ขั้น {st.step}/5 · {st.label}{who ? ` · รอ${who}` : ''}
                            {r.qty_ok != null && st.step === 4 && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> {trI18n('· ซ่อมดี')} {r.qty_ok} {trI18n('· ไม่ได้')} {r.qty_ng ?? 0}{r.repair_detail ? ` · ${r.repair_detail}` : ''}</span>}
                          </div>
                        </>) : null;
                      })()}
                    </div>
                    {(() => {
                      const st = ncStep(r, { hasRedChild: redChildOf.has(r.id) });
                      const B = (tone, label, onClick, title) => (
                        <button key={label} disabled={busy} onClick={onClick} title={title}
                          style={{ fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap', borderRadius: 'var(--r-md)', padding: '5px 11px',
                            cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
                            color: `var(--${tone})`, background: `var(--${tone}-dim)`, border: `1px solid var(--${tone}-line)` }}>
                          {label}
                        </button>
                      );
                      let btns = [];
                      if (st.key === 'qa_decide' && canDecide) btns = [
                        B('green', '✅ งานดี', () => decide(r, 'good'), 'ตรวจแล้วใช้ได้ — ติดแท็กเขียวแล้วกลับเข้ากระบวนการ (WI §5.4)'),
                        B('blue', '🔧 ส่งซ่อม', () => decide(r, 'repair'), 'ให้ฝ่ายผลิตซ่อมตาม SOP/WI (ขั้น 3) แล้ว QA ตรวจรับ (ขั้น 4)'),
                        B('red', '🔴 เสียแน่ → ถังแดง', () => decideScrap(r), 'ซ่อมไม่ได้/ไม่คุ้ม — ติดแท็กแดงแล้วย้ายลงถังแดง เพื่อออกใบขออนุมัติทำลาย'),
                      ];
                      else if (st.key === 'use_as_is_doc' && canDecide) btns = [
                        B('blue', `✏️ กรอกเลขใบ ${SPECIAL_USE_FORM}`, () => openEdit(r), 'ขอใช้ต้องมีเลขใบ FM-QA-042'),
                      ];
                      else if (st.key === 'repair' && canRecord) btns = [
                        B('blue', '🔧 ลงผลซ่อม', () => setRepairing({ row: r, ok: String(r.qty ?? ''), ng: '0', detail: '' }), 'ซ่อมเสร็จแล้ว — ลงจำนวนดี/ไม่ได้ ส่งให้ QA ตรวจรับ'),
                      ];
                      else if (st.key === 'repair_accept' && canDecide) btns = [
                        B('green', '✅ ตรวจรับ', () => acceptRepair(r), 'งานซ่อมผ่าน — ติดแท็กเขียว กลับเข้ากระบวนการ'),
                        B('amber', '↩️ ตีกลับ', () => rejectRepair(r), 'งานซ่อมไม่ผ่าน — ส่งกลับให้ฝ่ายผลิตซ่อมใหม่'),
                      ];
                      else if (st.key === 'to_red' && canRecord) btns = [
                        B('red', '🔴 ย้ายลงถังแดง', () => toRed(r), 'QA ชี้ทำลาย — ย้ายของลงถังแดงเพื่อออกใบรายงานของเสีย'),
                      ];
                      return btns.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{btns}</div> : null;
                    })()}
                  </div>
                );
              })}
            </div>
            {pend.length > 8 && (
              <button onClick={() => setPendAll(v => !v)}
                style={{ marginTop: 8, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)',
                  borderRadius: 'var(--r-md)', padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                {pendAll ? 'ย่อกลับ' : `แสดงอีก ${pend.length - 8} (ทั้งหมด ${pend.length})`}
              </button>
            )}
            {pend.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
                ขั้น 2 ตัดสิน · ขั้น 4 ตรวจรับ = <b>QA</b> {trI18n('(สิทธิ์ qa:bin_decide')}{canDecide ? ' ✓' : ' — บัญชีนี้ไม่มี'}) ·
                ขั้น 3 ลงผลซ่อม · ย้ายลงถังแดง = <b>{trI18n('ฝ่ายผลิต')}</b> {trI18n('(สิทธิ์ scrap:record')}{canRecord ? ' ✓' : ' — บัญชีนี้ไม่มี'})
              </div>
            )}
          </div>
        );
  };

  /* ═══ 🏭 โหมดคิว (/qa) — "งานค้างอนุมัติของแผนก" เท่านั้น ไม่ใช่ทะเบียนเอกสาร ════════════
     คำสั่ง user 2026-11-06: *"หลักๆอันนี้ต้องอยู่หมวดของผลิตนะ qa จะไปโชว์แค่พวกงานค้างอนุมัติ
     ของแผนก เพราะ หลักๆเอกสารอยู่ที่ผลิต"* ⇒ ที่นี่ไม่มีแถบกรอง/ตาราง/ปุ่มบันทึก/ทะเบียน WI
     🔴 ลิงก์ไปบ้านจริงโชว์เฉพาะคนที่เข้าหน้านั้นได้ — ลิงก์ที่กดแล้วเด้งกลับ = จอโกหก
     🔴 ขอบเขตของคิวต้องเขียนบนจอ (เห็นเฉพาะส่วนงานตัวเอง ≠ ทั้งโรงงานเคลียร์หมด) */
  /* 🔧 ขั้น 3 — โมดัลลงผลซ่อม (ฝ่ายผลิต) · ดี + ไม่ได้ ต้องรวมเท่าจำนวนในใบ */
  const renderRepairModal = () => repairing && (
    /* ห้ามปิดด้วยคลิกพื้นหลัง — มีช่องกรอก (ด่าน backdrop-close-form-modal) */
    <div className="overlay"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 16 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, width: 'min(96vw, 460px)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{trI18n('🔧 ลงผลซ่อม (ขั้น 3)')}</h3>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {binDocLabel(repairing.row)} · {Number(repairing.row.qty) || 0} ชิ้น — บันทึกแล้วส่งให้ QA ตรวจรับ (ขั้น 4)
        </div>
        {repairing.row.repair_reject_note && (
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 10 }}>{trI18n('↩️ QA ตีกลับรอบก่อน:')} {repairing.row.repair_reject_note}</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignContent: 'start' }}>
          <div><label style={lbl}>{trI18n('ซ่อมแล้วดี (ชิ้น)')}</label>
            <input type="number" min="0" value={repairing.ok} onChange={e => setRepairing(f => ({ ...f, ok: e.target.value }))} style={inp} /></div>
          <div><label style={lbl}>{trI18n('ซ่อมไม่ได้ (ชิ้น) → ถังแดงตอนตรวจรับ')}</label>
            <input type="number" min="0" value={repairing.ng} onChange={e => setRepairing(f => ({ ...f, ng: e.target.value }))} style={inp} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>{trI18n('รายละเอียดการซ่อม (ทำอะไร · ตาม WI ไหน) *')}</label>
            <input value={repairing.detail} onChange={e => setRepairing(f => ({ ...f, detail: e.target.value }))} style={inp} /></div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{trI18n('ผู้ซ่อม:')} {fullName || '—'} {trI18n('· วันที่')} {today()} {trI18n('· แนบรูปหลังซ่อมได้ที่ ✏️ แก้ไขรายการ')}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={() => setRepairing(null)} style={{ padding: '7px 16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontSize: 13 }}>{trI18n('ยกเลิก')}</button>
          <button disabled={!!deciding} onClick={saveRepair} style={{ padding: '7px 16px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>{trI18n('บันทึกผลซ่อม → ส่ง QA')}</button>
        </div>
      </div>
    </div>
  );

  if (queueOnly) return (
    <div>
      {renderRepairModal()}
      <ReadOnlyNote show={!canDecide} role={role} what="ตัดสินผลของในถังเหลือง (เฉพาะ QA)" permKey="qa:bin_decide" />
      {renderPendQueue()}
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.8 }}>
        📄 เอกสารตัวจริง (ใบรายงานของเสีย · ทะเบียนถังเหลือง/ถังแดง · อายุแท็ก · ทะเบียน WI ซ่อม) อยู่ที่<b>{trI18n('ฝ่ายผลิต')}</b>
        {canAccessPage('/scrap-report', role)
          ? <> → <Link to="/scrap-report?tab=bins" style={{ color: 'var(--accent)', fontWeight: 700 }}>{trI18n('ของเสีย: ใบรายงาน · ถังเหลือง/แดง ↗')}</Link></>
          : <> {trI18n('— หน้า')} <b>{trI18n('ของเสีย: ใบรายงาน · ถังเหลือง/แดง')}</b> {trI18n('(บัญชีนี้ยังไม่มีสิทธิ์เข้าหน้านั้น)')}</>}
        <br />
        {scopeRes.unsure
          ? <span style={{ color: 'var(--amber)', fontWeight: 700 }}>
              ⚠️ ยังตัดขอบเขตไม่ชัด ({scopeRes.reason === 'registry_unloaded'
                ? `โหลดทะเบียนไลน์ไม่สำเร็จ${linesErr ? `: ${linesErr}` : ''}`
                : scopeRes.reason === 'own_line_unknown' ? 'ไม่พบไลน์ที่บัญชีนี้สังกัดในทะเบียน'
                  : 'ส่วนงานของบัญชีนี้ไม่ตรงกับไลน์ไหนในทะเบียน'}) — ตัวเลขข้างบนอาจไม่ใช่ขอบเขตจริงของคุณ
            </span>
          : scopeNames
            ? <>{trI18n('🏷️ คิวนี้เฉพาะส่วนงานของคุณ (')}{scopeNames.length} ไลน์) — ของไลน์อื่นไม่ถูกนับในตัวเลขข้างบน</>
            : <>{trI18n('🏷️ คิวนี้ทั้งโรงงาน (บัญชีนี้ไม่ถูกจำกัดส่วนงาน)')}</>}
      </div>
    </div>
  );

  return (
    <div>
      {renderRepairModal()}
      <ReadOnlyNote show={!canRecord} role={role} what="บันทึกถังเหลือง/ถังแดง"
        permKey="scrap:record" />
      {/* ── แถบควบคุม ── */}
      {/* UI-STANDARD 2026-09-24: ตัวกรองของหน้าเป็น children ของ TimeRangeBar = แถบเดียว (เดิมแยก 2 ชั้น) */}
      <TimeRangeBar
        scale={tr.scale} from={from} to={to} today={tr.today} scales={null}
        onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset} style={{ marginBottom: 14 }}
      >
        {/* เลือกถัง = ตัวเลือก 2 ตัวที่เท่ากัน ⇒ Segmented อยู่ในแถบเดียว (เดิมเป็นแถวปุ่มแยกเหนือแถบกรอง) · สีถัง = ความหมาย */}
        <Segmented label={trI18n('ถัง')} value={bin} onChange={setBin}
          options={BINS.map(b => ({ value: b.key, label: b.label, color: b.color }))} />
        <LineSelect lines={lineObjs} value={lineFilter} onChange={setLineFilter} placeholder={ALL.line} />
        <SearchInput value={search} onChange={setSearch} fields="ชิ้นงาน / สาเหตุ / ผู้แจ้ง" />
        {/* ⏱️ ของค้างเกินอายุแท็ก — ปุ่มโผล่เฉพาะเมื่อมีของค้างจริง (ปุ่มที่กดแล้วว่างเปล่าเสมอ = คนเลิกกด)
            ไม่กระพริบ: เป็นงานค้าง ไม่ใช่ alarm (Andon convention) */}
        {overdueCount > 0 && (
          <button onClick={() => setOverdueOnly(v => !v)}
            title={`ของในถังที่เลยอายุแท็กตาม WI-PD3-087 §5.6 (🟡 ${TAG_MAX_DAYS.yellow} วัน · 🔴 ${TAG_MAX_DAYS.red} วัน) และยังไม่ถูกจัดการ`}
            style={{ padding: '7px 13px', borderRadius: 'var(--r-md)', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
              border: '1px solid #f97316', whiteSpace: 'nowrap',
              background: overdueOnly ? '#f97316' : 'transparent', color: overdueOnly ? '#2a1204' : '#f97316' }}>
            {trI18n('⏱ เกินอายุแท็ก')} {overdueCount}
          </button>
        )}
        <span className="spacer" />
        {canRecord && <button onClick={openNew} style={{ padding: '8px 18px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>{trI18n('+ บันทึกรายการ')}</button>}
        <button onClick={doPrint} style={{ padding: '8px 16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{trI18n('พิมพ์ใบ')} {trI18n(B.short)}</button>
        <button onClick={() => setShowWiReg(v => !v)}
          title={trI18n('ทะเบียน QRs ↔ WI การซ่อม ตาม WI-PD3-069 §6 — อาการไหนซ่อมตาม WI เล่มไหน')}
          style={{ padding: '8px 14px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: showWiReg ? 'var(--bg2)' : 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          {trI18n('ทะเบียน WI ซ่อม')}
        </button>
      </TimeRangeBar>

      {/* 🟡 คิวรอพิจารณา — แผงเดียวกันทั้ง 2 หน้า (ของหลักอยู่ฝ่ายผลิต · /qa เห็นแค่คิวนี้)
          🔴 โหมดคิวโชว์เสมอ: ว่างต้องเขียนว่า "ไม่มีของค้าง" ห้ามซ่อนแผงทิ้ง (กฎความซื่อสัตย์ของจอ) */}
      {(queueOnly || (isY && (pendErr || pendRows.length > 0))) && renderPendQueue()}

      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>
        {loading ? 'กำลังโหลด…' : `${filtered.length} รายการ · รวม ${totalQty.toLocaleString('th-TH')} ชิ้น`}
        {scopeNames && <span> {trI18n('· เฉพาะส่วนงานของคุณ (')}{scopeNames.length} ไลน์)</span>}
        {!loading && overdueCount > 0 && (
          <span style={{ color: '#f97316', fontWeight: 700 }}> {trI18n('· ⏱ เกินอายุแท็ก')} {overdueCount} {trI18n('รายการ')}</span>
        )}
        {!loading && overdueErr && (
          <span style={{ color: '#e05252', fontWeight: 700 }} title={overdueErr}> {trI18n('· ⚠️ รายการค้างเกินอายุแท็กอาจไม่ครบ (')}{overdueErr})</span>
        )}
        {overdueOnly && <span> {trI18n('· แสดงเฉพาะของค้าง (ทุกวันที่ ไม่ขึ้นกับช่วงที่เลือก)')} <button onClick={() => setOverdueOnly(false)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12.5, textDecoration: 'underline', padding: 0 }}>{trI18n('แสดงทั้งหมด')}</button></span>}
      </div>

      {/* ── ตาราง ── */}
      <div style={{ overflowX: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isY ? 1150 : 900 }}>
          <thead><tr style={{ background: 'var(--bg2)' }}>
            {(isY
              ? ['วันที่ลงถัง', 'อายุแท็ก', 'ชิ้นงาน', 'จำนวนรอพิจารณา', 'สาเหตุ', 'ผู้แจ้ง', 'ผล QA', 'ซ่อมเมื่อ', 'ผู้ซ่อม', 'QA', 'OK', 'NG', 'กลับเข้ากระบวนการ', '']
              : ['วันที่ลงถัง', 'อายุแท็ก', 'ชิ้นงาน', 'ไลน์', 'จำนวนเสีย', 'สาเหตุ', 'ผู้แจ้ง', 'QA', 'ผู้กำจัดทำลาย', 'ตำแหน่ง', 'ใบรายงานของเสีย', '']
            ).map((h, i) => <th key={i} style={th}>{trI18n(h)}</th>)}
          </tr></thead>
          <tbody>
            {!loading && !filtered.length && (
              <tr><td colSpan={14} style={{ ...td, textAlign: 'center', color: 'var(--muted)', padding: 28 }}>
                {overdueOnly ? (overdueErr ? 'โหลดรายการค้างไม่สำเร็จ — ดูข้อความเตือนด้านบน' : 'ไม่มีของค้างเกินอายุแท็ก 👍') : 'ไม่มีรายการในช่วงที่เลือก'}
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
                  if (closed) return <span style={{ fontSize: 11.5, color: 'var(--muted)' }} title={trI18n('ออกจากถังแล้ว — หยุดนับอายุแท็ก')}>{trI18n('✓ จบแล้ว')}</span>;
                  return (
                    <span style={{ fontSize: 11.5, fontWeight: age.over ? 800 : 600, color: age.over ? '#f97316' : 'var(--text2)' }}
                      title={`ลงถัง ${r.work_date} · อายุแท็กสูงสุด ${age.limit} วันตาม WI-PD3-087 §5.6`}>
                      {age.over ? '⏱ ' : ''}{age.days} / {age.limit} วัน
                      {age.over && <span style={{ display: 'block', fontSize: 11, fontWeight: 700 }}>{trI18n('เกิน')} {age.overBy} {trI18n('วัน')}</span>}
                    </span>
                  );
                })()}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{r.part_name || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.part_no || r.mat_no || ''}</div>
                  {/* มาจากบันทึกงานเสียใน Daily Report — บอกที่มาไว้ กันคีย์ซ้ำ */}
                  {r.defect_log_id && (
                    <div style={{ fontSize: 11, color: '#0ea5e9' }}
                      title={trI18n('สร้างจากบันทึกงานเสียในหน้า Daily Report — ไม่ได้คีย์ใหม่')}>
                      จาก Daily Report
                    </div>
                  )}
                  {/* 📷 ภาพย่อในตาราง — ไม่เพิ่มคอลัมน์ (หัวตาราง 2 ถังคนละชุด เพิ่มแล้วต้องแก้ 2 ที่)
                      กดแล้วเปิดรูปเต็มคนละแท็บ ไม่ต้องเปิดฟอร์มแก้ไขเพื่อดูรูป */}
                  {(r.found_img || r.repair_img) && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      {[['found_img', 'รูปตอนพบ'], ['repair_img', 'รูปหลังซ่อม']].map(([k, t]) => r[k] && (
                        <a key={k} href={r[k]} target="_blank" rel="noreferrer" title={t}>
                          {/* 🔴 loading="lazy" บังคับ — ระบบนี้ไม่มี image transform ภาพย่อ 34px
                              ก็ยังโหลดไฟล์เต็มใบ ⇒ เปิดตารางทีเดียวลากทุกแถว (ด่าน list-thumb-needs-lazy) */}
                          <img src={r[k]} alt={t} loading="lazy" style={{ height: 34, width: 45, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} />
                        </a>
                      ))}
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
                  if (!d) return <span style={{ fontSize: 11.5, color: '#f59e0b' }}>{trI18n('⏳ รอ QA พิจารณา')}</span>;
                  return (
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: d.color }} title={trI18n(d.hint)}>
                      {trI18n(d.label)}
                      {r.qa_decision === 'use_as_is' && (
                        r.special_use_doc_no
                          ? <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{SPECIAL_USE_FORM} {r.special_use_doc_no}</span>
                          : <span style={{ display: 'block', fontSize: 11, color: '#f59e0b' }}>{trI18n('⏳ รอเลขใบ')} {SPECIAL_USE_FORM}</span>
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
                  {r.from_yellow_id && <div style={{ fontSize: 11, color: '#f5b942' }}>{trI18n('🟡 มาจากถังเหลือง')}</div>}
                </td>}
                {/* 🔴 สาย DOA: ของในถังแดงต้องมีใบรายงานของเสีย (FM-PD2-002) เพื่อขออนุมัติทำลาย
                    ยังไม่ออกใบ = ส้มเตือน (งานค้าง ไม่ใช่ alarm — ไม่กระพริบ ตาม Andon convention) */}
                {!isY && <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {r.scrap_report_id && scrapDocs[r.scrap_report_id]?.status === SCRAP_DRAFT
                    /* 🔴 ใบร่าง ≠ ขออนุมัติแล้ว — ยังเป็นงานค้าง (บั๊ก B 10/11) */
                    ? <span title={trI18n('ผูกใบแล้วแต่ใบยังเป็นร่าง — ยังไม่ได้ส่งขออนุมัติทำลาย')}
                        style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--amber)' }}>
                        📝 {scrapDocs[r.scrap_report_id]?.doc_no || ''} ร่าง · ยังไม่ส่งอนุมัติ
                      </span>
                    : r.scrap_report_id
                    ? <span style={{ fontSize: 11.5, fontWeight: 700, color: '#22c55e' }}>
                        {scrapDocs[r.scrap_report_id]?.doc_no || 'ออกใบแล้ว'}
                      </span>
                    : <span title={trI18n('ยังไม่ได้ออกใบรายงานของเสีย — ไปที่หน้า 🗑️ ใบรายงานของเสีย แล้วกด ⤵ ดึงจากถังแดง')}
                        style={{ fontSize: 11.5, fontWeight: 700, color: '#f59e0b' }}>
                        ⏳ ยังไม่ออกใบ
                      </span>}
                </td>}
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {canRecord && <button onClick={() => openEdit(r)} title={trI18n('แก้ไข')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✏️</button>}
                  {/* 🔴 ย้ายลงถังแดง — เดิมโผล่เฉพาะเมื่อกรอก "ซ่อมแล้ว NG" แล้ว
                      แต่ WI §5.4 ให้ QA ชี้ "ทำลาย" ได้ตรงๆ โดยไม่ต้องผ่านการซ่อม ⇒ เปิดปุ่มให้ด้วย */}
                  {canRecord && isY && ((Number(r.qty_ng) || 0) > 0 || r.qa_decision === 'scrap') && !redChildOf.has(r.id) && (
                    <button onClick={() => toRed(r)}
                      title={(Number(r.qty_ng) || 0) > 0 ? trI18n('ซ่อมแล้ว NG → ลงถังแดง') : trI18n('QA ชี้ว่าทำลาย → ลงถังแดง')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>🔴</button>
                  )}
                  {isY && redChildOf.has(r.id) && (
                    <span title={trI18n('ย้ายลงถังแดงไปแล้ว')} style={{ fontSize: 11, color: '#e05252', fontWeight: 700 }}>{trI18n('🔴 ย้ายแล้ว')}</span>
                  )}
                  {canManage && <DeleteButton onClick={() => remove(r)} title={trI18n('ลบ')} />}
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
            /* ด่านนับปลายทางก่อนลบ — เลข WI ถูก "พิมพ์ลงใน fix_action" ของใบของเสีย/ใบเครื่องหยุด
               (ไม่ใช่คอลัมน์อ้างอิง) ⇒ นับแบบ substring · ดู utils/masterRefs.js */
            onBeforeDelete={masterDeleteGuard(supabaseDR, 'repair_wi_registry', r => r?.wi_no)}
            canManage={canManage} stampCol="updated_by_name" stampName={fullName}
            title={trI18n('ทะเบียน QRs ↔ WI การซ่อม')}
            help={trI18n('จาก WI-PD3-069 Rev.02 §6 — อาการที่ซ่อมได้ต้องอ้าง WI เล่มที่กำหนด · หัวหน้ากลุ่มจะเห็นชิปแนะนำ WI ตอนลงวิธีแก้ไขในหน้า Daily Report')}
            emptyText={trI18n('ยังไม่มีรายการ — เพิ่มจากตัว WI-PD3-069 §6')}
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
              {editing === 'new' ? 'บันทึกรายการ' : 'แก้ไขรายการ'} — {trI18n(B.short)}
            </h3>
            <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignContent: 'start' }}>
              <div><label style={lbl}>{trI18n('วันที่ลงถัง *')}</label>
                <input type="date" value={form.work_date} onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>{trI18n('ไลน์การผลิต')}</label>
                <LineSelect lines={lineObjs} value={form.line_name} style={inp}
                  onChange={v => setForm(f => ({ ...f, line_name: v }))} /></div>
              <div><label style={lbl}>{trI18n('จำนวน (ชิ้น) *')}</label>
                <input type="number" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} style={inp} /></div>

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>{trI18n('ชิ้นงาน (เลือกจาก Product Master หรือพิมพ์เอง)')}</label>
                {/* 2026-09-07 <ProductSelect> — สินค้าของครอบครัวไลน์ที่เลือกขึ้นก่อน · พิมพ์เองได้ (ของที่ยังไม่อยู่ในทะเบียนมาถึงถังจริง) พร้อมป้าย */}
                <ProductSelect value={form.mat_no} lines={famLines} allowFree freeHint="ชิ้นงานที่ยังไม่อยู่ใน Product Master" history={binMatHist}
                  placeholder={trI18n('MAT / รหัสชิ้นงาน')} inputStyle={inp}
                  onChange={({ mat_no, name, p_no, line_name, opt, known }) => {
                    const inReg = !!opt && known !== false; // กลุ่ม 📜 เคยบันทึกไว้ = นอกทะเบียน → ปฏิบัติเหมือนพิมพ์เอง (2026-09-07)
                    setMatLocked(inReg);
                    setForm(f => ({ ...f, mat_no, ...(inReg ? { part_name: name || f.part_name, part_no: p_no || f.part_no, line_name: f.line_name || line_name || '' } : {}) }));
                  }} /></div>
              {/* ตรง Product Master → ชื่อ/Part No. ล็อกตามทะเบียน (ล้าง MAT เพื่อแก้เอง) — กันสะกดชื่อชิ้นงานคนละแบบ */}
              <div><label style={lbl}>{trI18n('ชื่อชิ้นงาน')}</label>
                <input value={form.part_name} readOnly={matLocked} title={matLocked ? trI18n('ตาม Product Master — ล้างช่อง MAT เพื่อแก้เอง') : ''} onChange={e => setForm(f => ({ ...f, part_name: e.target.value }))} style={{ ...inp, opacity: matLocked ? 0.75 : 1 }} /></div>
              <div><label style={lbl}>{trI18n('Part No. (เลขลูกค้า)')}</label>
                <input value={form.part_no} readOnly={matLocked} title={matLocked ? trI18n('ตาม Product Master — ล้างช่อง MAT เพื่อแก้เอง') : ''} onChange={e => setForm(f => ({ ...f, part_no: e.target.value }))} style={{ ...inp, opacity: matLocked ? 0.75 : 1 }} /></div>

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>{trI18n('สาเหตุ')}</label>
                <input value={form.cause} onChange={e => setForm(f => ({ ...f, cause: e.target.value }))} style={inp} /></div>
              {/* 📷 รูปตอนพบ — ทางเลือก ห้ามบังคับ (หน้างานใส่ถุงมือ/รีบ · คำสั่ง user 12/10)
                  ประโยชน์หลัก: QA ตัดสิน 4 ทางจากรูปได้โดยไม่ต้องเดินไปดูของ และของที่ถูกซ่อม/
                  ทำลายไปแล้วยังสืบย้อนได้ว่าเสียยังไง */}
              <div style={{ gridColumn: '1 / -1' }}>
                <QualityPhotoField
                  label={trI18n('รูปตอนพบของเสีย')} hint={trI18n('ไม่บังคับ — แนบไว้ช่วยให้ QA ตัดสินได้โดยไม่ต้องเดินไปดูของ')}
                  url={form.found_img || null} file={foundFile}
                  onPick={(f) => { setFoundFile(f); if (!f) setForm(fm => ({ ...fm, found_img: '' })); }}
                />
              </div>
              {/* 2026-09-07 ชื่อคนเลือกจาก employees+profiles ผ่าน <PersonSelect> (คนในครอบครัวไลน์ขึ้นก่อน · เก็บชื่อ snapshot — ตาราง DR) */}
              <div><label style={lbl}>{trI18n('ผู้แจ้ง (พนักงาน)')}</label>
                <PersonSelect value={form.reported_by} source="both" lines={famLines} history={reportedHist} inputStyle={inp} onChange={({ name }) => setForm(f => ({ ...f, reported_by: name }))} /></div>
              <div><label style={lbl}>{trI18n('ผู้ตรวจสอบ (QA)')}</label>
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
                      <button key={d.value} type="button" title={canDecide ? trI18n(d.hint) : trI18n('ตัดสินผลได้เฉพาะ QA (สิทธิ์ qa:bin_decide)')}
                        disabled={!canDecide}
                        onClick={() => setForm(f => ({ ...f, qa_decision: on ? '' : d.value }))}
                        style={{ padding: '6px 12px', borderRadius: 'var(--r-md)', fontSize: 12.5, fontWeight: 800,
                          cursor: canDecide ? 'pointer' : 'not-allowed', opacity: canDecide || on ? 1 : 0.5,
                          border: `1px solid ${on ? d.color : 'var(--border2)'}`,
                          background: on ? `${d.color}22` : 'transparent', color: on ? d.color : 'var(--text2)' }}>
                        {trI18n(d.label)}
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
                    <label style={lbl}>{trI18n('เลขที่ใบ')} {SPECIAL_USE_FORM} {trI18n('(ใบขออนุมัติใช้ชิ้นส่วนเป็นกรณีพิเศษ)')}</label>
                    <input value={form.special_use_doc_no} placeholder={trI18n('ยังไม่ออกใบ = เว้นว่างไว้ก่อน (จะยังนับเป็นของค้างในถัง)')}
                      onChange={e => setForm(f => ({ ...f, special_use_doc_no: e.target.value }))} style={inp} />
                  </div>
                )}
                {form.qa_decision === 'scrap' && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: '#f59e0b', lineHeight: 1.5 }}>
                    ⚠ บันทึกแล้วอย่าลืมกดปุ่ม 🔴 ที่แถวนี้เพื่อสร้างรายการถังแดง — ระบบไม่ย้ายให้เอง
                    (“เอาของลงถังแดง” เป็นการกระทำจริงหน้างาน ต้องมีคนกดยืนยัน)
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{trI18n('ผลการซ่อม')}</div>
                <div><label style={lbl}>{trI18n('วันที่ซ่อมชิ้นงาน')}</label>
                  <input type="date" value={form.repair_date} onChange={e => setForm(f => ({ ...f, repair_date: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>{trI18n('ผู้ดำเนินการซ่อม')}</label>
                  <PersonSelect value={form.repair_by} source="both" lines={famLines} history={repairByHist} inputStyle={inp} onChange={({ name }) => setForm(f => ({ ...f, repair_by: name }))} /></div>
                <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>{trI18n('รายละเอียดการซ่อมชิ้นงาน')}</label>
                  <input value={form.repair_detail} onChange={e => setForm(f => ({ ...f, repair_detail: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>{trI18n('ผลซ่อม OK (ชิ้น)')}</label>
                  <input type="number" value={form.qty_ok} onChange={e => setForm(f => ({ ...f, qty_ok: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>{trI18n('ผลซ่อม NG (ชิ้น)')}</label>
                  <input type="number" value={form.qty_ng} onChange={e => setForm(f => ({ ...f, qty_ng: e.target.value }))} style={inp} /></div>
                <div><label style={lbl}>{trI18n('วันที่นำกลับเข้ากระบวนการ')}</label>
                  <input type="date" value={form.return_date} disabled={!canDecide} title={canDecide ? '' : trI18n('วันกลับเข้ากระบวนการ = QA ตรวจรับ (ขั้น 4) เท่านั้น')}
                    onChange={e => setForm(f => ({ ...f, return_date: e.target.value }))} style={inp} /></div>
                {/* 📷 รูปหลังซ่อม — ปิดลูป "ซ่อมแล้วใช้ได้จริง" คู่กับรายละเอียดการซ่อม (I DO I CHECK) */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <QualityPhotoField
                    label={trI18n('รูปหลังซ่อม')} hint={trI18n('ไม่บังคับ — คู่กับรายละเอียดการซ่อม ใช้ยืนยันว่าซ่อมแล้วใช้ได้จริง')}
                    url={form.repair_img || null} file={repairFile}
                    onPick={(f) => { setRepairFile(f); if (!f) setForm(fm => ({ ...fm, repair_img: '' })); }}
                  />
                </div>
              </>) : (<>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{trI18n('การกำจัดทำลาย (ตาม DOA)')}</div>
                <div><label style={lbl}>{trI18n('ผู้กำจัดทำลาย')}</label>
                  {/* เลือกคนแล้ว "ตำแหน่ง" เติมจากทะเบียน (positions master) อัตโนมัติ — ยังแก้เองได้ */}
                  <PersonSelect value={form.disposed_by} source="both" lines={famLines} history={disposedByHist} inputStyle={inp}
                    onChange={({ name, position, opt }) => setForm(f => ({ ...f, disposed_by: name, ...(opt && position ? { disposed_position: positionLabel(position) || position } : {}) }))} /></div>
                <div><label style={lbl}>{trI18n('ตำแหน่ง')}</label>
                  <input value={form.disposed_position} onChange={e => setForm(f => ({ ...f, disposed_position: e.target.value }))}
                    placeholder={trI18n('ระดับหัวหน้ากลุ่ม-วิศวกรขึ้นไป')} style={inp} /></div>
              </>)}

              <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>{trI18n('หมายเหตุ')}</label>
                <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inp} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button onClick={() => setEditing(null)} style={{ padding: '8px 18px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}>{trI18n('ยกเลิก')}</button>
              <button onClick={save} disabled={saving} style={{ padding: '8px 20px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', cursor: 'pointer', fontSize: 13, fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
                {saving ? trI18n('กำลังบันทึก…') : trI18n('บันทึก')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
