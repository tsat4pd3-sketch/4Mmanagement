/**
 * QaCheckSheet — ใบตรวจตามมาตรฐาน (Inspection Check Sheet) · แท็บใน /qa
 *
 * ปิดช่องว่างที่ /qa-setup ตั้งมาตรฐานไว้ (balloon + สเปค + Rank + ความถี่/n) แต่ไม่มีหน้าไหน
 * อ่าน `qa_inspection_items` ไปบันทึกผลจริง — จุด attribute (GO/NOGO) เลยไม่มีที่ลงผลเลย
 * (variable ไปได้ทางเดียวคือกด "ส่งเข้า SPC") · คำสั่ง user 2026-08-04
 *
 * 1 ใบ = พาร์ท + วันงาน + กะ + รอบที่  → qa_inspection_sheets
 * 1 แถวผล = 1 จุดตรวจในใบนั้น          → qa_inspection_results  (snapshot ชื่อ/สเปคไว้ในแถว)
 *
 * กติกาที่ยึด:
 *   - หมุดบนแบบ sync กับผลตรวจ (เขียว OK / แดง NG / เทา ข้าม) เหมือนจอตรวจ PM — UI-CONVENTIONS §5.1
 *   - รูปแบบพอดีกรอบทั้ง 2 แกน (สูตรเดียวกับ /qa-setup 2026-08-04) ห้าม object-fit เพราะพิกัด % จะเพี้ยน
 *   - NG ต้องกรอกรายละเอียดเสมอ (ผลตรวจที่ไม่บอกว่าเสียยังไง ใช้ต่อไม่ได้)
 *   - บันทึกทีละแถวทันที (หน้างานปิดจอ/แบตหมดแล้วต้องไม่หายทั้งใบ)
 *   - วันงานใช้ getWorkDate (ก่อน 08:00 = วันก่อนหน้า) ห้าม toISOString
 */
import { useState, useEffect, useMemo, useCallback, useRef, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { UserContext } from '../App';
import useIsMobile from '../utils/useIsMobile';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { inSectionScope } from '../utils/sectionScope';
import { nextDocNo } from '../utils/qaDocNo';
import CalloutPin from './CalloutPin';
import QaFmeQueue from './QaFmeQueue';
import { QA_STAGES, FME_SHEET_STAGE } from '../utils/qaStages';
import { notifyEvent } from '../utils/notifyEvent';
import { checkWrite } from '../utils/dbWrite';
import { specLabel, judgeVariable } from '../utils/qaSpec';
import { evalSequence } from '../utils/qaSequential';
import { can } from '../utils/permissions';
import QaPieceStepper from './QaPieceStepper';

/* ── helpers เวลา/วันงาน (กฎเดียวกับทั้งระบบ) ───────────────────────────── */
const getWorkDate = () => {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const getCurrentShift = () => {
  const h = new Date().getHours();
  return (h >= 8 && h < 20) ? 'day' : 'night';
};

const STAGE = QA_STAGES;
const RANK = { M: { label: 'M', color: '#f59e0b' }, SC: { label: 'SC', color: '#ef4444' } };
const JUDGE = {
  ok: { label: 'ผ่าน', color: '#22c55e' },
  ng: { label: 'ไม่ผ่าน', color: '#ef4444' },
  na: { label: 'ข้าม', color: '#6b7280' },
};

const inputSt = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)',
};
const ghostBtn = {
  padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)',
};
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };
const Chip = ({ label, color }) => (
  <span style={{
    display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
    background: `${color}22`, color, border: `1px solid ${color}55`, whiteSpace: 'nowrap',
  }}>{label}</span>
);

/* เรียงเลข balloon แบบ natural (H2 มาก่อน H10) — เหมือนหน้า setup */
const balloonSort = (a, b) =>
  String(a.balloon_no ?? '').localeCompare(String(b.balloon_no ?? ''), undefined, { numeric: true });

/* ความสูงกรอบดูแบบ ≈ 42% ของจอ (สูตรเดียวกับ /qa-setup — ให้แบบ+รายการอยู่ในจอเดียว) */
const calcViewH = () =>
  Math.round(Math.min(560, Math.max(240, (typeof window === 'undefined' ? 900 : window.innerHeight) * 0.42)));

export default function QaCheckSheet({ canRecord }) {
  const { role, lineId, sections, fullName } = useContext(UserContext);
  // ฝ่ายผลิต/หัวหน้าไลน์บันทึก action หลัง alarm (cross-function กับ QA) — คีย์แยกจาก qa:record
  const canAction = can('qa', 'record_action', role);
  const isMobile = useIsMobile();

  const [allLines, setAllLines] = useState([]);
  const [parts, setParts] = useState([]);
  const [partId, setPartId] = useState(null);
  const [items, setItems] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [activeDwgId, setActiveDwgId] = useState(null);

  const [workDate, setWorkDate] = useState(() => getWorkDate());
  const [shift, setShift] = useState(() => getCurrentShift());
  const [roundNo, setRoundNo] = useState(1);
  // ช่วงการตรวจของใบที่กำลังจะเปิด (setup_first/inprocess/final) — ตั้งจากคิวเรียกตรวจ FME
  // เดิมคอลัมน์ stage มีอยู่แต่ไม่เคยถูกเขียน · null = เหมือนเดิมทุกประการ
  const [sheetStage, setSheetStage] = useState(null);
  const [fmeObId, setFmeObId] = useState(null);   // งานตรวจในคิวที่ใบนี้กำลังตอบอยู่
  const fmeKeyRef = useRef(null);                 // คีย์ (พาร์ท|วัน|กะ) ที่คิวตั้งไว้

  const [sheet, setSheet] = useState(null);          // แถว qa_inspection_sheets ของคีย์ปัจจุบัน
  const [results, setResults] = useState([]);        // ผลของใบนั้น
  const [pieces, setPieces] = useState([]);          // ผลต่อชิ้น (ตรวจทีละชิ้น · 2026-09-07)
  const [actions, setActions] = useState([]);        // action ที่ปิด alarm แต่ละรอบ
  const [recent, setRecent] = useState([]);          // ใบตรวจล่าสุดของพาร์ทนี้
  const [drafts, setDrafts] = useState({});          // item_id → { values[], note, qty_ng }
  const [selItemId, setSelItemId] = useState(null);  // จุดที่ไฮไลต์ (คลิกหมุด ↔ แถว)
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDrawing, setShowDrawing] = useState(true);
  // ยังไม่ apply migration 20260804_qa_inspection_check_sheet → บอกให้ชัด แทนที่จะ error งงๆ ตอนกดบันทึก
  const [needMigration, setNeedMigration] = useState(false);

  // กรอบรูป: วัดความกว้างจาก div นอกที่ไม่ scroll + fit ทั้ง 2 แกน (ดู UI-CONVENTIONS §5.1)
  const boxRef = useRef(null);
  const wrapRef = useRef(null);
  const rowRefs = useRef({});
  const [boxW, setBoxW] = useState(0);
  const [natSize, setNatSize] = useState({ w: 0, h: 0 });
  const [imgBox, setImgBox] = useState({ w: 0, h: 0 });
  const [viewH, setViewH] = useState(() => calcViewH());

  useEffect(() => {
    const on = () => setViewH(calcViewH());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  /* ── scope ไลน์: leader = ครอบครัวไลน์ตัวเอง · role ที่ถูกจำกัด = ตาม sections ── */
  useEffect(() => {
    supabase.from('production_lines').select('id, name, section, parent_line_name')
      .then(({ data }) => setAllLines(data || []));
  }, []);
  const scopedLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const my = allLines.find(l => String(l.id) === String(lineId));
      return my ? getLineFamilyNames(allLines, my.name) : [];
    }
    if (sections && sections.length) return allLines.filter(l => inSectionScope(sections, l.section)).map(l => l.name);
    return null; // ไม่จำกัด
  }, [role, lineId, sections, allLines]);

  useEffect(() => {
    supabase.from('qa_parts').select('*').eq('is_active', true).order('part_no')
      .then(({ data }) => setParts(data || []));
  }, []);

  // ตัวเลือกพาร์ทต้อง scope ด้วย ไม่ใช่แค่ข้อมูล (กฎ dropdown-scope) — พาร์ทที่ไม่ผูกไลน์ยังเห็นได้
  const scopedParts = useMemo(() => {
    if (!scopedLineNames) return parts;
    const ok = new Set(scopedLineNames);
    return parts.filter(p => !p.line_name || ok.has(p.line_name));
  }, [parts, scopedLineNames]);

  useEffect(() => {
    setPartId(prev => (prev && scopedParts.some(p => p.id === prev)) ? prev : (scopedParts[0]?.id ?? null));
  }, [scopedParts]);

  const part = useMemo(() => scopedParts.find(p => p.id === partId) || null, [scopedParts, partId]);

  /* ── มาตรฐาน (จุดตรวจ + แบบ) ของพาร์ทที่เลือก ── */
  useEffect(() => {
    if (!partId) { setItems([]); setDrawings([]); setActiveDwgId(null); return; }
    let alive = true;
    (async () => {
      const [{ data: it }, { data: dw }] = await Promise.all([
        supabase.from('qa_inspection_items').select('*').eq('part_id', partId).eq('is_active', true),
        supabase.from('qa_part_drawings').select('*').eq('part_id', partId).order('sort').order('created_at'),
      ]);
      if (!alive) return;
      setItems((it || []).sort(balloonSort));
      setDrawings(dw || []);
      setActiveDwgId(dw?.[0]?.id ?? null);
      setNatSize({ w: 0, h: 0 });
    })();
    return () => { alive = false; };
  }, [partId]);

  /* คีย์ของใบที่ "กำลังแสดงอยู่" — ใช้กัน race ทั้งขาอ่านและขาเขียน (audit 2026-09-02)
     🔴 เดิม `loadSheet` ไม่มี guard และ `ensureSheet` ลัดวงจรด้วย `if (sheet?.id) return sheet`
        โดยไม่ตรวจว่าใบนั้นเป็นของคีย์ปัจจุบันไหม ⇒ QA เปลี่ยน "รอบที่" 1→2 (หรือเปลี่ยนพาร์ท)
        ระหว่างคิวรีรอบ 1 ยังไม่กลับ แล้วแตะจุดตรวจภายใน ~1 วินาที → ผลตรวจถูก upsert ด้วย
        `sheet_id` **ของรอบเดิม** โดยจอขึ้นเขียว "บันทึกแล้ว" ปกติ = บันทึกคุณภาพผิดใบแบบเงียบสนิท
        (และ NCR ที่เปิดจากแถวนั้นชี้ผิดรอบตามไปด้วย) */
  const sheetKey = `${partId}|${workDate}|${shift}|${roundNo}`;
  const sheetKeyRef = useRef(sheetKey);
  sheetKeyRef.current = sheetKey;
  const matchesKey = (s) => !!s && `${s.part_id}|${s.work_date}|${s.shift}|${s.round_no}` === sheetKeyRef.current;

  /* ── ใบตรวจของคีย์ปัจจุบัน (พาร์ท+วัน+กะ+รอบ) + ผลในใบ ── */
  const loadSheet = useCallback(async () => {
    if (!partId) { setSheet(null); setResults([]); return; }
    const myKey = `${partId}|${workDate}|${shift}|${roundNo}`;
    setLoading(true);
    const { data: sh, error } = await supabase.from('qa_inspection_sheets').select('*')
      .eq('part_id', partId).eq('work_date', workDate).eq('shift', shift).eq('round_no', roundNo)
      .maybeSingle();
    // 42P01 = ตารางยังไม่มี (ยังไม่ apply migration) — ไม่ใช่ error ของ user
    if (error?.code === '42P01') { setNeedMigration(true); setSheet(null); setResults([]); setLoading(false); return; }
    if (sheetKeyRef.current !== myKey) return;   // ผู้ใช้เปลี่ยนคีย์ระหว่างรอ → ทิ้งผลรอบนี้
    setNeedMigration(false);
    let res = [], pcs = [], acts = [];
    if (sh?.id) {
      const [r1, r2, r3] = await Promise.all([
        supabase.from('qa_inspection_results').select('*').eq('sheet_id', sh.id),
        supabase.from('qa_inspection_pieces').select('*').eq('sheet_id', sh.id).order('piece_no'),
        supabase.from('qa_inspection_actions').select('*').eq('sheet_id', sh.id).order('round_no'),
      ]);
      res = r1.data || []; pcs = r2.data || []; acts = r3.data || [];
      // ตาราง pieces/actions ยังไม่ apply migration → บอกชัด ไม่ปล่อยให้ตัวเดินกฎคิดว่าใบว่าง
      if (r2.error?.code === '42P01' || r3.error?.code === '42P01') { setNeedMigration(true); }
    }
    // เช็คซ้ำหลัง await ตัวที่ 2 — ห้าม setDrafts({}) ทับค่าที่ผู้ใช้เพิ่งพิมพ์ในคีย์ใหม่
    if (sheetKeyRef.current !== myKey) return;
    setSheet(sh || null);
    setResults(res);
    setPieces(pcs);
    setActions(acts);
    setDrafts({});
    setLoading(false);
  }, [partId, workDate, shift, roundNo]);
  useEffect(() => { loadSheet(); }, [loadSheet]);

  const loadRecent = useCallback(async () => {
    if (!partId) { setRecent([]); return; }
    // ตารางยังไม่มี = ไม่มีประวัติให้โชว์ (banner ด้านบนบอกสาเหตุแล้ว)
    const { data } = await supabase.from('qa_inspection_sheets').select('*')
      .eq('part_id', partId).order('work_date', { ascending: false }).order('round_no', { ascending: false }).limit(12);
    setRecent(data || []);
  }, [partId]);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const resById = useMemo(() => {
    const m = new Map();
    results.forEach(r => { if (r.item_id) m.set(r.item_id, r); });
    return m;
  }, [results]);

  const summary = useMemo(() => {
    const total = items.length;
    let ok = 0, ng = 0, na = 0;
    items.forEach(i => {
      const j = resById.get(i.id)?.judgement;
      if (j === 'ok') ok++; else if (j === 'ng') ng++; else if (j === 'na') na++;
    });
    return { total, ok, ng, na, done: ok + ng + na, left: total - (ok + ng + na) };
  }, [items, resById]);

  /* เปลี่ยนพาร์ท/วัน/กะ เองหลังกดมาจากคิว = ไม่ใช่ใบที่คิวเรียกอีกต่อไป → ตัดการผูกทิ้ง
     (ไม่งั้นใบของรุ่นอื่นจะไปปิดคิวของรุ่นที่ถูกเรียก = ตรวจตกโดยระบบบอกว่าตรวจแล้ว) */
  useEffect(() => {
    if (!fmeObId) return;
    const key = `${partId}|${workDate}|${shift}`;
    if (fmeKeyRef.current && fmeKeyRef.current !== key) { setFmeObId(null); setSheetStage(null); }
  }, [partId, workDate, shift, fmeObId]);

  /* ── ผูกใบตรวจกลับไปที่คิวเรียกตรวจ (FME) ──────────────────────────────────
     acked = QA รับงานแล้ว (หยุดเตือนซ้ำ) · done_ok/done_ng = ปิดใบแล้ว
     ⚠️ best-effort แต่ **ห้ามเงียบ** — ถ้าเขียนไม่ได้ ห้องแชทจะโดนเตือนซ้ำทั้งที่ตรวจไปแล้ว */
  const linkFme = useCallback(async (sheetId, status) => {
    if (!fmeObId) return;
    const patch = { sheet_id: sheetId, status };
    if (status === 'acked') patch.acked_at = new Date().toISOString();
    else patch.done_at = new Date().toISOString();
    const { error } = await supabase.from('qa_fme_obligations').update(patch).eq('id', fmeObId);
    if (error) {
      console.warn('linkFme', error);
      toast.error('บันทึกผลตรวจสำเร็จ แต่ปิดคิวเรียกตรวจไม่ได้ — ระบบอาจเตือนซ้ำ (แจ้ง admin)');
    }
  }, [fmeObId]);

  /* ── สร้างใบเมื่อเริ่มบันทึกจริง (ไม่สร้างใบเปล่าทิ้งไว้) ── */
  const ensureSheet = useCallback(async () => {
    // ⚠️ ด่านสุดท้ายของขาเขียน — ต้องตรวจว่าใบใน state เป็นของคีย์ที่แสดงอยู่จริง
    //    เช็คแค่ `sheet?.id` ไม่พอ: ใบของรอบก่อนก็มี id เหมือนกัน แล้วผลตรวจจะลงผิดใบ
    if (matchesKey(sheet)) return sheet;
    if (!part) return null;
    const { data, error } = await supabase.from('qa_inspection_sheets').insert({
      part_id: part.id, part_no: part.part_no, part_name: part.part_name || null,
      line_name: part.line_name || null,
      work_date: workDate, shift, round_no: roundNo, stage: sheetStage,
      inspector_name: fullName || null, created_by: fullName || null,
    }).select().single();
    if (error) {
      // ใบถูกสร้างพร้อมกันจากอีกเครื่อง → ดึงของจริงมาใช้ต่อ (unique key กันซ้ำให้แล้ว)
      const { data: again } = await supabase.from('qa_inspection_sheets').select('*')
        .eq('part_id', part.id).eq('work_date', workDate).eq('shift', shift).eq('round_no', roundNo).maybeSingle();
      if (again) { setSheet(again); return again; }
      toast.error(`เปิดใบตรวจไม่สำเร็จ: ${error.message}`);
      return null;
    }
    setSheet(data);
    // มาจากคิวเรียกตรวจ → ผูกใบกับงานตรวจ + นับว่า "รับงานแล้ว" (หยุดเตือนซ้ำทันที ไม่ต้องรอ cron)
    if (fmeObId) linkFme(data.id, 'acked');
    loadRecent();
    return data;
  }, [sheet, part, workDate, shift, roundNo, sheetStage, fullName, loadRecent, fmeObId, linkFme]);

  /* ── บันทึกผล 1 จุด (upsert ทันที) ── */
  const saveResult = useCallback(async (item, judgement, extra = {}) => {
    if (!canRecord) { toast.error('ไม่มีสิทธิ์บันทึกผลตรวจ'); return; }
    if (sheet?.status === 'done') { toast.error('ใบนี้ปิดแล้ว — เปิดรอบใหม่เพื่อตรวจเพิ่ม'); return; }
    const d = drafts[item.id] || {};
    const note = (extra.note ?? d.note ?? '').trim();
    if (judgement === 'ng' && !note) {
      toast.error('จุดที่ไม่ผ่าน ต้องกรอกรายละเอียดว่าเสียอย่างไร');
      setDrafts(p => ({ ...p, [item.id]: { ...d, judgement: 'ng', needNote: true } }));
      return;
    }
    setBusy(true);
    const sh = await ensureSheet();
    if (!sh) { setBusy(false); return; }
    const vals = extra.values ?? d.values ?? null;
    const payload = {
      sheet_id: sh.id, item_id: item.id,
      balloon_no: String(item.balloon_no ?? ''), characteristic: item.characteristic,
      item_type: item.item_type, spec_text: specOf(item),
      judgement,
      values_json: vals && vals.length ? vals : null,
      qty_checked: extra.qty_checked ?? item.sample_size ?? null,
      qty_ng: judgement === 'ng' ? (parseInt(extra.qty_ng ?? d.qty_ng, 10) || 1) : 0,
      note: note || null,
      recorded_by: fullName || null, recorded_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('qa_inspection_results')
      .upsert(payload, { onConflict: 'sheet_id,item_id' });
    setBusy(false);
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    setDrafts(p => { const n = { ...p }; delete n[item.id]; return n; });
    const { data } = await supabase.from('qa_inspection_results').select('*').eq('sheet_id', sh.id);
    setResults(data || []);
  }, [canRecord, sheet, drafts, ensureSheet, fullName]);

  /* ── ตรวจทีละชิ้น (sequential acceptance · 2026-09-07) ─────────────────────
     ตัวเดินกฎ = utils/qaSequential (จุดเดียว) · ใบปิดเองเมื่อ "ยอมรับ" — ไม่มีปุ่มปิดใบ/ผ่านทั้งหมดอีก
     ค่าต่อจุดต่อชิ้นยังลง qa_inspection_results.values_json (index = ชิ้นที่-1) ให้ pin/NCR/ประวัติเดิมอ่านได้ */
  const seq = useMemo(() => evalSequence(pieces, actions), [pieces, actions]);
  const shiftLabel = shift === 'day' ? 'กะเช้า' : 'กะดึก';

  const savePiece = useCallback(async (p) => {
    if (!canRecord) { toast.error('ไม่มีสิทธิ์บันทึกผลตรวจ'); return; }
    if (seq.state !== 'inspecting') { toast.error(seq.state === 'accepted' ? 'ใบนี้ยอมรับแล้ว' : 'ใบนี้รอ action อยู่ — ตรวจต่อไม่ได้'); return; }
    setBusy(true);
    const sh = await ensureSheet();
    if (!sh) { setBusy(false); return; }
    const pieceNo = seq.nextPiece, roundNo = seq.round;
    const now = new Date().toISOString();

    // 1) ผลต่อจุด — merge ค่าของชิ้นนี้เข้า array เดิม · judgement รวม: มี ng ชิ้นไหน = ng
    const rows = items.map(i => {
      const prev = resById.get(i.id);
      const j = p.judgements[i.id] || { judge: 'na', value: '', note: '' };
      const vals = Array.isArray(prev?.values_json) ? [...prev.values_json] : [];
      vals[pieceNo - 1] = i.item_type === 'variable' ? (j.value === '' || j.value == null ? null : Number(j.value)) : j.judge;
      const judgement = (j.judge === 'ng' || prev?.judgement === 'ng') ? 'ng'
        : (j.judge === 'ok' || prev?.judgement === 'ok') ? 'ok' : 'na';
      return {
        sheet_id: sh.id, item_id: i.id,
        balloon_no: String(i.balloon_no ?? ''), characteristic: i.characteristic,
        item_type: i.item_type, spec_text: specOf(i), judgement,
        values_json: vals.some(v => v != null) ? vals : null,
        qty_checked: (Number(prev?.qty_checked) || 0) + (j.judge !== 'na' ? 1 : 0),
        qty_ng: (Number(prev?.qty_ng) || 0) + (j.judge === 'ng' ? 1 : 0),
        note: j.note || prev?.note || null,
        recorded_by: fullName || null, recorded_at: now,
      };
    });
    if (!checkWrite(await supabase.from('qa_inspection_results').upsert(rows, { onConflict: 'sheet_id,item_id' }), 'ผลต่อจุด')) { setBusy(false); return; }

    // 2) ผลต่อชิ้น
    const { data: pc, error: pcErr } = await supabase.from('qa_inspection_pieces').insert({
      sheet_id: sh.id, round_no: roundNo, piece_no: pieceNo, result: p.result,
      failed_items: p.failedItems?.length ? p.failedItems : null,
      disposition: p.result === 'fail' ? (p.disposition || null) : null,
      remark: p.remark || null, recorded_by: fullName || null,
    }).select().single();
    if (pcErr) { setBusy(false); toast.error(`บันทึกชิ้นที่ ${pieceNo} ไม่สำเร็จ: ${pcErr.message}`); return; }

    // 3) scrap → ลงถังแดง (DR) ผูกกลับ — ล้มเหลวต้องบอก ไม่เงียบ (ชิ้นถูกทิ้งแต่ไม่มีบันทึก = สืบไม่ได้)
    if (p.disposition === 'scrap') {
      const failedTxt = (p.failedItems || []).map(f => `#${f.balloon_no} ${f.characteristic}`).join(', ');
      const { data: rb, error: rbErr } = await supabaseDR.from('quality_bin_records').insert({
        bin: 'red', work_date: workDate, line_name: part?.line_name || null,
        mat_no: part?.mat_no || null, part_name: part?.part_name || null, part_no: part?.part_no || null,
        qty: 1, cause: `ใบตรวจ QA ${workDate} ${shiftLabel} รอบ ${roundNo} · ชิ้นที่ ${pieceNo} ตก ${failedTxt}${p.remark ? ` — ${p.remark}` : ''}`,
        reported_by: fullName || null, qa_by: fullName || null,
      }).select('id').single();
      if (rbErr) toast.error(`บันทึกชิ้นแล้ว แต่ลงถังแดงไม่สำเร็จ: ${rbErr.message} — ไปลงที่แท็บถังแดงเอง`);
      else {
        checkWrite(await supabase.from('qa_inspection_pieces').update({ red_bin_id: rb.id }).eq('id', pc.id), 'ผูกถังแดงเข้าชิ้น');
        notifyEvent({ event: 'quality_bin_added', type: 'error', ref_table: 'quality_bin_records', ref_id: rb.id,
          line_name: part?.line_name || null, actor: fullName,
          lines: ['🔴 ถังแดง (ของเสียยืนยันแล้ว — จากใบตรวจ QA)', `🏭 ไลน์: ${part?.line_name || '—'} · ${part?.part_no || '—'}`, `🔢 1 ชิ้น · ${failedTxt}`] });
      }
    }

    // 4) เดินกฎใหม่ → เขียน cache บนใบ + ปิดใบ/alarm ตามผล
    const next = evalSequence([...pieces, pc], actions);
    const patch = { seq_round: next.round, seq_state: next.state, alarm_count: next.alarmCount };
    if (next.state === 'accepted') Object.assign(patch, { status: 'done', result: 'pass', closed_by: fullName || null, closed_at: now });
    if (!checkWrite(await supabase.from('qa_inspection_sheets').update(patch).eq('id', sh.id).select('id'), 'สถานะใบตรวจ')) { setBusy(false); loadSheet(); return; }
    if (next.state === 'accepted') {
      await linkFme(sh.id, 'done_ok');
      toast.success(next.acceptedBy === 'first_pass' ? 'ชิ้นแรกผ่านทุกจุด — ยอมรับ ปิดใบแล้ว ✓' : 'ผ่านติดกัน 2 ชิ้น — ยอมรับ ปิดใบแล้ว ✓');
    } else if (next.state === 'await_action') {
      const failedPieces = [...pieces, pc].filter(x => x.round_no === next.round && x.result === 'fail');
      notifyEvent({
        event: 'qa_seq_alarm', type: 'error', ref_table: 'qa_inspection_sheets', ref_id: sh.id,
        line_name: part?.line_name || null, actor: fullName,
        lines: [
          `🚨 ใบตรวจตกซ้ำ — ต้องแก้ไขก่อน QA ตรวจต่อ (alarm ครั้งที่ ${next.alarmCount})`,
          `🏭 ไลน์: ${part?.line_name || '—'} · พาร์ท: ${part?.part_no || '—'}${part?.part_name ? ` ${part.part_name}` : ''}`,
          `📅 ${workDate} ${shiftLabel} รอบ ${roundNo}${sheetStage ? ` · ${sheetStage}` : ''}`,
          `✕ ชิ้นที่ตก: ${failedPieces.map(x => `${x.piece_no} (${(x.failed_items || []).map(f => `#${f.balloon_no}`).join(',') || '—'})`).join(' · ')}`,
          'ฝ่ายผลิตบันทึก action ที่ /qa แท็บใบตรวจ แล้ว QA ตรวจต่อ 2 ชิ้นติดกัน',
        ],
      });
      toast.error(`ชิ้นที่ ${pieceNo} ตก — ครบเงื่อนไข alarm แล้ว ต้องมี action ก่อนตรวจต่อ`);
    } else {
      toast.success(p.result === 'fail' ? `บันทึกชิ้นที่ ${pieceNo} (ตก) — ต้องตรวจชิ้นที่ ${next.nextPiece} ต่อ` : `บันทึกชิ้นที่ ${pieceNo} ผ่าน — ต้องผ่านอีก 1 ชิ้นติดกัน`);
    }
    setBusy(false);
    loadSheet(); loadRecent();
  }, [canRecord, seq, ensureSheet, items, resById, fullName, pieces, actions, workDate, shiftLabel, part, sheetStage, linkFme, loadSheet, loadRecent]);

  const saveAction = useCallback(async (a) => {
    if (!canAction) { toast.error('ไม่มีสิทธิ์บันทึก action'); return; }
    if (seq.state !== 'await_action' || !sheet?.id) { toast.error('ใบนี้ไม่ได้รอ action'); return; }
    setBusy(true);
    const roundNo = seq.alarmRound;
    const failedTxt = pieces.filter(x => x.round_no === roundNo && x.result === 'fail')
      .flatMap(x => (x.failed_items || []).map(f => `#${f.balloon_no} ${f.characteristic}`)).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
    // ผูก 4M เมื่อคนเลือก (ห้ามสร้างอัตโนมัติเงียบๆ — บทเรียน 392 ใบ) · เข้าคิวอนุมัติหัวหน้า → QA ตามปกติ
    let four_m_log_id = null;
    if (a.fourM) {
      const { data: u } = await supabase.auth.getUser();
      const logData = {
        work_date: workDate, line_name: part?.line_name || null, category: a.fourM.category,
        description: `[ใบตรวจ QA ${part?.part_no || ''} · ${workDate} ${shiftLabel} รอบ ${roundNo}] ตกจุด ${failedTxt || '—'} — แก้ไข: ${a.text} (โดย ${a.by})`,
        requires_qa: true, created_by: u?.user?.id ?? null,
      };
      const { data: m4, error: m4Err } = await supabase.from('four_m_logs').insert(logData).select('id').single();
      if (m4Err) { setBusy(false); toast.error(`เปิดใบ 4M ไม่สำเร็จ: ${m4Err.message} — ยังไม่บันทึก action`); return; }
      four_m_log_id = m4.id;
      supabase.functions.invoke('send-notification', { body: { event: 'new_4m', log: logData } }).catch(() => {});
    }
    const { error } = await supabase.from('qa_inspection_actions').insert({
      sheet_id: sheet.id, round_no: roundNo, action_text: a.text, action_by: a.by, four_m_log_id, recorded_by: fullName || null,
    });
    if (error) { setBusy(false); toast.error(`บันทึก action ไม่สำเร็จ: ${error.message}`); return; }
    checkWrite(await supabase.from('qa_inspection_sheets').update({ seq_state: 'inspecting', seq_round: roundNo + 1 }).eq('id', sheet.id).select('id'), 'สถานะใบตรวจ');
    notifyEvent({
      event: 'qa_seq_action', type: 'info', ref_table: 'qa_inspection_sheets', ref_id: sheet.id,
      line_name: part?.line_name || null, actor: a.by,
      lines: [
        `🛠 ผลิตแก้ไขแล้ว — QA กลับมาตรวจต่อ (ต้องผ่านติดกัน 2 ชิ้น)`,
        `🏭 ไลน์: ${part?.line_name || '—'} · พาร์ท: ${part?.part_no || '—'}`,
        `📅 ${workDate} ${shiftLabel} รอบ ${roundNo} → รอบ ${roundNo + 1}`,
        `📝 ${a.text} (${a.by})${four_m_log_id ? ' · เปิดใบ 4M แล้ว' : ''}`,
      ],
    });
    setBusy(false);
    toast.success(`บันทึก action แล้ว — QA ตรวจต่อรอบที่ ${roundNo + 1}`);
    loadSheet();
  }, [canAction, seq, sheet, pieces, workDate, shiftLabel, part, fullName, loadSheet]);

  /* NG → เปิด NCR ผูกกลับมาที่แถวผล (ไม่ต้องพิมพ์ซ้ำ) */
  const openNcr = async (item, res) => {
    if (!canRecord) { toast.error('ไม่มีสิทธิ์เปิด NCR'); return; }
    if (res.ncr_id) { toast.info('จุดนี้เปิด NCR ไปแล้ว — ดูต่อที่แท็บ NCR ของเสีย'); return; }
    if (!window.confirm(`เปิดใบ NCR จากจุด #${item.balloon_no} ${item.characteristic}?`)) return;
    setBusy(true);
    const ncr_no = await nextDocNo('qa_ncr', 'ncr_no', 'NCR');
    const { data, error } = await supabase.from('qa_ncr').insert({
      ncr_no, report_date: workDate,
      line_name: part?.line_name || null, part_no: part?.part_no || null, part_name: part?.part_name || null,
      source: 'inprocess', severity: item.rank === 'SC' ? 'critical' : (item.rank === 'M' ? 'major' : 'minor'),
      defect_desc: `[ใบตรวจ ${workDate} ${shift === 'day' ? 'กะเช้า' : 'กะดึก'} รอบ ${roundNo}] จุด #${item.balloon_no} ${item.characteristic}`
        + (res.note ? ` — ${res.note}` : '') + (res.spec_text ? ` (สเปค: ${res.spec_text})` : ''),
      qty_found: res.qty_checked || 0, qty_ng: res.qty_ng || 0,
      created_by: fullName || null,
    }).select().single();
    if (error) { setBusy(false); toast.error(`เปิด NCR ไม่สำเร็จ: ${error.message}`); return; }
    checkWrite(await supabase.from('qa_inspection_results').update({ ncr_id: data.id }).eq('id', res.id), 'ผูก NCR เข้าผลตรวจ');
    notifyEvent({
      event: 'qa_ncr_opened', type: 'error', ref_table: 'qa_ncr', ref_id: data.id,
      line_name: part?.line_name || null, actor: fullName,
      lines: [
        `📄 ${ncr_no} · ${data.severity === 'critical' ? '🔴 critical' : data.severity === 'major' ? '🟠 major' : '🟡 minor'}`,
        `🏭 ไลน์: ${part?.line_name || '—'} · พาร์ท: ${part?.part_no || '—'}`,
        `🔍 จุด #${item.balloon_no} ${item.characteristic}`,
        `🚫 NG ${res.qty_ng || 0} / ตรวจ ${res.qty_checked || 0}`,
      ],
    });
    setBusy(false);
    toast.success(`เปิด ${ncr_no} แล้ว — ติดตามต่อที่แท็บ NCR ของเสีย ✓`);
    const { data: rs } = await supabase.from('qa_inspection_results').select('*').eq('sheet_id', sheet.id);
    setResults(rs || []);
  };

  /* ── รูปแบบ: fit ทั้ง 2 แกน + หมุด sync สีตามผลตรวจ ── */
  useEffect(() => {
    const el = boxRef.current;
    if (!el) { setBoxW(0); return; }
    const measure = () => setBoxW(el.clientWidth || 0);
    const ro = new ResizeObserver(measure);
    ro.observe(el); measure();
    return () => ro.disconnect();
  }, [activeDwgId, showDrawing, drawings.length]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) { setImgBox({ w: 0, h: 0 }); return; }
    const measure = () => setImgBox({ w: el.clientWidth || 0, h: el.clientHeight || 0 });
    const ro = new ResizeObserver(measure);
    ro.observe(el); measure();
    return () => ro.disconnect();
  }, [activeDwgId, showDrawing, drawings.length]);

  const fitScale = (natSize.w && natSize.h && boxW) ? Math.min(boxW / natSize.w, viewH / natSize.h) : 0;
  const imgW = fitScale ? Math.round(natSize.w * fitScale) : 0;
  const BK = Math.round(Math.max(22, Math.min(40, (imgBox.w || 500) * 0.04)));

  const activeDwg = drawings.find(d => d.id === activeDwgId) || null;
  const isPdf = activeDwg?.drawing_url?.toLowerCase().includes('.pdf');
  const pinItems = useMemo(() => items.filter(i =>
    i.pos_x != null && i.pos_y != null &&
    (i.drawing_id === activeDwgId || (!i.drawing_id && drawings[0]?.id === activeDwgId))
  ), [items, activeDwgId, drawings]);

  const pinColor = (i) => {
    const j = resById.get(i.id)?.judgement;
    if (j === 'ok') return JUDGE.ok.color;
    if (j === 'ng') return JUDGE.ng.color;
    if (j === 'na') return JUDGE.na.color;
    return i.rank ? RANK[i.rank].color : '#4d9fff';   // ยังไม่ตรวจ = สีตาม rank (เหมือนหน้า setup)
  };

  const focusItem = (id) => {
    setSelItemId(id);
    // คลิกหมุด → เลื่อนไปแถวของจุดนั้น (จอเล็กจะได้ไม่ต้องไล่หา)
    rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const selectRow = (i) => {
    setSelItemId(i.id);
    // จุดอยู่คนละแผ่น → สลับแผ่นให้เห็นหมุด
    if (i.pos_x != null && i.drawing_id && i.drawing_id !== activeDwgId) setActiveDwgId(i.drawing_id);
  };

  const readOnly = !canRecord || sheet?.status === 'done';

  /* ── UI ─────────────────────────────────────────────────────────────── */
  return (
    <div>
      {needMigration && (
        <div style={{
          ...cardSt, marginBottom: 12, borderColor: '#f59e0b',
          background: 'rgba(245,158,11,0.10)', color: 'var(--text2)', fontSize: 12.5,
        }}>
          ⚠️ <b>ยังใช้บันทึกผลไม่ได้</b> — ตารางใบตรวจยังไม่ถูกสร้างในฐานข้อมูล
          (ต้อง apply migration <code>20260804_qa_inspection_check_sheet.sql</code> ที่ Supabase project หลักก่อน)
          · ระหว่างนี้ยังดูมาตรฐาน/จุดตรวจของแต่ละพาร์ทได้ตามปกติ
        </div>
      )}

      {/* คิว "ฝ่ายผลิตเรียกตรวจ" — กดแล้วตั้งพาร์ท/วัน/กะ/ช่วงตรวจให้ตรงกับรุ่นที่ถูกเรียก */}
      <QaFmeQueue scopedLineNames={scopedLineNames} onOpen={(ob) => {
        setPartId(ob.part_id);
        setWorkDate(ob.work_date);
        setShift(ob.shift);
        setRoundNo(1);
        setSheetStage(FME_SHEET_STAGE[ob.stage] || null);
        setFmeObId(ob.id);
        fmeKeyRef.current = `${ob.part_id}|${ob.work_date}|${ob.shift}`;
        toast.info(`เปิดใบตรวจ: ${ob.line_name} · ${ob.mat_no} · ${ob.stage === 'end' ? 'ชิ้นสุดท้าย' : ob.stage === 'middle' ? 'ระหว่างผลิต' : 'ชิ้นแรก'}`);
      }} />

      {/* แถบเลือกใบ */}
      <div style={{ ...cardSt, marginBottom: 12 }}>
        <div className="mgrid" style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(220px, 2fr) 150px 130px 110px 1fr',
          alignItems: 'end',
        }}>
          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>พาร์ทที่ตรวจ</label>
            <select style={inputSt} value={partId || ''} onChange={e => setPartId(e.target.value || null)}>
              {scopedParts.length === 0 && <option value="">— ยังไม่มีพาร์ทในขอบเขตของคุณ —</option>}
              {scopedParts.map(p => (
                <option key={p.id} value={p.id}>
                  {p.part_no}{p.part_name ? ` · ${p.part_name}` : ''}{p.line_name ? ` (${p.line_name})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>วันงาน</label>
            <input type="date" style={inputSt} value={workDate} max={getWorkDate()}
              onChange={e => setWorkDate(e.target.value || getWorkDate())} />
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>กะ</label>
            <select style={inputSt} value={shift} onChange={e => setShift(e.target.value)}>
              <option value="day">☀️ กะเช้า</option>
              <option value="night">🌙 กะดึก</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>รอบที่</label>
            <input type="number" min={1} max={20} style={inputSt} value={roundNo}
              onChange={e => setRoundNo(Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)))} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            ผู้ตรวจ: <b style={{ color: 'var(--text2)' }}>{sheet?.inspector_name || fullName || '—'}</b>
            {part?.line_name && <div>ไลน์: <b style={{ color: 'var(--text2)' }}>{part.line_name}</b></div>}
          </div>
        </div>

        {/* สรุปสถานะใบ */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          {!items.length ? (
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              พาร์ทนี้ยังไม่มีจุดตรวจ — ตั้งมาตรฐานที่หน้า “มาตรฐานการตรวจ &amp; Drawing” ก่อน
            </span>
          ) : (
            <>
              <Chip label={`ตรวจแล้ว ${summary.done}/${summary.total}`} color={summary.left ? '#f59e0b' : '#22c55e'} />
              <Chip label={`ผ่าน ${summary.ok}`} color={JUDGE.ok.color} />
              {summary.ng > 0 && <Chip label={`ไม่ผ่าน ${summary.ng}`} color={JUDGE.ng.color} />}
              {summary.na > 0 && <Chip label={`ข้าม ${summary.na}`} color={JUDGE.na.color} />}
              {sheet?.status === 'done'
                ? <Chip label={sheet.result === 'pass' ? '✅ ปิดใบแล้ว — ผ่าน' : '⛔ ปิดใบแล้ว — ไม่ผ่าน'} color={sheet.result === 'pass' ? '#22c55e' : '#ef4444'} />
                : <Chip label={sheet ? '📝 กำลังตรวจ' : '○ ยังไม่เริ่มตรวจ'} color={sheet ? '#4d9fff' : '#6b7280'} />}
              <span style={{ flex: 1 }} />
              {/* ใบปิดเองเมื่อตัวเดินกฎบอก "ยอมรับ" — ไม่มีปุ่มปิดใบ/ผ่านทั้งหมด (ตรวจทีละชิ้น 2026-09-07) */}
              <Chip label={`ชิ้นที่ตรวจแล้ว ${pieces.length}`} color="#6b7280" />
            </>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: (!isMobile && showDrawing && drawings.length) ? 'minmax(320px, 5fr) 7fr' : 'minmax(0, 1fr)', alignItems: 'start' }}>
          {/* แบบ + หมุด sync ผลตรวจ */}
          {drawings.length > 0 && (
            <div style={{ ...cardSt, position: isMobile ? 'static' : 'sticky', top: 10 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13 }}>🖼 แบบ + จุดตรวจ</div>
                <span style={{ flex: 1 }} />
                <button style={ghostBtn} onClick={() => setShowDrawing(s => !s)}>
                  {showDrawing ? '▾ ซ่อนแบบ' : '▸ แสดงแบบ'}
                </button>
              </div>
              {showDrawing && (
                <>
                  {drawings.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      {drawings.map(d => (
                        <button key={d.id} onClick={() => { setActiveDwgId(d.id); setNatSize({ w: 0, h: 0 }); }}
                          style={{ ...ghostBtn, padding: '5px 10px', ...(d.id === activeDwgId ? { background: 'var(--accent-dim)', color: 'var(--accent)', borderColor: 'var(--accent)', fontWeight: 800 } : {}) }}>
                          {d.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {isPdf ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      แผ่นนี้เป็น PDF — ดูจุดตรวจได้จากรายการด้านขวา ·{' '}
                      <a href={activeDwg.drawing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>เปิดแบบ ↗</a>
                    </div>
                  ) : activeDwg && (
                    <div ref={boxRef}>
                      <div style={{ maxHeight: viewH, overflow: 'auto', borderRadius: 10, border: '1px solid var(--border2)', background: 'var(--bg2)' }}>
                        <div ref={wrapRef} style={{ position: 'relative', width: 'fit-content', margin: '0 auto' }}>
                          <img src={activeDwg.drawing_url} alt={activeDwg.title}
                            ref={el => { if (el?.complete && el.naturalWidth && !natSize.w) setNatSize({ w: el.naturalWidth, h: el.naturalHeight }); }}
                            style={{
                              display: 'block', height: 'auto',
                              width: imgW ? `${imgW}px` : 'auto',
                              maxWidth: imgW ? 'none' : (boxW ? `${boxW}px` : '100%'),
                              maxHeight: imgW ? 'none' : viewH,
                            }}
                            onLoad={e => setNatSize({ w: e.currentTarget.naturalWidth || 0, h: e.currentTarget.naturalHeight || 0 })} />
                          {pinItems.map(i => (
                            <CalloutPin key={i.id} xPct={i.pos_x} yPct={i.pos_y} layerW={imgBox.w} layerH={imgBox.h}
                              size={BK} label={i.balloon_no} color={pinColor(i)} selected={selItemId === i.id}
                              title={`#${i.balloon_no} ${i.characteristic}`}
                              onClick={() => focusItem(i.id)} />
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6, fontSize: 11.5, color: 'var(--muted)' }}>
                        <span>🟢 ผ่าน</span><span>🔴 ไม่ผ่าน</span><span>⚪ ข้าม</span><span>🔵/🟠 ยังไม่ตรวจ</span>
                        <span>· แตะหมุดเพื่อไปที่จุดนั้น</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div>
          {/* ตรวจทีละชิ้น — แผงหลักของการบันทึก (ถามตัวเดินกฎว่าต่อไปทำอะไร) */}
          {!needMigration && (
            <QaPieceStepper items={items} results={results} pieces={pieces} actions={actions} seq={seq}
              sheet={sheet} part={part} workDate={workDate} shift={shift}
              canRecord={canRecord && !loading} canAction={canAction} busy={busy} isMobile={isMobile} fullName={fullName}
              onSavePiece={savePiece} onSaveAction={saveAction} />
          )}

          {/* สรุปต่อจุด (อ่านอย่างเดียว — ค่าทุกชิ้นที่วัดแล้ว · เปิด NCR จากจุดที่ตกได้ที่นี่) */}
          <div style={{ ...cardSt, padding: 0 }}>
            <div style={{ padding: '12px 16px', fontWeight: 800, fontSize: 13.5, borderBottom: '1px solid var(--border)' }}>
              📋 สรุปต่อจุด ({items.length})
              {loading && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}> · กำลังโหลด…</span>}
              <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>
                {' '}· {readOnly && canRecord ? 'ใบปิดแล้ว' : !canRecord ? 'ไม่มีสิทธิ์บันทึก — ดูอย่างเดียว' : 'บันทึกที่แผงตรวจทีละชิ้นด้านบน'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {items.map(i => (
                <ItemRow key={i.id} item={i} res={resById.get(i.id)} draft={drafts[i.id]}
                  selected={selItemId === i.id} readOnly canRecord={canRecord} busy={busy} isMobile={isMobile}
                  rowRef={el => { rowRefs.current[i.id] = el; }}
                  onSelect={() => selectRow(i)}
                  onDraft={patch => setDrafts(p => ({ ...p, [i.id]: { ...(p[i.id] || {}), ...patch } }))}
                  onSave={(judgement, extra) => saveResult(i, judgement, extra)}
                  onOpenNcr={res => openNcr(i, res)} />
              ))}
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ประวัติใบตรวจของพาร์ทนี้ */}
      {recent.length > 0 && (
        <div style={{ ...cardSt, marginTop: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>🗂 ใบตรวจล่าสุดของพาร์ทนี้</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {recent.map(s => {
              const cur = s.id === sheet?.id;
              const color = s.status !== 'done' ? '#4d9fff' : (s.result === 'pass' ? '#22c55e' : '#ef4444');
              return (
                <button key={s.id} onClick={() => { setWorkDate(s.work_date); setShift(s.shift); setRoundNo(s.round_no); }}
                  style={{ ...ghostBtn, padding: '6px 10px', borderColor: cur ? 'var(--accent)' : `${color}55`, color, fontWeight: cur ? 800 : 600 }}>
                  {s.work_date} · {s.shift === 'day' ? '☀️' : '🌙'} รอบ {s.round_no}
                  {s.status === 'done' ? (s.result === 'pass' ? ' ✓' : ' ✕') : ' …'}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* สเปคที่ใช้ตัดสิน — ข้อความเดียวกับที่โชว์ในหน้า setup */
/* สเปค + ตัดสินอัตโนมัติ ย้ายไป utils/qaSpec.js (single source of truth · 2026-09-07)
   — label กับคำตัดสินต้องอ่าน limit ชุดเดียวกัน · ห้ามประกอบข้อความสเปคเองในหน้านี้อีก */
const specOf = specLabel;
const autoJudge = judgeVariable;

function ItemRow({ item, res, draft, selected, readOnly, canRecord, busy, isMobile, rowRef, onSelect, onDraft, onSave, onOpenNcr }) {
  const n = Math.min(10, Math.max(1, item.sample_size || 1));
  const values = draft?.values ?? (res?.values_json ?? Array(n).fill(''));
  const judged = res?.judgement;
  const color = judged ? JUDGE[judged].color : 'var(--border2)';
  const showNg = draft?.judgement === 'ng' || judged === 'ng';
  const auto = item.item_type === 'variable' ? autoJudge(item, values) : null;

  return (
    <div ref={rowRef} onClick={onSelect}
      style={{
        padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
        background: selected ? 'var(--bg3)' : 'transparent',
        borderLeft: `4px solid ${judged ? color : 'transparent'}`,
      }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span style={{
          minWidth: 34, height: 24, padding: '0 8px', borderRadius: 999, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: '#fff',
          background: judged ? color : (item.rank ? RANK[item.rank].color : '#4d9fff'),
        }}>{item.balloon_no}</span>

        {/* minWidth 200: จอแคบให้ปุ่ม/ช่องค่าตกบรรทัดใหม่ แทนที่จะบีบข้อความจนคำละบรรทัด (วัดจริง 390px การ์ดสูง 500px+ · 2026-09-07) */}
        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{item.characteristic}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            <span>สเปค: {specOf(item)}</span>
            {item.method && <span>· {item.method}</span>}
            {item.frequency && <span>· {item.frequency}</span>}
            {item.sample_size != null && <span>· n={item.sample_size}</span>}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
            <Chip label={item.item_type === 'variable' ? 'Variable' : 'Attribute'} color={item.item_type === 'variable' ? '#4d9fff' : '#a78bfa'} />
            {item.rank && <Chip label={`Rank ${item.rank}`} color={RANK[item.rank].color} />}
            {item.stage && <Chip label={STAGE[item.stage]?.label || item.stage} color={STAGE[item.stage]?.color || '#6b7280'} />}
            {res?.ncr_id && <Chip label="🚨 เปิด NCR แล้ว" color="#ef4444" />}
          </div>
        </div>

        {/* ค่าที่วัดได้ (variable) */}
        {item.item_type === 'variable' && (
          <div style={{ flex: '1 1 210px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Array.from({ length: n }).map((_, k) => (
                <input key={k} type="number" step="any" disabled={readOnly} placeholder={`#${k + 1}`}
                  value={values[k] ?? ''}
                  onChange={e => {
                    const v = [...values]; v[k] = e.target.value;
                    onDraft({ values: v });
                  }}
                  style={{ ...inputSt, width: 74, padding: '6px 8px', fontSize: 12.5 }} />
              ))}
            </div>
            {auto && (
              <div style={{ fontSize: 11.5, marginTop: 3, color: JUDGE[auto].color, fontWeight: 700 }}>
                ตัดสินอัตโนมัติ: {JUDGE[auto].label}
              </div>
            )}
          </div>
        )}

        {/* ปุ่มตัดสิน */}
        {!readOnly && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            <button className="tbtn" disabled={busy}
              onClick={() => {
                // ค่าที่วัดหลุดสเปคแล้วกด "ผ่าน" = บันทึกของเสียเป็นของดี → พาไปทาง NG แทน
                if (auto === 'ng') {
                  toast.error('ค่าที่วัดได้หลุดสเปค — บันทึกเป็น "ผ่าน" ไม่ได้ กรอกรายละเอียดแล้วบันทึก NG');
                  onDraft({ judgement: 'ng', values });
                  return;
                }
                onSave('ok', { values: values.filter(v => v !== '') });
              }}
              style={{ ...ghostBtn, padding: isMobile ? '10px 14px' : '7px 12px', background: judged === 'ok' ? JUDGE.ok.color : 'var(--bg3)', color: judged === 'ok' ? '#fff' : JUDGE.ok.color, borderColor: JUDGE.ok.color, fontWeight: 800 }}>
              ✓ ผ่าน
            </button>
            <button className="tbtn" disabled={busy}
              onClick={() => onDraft({ judgement: 'ng', values })}
              style={{ ...ghostBtn, padding: isMobile ? '10px 14px' : '7px 12px', background: judged === 'ng' ? JUDGE.ng.color : 'var(--bg3)', color: judged === 'ng' ? '#fff' : JUDGE.ng.color, borderColor: JUDGE.ng.color, fontWeight: 800 }}>
              ✕ ไม่ผ่าน
            </button>
            <button className="tbtn" disabled={busy} title="ไม่ได้ตรวจจุดนี้ในรอบนี้"
              onClick={() => onSave('na')}
              style={{ ...ghostBtn, padding: isMobile ? '10px 12px' : '7px 10px' }}>ข้าม</button>
          </div>
        )}
      </div>

      {/* ฟอร์ม NG — บังคับกรอกรายละเอียด */}
      {showNg && !readOnly && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }}
          onClick={e => e.stopPropagation()}>
          <div className="mgrid" style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '1fr 120px auto' }}>
            <input style={inputSt} placeholder="เสียอย่างไร / เจอที่ไหน (บังคับกรอก)"
              value={draft?.note ?? res?.note ?? ''} onChange={e => onDraft({ note: e.target.value, judgement: 'ng' })} />
            <input type="number" min={1} style={inputSt} placeholder="จำนวน NG"
              value={draft?.qty_ng ?? res?.qty_ng ?? 1} onChange={e => onDraft({ qty_ng: e.target.value, judgement: 'ng' })} />
            <button disabled={busy}
              onClick={() => onSave('ng', { values: values.filter(v => v !== ''), note: draft?.note ?? res?.note ?? '', qty_ng: draft?.qty_ng ?? res?.qty_ng ?? 1 })}
              style={{ ...ghostBtn, background: JUDGE.ng.color, color: '#fff', borderColor: JUDGE.ng.color, fontWeight: 800 }}>
              บันทึก NG
            </button>
          </div>
        </div>
      )}

      {/* ผลที่บันทึกแล้ว */}
      {judged && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip label={JUDGE[judged].label} color={JUDGE[judged].color} />
          {res.values_json?.length > 0 && <span>ค่าที่วัด: {res.values_json.join(', ')}</span>}
          {judged === 'ng' && res.qty_ng > 0 && <span>· NG {res.qty_ng} ชิ้น</span>}
          {res.note && <span>· 💬 {res.note}</span>}
          {res.recorded_by && <span>· โดย {res.recorded_by}</span>}
          {/* เปิด NCR ได้แม้ใบปิดแล้ว — NCR เป็นงานตามหลัง ไม่ใช่การแก้ผลตรวจ */}
          {judged === 'ng' && !res.ncr_id && canRecord && (
            <button onClick={e => { e.stopPropagation(); onOpenNcr(res); }} disabled={busy}
              style={{ ...ghostBtn, padding: '4px 10px', borderColor: '#ef4444', color: '#ef4444', fontWeight: 700 }}>
              🚨 เปิด NCR
            </button>
          )}
        </div>
      )}
    </div>
  );
}
