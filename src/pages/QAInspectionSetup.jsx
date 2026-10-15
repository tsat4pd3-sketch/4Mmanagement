/**
 * QAInspectionSetup — มาตรฐานการตรวจ & Drawing (/qa-setup)
 *
 * หน้าตั้งค่าฝั่ง QA: สร้าง part master แล้วกด "🎯 ตั้งค่าจุดตรวจ & Drawing" เปิดโมดัล
 * `QaPointsEditor` — **ตัวเดียวกับ PM ตั้งค่าจุดตรวจ** (อัปรูป/Drawing หลายแผ่น · ซูม · ปักหมุด ·
 * การ์ดจุดตรวจ · รูปโคลสอัพ · แถบไปที่จุด · กดบันทึกครั้งเดียว) ต่างแค่ช่องสเปคแบบ QA
 * (Variable/Attribute · LSL/USL · Rank · Stage · ความถี่) — 📄 docs/modules/inspection-point-setup.md
 * หน้านี้เหลือ: รายการพาร์ท · ดู drawing+หมุด (อ่านอย่างเดียว) · ตารางมาตรฐาน · ส่งเข้า SPC
 *
 * ตาราง: qa_parts, qa_part_drawings, qa_inspection_items (MAIN project) — เขียนได้เฉพาะ qa:manage
 */
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { AnimatePresence } from 'framer-motion';
import { canWriteLine, writeBlockText } from '../utils/writeScope';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { UserContext } from '../App';
import { cachedMaster, mrows } from '../utils/masterCache';
import { usePerms } from '../utils/usePerms';
import useIsMobile from '../utils/useIsMobile';
import { QA_STAGES } from '../utils/qaStages';
import LineSelect from '../components/LineSelect';
import CustomerSelect from '../components/CustomerSelect';
import useColumnHistory from '../utils/useColumnHistory';
import { loadLinesRes, LINE_COLUMNS } from '../utils/useProductionLines';
import { specLabel } from '../utils/qaSpec';
import { checkWrite } from '../utils/dbWrite';
// 🧩 ตั้งค่าจุดตรวจ = ตัวกลางชุดเดียวกับ PM (15/10 · docs/modules/inspection-point-setup.md)
import SpinAnnotator from '../components/SpinAnnotator';
import QaPointsEditor from '../components/QaPointsEditor';
import { QA_RANK, balloonSort } from '../utils/qaPoints';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import SearchInput from '../components/SearchInput';

const fmtDT = s => s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const inputSt = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text)',
};
const btnSt = (bg = 'var(--accent)', color = bg === 'var(--accent)' ? 'var(--accent-ink)' : '#fff') => ({
  padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontWeight: 700, fontSize: 13, background: bg, color,
});
const ghostBtn = {
  padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12,
  background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)',
};
const cardSt = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };
const thSt = { padding: '7px 10px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border2)' };
const tdSt = { padding: '7px 10px', fontSize: 12.5, color: 'var(--text)', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };


/* ตามฟอร์ม FM-QA-112: Part Classification + Rank ของจุดตรวจ */
const PART_RANK = {
  safety:    { label: 'Safety part',                 color: '#ef4444' },
  important: { label: 'Important / Regulation part', color: '#f59e0b' },
  general:   { label: 'General part',                color: '#4d9fff' },
};
const PART_KIND = {
  completed:    'Completed part',
  component:    'Component, Child part',
  raw_material: 'Raw material',
};
const STAGE = QA_STAGES;
function Chip({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      color, background: `${color}1f`, border: `1px solid ${color}55`, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 12px', overflowY: 'auto',
      }}
      /* ตั้งใจไม่ปิดเมื่อคลิกพื้นหลัง — กันเผลอกดแล้วข้อมูลในฟอร์มหาย ปิดได้จากปุ่ม ✕/ยกเลิกเท่านั้น */
    >
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14,
        width: `min(${width}px, 96vw)`, boxShadow: 'var(--shadow-lg)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ padding: 18, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, span }) {
  return (
    <div style={{ gridColumn: span ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const EMPTY_PART = {
  part_no: '', part_name: '', customer: '', model: '', line_name: '',
  dwg_no: '', drawing_rev: '', concern_no: '', part_rank: '', part_kind: '',
};
export default function QAInspectionSetup() {
  const isMobile = useIsMobile(); // ≤768px: two-pane ยุบเป็นคอลัมน์เดียว + ปิด sticky (desktop ไม่เปลี่ยน)
  const { fullName, role, section: homeSection, sections: mySections, allUnits } = useContext(UserContext);
  const { can } = usePerms();
  const canManage = can('qa', 'manage');
  /* 🔐 พาร์ทผูกไลน์ (`qa_parts.line_name`) ⇒ แก้ spec/ลบพาร์ท+จุดตรวจ+แบบ ได้เฉพาะไลน์ส่วนงานตัวเอง
     (audit 15/10 — ทั้งไฟล์เดิมไม่มีคำว่าขอบเขตเลย) · ขา QA ถือ `scope:all_units` จึงไม่กระทบ */
  const wctx = useMemo(() => ({ role, section: homeSection, sections: mySections, allUnits }),
    [role, homeSection, mySections, allUnits]);
  // 📜 ค่าที่เคยบันทึกไว้ (Main) — วิธีตรวจ (Visual/CF ที่ไม่ใช่เครื่องมือในทะเบียน) / ลูกค้า ยังเลือกซ้ำได้ ไม่หายเงียบ (2026-09-07)
  const methodHist = useColumnHistory(supabase, 'qa_inspection_items', 'method');
  const custHist = useColumnHistory(supabase, 'qa_parts', 'customer');

  const [parts, setParts] = useState([]);
  const [lines, setLines] = useState([]);
  const [selId, setSelId] = useState(null);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [partModal, setPartModal] = useState(null);   // { ...form, id? }
  const [bomOptions, setBomOptions] = useState(null); // null = ยังไม่โหลด (โหลดครั้งแรกที่เปิด modal)
  const [bomSearch, setBomSearch] = useState('');
  const [drawings, setDrawings] = useState([]);        // หลายแผ่น/มุมมองต่อ part (qa_part_drawings) — อ่านอย่างเดียวในหน้านี้
  const [activeDwgIdx, setActiveDwgIdx] = useState(0);
  const [prodImg, setProdImg] = useState(null);        // รูป product จาก BOM/Product Master (dr_products.image_url)
  /* 🎯 โมดัลตั้งค่าจุดตรวจ + Drawing — หลักเดียวกับ PM (`QaPointsEditor` · 15/10)
     { focusItemId? } = เปิดแล้วเลื่อนไปการ์ดจุดนั้น */
  const [editor, setEditor] = useState(null);

  const sel = parts.find(p => p.id === selId) || null;
  const loadParts = useCallback(async () => {
    const { data } = await supabase.from('qa_parts').select('*').order('part_no');
    setParts(data || []);
    setSelId(prev => prev && (data || []).some(p => p.id === prev) ? prev : (data?.[0]?.id ?? null));
  }, []);
  /* ดูได้ทั้งโรงงาน — ด่านอยู่ที่ "แก้" ⇒ คำนวณต่อพาร์ทตอนกดปุ่ม ไม่ซ่อนพาร์ทออกจากลิสต์
     (ทะเบียนจุดตรวจเป็นข้อมูลอ้างอิงของทั้งโรงงาน ซ่อน = คนหาไม่เจอแล้วสร้างซ้ำ) */
  const partWrite = useMemo(() => canWriteLine(wctx, (parts.find(p2 => p2.id === selId) || {}).line_name, lines),
    [wctx, parts, selId, lines]);
  // แก้จุดตรวจ/แบบของพาร์ทนี้ได้ไหม = มีสิทธิ์ qa:manage และพาร์ทอยู่ในไลน์ส่วนงานตัวเอง
  const canEdit = canManage && partWrite.ok;
  useEffect(() => { loadParts(); }, [loadParts]);

  useEffect(() => {
    // เก็บเป็น object (id/name/parent_line_name) — dropdown จัดชั้นตามผัง (§5.3 ข้อ 8)
    // LINE_COLUMNS ครบ (section/is_active) ให้ <LineSelect> กรองปลดระวาง/จัดลำดับชั้นได้ (2026-09-07)
    loadLinesRes()
      .then(({ data }) => setLines(data || []));
  }, []);

  const loadItems = useCallback(async (partId) => {
    if (!partId) { setItems([]); return; }
    const { data } = await supabase.from('qa_inspection_items').select('*')
      .eq('part_id', partId);
    setItems((data || []).sort(balloonSort));
  }, []);
  const loadDrawings = useCallback(async (partId) => {
    if (!partId) { setDrawings([]); setActiveDwgIdx(0); return; }
    const { data } = await supabase.from('qa_part_drawings').select('*')
      .eq('part_id', partId).order('sort').order('created_at');
    setDrawings(data || []);
    setActiveDwgIdx(i => (i < (data || []).length ? i : 0));
  }, []);

  /* ⚠️ หน้านี้ไม่เขียนจุดตรวจ/แผ่นแบบเองแล้ว (15/10) — ทั้งหมดอยู่ในโมดัล `QaPointsEditor`
     แบบเดียวกับ PM (แก้ทั้งชุด → กดบันทึกครั้งเดียว · ยกเลิก = ทิ้งที่แก้) จึงไม่ต้องมี Undo/Redo แยก */
  useEffect(() => { loadItems(selId); loadDrawings(selId); }, [selId, loadItems, loadDrawings]);

  /* รูป product จาก BOM/Product Master — จับคู่ part_no ↔ mat_no/p_no/code ของ dr_products
     ช่วยพนักงานจำหน้าตาชิ้นงานได้โดยไม่ต้องอัพโหลดซ้ำ */
  useEffect(() => {
    setProdImg(null);
    const pn = sel?.part_no?.trim();
    if (!pn || pn.includes(',')) return;
    let alive = true;
    // ค้นทีละคอลัมน์ด้วย .eq (parameterized) แทน .or ที่ interpolate ค่าดิบ —
    // เลขพาร์ทที่มี . / ( ) เป็น metachar ของ PostgREST filter ทำให้ .or พังแล้วรูปไม่ขึ้น
    (async () => {
      for (const col of ['mat_no', 'p_no', 'code']) {
        const { data } = await supabaseDR.from('dr_products').select('image_url')
          .eq(col, pn).not('image_url', 'is', null).limit(1);
        if (!alive) return;
        if (data?.[0]?.image_url) { setProdImg(data[0].image_url); return; }
      }
    })();
    return () => { alive = false; };
  }, [sel?.part_no]);

  /* ตัวเลือกพาร์ทจากฐานข้อมูล BOM ฝั่ง DR (dr_products + bom_items) —
     อ่านอย่างเดียวผ่าน supabaseDR (anon), โหลด lazy ครั้งแรกที่เปิด modal เพิ่ม Part */
  useEffect(() => {
    if (!partModal || bomOptions !== null) return;
    let alive = true;
    (async () => {
   // ⚠️ ตัวที่ผ่าน cachedMaster คืน **array ตรงๆ** (ไม่ใช่ { data }) — destructure ต้องไม่ห่อ { data: … }
      const [prods, { data: boms }] = await Promise.all([
        /* cache master (2026-09-16) — ทะเบียนเปลี่ยนเดือนละไม่กี่ครั้ง · ล้างด้วย invalidateTable() ที่หน้าแก้ทะเบียน */
        cachedMaster('dr_products:qa', async () => mrows(await supabaseDR.from('dr_products').select('id, name, code, mat_no, p_no, customer, line_name').eq('is_active', true).order('name'))),
        supabaseDR.from('bom_items').select('id, product_id, mat_no, part_no, part_name, supplier').eq('is_active', true).order('part_name'),
      ]);
      if (!alive) return;
      const prodById = Object.fromEntries((prods || []).map(p => [p.id, p]));
      const opts = [
        ...(prods || []).map(p => ({
          key: `p-${p.id}`, tag: 'Product',
          part_no: p.p_no || p.mat_no || p.code || '', part_name: p.name || '',
          customer: p.customer || '', line_name: p.line_name || '',
          sub: [p.mat_no, p.line_name].filter(Boolean).join(' · '),
        })),
        ...(boms || []).map(b => {
          const parent = prodById[b.product_id];
          return {
            key: `b-${b.id}`, tag: 'BOM',
            part_no: b.part_no || b.mat_no || '', part_name: b.part_name || '',
            customer: parent?.customer || '', line_name: parent?.line_name || '',
            sub: `ใน BOM: ${parent?.name || '—'}${b.supplier ? ` · ${b.supplier}` : ''}`,
          };
        }),
      ].filter(o => o.part_no || o.part_name);
      setBomOptions(opts);
    })();
    return () => { alive = false; };
  }, [partModal, bomOptions]);

  const bomMatches = useMemo(() => {
    const q = bomSearch.trim().toLowerCase();
    if (!bomOptions || q.length < 2) return [];
    return bomOptions
      .filter(o => [o.part_no, o.part_name, o.sub].some(v => (v || '').toLowerCase().includes(q)))
      .slice(0, 8);
  }, [bomOptions, bomSearch]);

  const pickBomOption = (o) => {
    setPartModal(f => ({
      ...f,
      part_no: o.part_no || f.part_no,
      part_name: o.part_name || f.part_name,
      customer: o.customer || f.customer,
      line_name: lines.some(l => l.name === o.line_name) ? o.line_name : f.line_name,
    }));
    setBomSearch('');
  };

  const shownParts = parts.filter(p => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p.part_no, p.part_name, p.customer, p.model].some(v => (v || '').toLowerCase().includes(q));
  });

  /* ── Part CRUD ── */
  const savePart = async () => {
    const f = partModal;
    if (!f.part_no.trim()) { toast.error('กรอก Part No.'); return; }
    const payload = {
      part_no: f.part_no.trim(), part_name: f.part_name.trim() || null,
      customer: f.customer.trim() || null, model: f.model.trim() || null,
      line_name: f.line_name || null,
      dwg_no: f.dwg_no.trim() || null, drawing_rev: f.drawing_rev.trim() || null,
      concern_no: f.concern_no.trim() || null,
      part_rank: f.part_rank || null, part_kind: f.part_kind || null,
      ...(f.id ? { is_active: f.is_active } : {}),
    };
    /* 🔐 ด่านซ้ำตอนกดจริง — ไลน์ปลายทางมาจากฟอร์ม (เปลี่ยนไลน์ได้) จึงเช็คค่าที่จะเขียนจริง */
    const w = canWriteLine(wctx, f.line_name, lines);
    if (!w.ok) { toast.info(writeBlockText(w, { what: 'พาร์ทของไลน์นี้' })); return; }
    const { data, error } = f.id
      ? await supabase.from('qa_parts').update(payload).eq('id', f.id).select().single()
      : await supabase.from('qa_parts').insert({ ...payload, created_by: fullName || null }).select().single();
    if (error) { toast.error(error.code === '23505' ? `Part No. ${f.part_no} มีอยู่แล้ว` : `บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success('บันทึก Part แล้ว ✓');
    setPartModal(null);
    await loadParts();
    setSelId(data.id);
  };

  const delPart = async () => {
    if (!sel) return;
    if (!partWrite.ok) { toast.info(writeBlockText(partWrite, { what: 'พาร์ทของไลน์นี้' })); return; }
    if (!window.confirm(`ลบ ${sel.part_no} พร้อมจุดตรวจทั้งหมด ${items.length} จุด?`)) return;
    const partId = sel.id;
    /* 🔴 ต้อง `.select('id')` แล้ว**นับแถว** ก่อนแตะ storage (QC audit 2026-10-06)
       RLS ปฏิเสธ DELETE = "สำเร็จ 0 แถว ไม่มี error" (กฎเหล็ก DB ข้อ 2) — เดิมเช็คแค่ `error`
       แล้วเดินไปลบ `qa-drawings/parts/<id>` ทั้งโฟลเดอร์ ⇒ **แถวยังอยู่ แต่แบบหายหมด กู้ไม่ได้**
       แล้วจอยังขึ้น "ลบแล้ว" · ลำดับที่ปลอดภัยมีทางเดียว: ยืนยันแถวหายจริงก่อน ค่อยเก็บกวาดไฟล์ */
    const res = await supabase.from('qa_parts').delete().eq('id', sel.id).select('id');
    if (!checkWrite(res, 'ลบพาร์ท')) return;
    if (!(res.data || []).length) {
      toast.error('ลบไม่สำเร็จ (0 แถว) — สิทธิ์ qa:manage ไม่พอ · แบบและจุดตรวจยังอยู่ครบ');
      return;
    }
    // แถวหายจริงแล้ว เก็บกวาดไฟล์ drawing ทั้งโฟลเดอร์ กันไฟล์กำพร้าใน storage (best-effort)
    try {
      const { data: files } = await supabase.storage.from('qa-drawings').list(`parts/${partId}`, { limit: 1000 });
      const paths = (files || []).map(f => `parts/${partId}/${f.name}`);
      if (paths.length) await supabase.storage.from('qa-drawings').remove(paths);
    } catch { /* ลบไฟล์พลาดไม่ต้องกระทบ flow หลัก */ }
    toast.success('ลบแล้ว');
    setSelId(null);
    loadParts();
  };

  /* สร้างจุดควบคุม SPC จาก item ชนิด variable → ไปวัด/ดู Cp-Cpk ที่หน้า /qa */
  const sendToSPC = async (it) => {
    /* 🔐 `qa_characteristics` = ตารางเดียวกับแท็บ SPC ที่ปิดไปแล้ว ⇒ ต้องมีด่านเดียวกัน
       (QC audit 15/10 "ประตูที่สอง" — เดิมปุ่มนี้เปิดด้วย canManage ล้วน) */
    if (!partWrite.ok) { toast.info(writeBlockText(partWrite, { what: 'จุดควบคุมของไลน์นี้' })); return; }
    const { error } = await supabase.from('qa_characteristics').insert({
      part_no: sel.part_no, part_name: sel.part_name || null, line_name: sel.line_name || null,
      characteristic: it.characteristic, unit: it.unit || null,
      nominal: it.nominal, usl: it.usl, lsl: it.lsl,
      subgroup_size: 5, gauge: it.method || null,
      control_method: `Dwg ${sel.dwg_no || sel.drawing_rev || ''} balloon #${it.balloon_no}`.replace(/\s+/g, ' ').trim(),
      created_by: fullName || null,
    });
    if (error) { toast.error(`สร้างไม่สำเร็จ: ${error.message}`); return; }
    toast.success(`สร้างจุดควบคุม SPC "${it.characteristic}" แล้ว — บันทึกค่าวัดที่ Quality Control Center ✓`);
  };

  return (
    <Page>
      <PageHeader title="มาตรฐานการตรวจ & Drawing" icon="📐"
        sub="อัพโหลดแบบชิ้นงาน วาง balloon จุดตรวจ และกำหนดมาตรฐานการตรวจสอบต่อ part — จุด variable ส่งเข้า SPC (หน้า Quality Control Center) ได้" />

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(230px, 290px) 1fr', gap: 14, alignItems: 'start' }}>
        {/* ── ซ้าย: รายการ part ── */}
        <div style={{ ...cardSt, padding: 12, ...(isMobile ? null : { position: 'sticky', top: 70 }) }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <SearchInput value={search} onChange={setSearch} fields="part" />
            {canManage && <button style={{ ...btnSt(), padding: '8px 12px' }} title="เพิ่ม Part" onClick={() => setPartModal({ ...EMPTY_PART })}>＋</button>}
          </div>
          <div style={{ maxHeight: '65vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {shownParts.map(p => (
              <button key={p.id} onClick={() => setSelId(p.id)}
                style={{
                  textAlign: 'left', padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                  background: p.id === selId ? 'var(--accent-dim)' : 'transparent',
                  border: `1px solid ${p.id === selId ? 'var(--accent)' : 'transparent'}`,
                  opacity: p.is_active ? 1 : 0.5,
                }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: p.id === selId ? 'var(--accent)' : 'var(--text)' }}>
                  {p.part_no}{p.is_active ? '' : ' (ปิด)'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[p.part_name, p.customer].filter(Boolean).join(' · ') || '—'}
                </div>
              </button>
            ))}
            {shownParts.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12, padding: 16, textAlign: 'center' }}>ยังไม่มี part{canManage ? ' — กด ＋ เพื่อเพิ่ม' : ''}</div>}
          </div>
        </div>

        {/* ── ขวา: รายละเอียด part ── */}
        {!sel ? (
          <div style={{ ...cardSt, textAlign: 'center', color: 'var(--muted)', padding: 60 }}>เลือก part จากรายการด้านซ้าย</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            {/* header */}
            <div style={{ ...cardSt, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {prodImg && (
                <a href={prodImg} target="_blank" rel="noreferrer" title="รูปจาก Product Master/BOM — คลิกเปิดเต็มจอ" style={{ flexShrink: 0 }}>
                  <img src={prodImg} alt={sel.part_no} style={{
                    width: 72, height: 72, objectFit: 'cover', borderRadius: 10,
                    border: '1px solid var(--border2)', background: 'var(--bg2)', display: 'block',
                  }} />
                </a>
              )}
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 900, fontSize: 17, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {sel.part_no} <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{sel.part_name || ''}</span>
                  {sel.part_rank && <Chip label={PART_RANK[sel.part_rank]?.label || sel.part_rank} color={PART_RANK[sel.part_rank]?.color || '#6b7280'} />}
                  {sel.part_kind && <Chip label={PART_KIND[sel.part_kind] || sel.part_kind} color="#a78bfa" />}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {[sel.customer && `ลูกค้า: ${sel.customer}`, sel.model && `Model: ${sel.model}`, sel.line_name && `ไลน์: ${sel.line_name}`,
                    sel.dwg_no && `Dwg.No: ${sel.dwg_no}`, sel.drawing_rev && `Rev: ${sel.drawing_rev}`,
                    sel.concern_no && `Concern No: ${sel.concern_no}`,
                    sel.drawing_updated_at && `อัพเดต ${fmtDT(sel.drawing_updated_at)}`]
                    .filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              {/* 🔐 มีสิทธิ์ qa:manage แต่พาร์ทนี้เป็นของไลน์ส่วนงานอื่น — เขียนบอก ห้ามซ่อนปุ่มเงียบ */}
              {canManage && !partWrite.ok && (
                <div style={{ fontSize: 12, color: '#eab308', padding: '6px 0' }}>
                  🔒 {writeBlockText(partWrite, { what: 'พาร์ทนี้' })}
                </div>
              )}
              {canManage && partWrite.ok && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={btnSt()} onClick={() => setEditor({})}
                    title="แผ่น Drawing/รูปชิ้นงาน + ปักหมุด + สเปคทุกจุด — หน้าตาและวิธีใช้เดียวกับตั้งค่าจุดตรวจ PM">
                    🎯 ตั้งค่าจุดตรวจ & Drawing
                  </button>
                  <button style={ghostBtn} onClick={() => setPartModal({
                    ...EMPTY_PART, ...sel,
                    part_name: sel.part_name || '', customer: sel.customer || '', model: sel.model || '',
                    line_name: sel.line_name || '', dwg_no: sel.dwg_no || '', drawing_rev: sel.drawing_rev || '',
                    concern_no: sel.concern_no || '', part_rank: sel.part_rank || '', part_kind: sel.part_kind || '',
                  })}>✏️ แก้ไข Part</button>
                  <button style={{ ...ghostBtn, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }} onClick={delPart}>🗑 ลบ</button>
                </div>
              )}
            </div>

            {/* drawings + หมุด — อ่านอย่างเดียว (แก้ในโมดัล 🎯 ตั้งค่าจุดตรวจ — ตัวปักหมุดตัวเดียวกับ PM) */}
            <div style={cardSt}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>🖼 Drawings ({drawings.length} แผ่น){sel.drawing_rev ? ` · Rev ${sel.drawing_rev}` : ''}</div>
                {canEdit && drawings.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>แตะหมุด = ไปแก้จุดนั้น</div>}
              </div>
              {drawings.length === 0 ? (
                <div style={{ padding: 46, textAlign: 'center', color: 'var(--muted)', fontSize: 13, border: '2px dashed var(--border2)', borderRadius: 10 }}>
                  ยังไม่มี drawing — {canEdit ? 'กด "🎯 ตั้งค่าจุดตรวจ & Drawing" เพื่อเพิ่มแผ่น (รูปภาพหรือ PDF ≤20MB) แล้วปักหมุด' : 'รอ QA อัพโหลด'}
                </div>
              ) : (() => {
                const frames = drawings.map(d => ({ _key: d.id, _preview: d.drawing_url, title: d.title, isPdf: /\.pdf($|\?)/i.test(d.drawing_url || '') }));
                const cur = frames[activeDwgIdx] || frames[0];
                const onSheet = (i) => i.pos_x != null && i.pos_y != null && (i.drawing_id === cur._key || (!i.drawing_id && frames[0]._key === cur._key));
                return (
                  <SpinAnnotator readOnlyFrames spinnable={false} subject="part"
                    frames={frames} frameIdx={activeDwgIdx} setFrameIdx={setActiveDwgIdx}
                    frameCounts={Object.fromEntries(frames.map(f => [f._key, items.filter(i => i.pos_x != null && (i.drawing_id === f._key || (!i.drawing_id && frames[0]._key === f._key))).length]))}
                    pins={items.filter(onSheet).map(i => ({
                      key: i.id, x: Number(i.pos_x) / 100, y: Number(i.pos_y) / 100, label: i.balloon_no,
                      label_dx: i.label_dx, label_dy: i.label_dy,
                      color: i.rank ? QA_RANK[i.rank]?.color : '#4d9fff' }))}
                    pinHasDetail={Object.fromEntries(items.map(i => [i.id, !!i.image_path]))}
                    onPinClick={key => { if (canEdit) setEditor({ focusItemId: key }); }} />
                );
              })()}
            </div>

            {/* ตารางจุดตรวจ */}
            <div style={{ ...cardSt, padding: 0 }}>
              <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>
                  📋 มาตรฐานการตรวจ ({items.length} จุด
                  {items.some(i => i.rank) ? ` · Rank M ${items.filter(i => i.rank === 'M').length} / SC ${items.filter(i => i.rank === 'SC').length}` : ''})
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button style={btnSt()} onClick={() => setEditor({})}>🎯 แก้ไข / เพิ่มจุดตรวจ</button>
                  </div>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
                  <thead><tr>
                    <th style={thSt}>No.</th><th style={thSt}>Inspection item</th><th style={thSt}>ชนิด</th>
                    <th style={thSt}>Quality standard</th><th style={thSt}>Inspection equipment</th>
                    <th style={thSt}>Rank</th><th style={thSt}>Stage</th><th style={thSt}>ความถี่ / n</th>
                    {canManage && <th style={thSt}></th>}
                  </tr></thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id} style={{ opacity: it.is_active ? 1 : 0.45 }}>
                        <td style={{ ...tdSt, fontWeight: 900, whiteSpace: 'nowrap' }}>
                          <span style={{ color: it.rank ? QA_RANK[it.rank]?.color : '#4d9fff' }}>{it.rank ? '◆' : '●'} {it.balloon_no}</span>
                          {it.pos_x == null && <span title="ยังไม่วางบน drawing" style={{ marginLeft: 4, fontSize: 11, color: 'var(--muted)' }}>∅</span>}
                          {it.image_path && <span title="มีรูปโคลสอัพของจุดนี้" style={{ marginLeft: 4, fontSize: 11 }}>🔍</span>}
                          {it.pos_x != null && drawings.length > 1 && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 500, marginTop: 1 }}>
                              🖼 {drawings.find(d => d.id === it.drawing_id)?.title || drawings[0]?.title || '—'}
                            </div>
                          )}
                        </td>
                        <td style={tdSt}>{it.characteristic}{it.remark ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{it.remark}</div> : null}</td>
                        <td style={tdSt}><Chip label={it.item_type === 'variable' ? 'Variable' : 'Attribute'} color={it.item_type === 'variable' ? '#4d9fff' : '#a78bfa'} /></td>
                        <td style={{ ...tdSt, whiteSpace: 'nowrap' }} title={it.spec_text ? `ข้อความตามแบบ: ${it.spec_text}` : undefined}>
                          {/* ข้อความเดียวกับที่จอตรวจโชว์ (utils/qaSpec — ห้ามประกอบเอง) */}
                          {specLabel(it)}
                        </td>
                        <td style={tdSt}>{it.method || '—'}</td>
                        <td style={tdSt}>{it.rank ? <Chip label={it.rank} color={QA_RANK[it.rank]?.color || '#6b7280'} /> : '—'}</td>
                        <td style={tdSt}><Chip label={STAGE[it.stage]?.label || it.stage} color={STAGE[it.stage]?.color || '#6b7280'} /></td>
                        <td style={tdSt}>{[it.frequency, it.sample_size != null ? `n=${it.sample_size}` : null].filter(Boolean).join(' · ') || '—'}</td>
                        {canManage && (
                          <td style={{ ...tdSt, whiteSpace: 'nowrap' }}>
                            {canEdit && <button className="tbtn" title="แก้ไขจุดนี้ (เปิดตั้งค่าจุดตรวจที่การ์ดของจุดนี้)" onClick={() => setEditor({ focusItemId: it.id })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✏️</button>}
                            {it.item_type === 'variable' && (
                              <button className="tbtn" title="สร้างจุดควบคุม SPC จากจุดตรวจนี้" onClick={() => sendToSPC(it)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--accent)', fontWeight: 800 }}>→SPC</button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr><td style={tdSt} colSpan={9}>
                        <span style={{ color: 'var(--muted)' }}>ยังไม่มีจุดตรวจ{canEdit ? ' — กด "🎯 แก้ไข / เพิ่มจุดตรวจ"' : ''}</span>
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Part modal ── */}
      {partModal && (
        <Modal title={partModal.id ? `✏️ แก้ไข ${partModal.part_no}` : '➕ เพิ่ม Part'} onClose={() => { setPartModal(null); setBomSearch(''); }}>
          {/* เลือกจากฐานข้อมูล BOM / Product Master → เติมฟอร์มให้ (แก้ทับได้) */}
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: 'var(--bg3)', border: '1px dashed var(--border2)' }}>
            <Field label="🔍 เลือกจากฐานข้อมูล BOM / Product Master">
              <input style={inputSt} value={bomSearch} onChange={e => setBomSearch(e.target.value)}
                placeholder={bomOptions === null ? 'กำลังโหลดฐานข้อมูล…' : `พิมพ์ค้นหา Part No. / ชื่อพาร์ท / MAT.NO (${bomOptions.length.toLocaleString()} รายการ)`} />
            </Field>
            {bomSearch.trim().length >= 2 && (
              <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {bomMatches.map(o => (
                  <button key={o.key} onClick={() => pickBomOption(o)}
                    style={{
                      textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                      background: 'var(--card)', border: '1px solid var(--border)',
                      display: 'flex', gap: 8, alignItems: 'center',
                    }}>
                    <Chip label={o.tag} color={o.tag === 'BOM' ? '#f59e0b' : '#4d9fff'} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--text)' }}>{o.part_no || '—'} <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{o.part_name}</span></div>
                      {o.sub && <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.sub}</div>}
                    </div>
                  </button>
                ))}
                {bomMatches.length === 0 && bomOptions !== null && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 2px' }}>ไม่พบ — กรอกเองด้านล่างได้เลย</div>
                )}
              </div>
            )}
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Part No. *"><input style={inputSt} value={partModal.part_no} onChange={e => setPartModal(f => ({ ...f, part_no: e.target.value }))} /></Field>
            <Field label="Part Name"><input style={inputSt} value={partModal.part_name} onChange={e => setPartModal(f => ({ ...f, part_name: e.target.value }))} /></Field>
            {/* ลูกค้า — เลือกจากรายชื่อใน Product Master (CustomerSelect) กันสะกดต่างข้ามโมดูล (2026-09-07) */}
            <Field label="ลูกค้า"><CustomerSelect value={partModal.customer || ''} history={custHist} onChange={({ customer }) => setPartModal(f => ({ ...f, customer }))} /></Field>
            <Field label="Model"><input style={inputSt} value={partModal.model} onChange={e => setPartModal(f => ({ ...f, model: e.target.value }))} /></Field>
            <Field label="ไลน์ผลิต">
              {/* qa_parts.line_name ใช้ scope พาร์ทใน QaCheckSheet — ชื่อต้อง canonical → <LineSelect> (2026-09-07) */}
              <LineSelect lines={lines} value={partModal.line_name || ''} placeholder="— ไม่ระบุ —" style={inputSt}
                onChange={v => setPartModal(f => ({ ...f, line_name: v }))} />
            </Field>
            <Field label="Dwg. No."><input style={inputSt} placeholder="เช่น 97/3" value={partModal.dwg_no} onChange={e => setPartModal(f => ({ ...f, dwg_no: e.target.value }))} /></Field>
            <Field label="Revision"><input style={inputSt} placeholder="เช่น 01" value={partModal.drawing_rev} onChange={e => setPartModal(f => ({ ...f, drawing_rev: e.target.value }))} /></Field>
            <Field label="Concern No."><input style={inputSt} placeholder="เช่น C14225724" value={partModal.concern_no} onChange={e => setPartModal(f => ({ ...f, concern_no: e.target.value }))} /></Field>
            <Field label="Part Classification">
              <select style={inputSt} value={partModal.part_rank} onChange={e => setPartModal(f => ({ ...f, part_rank: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {Object.entries(PART_RANK).map(([v, r]) => <option key={v} value={v}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="ชนิด Part">
              <select style={inputSt} value={partModal.part_kind} onChange={e => setPartModal(f => ({ ...f, part_kind: e.target.value }))}>
                <option value="">— ไม่ระบุ —</option>
                {Object.entries(PART_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            {partModal.id && (
              <Field label="สถานะ">
                <select style={inputSt} value={partModal.is_active ? '1' : '0'} onChange={e => setPartModal(f => ({ ...f, is_active: e.target.value === '1' }))}>
                  <option value="1">ใช้งาน</option><option value="0">ปิดใช้งาน</option>
                </select>
              </Field>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button style={ghostBtn} onClick={() => setPartModal(null)}>ยกเลิก</button>
            <button style={btnSt()} onClick={savePart}>บันทึก</button>
          </div>
        </Modal>
      )}

      {/* ── 🎯 ตั้งค่าจุดตรวจ + Drawing — โมดัลเดียวกับ PM (ระบบเดียว เรียนครั้งเดียว · 15/10) ── */}
      <AnimatePresence>
        {editor && sel && canEdit && (
          <QaPointsEditor part={sel} focusItemId={editor.focusItemId} methodHist={methodHist} writeCheck={partWrite}
            onClose={() => setEditor(null)}
            onSaved={() => { setEditor(null); loadItems(sel.id); loadDrawings(sel.id); loadParts(); }} />
        )}
      </AnimatePresence>
    </Page>
  );
}
