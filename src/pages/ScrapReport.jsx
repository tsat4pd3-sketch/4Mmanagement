/**
 * ScrapReport — ใบรายงานของเสีย FM-PD2-002 Rev.06 (paperless + export)
 *
 * 1 ใบ = 1 วัน/ไลน์ · ยอด main product ดึงตั้งต้นจากของเสียที่บันทึกใน Daily Report
 * (defect_logs ของ session ไลน์+วันนั้น) แล้วแก้/เพิ่มพาร์ทย่อยเองได้
 * · พาร์ท link จาก mat SAP หลัก (dr_products) หรือพาร์ทย่อย (bom_items)
 * · export Excel ตรงฟอร์ม 100% (src/lib/scrapExportExcel.js)
 *
 * ตาราง scrap_reports / scrap_report_items / scrap_defect_types อยู่ DR project
 * (anon เสมอ) · สิทธิ์: scrap:record = สร้าง/แก้ · scrap:manage = อนุมัติ/ลบ
 */
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import ReadOnlyNote from '../components/ReadOnlyNote';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { UserContext } from '../App';
import { getLineFamilyNames, toHierarchicalOptions } from '../utils/lineHierarchy';
import { inSectionScope } from '../utils/sectionScope';
import { canDelete } from '../utils/permissions';
import { usePerms } from '../utils/usePerms';
import { exportScrapReportExcel } from '../lib/scrapExportExcel';
import { printScrapReport } from '../lib/scrapPrint';
import { docFormSync, loadDocForms, fullCode } from '../utils/docForms';
import { PULLABLE, statusMeta, effQty, KIND_LABEL } from '../utils/materialRequest';
import { notifyEvent } from '../utils/notifyEvent';

/* ── date helpers (ห้าม toISOString หา work date — ดู CLAUDE.md) ── */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getWorkDate() {
  const now = new Date();
  if (now.getHours() < 8) { const y = new Date(now); y.setDate(y.getDate() - 1); return localDateStr(y); }
  return localDateStr(now);
}
const fmtD = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

const inputSt = { width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)' };
const btnSt = (bg = 'var(--accent)', color = '#fff') => ({ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: bg, color });
const ghostBtn = { padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' };
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };
const thSt = { padding: '6px 8px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)' };
const tdSt = { padding: '4px 6px', fontSize: 12, color: 'var(--text)', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };

const CODE_OPTS = [['A', 'A · FG'], ['B', 'B · SEMI'], ['C', 'C · RM/PART'], ['D', 'D · TRY-OUT'], ['E', 'E · อื่นๆ']];
const M_OPTS = [['m1', 'M1 คน'], ['m2', 'M2 เครื่อง'], ['m3', 'M3 วัตถุดิบ'], ['m4', 'M4 วิธีการ'], ['m5', 'M5 สะสาง']];
const STAGE_OPTS = [['in_process', 'ในกระบวนการ'], ['post_process', 'หลังจบผลิต']];
const CAT_OPTS = [['FG', 'FG'], ['SEMI', 'SEMI'], ['RM', 'RM'], ['TR', 'TR'], ['OTHER', 'อื่นๆ']];

const EMPTY_ITEM = () => ({
  _key: crypto.randomUUID(), source: 'main', part_no: '', part_name: '', mat_no: '', model: '',
  code: '', bom_ref: '', qty: '', m_cause: '', stage: 'in_process', confirm_qty: '', defect_codes: '',
  src_defect_from_logs: false,
  // ผูกกลับไปที่รายการในใบเบิก QA (null = กรอกเอง/ดึงจาก Daily Report) — สืบย้อนได้ว่าชิ้นนี้เบิกด้วยใบไหน
  src_request_item_id: null,
});

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14, width: `min(${width}px, 96vw)`, boxShadow: 'var(--shadow-lg)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

export default function ScrapReport() {
  const { fullName, role, lineId, sections } = useContext(UserContext);
  const { can } = usePerms();
  const canRecord = can('scrap', 'record');
  const canManage = can('scrap', 'manage');
  const canDel    = canDelete('scrap', 'manage', role);  // สิทธิ์ลบใบ แยกจากอนุมัติ (fallback = manage)

  const [reports, setReports] = useState([]);
  const [allLines, setAllLines] = useState([]);   // production_lines เต็ม (name/section/parent) ไว้คิด scope

  // ขอบเขตไลน์ที่เห็นได้: leader → เฉพาะครอบครัวไลน์ตัวเอง · role ที่ถูกจำกัด sections → เฉพาะไลน์ในส่วนงาน
  // qa/manager/admin (sections ว่าง = ไม่จำกัด) → เห็นทั้งโรงงานเหมือนเดิม · null = ไม่จำกัด
  const scopedLineNames = useMemo(() => {
    if (role === 'leader' && lineId) {
      const myLine = allLines.find(l => String(l.id) === String(lineId));
      return myLine ? getLineFamilyNames(allLines, myLine.name) : [];
    }
    if (sections && sections.length) return allLines.filter(l => inSectionScope(sections, l.section)).map(l => l.name);
    return null;
  }, [role, lineId, sections, allLines]);
  // object array (id/name/parent_line_name) — render dropdown จัดชั้นตามผัง (§5.3 ข้อ 8) · ค่า value ยังเป็น name เหมือนเดิม
  const lines = useMemo(() => {
    if (!scopedLineNames) return allLines;
    const ok = new Set(scopedLineNames);
    return allLines.filter(l => ok.has(l.name));
  }, [allLines, scopedLineNames]);
  const [defectTypes, setDefectTypes] = useState([]);
  const [listFrom, setListFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return localDateStr(d); });
  const [listTo, setListTo] = useState(getWorkDate());
  const [editor, setEditor] = useState(null); // { report, items } กำลังแก้/สร้าง
  const [sapPicker, setSapPicker] = useState(null); // { itemKey } | { addSource }
  const [defectPicker, setDefectPicker] = useState(null); // itemKey
  const [sapOptions, setSapOptions] = useState(null);
  const [sapSearch, setSapSearch] = useState('');
  const [reqPicker, setReqPicker] = useState(null); // ใบเบิก QA ที่ดึงเข้าใบนี้ได้ | null
  const [docReady, setDocReady] = useState(false); // ทะเบียนเอกสารโหลดแล้ว → subtitle ดึงเลขฟอร์มจาก registry (doc_key เดียวกับ export)
  const scrapFormNo = fullCode(docReady ? docFormSync('scrap_report', { form_code: 'FM-PD2-002', rev: 'Rev.06' }) : { form_code: 'FM-PD2-002', rev: 'Rev.06' }) || 'FM-PD2-002 Rev.06';

  const loadReports = useCallback(async () => {
    if (scopedLineNames && scopedLineNames.length === 0) { setReports([]); return; } // ถูก scope แต่ไม่มีไลน์ → ว่าง
    let q = supabaseDR.from('scrap_reports').select('*')
      .gte('report_date', listFrom).lte('report_date', listTo);
    if (scopedLineNames) q = q.in('line_name', scopedLineNames);   // ดัน scope เข้า query
    const { data } = await q.order('report_date', { ascending: false }).order('created_at', { ascending: false });
    setReports(data || []);
  }, [listFrom, listTo, scopedLineNames]);
  useEffect(() => { loadReports(); }, [loadReports]);

  useEffect(() => {
    // ⚠️ production_lines อยู่ MAIN project (client supabase) ไม่ใช่ DR — ดึงผิด client = dropdown ว่าง
    supabase.from('production_lines').select('id, name, section, parent_line_name').order('name').then(({ data }) => setAllLines(data || []));
    supabaseDR.from('scrap_defect_types').select('*').eq('is_active', true).order('sort_order').then(({ data }) => setDefectTypes(data || []));
    loadDocForms().then(() => setDocReady(true));
  }, []);

  /* ── SAP / พาร์ทย่อย picker (dr_products main + bom_items/parts_master sub) ──
     parts_master เข้ามาด้วย (2026-08-06) — พาร์ทซื้อนอก/วัตถุดิบ (300/500) ที่ยังไม่ถูกผูกใน BOM
     ของสินค้าใดเลย เดิมไม่ขึ้นให้เลือก ต้องกรอกมือ · dedupe ด้วย mat_no (dr_products > bom_items > parts_master) */
  useEffect(() => {
    if (!sapPicker || sapOptions !== null) return;
    let alive = true;
    (async () => {
      const [{ data: prods }, { data: boms }, { data: macs }, pmRes] = await Promise.all([
        supabaseDR.from('dr_products').select('mat_no, p_no, name, code, line_name').eq('is_active', true).order('name'),
        supabaseDR.from('bom_items').select('mat_no, part_no, part_name, product_id').eq('is_active', true).order('part_name'),
        supabaseDR.from('machines').select('machine_no'),   // ไว้จับ p_no ที่กรอกเป็นหมายเลขเครื่อง (master ผิด)
        supabaseDR.from('parts_master').select('mat_no, part_no, part_name').eq('is_active', true).order('part_name').then(r => r, () => ({ data: [] })),
      ]);
      if (!alive) return;
      // ⚠️ dr_products.p_no บางไลน์ถูกกรอกเป็น "หมายเลขเครื่อง" (เจอจริง SUB APRON: SP-72/74/83/88)
      //    ซึ่งไม่ใช่เลขพาร์ทลูกค้า → ใบรายงานของเสียพิมพ์ออกมาผิด · ไม่แก้ข้อมูลให้เงียบๆ แต่ทำ 2 อย่าง:
      //    (1) ไม่เอาค่านั้นมาเป็น part_no (ปล่อยว่างให้กรอกเอง) (2) ติดธง badMaster ให้ UI เตือนไปแก้ที่ Product Master
      const machineNos = new Set((macs || []).map(m => (m.machine_no || '').trim().toUpperCase()).filter(Boolean));
      const isMachineNo = v => machineNos.has((v || '').trim().toUpperCase());
      const opts = [
        ...(prods || []).map(p => {
          const bad = isMachineNo(p.p_no);
          return { source: 'main', mat_no: p.mat_no || '', part_no: bad ? '' : (p.p_no || p.mat_no || ''), part_name: p.name || '', line_name: p.line_name || '', badMaster: bad ? p.p_no : '' };
        }),
        ...(boms || []).map(b => ({ source: 'sub', mat_no: b.mat_no || '', part_no: b.part_no || b.mat_no || '', part_name: b.part_name || '', line_name: '', badMaster: '' })),
        ...(pmRes?.data || []).map(m => ({ source: 'sub', mat_no: m.mat_no || '', part_no: m.part_no || m.mat_no || '', part_name: m.part_name || '', line_name: '', badMaster: '' })),
      ].filter(o => o.mat_no || o.part_no || o.part_name)
        .filter((o, i, arr) => !o.mat_no || arr.findIndex(x => x.mat_no === o.mat_no) === i);
      setSapOptions(opts);
    })();
    return () => { alive = false; };
  }, [sapPicker, sapOptions]);

  const sapMatches = useMemo(() => {
    const q = sapSearch.trim().toLowerCase();
    if (!sapOptions || q.length < 2) return [];
    return sapOptions.filter(o => [o.mat_no, o.part_no, o.part_name].some(v => (v || '').toLowerCase().includes(q))).slice(0, 12);
  }, [sapOptions, sapSearch]);

  /* ── สร้างเลขเอกสาร running รายเดือน ── */
  const nextDocNo = async (date) => {
    const ym = date.slice(0, 7).replace('-', '');
    // ใช้ "เลขสูงสุดที่มีในเดือน + 1" ไม่ใช่ count(ถึงวันนี้)+1 — กันเลขชนเมื่อลงใบย้อนวัน
    // (count ถึงวันที่ย้อนหลังจะได้เลขที่ออกไปแล้ว = ซ้ำ) · เทียบทั้งเดือนจาก doc_no ที่มีอยู่จริง
    const [y, mo] = date.slice(0, 7).split('-').map(Number);
    const monthStart = `${date.slice(0, 7)}-01`;
    const nextMonth = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
    const { data } = await supabaseDR.from('scrap_reports').select('doc_no')
      .gte('report_date', monthStart).lt('report_date', nextMonth);
    let maxSeq = 0;
    (data || []).forEach(r => { const m = /TSAT4-PDX\s+(\d+)/.exec(r.doc_no || ''); if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10)); });
    const running = maxSeq + 1;
    return `TSAT4-PDX ${String(running).padStart(4, '0')}/${ym.slice(4)}-${ym.slice(2, 4)}`;
  };

  /* ── เปิด editor: ใบใหม่ (พร้อม prefill จาก defect_logs) หรือแก้ใบเดิม ── */
  const openNew = () => {
    setEditor({
      report: {
        id: null, report_date: getWorkDate(), line_name: '', dept: '', section: '', division: 'TSAT4',
        product_categories: [], storage_location: '', doc_no: '',
        inspector_name: '', requester_name: '', approver_qa_name: '', approver_pd_name: '', approver_gm_name: '',
        sender_name: '', receiver_name: '', status: 'draft',
      },
      items: [],
    });
  };

  const openEdit = async (rep) => {
    const { data: items } = await supabaseDR.from('scrap_report_items').select('*').eq('report_id', rep.id).order('seq');
    setEditor({ report: { ...rep, product_categories: rep.product_categories || [] }, items: (items || []).map(it => ({ ...it, _key: it.id })) });
  };

  /* ดึงยอดของเสียตั้งต้นจาก Daily Report (defect_logs) ของไลน์+วันในใบ */
  /* ── ทางที่ 2: ดึงของที่ QA เบิกไปทดสอบแบบทำลาย (ใบ FM-STO-003) ───────────────
     ⚠️ ดึงได้เฉพาะใบที่อนุมัติแล้วขึ้นไป (PULLABLE) — ใบที่ยังไม่อนุมัติแปลว่ายังไม่ได้ของ
        เอามารายงานว่าทำลายไปแล้วไม่ได้ · เกณฑ์อยู่ที่ utils/materialRequest.js ห้ามเขียนซ้ำ */
  const openReqPicker = async () => {
    const { report } = editor;
    let q = supabaseDR.from('material_requests').select('*')
      .in('status', PULLABLE).eq('kind', 'withdraw')
      .order('request_date', { ascending: false }).limit(100);
    const { data, error } = await q;
    if (error) {
      toast.error(error.code === '42P01'
        ? 'ยังไม่ได้ apply migration ของใบเบิก — แจ้งผู้ดูแลระบบ'
        : 'โหลดใบเบิกไม่สำเร็จ: ' + error.message);
      return;
    }
    // ใบของไลน์นี้ขึ้นก่อน แต่ไม่ตัดใบอื่นทิ้ง (ใบเบิกอาจไม่ได้ระบุไลน์ — ไม่ใช่ช่องบังคับบนใบกระดาษ)
    const list = (data || []).slice().sort((a, b) =>
      (b.line_name === report.line_name) - (a.line_name === report.line_name));
    if (!list.length) { toast.info('ยังไม่มีใบเบิกที่อนุมัติแล้ว — ออกใบที่หน้า QA → ใบเบิกทดสอบ'); return; }
    setReqPicker(list);
  };

  const applyRequest = async (r) => {
    const { data, error } = await supabaseDR.from('material_request_items')
      .select('*').eq('request_id', r.id).order('seq');
    if (error) { toast.error('โหลดรายการในใบเบิกไม่สำเร็จ: ' + error.message); return; }
    const src = (data || []).filter(it => effQty(it) > 0);
    if (!src.length) { toast.info('ใบนี้ไม่มีรายการที่มีจำนวน'); return; }

    setEditor(e => {
      const have = new Set(e.items.map(it => it.src_request_item_id).filter(Boolean));
      const add = src.filter(it => !have.has(it.id)).map(it => ({
        ...EMPTY_ITEM(),
        source: 'main', mat_no: it.mat_no || '', part_name: it.description || '',
        qty: effQty(it), confirm_qty: effQty(it),
        // ของที่เบิกไปทดสอบ = TRY-OUT ตาม legend ของใบ scrap (code D) · แก้ทับได้
        code: 'D', stage: 'post_process',
        src_request_item_id: it.id,
      }));
      if (!add.length) { toast.info('รายการของใบนี้ถูกดึงเข้าใบแล้วทั้งหมด'); return e; }
      toast.success(`ดึง ${add.length} รายการจากใบเบิก ${r.doc_no || ''} ✓`);
      return { ...e, items: [...e.items, ...add] };
    });
    setReqPicker(null);
  };

  const pullFromDefectLogs = async () => {
    const { report } = editor;
    if (!report.line_name || !report.report_date) { toast.error('เลือกไลน์และวันที่ก่อน'); return; }
    // ⚠️ ต้องเช็ค error — ไม่งั้นคิวรีพังจะขึ้น "ไม่พบ session ผลิต" / "ไม่มีของเสียบันทึกไว้"
    //    = บอกข้อเท็จจริงที่ผิดบนใบรายงานของเสีย ซึ่งเป็นบันทึกคุณภาพ (ห้ามล้มเหลวเงียบ)
    const { data: sess, error: sErr } = await supabaseDR.from('production_sessions').select('id')
      .eq('line_name', report.line_name).eq('work_date', report.report_date);
    if (sErr) { toast.error('ดึงข้อมูลกะไม่สำเร็จ: ' + sErr.message); return; }
    const ids = (sess || []).map(s => s.id);
    if (!ids.length) { toast.info('ไม่พบ session ผลิตของไลน์/วันนี้'); return; }
    const { data: defs, error: dErr } = await supabaseDR.from('defect_logs')
      .select('qty_ng, prod_orders(mat_no, part_name)').in('session_id', ids);
    if (dErr) { toast.error('ดึงข้อมูลของเสียไม่สำเร็จ: ' + dErr.message); return; }
    const byMat = new Map();
    (defs || []).forEach(d => {
      const mat = d.prod_orders?.mat_no || '—';
      const cur = byMat.get(mat) || { mat_no: mat === '—' ? '' : mat, part_name: d.prod_orders?.part_name || '', qty: 0 };
      cur.qty += d.qty_ng || 0;
      byMat.set(mat, cur);
    });
    const pulled = [...byMat.values()].filter(v => v.qty > 0);
    if (!pulled.length) { toast.info('ไม่มีของเสียบันทึกไว้ในวันนี้'); return; }
    // รวมกับรายการเดิม: mat ที่ดึงมาแล้ว (from_logs) อัปเดตยอด, อื่นคงไว้
    setEditor(e => {
      const manual = e.items.filter(it => !it.src_defect_from_logs);
      const auto = pulled.map(v => ({ ...EMPTY_ITEM(), source: 'main', mat_no: v.mat_no, part_name: v.part_name, qty: v.qty, confirm_qty: v.qty, src_defect_from_logs: true }));
      return { ...e, items: [...auto, ...manual] };
    });
    toast.success(`ดึงของเสีย ${pulled.length} ชิ้นงานจาก Daily Report ✓`);
  };

  const setRep = (patch) => setEditor(e => ({ ...e, report: { ...e.report, ...patch } }));
  const setItem = (key, patch) => setEditor(e => ({ ...e, items: e.items.map(it => it._key === key ? { ...it, ...patch } : it) }));
  const addItem = (source = 'main') => setEditor(e => ({ ...e, items: [...e.items, { ...EMPTY_ITEM(), source }] }));
  const delItem = (key) => setEditor(e => ({ ...e, items: e.items.filter(it => it._key !== key) }));

  const applySap = (o) => {
    if (sapPicker.itemKey) setItem(sapPicker.itemKey, { source: o.source, mat_no: o.mat_no, part_no: o.part_no, part_name: o.part_name });
    else setEditor(e => ({ ...e, items: [...e.items, { ...EMPTY_ITEM(), source: o.source, mat_no: o.mat_no, part_no: o.part_no, part_name: o.part_name }] }));
    setSapPicker(null); setSapSearch('');
    // master ผิด (p_no = หมายเลขเครื่อง) → part no. ว่าง บอกให้รู้ตัว ไม่ปล่อยพิมพ์ใบผิดออกไปเงียบๆ
    if (o.badMaster) toast.error(`พาร์ทนี้ใน Product Master กรอกเลขพาร์ทเป็นหมายเลขเครื่อง "${o.badMaster}" — ต้องกรอก PART NO. เอง แล้วไปแก้ที่ /products`);
  };

  const totals = useMemo(() => {
    if (!editor) return { qty: 0, confirm: 0 };
    return {
      qty: editor.items.reduce((s, x) => s + (Number(x.qty) || 0), 0),
      confirm: editor.items.reduce((s, x) => s + (Number(x.confirm_qty) || 0), 0),
    };
  }, [editor]);

  const saveReport = async () => {
    const { report, items } = editor;
    if (!report.line_name) { toast.error('เลือกไลน์'); return; }
    let doc_no = report.doc_no;
    if (!doc_no) doc_no = await nextDocNo(report.report_date);
    const payload = {
      report_date: report.report_date, line_name: report.line_name, dept: report.dept || null,
      section: report.section || null, division: report.division || 'TSAT4', other_note: report.other_note || null,
      product_categories: report.product_categories || [], storage_location: report.storage_location || null, doc_no,
      inspector_name: report.inspector_name || null, requester_name: report.requester_name || null,
      approver_qa_name: report.approver_qa_name || null, approver_pd_name: report.approver_pd_name || null,
      approver_gm_name: report.approver_gm_name || null, sender_name: report.sender_name || null,
      receiver_name: report.receiver_name || null, status: report.status || 'draft', updated_at: new Date().toISOString(),
    };
    let repId = report.id;
    if (repId) {
      const { error } = await supabaseDR.from('scrap_reports').update(payload).eq('id', repId);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data, error } = await supabaseDR.from('scrap_reports').insert({ ...payload, created_by: fullName || null }).select().single();
      if (error) { toast.error(error.message); return; }
      repId = data.id;
    }
    // replace items ทั้งชุด — เช็ค error ของ delete ก่อน insert ใหม่
    // (ถ้า delete ล้มแล้วปล่อยผ่าน อาจได้ item ซ้ำ · ถ้า insert ล้มหลัง delete สำเร็จ รายการหายหมด — เตือนให้กดบันทึกใหม่)
    const { error: eDel } = await supabaseDR.from('scrap_report_items').delete().eq('report_id', repId);
    if (eDel) { toast.error('ลบรายการเดิมไม่สำเร็จ: ' + eDel.message); return; }
    if (items.length) {
      const rows = items.map((it, i) => ({
        report_id: repId, seq: i + 1, source: it.source, part_no: it.part_no || null, part_name: it.part_name || null,
        mat_no: it.mat_no || null, model: it.model || null, code: it.code || null, bom_ref: it.bom_ref || null,
        qty: Number(it.qty) || 0, m_cause: it.m_cause || null, stage: it.stage || null,
        confirm_qty: it.confirm_qty === '' || it.confirm_qty == null ? null : Number(it.confirm_qty),
        defect_codes: it.defect_codes || null, src_defect_from_logs: !!it.src_defect_from_logs,
        src_request_item_id: it.src_request_item_id || null,
      }));
      const { error } = await supabaseDR.from('scrap_report_items').insert(rows);
      if (error) { toast.error(error.message); return; }
    }
    if (report.status === 'submitted') notifyEvent({
      event: 'scrap_report_submitted', type: 'info', ref_table: 'scrap_reports', ref_id: repId,
      line_name: report.line_name || null, section: report.section || null, actor: fullName,
      lines: [
        `📄 ใบ ${doc_no}`,
        `🏭 ไลน์: ${report.line_name || '—'}${report.section ? ` · ${report.section}` : ''}`,
        `🗑️ ${items.length} รายการ · รวม ${items.reduce((s, it) => s + (Number(it.qty) || 0), 0)} ชิ้น`,
      ],
    });
    toast.success(`บันทึกใบ ${doc_no} แล้ว ✓`);
    setEditor(null);
    loadReports();
  };

  const delReport = async (rep) => {
    if (!window.confirm(`ลบใบ ${rep.doc_no || fmtD(rep.report_date)}?`)) return;
    const { error } = await supabaseDR.from('scrap_reports').delete().eq('id', rep.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบแล้ว'); loadReports();
  };

  const doExport = async (rep) => {
    const { data: items } = await supabaseDR.from('scrap_report_items').select('*').eq('report_id', rep.id).order('seq');
    // เลขฟอร์ม/Rev/ช่องลายเซ็น อ่านจาก Document Master กลางใน lib เอง (getDocForm 'scrap_report')
    await exportScrapReportExcel({ report: rep, items: items || [], defectTypes });
  };

  // พิมพ์/บันทึก PDF — layout เดียวกับ Excel · เลขฟอร์ม/Rev/โลโก้ จากทะเบียนเอกสาร (เซฟ PDF จาก dialog พิมพ์)
  const doPrint = async (rep) => {
    const { data: items } = await supabaseDR.from('scrap_report_items').select('*').eq('report_id', rep.id).order('seq');
    const ok = await printScrapReport({ report: rep, items: items || [] });
    if (!ok) toast.error('เบราว์เซอร์บล็อก popup — อนุญาต popup ของเว็บนี้แล้วลองใหม่');
  };

  const STATUS_META = { draft: { label: 'ร่าง', color: '#6b7280' }, submitted: { label: 'ส่งอนุมัติ', color: '#f59e0b' }, approved: { label: 'อนุมัติแล้ว', color: '#22c55e' } };

  return (
    <div style={{ padding: '0 18px 30px', maxWidth: 1500, margin: '0 auto' }}>
      <ReadOnlyNote show={!canRecord} role={role} what="สร้าง/แก้ใบรายงานของเสีย"
        permKey="scrap:record" hint="ยังเปิดดูใบเดิม พิมพ์ และ export Excel ได้ตามปกติ" />
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0, fontFamily: 'var(--font-display)' }}>♻️ ใบรายงานของเสีย (Scrap Report)</h1>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
          {scrapFormNo} — ลงยอดของเสียต่อไลน์/วัน · ดึงตั้งต้นจาก Daily Report + เพิ่มพาร์ทย่อย · export ตรงฟอร์ม
        </div>
      </div>

      <div style={{ ...cardSt, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>ช่วง:</span>
        <input type="date" value={listFrom} max={listTo} onChange={e => setListFrom(e.target.value)} style={{ ...inputSt, width: 150 }} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>ถึง</span>
        <input type="date" value={listTo} min={listFrom} onChange={e => setListTo(e.target.value)} style={{ ...inputSt, width: 150 }} />
        <div style={{ flex: 1 }} />
        {canRecord && <button style={btnSt()} onClick={openNew}>+ เปิดใบใหม่</button>}
      </div>

      <div className="table-sticky" style={{ ...cardSt, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead><tr>
            <th style={thSt}>เลขที่</th><th style={thSt}>วันที่</th><th style={thSt}>ไลน์</th>
            <th style={thSt}>รายการ</th><th style={thSt}>รวมของเสีย</th><th style={thSt}>สถานะ</th><th style={thSt}></th>
          </tr></thead>
          <tbody>
            {reports.map(rep => (
              <tr key={rep.id}>
                <td style={{ ...tdSt, fontWeight: 700, whiteSpace: 'nowrap' }}>{rep.doc_no || '—'}</td>
                <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>{fmtD(rep.report_date)}</td>
                <td style={tdSt}>{rep.line_name || '—'}</td>
                <td style={tdSt}><ItemCount reportId={rep.id} /></td>
                <td style={tdSt}><ScrapSum reportId={rep.id} /></td>
                <td style={tdSt}><span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, color: STATUS_META[rep.status]?.color, background: `${STATUS_META[rep.status]?.color}1f`, border: `1px solid ${STATUS_META[rep.status]?.color}55` }}>{STATUS_META[rep.status]?.label || rep.status}</span></td>
                <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                  <button className="tbtn" style={{ ...ghostBtn, padding: '4px 10px' }} onClick={() => doPrint(rep)}>🖨️ PDF</button>
                  <button className="tbtn" style={{ ...ghostBtn, padding: '4px 10px', marginLeft: 4 }} onClick={() => doExport(rep)}>⬇ Excel</button>
                  {canRecord && <button className="tbtn" style={{ ...ghostBtn, padding: '4px 10px', marginLeft: 4 }} onClick={() => openEdit(rep)}>✏️</button>}
                  {canDel && <button className="tbtn" style={{ ...ghostBtn, padding: '4px 10px', marginLeft: 4, color: '#ef4444' }} onClick={() => delReport(rep)}>🗑</button>}
                </td>
              </tr>
            ))}
            {reports.length === 0 && <tr><td style={tdSt} colSpan={7}><span style={{ color: 'var(--muted)' }}>ไม่มีใบในช่วงนี้</span></td></tr>}
          </tbody>
        </table>
      </div>

      {editor && (
        <Modal title={editor.report.id ? `✏️ แก้ใบ ${editor.report.doc_no || ''}` : '➕ เปิดใบรายงานของเสียใหม่'} onClose={() => setEditor(null)} width={1180}>
          {/* หัวใบ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <Field label="วันที่"><input type="date" style={inputSt} value={editor.report.report_date} onChange={e => setRep({ report_date: e.target.value })} /></Field>
            <Field label="ไลน์ *">
              <select style={inputSt} value={editor.report.line_name} onChange={e => setRep({ line_name: e.target.value })}>
                <option value="">— เลือกไลน์ —</option>
                {toHierarchicalOptions(lines).map(({ line: l, depth }) => (
                  <option key={l.id} value={l.name}>{`${'  '.repeat(depth)}${depth ? '↳ ' : ''}${l.name}`}</option>
                ))}
              </select>
            </Field>
            <Field label="แผนก"><input style={inputSt} value={editor.report.dept} onChange={e => setRep({ dept: e.target.value })} /></Field>
            <Field label="ส่วน"><input style={inputSt} value={editor.report.section} onChange={e => setRep({ section: e.target.value })} /></Field>
            <Field label="Storage Location"><input style={inputSt} value={editor.report.storage_location} onChange={e => setRep({ storage_location: e.target.value })} /></Field>
            <Field label="ประเภทชิ้นงาน (หัวฟอร์ม)" span3>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 6 }}>
                {CAT_OPTS.map(([v, l]) => (
                  <label key={v} style={{ fontSize: 12.5, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={(editor.report.product_categories || []).includes(v)}
                      onChange={e => setRep({ product_categories: e.target.checked ? [...(editor.report.product_categories || []), v] : (editor.report.product_categories || []).filter(x => x !== v) })} />
                    {l}
                  </label>
                ))}
              </div>
            </Field>
          </div>

          {/* toolbar รายการ */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5 }}>รายการของเสีย ({editor.items.length})</div>
            <div style={{ flex: 1 }} />
            <button style={btnSt('#4d9fff')} onClick={pullFromDefectLogs}>⤵ ดึงจาก Daily Report</button>
            {/* ทางที่ 2: ของที่ QA เบิกไปทดสอบแบบทำลาย (ใบ FM-STO-003) — 2026-08-24 */}
            <button style={btnSt('#a855f7')} onClick={openReqPicker}>⤵ ดึงจากใบเบิก QA</button>
            <button style={ghostBtn} onClick={() => { setSapPicker({ addSource: true }); setSapSearch(''); }}>🔍 เพิ่มจาก SAP/BOM</button>
            <button style={ghostBtn} onClick={() => addItem('sub')}>+ พาร์ทย่อย (กรอกเอง)</button>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
              <thead><tr>
                <th style={thSt}>#</th><th style={thSt}>ที่มา</th><th style={thSt}>PART NO.</th><th style={thSt}>PART NAME</th>
                <th style={thSt}>MAT SAP</th><th style={thSt}>MODEL</th><th style={thSt}>CODE</th><th style={thSt}>BOM</th>
                <th style={thSt}>Q'TY</th><th style={thSt}>สาเหตุ</th><th style={thSt}>ช่วง</th><th style={thSt}>ยืนยัน</th>
                <th style={thSt}>รหัสงานเสีย</th><th style={thSt}></th>
              </tr></thead>
              <tbody>
                {editor.items.map((it, i) => (
                  <tr key={it._key}>
                    <td style={tdSt}>{i + 1}
                      {it.src_defect_from_logs && <span title="ดึงจาก Daily Report" style={{ marginLeft: 3, fontSize: 11, color: '#4d9fff' }}>⤵</span>}
                      {it.src_request_item_id && <span title="ดึงจากใบเบิก QA (ทดสอบแบบทำลาย)" style={{ marginLeft: 3, fontSize: 11, color: '#a855f7' }}>📦</span>}</td>
                    <td style={tdSt}><span style={{ fontSize: 10.5, fontWeight: 700, color: it.source === 'sub' ? '#f59e0b' : '#4d9fff' }}>{it.source === 'sub' ? 'ย่อย' : 'หลัก'}</span></td>
                    <td style={tdSt}><input style={{ ...inputSt, width: 120, padding: '5px 7px' }} value={it.part_no} onChange={e => setItem(it._key, { part_no: e.target.value })} /></td>
                    <td style={tdSt}><input style={{ ...inputSt, width: 150, padding: '5px 7px' }} value={it.part_name} onChange={e => setItem(it._key, { part_name: e.target.value })} /></td>
                    <td style={tdSt}>
                      <div style={{ display: 'flex', gap: 2 }}>
                        <input style={{ ...inputSt, width: 96, padding: '5px 7px' }} value={it.mat_no} onChange={e => setItem(it._key, { mat_no: e.target.value })} />
                        <button style={{ ...ghostBtn, padding: '4px 6px' }} title="เลือกจาก SAP/BOM" onClick={() => { setSapPicker({ itemKey: it._key }); setSapSearch(''); }}>🔍</button>
                      </div>
                    </td>
                    <td style={tdSt}><input style={{ ...inputSt, width: 66, padding: '5px 7px' }} value={it.model} onChange={e => setItem(it._key, { model: e.target.value })} /></td>
                    <td style={tdSt}>
                      <select style={{ ...inputSt, width: 60, padding: '5px 4px' }} value={it.code} onChange={e => setItem(it._key, { code: e.target.value })}>
                        <option value="">—</option>{CODE_OPTS.map(([v]) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </td>
                    <td style={tdSt}><input style={{ ...inputSt, width: 60, padding: '5px 7px' }} value={it.bom_ref} onChange={e => setItem(it._key, { bom_ref: e.target.value })} /></td>
                    <td style={tdSt}><input type="number" style={{ ...inputSt, width: 64, padding: '5px 7px' }} value={it.qty} onChange={e => setItem(it._key, { qty: e.target.value })} /></td>
                    <td style={tdSt}>
                      <select style={{ ...inputSt, width: 90, padding: '5px 4px' }} value={it.m_cause} onChange={e => setItem(it._key, { m_cause: e.target.value })}>
                        <option value="">—</option>{M_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td style={tdSt}>
                      <select style={{ ...inputSt, width: 96, padding: '5px 4px' }} value={it.stage} onChange={e => setItem(it._key, { stage: e.target.value })}>
                        {STAGE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td style={tdSt}><input type="number" style={{ ...inputSt, width: 64, padding: '5px 7px' }} value={it.confirm_qty} onChange={e => setItem(it._key, { confirm_qty: e.target.value })} /></td>
                    <td style={tdSt}>
                      <button style={{ ...ghostBtn, padding: '5px 8px', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => setDefectPicker(it._key)}>
                        {it.defect_codes || '+ เลือก'}
                      </button>
                    </td>
                    <td style={tdSt}><button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }} onClick={() => delItem(it._key)}>🗑</button></td>
                  </tr>
                ))}
                {editor.items.length === 0 && <tr><td style={tdSt} colSpan={14}><span style={{ color: 'var(--muted)' }}>ยังไม่มีรายการ — กด "ดึงจาก Daily Report" หรือ "เพิ่มจาก SAP/BOM"</span></td></tr>}
              </tbody>
              {editor.items.length > 0 && (
                <tfoot><tr>
                  <td style={{ ...tdSt, fontWeight: 800 }} colSpan={8}>TOTAL</td>
                  <td style={{ ...tdSt, fontWeight: 800 }}>{totals.qty}</td>
                  <td style={tdSt} colSpan={2}></td>
                  <td style={{ ...tdSt, fontWeight: 800 }}>{totals.confirm}</td>
                  <td style={tdSt} colSpan={2}></td>
                </tr></tfoot>
              )}
            </table>
          </div>

          {/* สายอนุมัติ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
            <Field label="ผู้ตรวจสอบ (QC)"><input style={inputSt} value={editor.report.inspector_name} onChange={e => setRep({ inspector_name: e.target.value })} /></Field>
            <Field label="ผู้ขออนุมัติ (หัวหน้าแผนก)"><input style={inputSt} value={editor.report.requester_name} onChange={e => setRep({ requester_name: e.target.value })} /></Field>
            <Field label="ผู้อนุมัติ (ผจก. QA/QC)"><input style={inputSt} value={editor.report.approver_qa_name} onChange={e => setRep({ approver_qa_name: e.target.value })} /></Field>
            <Field label="ผู้อนุมัติ (ผจก.ผลิต)"><input style={inputSt} value={editor.report.approver_pd_name} onChange={e => setRep({ approver_pd_name: e.target.value })} /></Field>
            <Field label="ผู้อนุมัติ (ผจก.ทั่วไป)"><input style={inputSt} value={editor.report.approver_gm_name} onChange={e => setRep({ approver_gm_name: e.target.value })} /></Field>
            <Field label="สถานะ">
              <select style={inputSt} value={editor.report.status} onChange={e => setRep({ status: e.target.value })} disabled={!canManage && editor.report.status === 'approved'}>
                <option value="draft">ร่าง</option><option value="submitted">ส่งอนุมัติ</option>
                {canManage && <option value="approved">อนุมัติแล้ว</option>}
              </select>
            </Field>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button style={ghostBtn} onClick={() => setEditor(null)}>ยกเลิก</button>
            {canRecord && <button style={btnSt()} onClick={saveReport}>💾 บันทึกใบ</button>}
          </div>
        </Modal>
      )}

      {/* SAP / BOM picker */}
      {sapPicker && (
        <Modal title="🔍 เลือกจาก SAP / BOM" onClose={() => { setSapPicker(null); setSapSearch(''); }} width={520}>
          <input autoFocus style={inputSt} value={sapSearch} onChange={e => setSapSearch(e.target.value)}
            placeholder={sapOptions === null ? 'กำลังโหลด…' : `พิมพ์ค้นหา MAT SAP / Part No / ชื่อ (${sapOptions.length})`} />
          <div style={{ marginTop: 10, maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sapMatches.map((o, i) => (
              <button key={i} onClick={() => applySap(o)} style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: 'var(--card)', border: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, color: o.source === 'sub' ? '#f59e0b' : '#4d9fff', background: o.source === 'sub' ? '#f59e0b1f' : '#4d9fff1f' }}>{o.source === 'sub' ? 'ย่อย' : 'หลัก'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{o.mat_no || o.part_no} <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{o.part_name}</span></div>
                  {o.line_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.line_name}</div>}
                  {o.badMaster && <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>⚠ Master กรอกเลขพาร์ทเป็นหมายเลขเครื่อง "{o.badMaster}" — ต้องกรอก PART NO. เอง</div>}
                </div>
              </button>
            ))}
            {sapSearch.trim().length >= 2 && sapMatches.length === 0 && sapOptions && <div style={{ fontSize: 12, color: 'var(--muted)', padding: 8 }}>ไม่พบ</div>}
          </div>
        </Modal>
      )}

      {/* ใบเบิก QA — เลือกใบที่จะดึงของเข้าใบรายงานของเสีย (2026-08-24) */}
      {reqPicker && (
        <Modal title="📦 เลือกใบเบิกทดสอบ (FM-STO-003)" onClose={() => setReqPicker(null)} width={640}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
            แสดงเฉพาะใบที่<b>อนุมัติแล้ว</b>ขึ้นไป · ใบของไลน์ “{editor.report.line_name || '—'}” ขึ้นก่อน<br />
            จำนวนที่ดึงใช้ <b>จำนวนที่จ่ายจริง</b> ก่อน ไม่มีค่อยใช้จำนวนที่ขอเบิก · รายการที่ดึงไปแล้วจะไม่ซ้ำ
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {reqPicker.map(r => {
              const st = statusMeta(r.status);
              const mine = r.line_name === editor.report.line_name;
              return (
                <button key={r.id} onClick={() => applyRequest(r)} style={{
                  textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  background: 'var(--card)', border: `1px solid ${mine ? '#a855f7' : 'var(--border)'}`,
                }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                    {r.doc_no || '(ไม่มีเลขที่)'}
                    <span style={{ color: st.color, fontWeight: 700, marginLeft: 8, fontSize: 11.5 }}>{st.label}</span>
                    {mine && <span style={{ color: '#a855f7', marginLeft: 6, fontSize: 11 }}>· ไลน์นี้</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text2)' }}>
                    {r.request_date} · {KIND_LABEL[r.kind] || r.kind} · {r.requester_dept || '—'}
                    {r.requester_name ? ` · ${r.requester_name}` : ''}
                    {r.line_name ? ` · ${r.line_name}` : ''}
                  </div>
                  {r.detail && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.detail}</div>}
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {/* defect code picker */}
      {defectPicker && (
        <DefectPicker types={defectTypes}
          value={editor.items.find(it => it._key === defectPicker)?.defect_codes || ''}
          onClose={() => setDefectPicker(null)}
          onSave={(codes) => { setItem(defectPicker, { defect_codes: codes }); setDefectPicker(null); }} />
      )}
    </div>
  );
}

function Field({ label, children, span3 }) {
  return (
    <div style={{ gridColumn: span3 ? 'span 3' : undefined }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

/* เลือกรหัสงานเสียได้หลายตัว (P1-P20 / A1-A18) */
function DefectPicker({ types, value, onClose, onSave }) {
  const [sel, setSel] = useState(() => new Set(value.split(',').map(s => s.trim()).filter(Boolean)));
  const toggle = (c) => setSel(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const grpP = types.filter(t => t.grp === 'P');
  const grpA = types.filter(t => t.grp === 'A');
  const Col = ({ title, list }) => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {list.map(t => (
          <label key={t.code} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', padding: '3px 5px', borderRadius: 6, background: sel.has(t.code) ? 'var(--accent-dim)' : 'transparent' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={sel.has(t.code)} onChange={() => toggle(t.code)} />
            <b style={{ minWidth: 30 }}>{t.code}</b> {t.label}
          </label>
        ))}
      </div>
    </div>
  );
  return (
    <Modal title="เลือกรหัสประเภทงานเสีย" onClose={onClose} width={620}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Col title="P · กระบวนการผลิต" list={grpP} />
        <Col title="A · ประกอบ / เชื่อม" list={grpA} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>เลือก: <b>{[...sel].join(', ') || '—'}</b></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ghostBtn} onClick={onClose}>ยกเลิก</button>
          <button style={btnSt()} onClick={() => onSave([...sel].join(','))}>ตกลง</button>
        </div>
      </div>
    </Modal>
  );
}

/* นับรายการ + รวมยอด (โหลดเบาๆ ต่อแถวรายการ) */
function ItemCount({ reportId }) {
  const [n, setN] = useState(null);
  useEffect(() => { supabaseDR.from('scrap_report_items').select('id', { count: 'exact', head: true }).eq('report_id', reportId).then(({ count }) => setN(count || 0)); }, [reportId]);
  return <span>{n == null ? '…' : `${n} รายการ`}</span>;
}
function ScrapSum({ reportId }) {
  const [s, setS] = useState(null);
  useEffect(() => { supabaseDR.from('scrap_report_items').select('qty').eq('report_id', reportId).then(({ data }) => setS((data || []).reduce((a, x) => a + (Number(x.qty) || 0), 0))); }, [reportId]);
  return <span style={{ fontWeight: 700, color: s ? '#ef4444' : undefined }}>{s == null ? '…' : s.toLocaleString()}</span>;
}
