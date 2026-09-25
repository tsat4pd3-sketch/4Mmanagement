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
import { getLineFamilyNames } from '../utils/lineHierarchy';
import LineSelect from '../components/LineSelect';
import { LINE_COLUMNS } from '../utils/useProductionLines';
import ProductSelect from '../components/ProductSelect';
import PersonSelect from '../components/PersonSelect';
import StorageLocSelect from '../components/StorageLocSelect';
import useColumnHistory from '../utils/useColumnHistory'; // 📜 ค่าที่เคยบันทึกใน scrap_reports/items — ทะเบียนไม่มีก็ยังเลือกซ้ำได้ (2026-09-07)
import { useOrgSections, useOrgDepts } from '../utils/useOrgSections';
import { slocValid, SLOC_FORMAT_HINT } from '../utils/storageLoc';
import { inSectionScope } from '../utils/sectionScope';
import { canDelete } from '../utils/permissions';
import { usePerms } from '../utils/usePerms';
import { exportScrapReportExcel } from '../lib/scrapExportExcel';
import { printScrapReport } from '../lib/scrapPrint';
import { docFormSync, loadDocForms, fullCode } from '../utils/docForms';
import { PULLABLE, statusMeta, effQty, KIND_LABEL } from '../utils/materialRequest';
import { explodeScrapRow, scanScrapItems, opInfoOf } from '../utils/scrapExplode';
import { buildBomIndex } from '../utils/bomTree';
import { notifyEvent } from '../utils/notifyEvent';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import FilterBar from '../components/FilterBar';

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
  // 🧩 แถวนี้เกิดจากการระเบิดของเสียของ "ขั้นตอน (OP)" ตัวไหน (null = ของเสียของพาร์ทตรงๆ) — 2026-09-15
  src_op_mat: null,
  /* 🔴 แถวนี้มาจากถังแดงใบไหน (quality_bin_records) — WI-PD3-069 §5.5 (2026-09-25)
     WI สั่งให้ Scrap Report อ้างอิง "รายละเอียดและจำนวนตามแท็กแดง" ไม่ใช่ดึงจาก defect_logs ตรงๆ */
  src_bin_id: null,
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
  /* 📜 ค่าที่เคยบันทึกในใบรายงานของเสีย (DR) — MAT/ชื่อผู้เซ็น/รหัสคลังที่กรอกมาก่อนทะเบียนจะครบ ยังเลือกซ้ำได้
     ห้ามล้าง/บล็อกเงียบ (คำสั่ง user 2026-09-07) · เก็บ snapshot text เหมือนเดิม */
  const itemMatHist = useColumnHistory(supabaseDR, 'scrap_report_items', 'mat_no', { upper: true });
  const inspectorHist = useColumnHistory(supabaseDR, 'scrap_reports', 'inspector_name');
  const requesterHist = useColumnHistory(supabaseDR, 'scrap_reports', 'requester_name');
  const approverQaHist = useColumnHistory(supabaseDR, 'scrap_reports', 'approver_qa_name');
  const approverPdHist = useColumnHistory(supabaseDR, 'scrap_reports', 'approver_pd_name');
  const approverGmHist = useColumnHistory(supabaseDR, 'scrap_reports', 'approver_gm_name');
  const storageHist = useColumnHistory(supabaseDR, 'scrap_reports', 'storage_location', { upper: true });

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
  // 2026-09-07 แผนก/ส่วน ในหัวใบ เลือกจากผังองค์กร (org_nodes) แทนพิมพ์เอง · ส่วน auto จากไลน์ที่เลือก
  const orgSections = useOrgSections();
  const deptsOf     = useOrgDepts();
  const [reqPicker, setReqPicker] = useState(null); // ใบเบิก QA ที่ดึงเข้าใบนี้ได้ | null
  /* 🧩 บริบทระเบิดของเสียชั้น OP → เลข SAP จริง (utils/scrapExplode · 2026-09-15)
     opRows = แถว OP ทั้งหมด (ไล่ขั้นก่อนหน้าในสายเดียวกัน) · bomOf = สูตรของแต่ละขั้น/พาร์ท
     โหลดพร้อมกับ sapOptions ก้อนเดียว (คิวรีชุดเดิม เพิ่มคอลัมน์) — ไม่ยิงรอบใหม่ */
  const [opRows, setOpRows] = useState([]);
  const [bomByMat, setBomByMat] = useState({});
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
    supabase.from('production_lines').select(LINE_COLUMNS).order('name').then(({ data }) => setAllLines(data || [])); // 2026-09-07 ครบคอลัมน์ให้ <LineSelect>
    supabaseDR.from('scrap_defect_types').select('*').eq('is_active', true).order('sort_order').then(({ data }) => setDefectTypes(data || []));
    loadDocForms().then(() => setDocReady(true));
  }, []);

  /* ── SAP / พาร์ทย่อย picker (dr_products main + bom_items/parts_master sub) ──
     parts_master เข้ามาด้วย (2026-08-06) — พาร์ทซื้อนอก/วัตถุดิบ (300/500) ที่ยังไม่ถูกผูกใน BOM
     ของสินค้าใดเลย เดิมไม่ขึ้นให้เลือก ต้องกรอกมือ · dedupe ด้วย mat_no (dr_products > bom_items > parts_master) */
  useEffect(() => {
    if ((!sapPicker && !editor) || sapOptions !== null) return; // 2026-09-07 โหลดเมื่อเปิดฟอร์มด้วย — ช่อง MAT SAP ในแถวเป็น picker แล้ว
    let alive = true;
    (async () => {
      const [{ data: prods }, { data: boms }, { data: macs }, pmRes] = await Promise.all([
        // id/ชั้น OP/qty_per_unit เพิ่มมาเพื่อ "ระเบิดของเสียของขั้นตอน" — คิวรีชุดเดิม ไม่ได้ยิงเพิ่ม
        supabaseDR.from('dr_products').select('id, mat_no, p_no, name, code, line_name, is_operation, op_parent_mat, op_seq').eq('is_active', true).order('name'),
        // parent_mat = ชั้นที่ตั้งเองได้ (migration 20260916) — ยังไม่ apply = ถอยไปชุดเดิม ห้ามให้ทั้งหน้าพัง
        supabaseDR.from('bom_items').select('mat_no, part_no, part_name, product_id, qty_per_unit, uom, parent_mat').eq('is_active', true).order('part_name')
          .then(r => r.error?.code === '42703'
            ? supabaseDR.from('bom_items').select('mat_no, part_no, part_name, product_id, qty_per_unit, uom').eq('is_active', true).order('part_name')
            : r),
        supabaseDR.from('machines').select('machine_no'),   // ไว้จับ p_no ที่กรอกเป็นหมายเลขเครื่อง (master ผิด)
        supabaseDR.from('parts_master').select('mat_no, part_no, part_name').eq('is_active', true).order('part_name').then(r => r, () => ({ data: [] })),
      ]);
      if (!alive) return;
      /* ── สูตร "ขั้นนี้กินอะไรเข้าไป" (bom_items ที่ product_id ชี้แถว OP) ───────────────
         ⚠️ ทั้ง opRows และ opMap ถอดจาก `prods` ก้อนเดียวกันโดยตั้งใจ (ไม่ใช้ opInfoSync ที่
         cache ระดับ module) — สองแหล่งอาจไม่ตรงกันเมื่อมีคนเพิ่ม OP ระหว่าง session
         แล้วใบของเสียจะระเบิดผิด/ไม่ระเบิด โดยไม่มีใครรู้ */
      /* ⚠️ ต้นไม้ BOM ผ่าน `buildBomIndex` เท่านั้น (utils/bomTree) — `parent_mat` ชนะ `product_id`
         ⇒ ขั้นที่ถูกย้ายไปอยู่ชั้นลึก ก็ยังระเบิดของเสียได้ถูก · ห้ามประกอบเองซ้ำที่นี่ */
      const matOfProd = {}; (prods || []).forEach(p => { if (p.id) matOfProd[p.id] = p.mat_no; });
      const ix = buildBomIndex(boms || [], matOfProd);
      const bomMap = {};
      (boms || []).forEach(b => { const m = ix.parentOf(b); if (m) (bomMap[m] = bomMap[m] || []).push(b); });
      setBomByMat(bomMap);
      setOpRows((prods || []).filter(p => p.is_operation));
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
  }, [sapPicker, sapOptions, editor]);

  // 2026-09-07 พาร์ทลูก (BOM / parts_master) เป็นกลุ่มเสริมของ <ProductSelect> ในแถวรายการ — main product ให้ ProductSelect อ่านจาก Product Master เอง
  const sapExtra = useMemo(() => (sapOptions || []).filter(o => o.source === 'sub' && o.mat_no)
    .map(o => ({ mat_no: o.mat_no, name: o.part_name, p_no: o.part_no, sub: [o.part_no, o.part_name].filter(Boolean).join(' · ') })), [sapOptions]);
  // แถวที่ mat_no ตรงทะเบียน → part_no/part_name ล็อกตามทะเบียน (แก้ได้เมื่อล้าง mat_no · master ผิด (badMaster) part_no ปล่อยให้กรอกเอง)
  const sapByMat = useMemo(() => new Map((sapOptions || []).filter(o => o.mat_no).map(o => [o.mat_no.toUpperCase(), o])), [sapOptions]);
  const pickSapForItem = (key, { mat_no, name, p_no, opt }) => {
    // พิมพ์เอง หรือเลือกจากกลุ่ม 📜 เคยบันทึกไว้ (ไม่มีในทะเบียน) → เก็บแค่ mat_no ไม่ทับ part_no/part_name ที่กรอกไว้ (2026-09-07)
    if (!opt || opt.history) { setItem(key, { mat_no }); return; }
    const so = sapByMat.get(String(mat_no).toUpperCase());
    const isSub = String(opt.id).startsWith('x:');
    setItem(key, { mat_no, source: isSub ? 'sub' : 'main', part_no: so ? so.part_no : (p_no || mat_no), part_name: so ? so.part_name : (name || '') });
    if (so?.badMaster) toast.error(`พาร์ทนี้ใน Product Master กรอกเลขพาร์ทเป็นหมายเลขเครื่อง "${so.badMaster}" — ต้องกรอก PART NO. เอง แล้วไปแก้ที่ /products`);
  };

  const sapMatches = useMemo(() => {
    const q = sapSearch.trim().toLowerCase();
    if (!sapOptions || q.length < 2) return [];
    return sapOptions.filter(o => [o.mat_no, o.part_no, o.part_name].some(v => (v || '').toLowerCase().includes(q))).slice(0, 12);
  }, [sapOptions, sapSearch]);

  /* ══ 🧩 ระเบิดของเสียของ "ขั้นตอน (OP)" → เลขที่สโตร์ตัด SAP ได้จริง (user 2026-09-15) ══
     ชั้น OP ไม่มีตัวตนใน SAP และ "ตัวมันเองยังไม่สมบูรณ์" (ไม่เคยเข้าคลัง — fn_post_confirmed_output
     ข้าม is_operation) ⇒ ของที่หายจริงคือวัตถุดิบ/พาร์ทที่ใส่เข้าไปจนถึงขั้นนั้น
     กติกา/การไล่ขั้นก่อนหน้าอยู่ที่ src/utils/scrapExplode.js (pure + มีเทส) ห้ามคิดสูตรซ้ำที่นี่ */
  const explodeCtx = useMemo(() => ({
    opMap: Object.fromEntries(opRows.map(o => [o.mat_no, { parent: o.op_parent_mat, seq: o.op_seq }])),
    opRows,
    bomOf: (mat) => bomByMat[mat] || [],
  }), [opRows, bomByMat]);

  // สแกนทั้งใบ: แถวไหนเป็นขั้น OP · ระเบิดได้แล้ว / ยังไม่มีสูตร (ใช้ทั้งแถบเตือนและปุ่ม)
  const opScan = useMemo(() => scanScrapItems(editor?.items || [], explodeCtx), [editor, explodeCtx]);
  // หน่วยของแต่ละ mat จาก BOM (KG/PC) — โชว์บนจอเท่านั้น ใบฟอร์มไม่มีคอลัมน์หน่วย (SAP รู้หน่วยฐานเอง)
  const uomByMat = useMemo(() => {
    const m = {};
    Object.values(bomByMat).forEach(rows => rows.forEach(b => { if (b.mat_no && b.uom && !m[b.mat_no]) m[b.mat_no] = b.uom; }));
    return m;
  }, [bomByMat]);

  /** แทนแถวขั้น OP ด้วยรายการวัตถุดิบ/พาร์ทที่ถูกใส่เข้าไปจนถึงขั้นนั้น
   *  ⚠️ คำนวณจาก `items` ที่ส่งเข้ามา **นอก** setEditor เสมอ — ถ้าไปนับใน updater
   *     ตัวเลขที่เอาไป toast จะเป็นค่าเก่า (updater ทำงานทีหลัง) = บอกผลผิดให้คนหน้างาน
   *  @param items   แถวปัจจุบัน (ส่ง array ที่เพิ่งสร้างได้ เช่นตอนดึงจาก Daily Report)
   *  @param onlyKey ระเบิดเฉพาะแถวนั้น (null = ทั้งใบ)
   *  @param quiet   true = ไม่ต้องบอกเมื่อไม่มีอะไรให้ระเบิด (ใช้ตอนดึงอัตโนมัติ) */
  const explodeOpItems = (items, onlyKey = null, quiet = false) => {
    const out = [];
    let done = 0; const blocked = []; const dup = new Set();
    (items || []).forEach(it => {
      if (onlyKey && it._key !== onlyKey) { out.push(it); return; }
      const r = explodeScrapRow(it, explodeCtx);
      if (r.status === 'not_op') { out.push(it); return; }
      if (r.status === 'no_bom') { blocked.push(it.mat_no); out.push(it); return; }
      r.dupMats.forEach(m => dup.add(m));
      done++;
      r.lines.forEach(l => out.push({
        ...EMPTY_ITEM(), source: 'sub',
        mat_no: l.mat_no, part_no: l.part_no || '', part_name: l.part_name || '',
        qty: l.qty, confirm_qty: l.qty,
        // ยกบริบทของเสียจากแถวต้นทางมาทั้งชุด (สาเหตุ/ช่วง/รหัสงานเสีย/รุ่น) — คนกรอกไม่ต้องคีย์ใหม่
        model: it.model, code: it.code || 'C', m_cause: it.m_cause, stage: it.stage,
        defect_codes: it.defect_codes,
        bom_ref: it.mat_no,                       // คอลัมน์ BOM บนฟอร์ม = ขั้นที่ของเสียหลุด
        src_op_mat: it.mat_no,                    // สืบย้อนได้ว่าแถวนี้มาจากขั้นไหน
        src_defect_from_logs: !!it.src_defect_from_logs,
      }));
    });
    if (done) setEditor(e => (e ? { ...e, items: out } : e));
    if (done) toast.success(`ระเบิดขั้นตอน ${done} รายการเป็นเลข SAP ที่ตัดสต๊อกได้แล้ว ✓`);
    else if (!quiet && !blocked.length) toast.info('ไม่มีแถวที่เป็นขั้นตอน (OP) ให้ระเบิด');
    if (blocked.length) toast.error(`ยังไม่ได้ผูกสูตรของขั้น: ${[...new Set(blocked)].join(', ')} — ไปตั้งที่ /products แท็บ BOM (เลือกแถว 🔩 ขั้นตอน) แล้วกดระเบิดอีกครั้ง`);
    if (dup.size) toast.info(`⚠ ${[...dup].join(', ')} ถูกผูกไว้หลายขั้น ระบบรวมยอดให้ — เช็คว่าคีย์สูตรแบบสะสมหรือเปล่า`);
    return { items: out, done, blocked };
  };

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
    const manual = editor.items.filter(it => !it.src_defect_from_logs);
    const auto = pulled.map(v => ({ ...EMPTY_ITEM(), source: 'main', mat_no: v.mat_no, part_name: v.part_name, qty: v.qty, confirm_qty: v.qty, src_defect_from_logs: true }));
    const next = [...auto, ...manual];
    setEditor(e => (e ? { ...e, items: next } : e));
    toast.success(`ดึงของเสีย ${pulled.length} ชิ้นงานจาก Daily Report ✓`);
    /* 🧩 ของเสียที่หลุดที่ "ขั้นตอน (OP)" ถูกดึงมาด้วยเลขของขั้น ซึ่ง SAP ไม่มี ⇒ ระเบิดเป็นวัตถุดิบจริงทันที
       (user 2026-09-15: "มันต้องดึง BOM ที่มันประกอบมาตัด ไม่ใช่ตัดตัวมันเอง")
       quiet = ไม่ต้องบอกว่า "ไม่มีอะไรให้ระเบิด" — ไลน์ส่วนใหญ่ไม่มีชั้น OP อยู่แล้ว
       แต่แถวที่ระเบิดไม่ได้ (ยังไม่ผูกสูตร) **ยังเตือนเสมอ** ไม่ปล่อยใบที่ตัดสต๊อกไม่ได้ออกไปเงียบๆ */
    explodeOpItems(next, null, true);
  };

  /* ── ทางที่ 3: ดึงจาก "ถังแดง" (WI-PD3-069 §5.5 · 2026-09-25) ────────────────────
     เส้นทางที่ WI บังคับจริง: ของเสีย → ติดแท็กแดง → ลงใบปะหน้าถัง (FM-PD2-023)
     → หัวหน้างานทำ Scrap Report **โดยอ้างอิงรายการตามแท็กแดง** → ขออนุมัติทำลายตาม DOA
     ต่างจาก "ดึงจาก Daily Report" ที่ข้ามถังแดงไปเอายอดดิบ ⇒ ของในถังไม่มีใบขออนุมัติ
     (วัดจริง 25/09: ถังแดง 24 แถว · ใบ scrap 6 ใบ · ผูกกัน 0)
     ⚠️ ดึงเฉพาะใบถังที่ **ยังไม่เคยออกใบ** (scrap_report_id is null) — กันของก้อนเดียวถูกขออนุมัติซ้ำ */
  const pullFromRedBins = async () => {
    const { report } = editor;
    if (!report.line_name || !report.report_date) { toast.error('เลือกไลน์และวันที่ก่อน'); return; }
    const { data: bins, error } = await supabaseDR.from('quality_bin_records')
      .select('id, mat_no, part_name, part_no, qty, cause, work_date')
      .eq('bin', 'red').eq('is_active', true)
      .eq('line_name', report.line_name).eq('work_date', report.report_date)
      .is('scrap_report_id', null);
    if (error) { toast.error('ดึงรายการถังแดงไม่สำเร็จ: ' + error.message); return; }
    if (!bins?.length) {
      toast.info('ไม่มีรายการในถังแดงของไลน์/วันนี้ที่ยังไม่ได้ออกใบ — ถ้ายังไม่ได้ลงถัง ให้ลงที่ Daily Report ปุ่ม 🗑️ ลงถัง ก่อน');
      return;
    }
    // ใบถัง 1 แถว = 1 รายการบนใบ scrap (ไม่ยุบรวม — แต่ละแท็กแดงเป็นก้อนของจริงที่ต้องสอบกลับได้)
    const already = new Set(editor.items.map(it => it.src_bin_id).filter(Boolean));
    const add = bins.filter(b => !already.has(b.id)).map(b => ({
      ...EMPTY_ITEM(), source: 'main',
      mat_no: b.mat_no || '', part_name: b.part_name || '', part_no: b.part_no || '',
      qty: b.qty ?? '', confirm_qty: b.qty ?? '', m_cause: b.cause || '',
      src_bin_id: b.id,
    }));
    if (!add.length) { toast.info('รายการถังแดงทั้งหมดถูกดึงเข้าใบนี้แล้ว'); return; }
    const next = [...editor.items, ...add];
    setEditor(e => (e ? { ...e, items: next } : e));
    toast.success(`ดึงจากถังแดง ${add.length} รายการ ✓ — บันทึกใบแล้วระบบจะผูกใบถังกลับให้อัตโนมัติ`);
    explodeOpItems(next, null, true);
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
    if (!slocValid(report.storage_location)) { toast.error(`Storage Location ไม่ถูกรูปแบบ — ${SLOC_FORMAT_HINT}`); return; } // 2026-09-07
    /* 🔩 ส่งอนุมัติ/อนุมัติทั้งที่ยังมีเลขขั้นตอน (OP) ค้างอยู่ = ใบนี้สโตร์เอาไปตัด SAP ไม่ได้
       ไม่บล็อก (บางใบอาจตั้งใจบันทึกไว้ก่อน) แต่ต้องถามให้คนกดรู้ตัว — ห้ามผ่านเงียบ (2026-09-15) */
    if (report.status !== 'draft' && opScan.opRowsCount > 0) {
      const mats = [...new Set([...opScan.ready, ...opScan.blocked].map(x => x.item.mat_no))].join(', ');
      if (!window.confirm(`ใบนี้ยังมี ${opScan.opRowsCount} รายการที่เป็นเลขขั้นตอน (OP): ${mats}\n\nเลขพวกนี้ไม่มีใน SAP — สโตร์ตัดสต๊อกไม่ได้\nกด "🧩 ระเบิดขั้นตอน" ก่อนจะตรงกว่า\n\nยืนยันบันทึกทั้งที่ยังไม่ระเบิด?`)) return;
    }
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
        src_op_mat: it.src_op_mat || null,
        src_bin_id: it.src_bin_id || null,
      }));
      // 42703 = ยังไม่ apply migration ของคอลัมน์ src_op_mat/src_bin_id → ถอยไปชุดเดิม (ห้ามให้ทั้งใบบันทึกไม่ได้)
      let { error } = await supabaseDR.from('scrap_report_items').insert(rows);
      if (error?.code === '42703') {
        ({ error } = await supabaseDR.from('scrap_report_items')
          .insert(rows.map(({ src_op_mat, src_bin_id, ...r }) => r)));   // eslint-disable-line no-unused-vars
      }
      if (error) { toast.error(error.message); return; }

      /* 🔴 ผูกใบถังแดงกลับมาที่ใบนี้ (WI-PD3-069 §5.5) — ทำ **หลัง** items บันทึกสำเร็จเท่านั้น
         ไม่งั้นใบถังจะถูกมาร์คว่า "ออกใบแล้ว" ทั้งที่รายการยังไม่เข้าใบ = ของหลุดจากสายขออนุมัติทำลาย
         ⚠️ RLS ปฏิเสธ UPDATE = 0 แถว ไม่มี error ⇒ ต้อง .select('id') แล้วนับ (กฎเหล็กข้อ 2) */
      const binIds = [...new Set(items.map(it => it.src_bin_id).filter(Boolean))];
      if (binIds.length) {
        const { data: linked, error: bErr } = await supabaseDR.from('quality_bin_records')
          .update({ scrap_report_id: repId }).in('id', binIds).select('id');
        if (bErr) toast.error(`บันทึกใบแล้ว แต่ผูกใบถังแดงไม่สำเร็จ: ${bErr.message} — ของในถังจะยังขึ้นว่า "ยังไม่ออกใบ"`);
        else if ((linked?.length || 0) < binIds.length)
          toast.error(`ผูกใบถังแดงได้ ${linked?.length || 0}/${binIds.length} รายการ — ที่เหลืออาจไม่มีสิทธิ์แก้ แจ้ง admin`);
      }
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
    <Page>
      <ReadOnlyNote show={!canRecord} role={role} what="สร้าง/แก้ใบรายงานของเสีย"
        permKey="scrap:record" hint="ยังเปิดดูใบเดิม พิมพ์ และ export Excel ได้ตามปกติ" />
      <PageHeader title="ใบรายงานของเสีย (Scrap Report)" icon="♻️"
        sub={`${scrapFormNo} — ลงยอดของเสียต่อไลน์/วัน · ดึงตั้งต้นจาก Daily Report + เพิ่มพาร์ทย่อย · export ตรงฟอร์ม`} />

      {/* UI-STANDARD 2026-09-24: แถบกรองมาตรฐาน (ไม่ใส่ขนาด inline ในช่อง) */}
      <FilterBar style={{ marginBottom: 14 }}>
        <span className="filter-label">ช่วง</span>
        <input type="date" value={listFrom} max={listTo} onChange={e => setListFrom(e.target.value)} />
        <span className="filter-label">ถึง</span>
        <input type="date" value={listTo} min={listFrom} onChange={e => setListTo(e.target.value)} />
        <span className="spacer" />
        {canRecord && <button style={btnSt()} onClick={openNew}>+ เปิดใบใหม่</button>}
      </FilterBar>

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
              {/* 2026-09-07 อ่านทะเบียนไลน์ผ่าน <LineSelect> — เลือกไลน์แล้ว "ส่วน" เติมจาก production_lines.section อัตโนมัติ */}
              <LineSelect lines={lines} value={editor.report.line_name} style={inputSt} placeholder="— เลือกไลน์ —"
                onChange={v => { const ln = allLines.find(l => l.name === v); setRep({ line_name: v, ...(ln?.section ? { section: ln.section } : {}) }); }} />
            </Field>
            {/* 2026-09-07 แผนก = <select> จากผังองค์กร (cascade จากส่วน) · ค่าเดิมที่ไม่อยู่ในผังยังโชว์ ไม่หายเงียบ */}
            <Field label="แผนก">
              <select style={inputSt} value={editor.report.dept || ''} onChange={e => setRep({ dept: e.target.value })}>
                <option value="">—</option>
                {editor.report.dept && !deptsOf(editor.report.section).includes(editor.report.dept) && <option value={editor.report.dept}>{editor.report.dept} ⚠ ไม่มีในผัง</option>}
                {deptsOf(editor.report.section).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            {/* 2026-09-07 ส่วน = auto จากไลน์ (อ่านอย่างเดียวเมื่อไลน์มี section) · ไลน์ไม่มี section → เลือกจากผังองค์กร */}
            <Field label="ส่วน">
              {(() => {
                const lnSec = allLines.find(l => l.name === editor.report.line_name)?.section || '';
                return (
                  <select style={inputSt} value={editor.report.section || ''} disabled={!!lnSec}
                    onChange={e => setRep({ section: e.target.value, dept: '' })}>
                    <option value="">—</option>
                    {editor.report.section && !orgSections.includes(editor.report.section) && <option value={editor.report.section}>{editor.report.section}</option>}
                    {orgSections.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                  </select>
                );
              })()}
            </Field>
            {/* 2026-09-07 รหัสคลังจากทะเบียน storage_locations (พิมพ์เองได้พร้อมป้าย + ตรวจรูปแบบ slocValid ตอนบันทึก) */}
            <Field label="Storage Location">
              <StorageLocSelect value={editor.report.storage_location || ''} inputStyle={inputSt} history={storageHist} onChange={({ code }) => setRep({ storage_location: code })} />
            </Field>
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
            {/* 🔴 ทางที่ WI บังคับ (§5.5) — วางก่อน "ดึงจาก Daily Report" ให้เป็นทางหลักที่ตาเห็นก่อน */}
            <button style={btnSt('#e05252')} onClick={pullFromRedBins}
              title="ดึงรายการตามแท็กแดง (ถังแดง) ของไลน์+วันนี้ ที่ยังไม่เคยออกใบ — ทางที่ WI-PD3-069 §5.5 กำหนด">
              ⤵ ดึงจากถังแดง
            </button>
            <button style={btnSt('#4d9fff')} onClick={pullFromDefectLogs}>⤵ ดึงจาก Daily Report</button>
            {/* ทางที่ 2: ของที่ QA เบิกไปทดสอบแบบทำลาย (ใบ FM-STO-003) — 2026-08-24 */}
            <button style={btnSt('#a855f7')} onClick={openReqPicker}>⤵ ดึงจากใบเบิก QA</button>
            {opScan.opRowsCount > 0 && (
              <button style={btnSt('#f97316')} onClick={() => explodeOpItems(editor.items)}
                title="แทนแถวของขั้นตอนด้วยวัตถุดิบ/พาร์ทที่ใส่เข้าไปจนถึงขั้นนั้น — เลขที่สโตร์ตัด SAP ได้จริง">
                🧩 ระเบิดขั้นตอน ({opScan.opRowsCount})
              </button>
            )}
            <button style={ghostBtn} onClick={() => { setSapPicker({ addSource: true }); setSapSearch(''); }}>🔍 เพิ่มจาก SAP/BOM</button>
            <button style={ghostBtn} onClick={() => addItem('sub')}>+ พาร์ทย่อย (กรอกเอง)</button>
          </div>

          {/* ⚠️ แถบเตือน "เลขนี้ SAP ตัดไม่ได้" — ห้ามซ่อน (ใบของเสียที่ตัดสต๊อกไม่ได้ = งานค้างของสโตร์)
              pattern เดียวกับแถบ 🔩 worklist ใน /products */}
          {opScan.opRowsCount > 0 && (
            <div style={{
              marginBottom: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.65,
              background: opScan.blocked.length ? 'rgba(239,68,68,0.10)' : 'rgba(249,115,22,0.10)',
              border: `1px solid ${opScan.blocked.length ? 'rgba(239,68,68,0.45)' : 'rgba(249,115,22,0.45)'}`,
              color: opScan.blocked.length ? '#ef4444' : '#f97316',
            }}>
              <b>🔩 {opScan.opRowsCount} รายการเป็น "ขั้นตอน (OP)" ไม่ใช่เลข SAP</b> — ชิ้นงานยังไม่สมบูรณ์
              จึงตัดตัวมันเองไม่ได้ ต้องตัดวัตถุดิบ/พาร์ทที่ใส่เข้าไปจนถึงขั้นนั้นแทน
              {opScan.ready.length > 0 && <> · กด <b>🧩 ระเบิดขั้นตอน</b> เพื่อแปลงให้อัตโนมัติ</>}
              {opScan.blocked.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  ⛔ ยังไม่ได้ผูกสูตรว่าขั้นนี้กินอะไร: <b>{[...new Set(opScan.blocked.map(b => b.item.mat_no))].join(' · ')}</b>
                  {' '}— ไปตั้งที่ <a href="/products?tab=bom" style={{ color: 'inherit', fontWeight: 800 }}>/products → แท็บ BOM</a> (เลือกแถวที่ติดป้าย 🔩 ขั้นตอน) แล้วกลับมากดระเบิด
                </div>
              )}
            </div>
          )}

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
                      {it.src_request_item_id && <span title="ดึงจากใบเบิก QA (ทดสอบแบบทำลาย)" style={{ marginLeft: 3, fontSize: 11, color: '#a855f7' }}>📦</span>}
                      {it.src_bin_id && <span title="ดึงจากถังแดง (แท็กแดง) — WI-PD3-069 §5.5" style={{ marginLeft: 3, fontSize: 11, color: '#e05252' }}>🔴</span>}
                      {opInfoOf(it.mat_no, explodeCtx.opMap) && <span title="ขั้นตอน (OP) — เลขนี้ไม่มีใน SAP ตัดสต๊อกไม่ได้ ต้องระเบิดเป็นวัตถุดิบก่อน" style={{ marginLeft: 3, fontSize: 11, color: '#ef4444' }}>🔩</span>}
                      {it.src_op_mat && <span title={`ระเบิดมาจากขั้น ${it.src_op_mat}`} style={{ marginLeft: 3, fontSize: 11, color: '#f97316' }}>🧩</span>}</td>
                    <td style={tdSt}><span style={{ fontSize: 11, fontWeight: 700, color: it.source === 'sub' ? '#f59e0b' : '#4d9fff' }}>{it.source === 'sub' ? 'ย่อย' : 'หลัก'}</span></td>
                    {/* 2026-09-07 MAT SAP = <ProductSelect> (Product Master ∪ BOM/parts_master) · ตรงทะเบียน → part_no/part_name ล็อกตามทะเบียน
                        allowFree เพราะบางพาร์ทใน master กรอกเลขเครื่องแทนเลขพาร์ท (badMaster) — ยังต้องพิมพ์เองได้พร้อมป้าย */}
                    {(() => {
                      const so = it.mat_no ? sapByMat.get(String(it.mat_no).toUpperCase()) : null;
                      const lockNo = !!(so && so.part_no && !so.badMaster);
                      const lockName = !!(so && so.part_name);
                      return (<>
                        <td style={tdSt}><input style={{ ...inputSt, width: 120, padding: '5px 7px', opacity: lockNo ? 0.75 : 1 }} value={it.part_no} readOnly={lockNo} title={lockNo ? 'ตามทะเบียน — ล้าง MAT SAP เพื่อแก้เอง' : ''} onChange={e => setItem(it._key, { part_no: e.target.value })} /></td>
                        <td style={tdSt}><input style={{ ...inputSt, width: 150, padding: '5px 7px', opacity: lockName ? 0.75 : 1 }} value={it.part_name} readOnly={lockName} title={lockName ? 'ตามทะเบียน — ล้าง MAT SAP เพื่อแก้เอง' : ''} onChange={e => setItem(it._key, { part_name: e.target.value })} /></td>
                        <td style={tdSt}>
                          <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                            <ProductSelect value={it.mat_no} extraOptions={sapExtra} history={itemMatHist} lines={editor.report.line_name ? getLineFamilyNames(allLines, editor.report.line_name) : undefined}
                              allowFree freeHint="พาร์ทที่ไม่อยู่ในทะเบียน / master กรอกเลขเครื่อง" placeholder="MAT SAP"
                              style={{ width: 150 }} inputStyle={{ padding: '5px 26px 5px 7px', fontSize: 12 }}
                              onChange={r => pickSapForItem(it._key, r)} />
                            <button style={{ ...ghostBtn, padding: '4px 6px' }} title="เลือกจาก SAP/BOM" onClick={() => { setSapPicker({ itemKey: it._key }); setSapSearch(''); }}>🔍</button>
                            {opInfoOf(it.mat_no, explodeCtx.opMap) && (
                              <button style={{ ...ghostBtn, padding: '4px 6px', borderColor: 'rgba(249,115,22,0.6)', color: '#f97316' }}
                                title="ระเบิดขั้นนี้เป็นวัตถุดิบ/พาร์ทที่ใส่เข้าไป (เลขที่ตัด SAP ได้)"
                                onClick={() => explodeOpItems(editor.items, it._key)}>🧩</button>
                            )}
                          </div>
                        </td>
                      </>);
                    })()}
                    <td style={tdSt}><input style={{ ...inputSt, width: 66, padding: '5px 7px' }} value={it.model} onChange={e => setItem(it._key, { model: e.target.value })} /></td>
                    <td style={tdSt}>
                      <select style={{ ...inputSt, width: 60, padding: '5px 4px' }} value={it.code} onChange={e => setItem(it._key, { code: e.target.value })}>
                        <option value="">—</option>{CODE_OPTS.map(([v]) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </td>
                    <td style={tdSt}><input style={{ ...inputSt, width: 60, padding: '5px 7px' }} value={it.bom_ref} onChange={e => setItem(it._key, { bom_ref: e.target.value })} /></td>
                    <td style={tdSt}>
                      {/* หน่วยจาก BOM (KG/PC) — จอเท่านั้น ฟอร์มกระดาษไม่มีคอลัมน์หน่วย (SAP รู้หน่วยฐานของ mat เอง)
                          ⚠️ coil เป็น KG ทศนิยม ห้ามปัดเป็นจำนวนเต็ม */}
                      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                        <input type="number" style={{ ...inputSt, width: 64, padding: '5px 7px' }} value={it.qty} onChange={e => setItem(it._key, { qty: e.target.value })} />
                        {uomByMat[it.mat_no] && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{uomByMat[it.mat_no]}</span>}
                      </div>
                    </td>
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

          {/* สายอนุมัติ — 2026-09-07 เลือกคนจาก profiles ผ่าน <PersonSelect> (role ที่ตรงช่องขึ้นก่อน · เก็บชื่อ snapshot เหมือนเดิม — ตาราง DR) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
            <Field label="ผู้ตรวจสอบ (QC)"><PersonSelect value={editor.report.inspector_name || ''} roles={['qa']} lines={editor.report.line_name ? getLineFamilyNames(allLines, editor.report.line_name) : undefined} history={inspectorHist} inputStyle={inputSt} onChange={({ name }) => setRep({ inspector_name: name })} /></Field>
            <Field label="ผู้ขออนุมัติ (หัวหน้าแผนก)"><PersonSelect value={editor.report.requester_name || ''} roles={['supervisor', 'leader']} lines={editor.report.line_name ? getLineFamilyNames(allLines, editor.report.line_name) : undefined} history={requesterHist} inputStyle={inputSt} onChange={({ name }) => setRep({ requester_name: name })} /></Field>
            <Field label="ผู้อนุมัติ (ผจก. QA/QC)"><PersonSelect value={editor.report.approver_qa_name || ''} roles={['qa', 'manager']} lines={editor.report.line_name ? getLineFamilyNames(allLines, editor.report.line_name) : undefined} history={approverQaHist} inputStyle={inputSt} onChange={({ name }) => setRep({ approver_qa_name: name })} /></Field>
            <Field label="ผู้อนุมัติ (ผจก.ผลิต)"><PersonSelect value={editor.report.approver_pd_name || ''} roles={['manager']} lines={editor.report.line_name ? getLineFamilyNames(allLines, editor.report.line_name) : undefined} history={approverPdHist} inputStyle={inputSt} onChange={({ name }) => setRep({ approver_pd_name: name })} /></Field>
            <Field label="ผู้อนุมัติ (ผจก.ทั่วไป)"><PersonSelect value={editor.report.approver_gm_name || ''} roles={['manager', 'admin']} lines={editor.report.line_name ? getLineFamilyNames(allLines, editor.report.line_name) : undefined} history={approverGmHist} inputStyle={inputSt} onChange={({ name }) => setRep({ approver_gm_name: name })} /></Field>
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
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, color: o.source === 'sub' ? '#f59e0b' : '#4d9fff', background: o.source === 'sub' ? '#f59e0b1f' : '#4d9fff1f' }}>{o.source === 'sub' ? 'ย่อย' : 'หลัก'}</span>
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
    </Page>
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
