import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import ReadOnlyNote from '../components/ReadOnlyNote';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadLinesRes } from '../utils/useProductionLines';
import { UserContext } from '../App';
import { canWriteLine, writeBlockText } from '../utils/writeScope';   // 🔐 ชั้นที่ 3 — ยืมมือเขียนทะเบียนสินค้า (20/10)
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope, scopedLines as scopedLinesOf } from '../utils/sectionScope';
import { getLineFamilyNames, lineNameCompare } from '../utils/lineHierarchy';
import { dieSetKindLabel, dieSetKindOptions, dieSetKindKey } from '../utils/equipmentKinds';
import useDieSetKinds, { invalidateDieSetKinds } from '../utils/useDieSetKinds'; // ทะเบียนรูปแบบชุด (DR die_set_kinds) — 2026-10-05
import { OPEN_MO_STATUSES, buildOpenMoMap, openMosOf } from '../utils/dieStatus';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import FilterBar from '../components/FilterBar';
import SearchInput from '../components/SearchInput';
import { ALL, allOf } from '../utils/filterLabels';
import useTabParam, { useMergeParams } from '../utils/useTabParam';
import { useSearchParams } from 'react-router-dom';
import { buildQrPayload, parseQrPayload, findDieByScan } from '../utils/qrCode';   // 📷 สแกนป้ายแม่พิมพ์ → หมุดบนผัง (2026-10-06)
import DieLayout from '../components/DieLayout';
import DieStatusBoard from '../components/DieStatusBoard';
import ProductSelect from '../components/ProductSelect'; // MAT SAP = picker กลาง (single-source audit 2026-09-07)
import { dieSetMats, dieSetPairState, suggestPps, pairHint } from '../utils/dieSetMats';
import { pairBlockReason } from '../utils/pairOrder';   // 🔗 ด่านเดียวกับ Product Master — คู่ต้องอยู่ไลน์เดียวกัน
import { checkWrite, checkWriteRows } from '../utils/dbWrite';      // RLS ปฏิเสธ UPDATE = 0 แถว ไม่มี error ⇒ ต้องนับแถว // 🔨 ชุดหนึ่งทำได้ 2 MAT (งานคู่ RH/LH)
import useColumnHistory from '../utils/useColumnHistory'; // 📜 MAT ที่เคยบันทึกใน die_sets — Product Master ไม่มีก็ยังเลือกซ้ำได้ (2026-09-07)
import SelectOrFree from '../components/SelectOrFree';
import SimpleMasterPanel from '../components/SimpleMasterPanel';
import CollapseCard from '../components/CollapseCard';
import PressSetupRules from '../components/PressSetupRules';   // ⏱️ กฎเวลาเปลี่ยนรุ่นงานปั๊ม (2026-09-25)
import useDiePressLines, { invalidateDiePressLines } from '../utils/useDiePressLines'; // ทะเบียนกลุ่มเครื่องปั๊ม (DR die_press_lines) — 2026-09-08
import { masterDeleteGuard } from '../utils/masterRefs'; // ด่านนับปลายทางก่อนลบทะเบียนที่จับคู่ด้วยข้อความ — 2026-10-18
import { ppsOf } from '../utils/pmUsage';   // ชิ้นออก/shot ราย OP (ว่าง = ถอยไปค่าของชุด) — จุดเดียวของระบบ
import { FEED_TYPES, DIE_OWNERS, dieOwnerLabel, membersBySet, dieRegistryAoa } from '../utils/dieRegistryExport'; // 1 ตัว = 1 OP · common die · Excel (05/11)
import { loadDocForms } from '../utils/docForms';
import { xlsxDocName } from '../utils/csvDoc';

import NoticeBar from '../components/NoticeBar';
/* ═══════════════════════════════════════════════════════════════
   ทะเบียนแม่พิมพ์ & DIE MAINTENANCE — /die-registry

   3 แท็บ (useTabParam):
     📋 ทะเบียน   — ชุดแม่พิมพ์ + สมาชิกราย OP (ของเดิม)
     🗺️ ผังจัดเก็บ — layout แม่พิมพ์: รูปจริง + หมุดตำแหน่งรายตัว (DieLayout)
     📊 สถานะ     — บอร์ดติดตามสถานะ + ใบซ่อม MO ค้าง (DieStatusBoard)

   ⚠️ หน้านี้ "แยกจอ" จากฐานข้อมูลเครื่องจักร แต่ **ไม่ได้แยกฐานข้อมูล**
      ตัวตนของแม่พิมพ์ยังอยู่ `machines` (machine_no unique · MO/downtime/QR อ้างเลขนี้)
      หน้านี้อ่าน machines ที่ equipment_kind='die' แล้วต่อ:
        die_sets          = ชุดแม่พิมพ์ (รวม OP เป็นพาร์ท · ไลน์หลัก · เจ้าของ)
        equipment_die     = ส่วนขยาย 1:1 = **แม่พิมพ์ 1 ตัว = 1 OP** (เลข D-xxxx · OP · ชนิดป้อน ·
                            ชิ้นเข้า/ออก ต่อ shot · พิทช์ · ความสูงตอนปิด · ตัน · น้ำหนัก/ขนาด · สถานะ/ตำแหน่ง)
        die_set_shared_dies = common die — ชุดที่ยืมแม่พิมพ์ของชุดอื่น (บ้าน = equipment_die.die_set_id)
                            (05/11 · migration 20261105_die_registry_op_model_dr.sql)
        die_storage_areas = ผังจัดเก็บ (migration 20260819_die_layout_status.sql)
      เหตุผลเต็มอยู่ใน src/utils/equipmentKinds.js — อ่านก่อนคิดจะแยกตาราง

   ⚠️ ข้อมูลมาจาก backfill ที่แกะจาก "ชื่อเครื่อง" → ไม่ครบทุกช่องโดยธรรมชาติ
      (ฟิลด์ที่แกะไม่ออก = ปล่อยว่าง ห้ามเดา) → หน้านี้ต้องทำให้ "ช่องที่ยังว่าง" เห็นชัด
      เป็น worklist ให้ไล่เก็บ **ห้ามซ่อน** (หลักเดียวกับแถบ ⚠️ ข้อมูลไม่ตรงผังองค์กร ใน /operator)
      สถานะแม่พิมพ์ก็หลักเดียวกัน: null = "ยังไม่ระบุ" ห้าม default เป็นพร้อมใช้
═══════════════════════════════════════════════════════════════ */

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const saveBtnStyle = {
  background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', borderRadius: 8,
  padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const cancelBtnStyle = {
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
};
const warnBox = {
  background: 'var(--amber-dim)', border: '1px solid var(--amber-line)',
  borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--text)',
};

function Field({ label, hint, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
        {label}{hint && <span style={{ fontWeight: 400, opacity: 0.75 }}> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** ช่องที่ยังว่าง = งานที่ต้องไล่เก็บ ไม่ใช่ error — แสดงเป็นขีดสีส้มให้สะดุดตาแต่ไม่ตกใจ */
const Blank = () => <span style={{ color: 'var(--amber)', fontWeight: 700 }} title="ยังไม่ได้กรอก">—</span>;

const numOrNull = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const KIND_NONE = '__none__';   // ตัวกรอง "ยังไม่ระบุรูปแบบชุด" (die_sets.kind = null)

const emptySet = {
  id: null, set_code: '', part_no: '', part_name: '', model: '', line_name: '',
  // ว่าง = "ยังไม่ระบุ" (06/10 · คำสั่ง user — เดิม default tandem = เดาแทนหน้างาน)
  kind: '', op_total: '',
  // 🔴 ว่าง = ยังไม่รู้ ห้าม default 1 (14/10 · คำสั่ง user "ควรนับ shot ไม่ใช่นับชิ้น สำหรับงานคู่")
  pieces_per_stroke: '',
  mat_no: '', mat_no_2: '',   // ตัวที่ 2 = งานคู่ RH/LH (gang die ปั๊มทีเดียวได้ 2 พาร์ท)
  owner: '',   // เจ้าของแม่พิมพ์ company/customer · ว่าง = ยังไม่ระบุ (05/11)
  note: '', is_active: true,
};

/* 🔗 ชุดที่ลง MAT ไว้ 2 ตัว ต้องสอดคล้องกับคู่ที่ตั้งไว้ใน Product Master
   เจ้าของข้อมูล "ใครคู่กับใคร" ยังเป็น Product Master — หน้านี้แค่**ยืมมือเขียน** ⇒ ต้องเหมือนกันทุกด่าน:
     1) สิทธิ์ `products:edit` (ไม่ใช่ `machines:edit` ของหน้านี้) — ไม่มี = บอกเหตุผล ไม่ซ่อนปุ่มเงียบ
     2) `pairBlockReason()` ตัวเดียวกับหน้า Product Master (คู่ RH/LH ต้องผลิตไลน์เดียวกัน)
     3) เขียน **2 ทาง** + ปลดคู่เก่าที่ชี้ค้างก่อน ไม่งั้นคู่ชี้ข้างเดียว = `collapsePairShots` ยุบไม่ครบ
     4) `checkWriteRows` ทุกครั้ง — RLS ปฏิเสธ UPDATE คืน 0 แถวโดยไม่มี error */
function SetPairNote({ set, products, role, onDone, prodLines = [] }) {
  const [busy, setBusy] = useState(false);
  /* 🔐 ชั้นที่ 3 (20/10) — ข้อ 1 ข้างบนยืมสิทธิ์ `products:edit` มาแล้ว **แต่ยังไม่ได้ยืมขอบเขต**
     ⇒ ต้องเช็ค "ไลน์ของพาร์ท" เหมือนหน้า Product Master ไม่งั้นปิดทางนั้นแล้วยังเข้าทางนี้ได้
     (ตั้งคู่ผิด = `collapsePairShots` ยุบ shot ของไลน์เขา ⇒ %P ทั้งกะเพี้ยน)
     🔴 ต้องรับทะเบียนไลน์ผลิตจากหน้าแม่ (`prodLines`) — คนละตัวกับ die_press_lines ของหน้านี้ */
  const { section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx } = useContext(UserContext);
  const pGuard = (prod, what) => {
    const w = canWriteLine({ role, section: homeSection, sections: scopeSecs, allUnits, respCostCenters, scopeIdx },
      prod?.line_name, prodLines);
    if (w.ok) return true;
    toast.error(writeBlockText(w, { what, unit: prod?.line_name || '' }));
    return false;
  };
  const canPair = can('products', 'edit', role);
  const byMat = (m) => products.find(p => String(p.mat_no || '').trim().toUpperCase() === m) || null;
  const r = dieSetPairState(set, (m) => byMat(m)?.pair_mat_no || null);
  if (r.state === 'single' || r.state === 'ok') return null;

  const [a, b] = r.mats;
  const msg = r.state === 'mismatch'
    ? `Product Master บอกว่าคู่ของ ${a} คือ ${r.says} ไม่ใช่ ${b} — ตรวจก่อนบันทึก`
    : `ยังไม่ได้ตั้งคู่ RH/LH ของ 2 ตัวนี้ — OEE จะยังนับ shot ซ้ำ 2 เท่า`;

  async function setPair() {
    const pa = byMat(a), pb = byMat(b);
    if (!pa || !pb) return toast.error(`${!pa ? a : b} ยังไม่มีในทะเบียนสินค้า — เพิ่มที่ /products ก่อน`);
    const why = pairBlockReason(pa, pb);          // ด่านเดียวกับ Product Master ห้ามข้าม
    if (why) return toast.error(why);
    if (!pGuard(pa, `สินค้า ${a}`) || !pGuard(pb, `สินค้า ${b}`)) return;   // ชั้นที่ 3 — ทั้ง 2 ฝั่งของคู่
    const olds = [pa.pair_mat_no, pb.pair_mat_no]   // คู่เก่าที่ชี้ไปที่อื่น ต้องปลดก่อน ไม่งั้นค้างชี้ข้างเดียว
      .map(v => String(v || '').trim().toUpperCase())
      .filter(v => v && v !== a && v !== b);
    if (!window.confirm(
      `ตั้งให้ ${a} ↔ ${b} เป็นคู่ RH/LH ในทะเบียนสินค้า?\n`
      + (olds.length ? `\n⚠️ จะปลดคู่เดิมออกก่อน: ${olds.join(', ')}\n` : '')
      + '\nมีผลกับการคำนวณ OEE ของทั้ง 2 พาร์ท (ยุบ shot งานคู่)')) return;

    setBusy(true);
    try {
      for (const o of olds) {
        /* คู่เก่าที่ต้องปลด อาจเป็นพาร์ทของไลน์อื่น — ปลดคู่ของเขาก็คือการเขียนทับข้อมูลเขา */
        if (!pGuard(byMat(o), `คู่เดิม ${o}`)) return;
        if (!checkWriteRows(await supabaseDR.from('dr_products').update({ pair_mat_no: null })
          .eq('mat_no', o).select('id'), `ปลดคู่เดิมของ ${o}`)) return;   // ปลดไม่ได้ = หยุด ห้ามเขียนทับต่อ
      }
      if (!checkWriteRows(await supabaseDR.from('dr_products').update({ pair_mat_no: b })
        .eq('mat_no', pa.mat_no).select('id'), `ผูกคู่ฝั่ง ${a}`)) return;
      if (!checkWriteRows(await supabaseDR.from('dr_products').update({ pair_mat_no: a })
        .eq('mat_no', pb.mat_no).select('id'), `ผูกคู่ฝั่ง ${b}`)) {
        toast.error(`⚠️ ${a} ผูกไปแล้วแต่ ${b} ไม่สำเร็จ — คู่ชี้ข้างเดียว ไปแก้ที่ /products`);
        return;
      }
      toast.success(`ตั้งคู่ ${a} ↔ ${b} แล้ว`);
      await onDone?.();
    } finally { setBusy(false); }
  }

  const color = r.state === 'mismatch' ? 'var(--red)' : 'var(--amber)';
  return (
    <div style={{ marginTop: 4, fontSize: 11, color }}>
      {r.state === 'mismatch' ? '⚠️ ' : 'ℹ️ '}{msg}
      {canPair ? (
        <button type="button" className="pg-btn sm" onClick={setPair} disabled={busy}
          style={{ marginLeft: 6 }}>
          {busy ? 'กำลังตั้ง…' : r.state === 'mismatch' ? 'ตั้งคู่ใหม่เป็น ' + b : 'ตั้งคู่ให้เลย'}
        </button>
      ) : (
        <span style={{ color: 'var(--muted)' }}> · บัญชีคุณไม่มีสิทธิ์แก้ทะเบียนสินค้า ตั้งคู่ที่ /products</span>
      )}
    </div>
  );
}

export default function DieRegistry() {
  const { role, lineId: userLineId, sections: scopeSecs, fullName, scopeIdx } = useContext(UserContext);
  // ใช้สิทธิ์ชุดเดียวกับฐานข้อมูลเครื่องจักร — แม่พิมพ์อยู่ตาราง machines เดียวกัน คนดูแลกลุ่มเดียวกัน
  // (เลี่ยงการ seed permission key ใหม่ ซึ่งมีกับดัก enum_range ทำให้ role ที่เพิ่มทีหลัง fail-closed)
  const canEdit = can('machines', 'edit', role);
  /* ⚠️ param ชื่อ `die` ไม่ใช่ `tab` — หน้านี้ถูก embed เป็นแท็บใน `/equipment` (2026-09-22)
     ซึ่งกิน `?tab=` ไปแล้ว · แท็บซ้อนแท็บต้องคนละ param (UI-CONVENTIONS §6.8)
     ลิงก์เก่า `/die-registry?tab=layout` ยังใช้ได้ — App.jsx แปลงให้ตอน redirect */
  const [tab, setTab] = useTabParam(['registry', 'layout', 'status'], 'registry', 'die');
  // 2026-09-08: ทะเบียน die_press_lines — แหล่งหลักของชื่อ "ไลน์/กลุ่มเครื่องปั๊ม" ของแม่พิมพ์ (แยกจาก production_lines)
  const pressLines = useDiePressLines();
  // 2026-10-05: รูปแบบชุด = ทะเบียน die_set_kinds (เดิม hardcode 4 ค่า) — ทีมแม่พิมพ์เพิ่ม/ตั้งชื่อเรียกเองได้
  const [opTypes, setOpTypes] = useState([]);
  const [kindsVer, setKindsVer] = useState(0);
  const setKinds = useDieSetKinds(kindsVer);
  /* ตัวเลือก "ชนิดอุปกรณ์ในใบแจ้งซ่อม" ของแผง ⚙️ รูปแบบชุด = ชื่อใน mtn_item_types ของทีม DIE + ของกลาง
     โหลดแยกจาก load() หลัก (ใช้แค่ในแผงตั้งค่า) · โหลดไม่ได้ = ลิสต์ว่าง + ขึ้น toast (ห้ามเงียบ) */
  const [dieItemTypes, setDieItemTypes] = useState([]);
  useEffect(() => {
    let alive = true;
    supabaseDR.from('mtn_item_types').select('name, team').eq('is_active', true).order('sort_order').then(({ data, error }) => {
      if (!alive) return;
      if (error) { toast.error('โหลดชนิดอุปกรณ์ (ใบแจ้งซ่อม) ไม่สำเร็จ: ' + error.message); return; }
      setDieItemTypes((data || []).filter(t => !t.team || t.team === 'die_maintenance').map(t => t.name));
    });
    return () => { alive = false; };
  }, []);
  const dieItemTypeOpts = useMemo(() => {
    const names = new Set(dieItemTypes);
    setKinds.forEach(k => { if (k.mo_item_type) names.add(k.mo_item_type); }); // ค่าที่ตั้งไว้แล้วต้องอยู่ในลิสต์เสมอ
    opTypes.forEach(o => { if (o.mo_item_type) names.add(o.mo_item_type); });
    return [...names].map(n => ({ value: n, label: n }));
  }, [dieItemTypes, setKinds, opTypes]);

  const [lines, setLines]   = useState([]);
  const [dies, setDies]     = useState([]);   // machines (equipment_kind='die') + equipment_die
  const [sets, setSets]     = useState([]);
  /* common die (05/11) — ชุดที่ยืมแม่พิมพ์ของชุดอื่น · null = ยังไม่ apply migration/โหลดไม่ได้ (ต่างจาก [] = ไม่มีใครยืม) */
  const [shared, setShared] = useState([]);
  const [sharedErr, setSharedErr] = useState('');
  const [addShare, setAddShare] = useState(null);   // { setId, machineId, opSeq } ฟอร์มเพิ่มแม่พิมพ์ใช้ร่วม
  const [exporting, setExporting] = useState(false);
  const [products, setProducts] = useState([]); // dr_products — ผูก mat_no ของชุด
  const [areas, setAreas]     = useState([]);   // die_storage_areas — ผังจัดเก็บ
  const [openMos, setOpenMos] = useState([]);   // ใบซ่อม MO ที่ยังไม่ปิด (derive สถานะซ่อม)
  const [layoutReady, setLayoutReady] = useState(false); // migration 20260819 apply แล้วหรือยัง
  const [dataWarn, setDataWarn] = useState('');          // คิวรีชุดไหนล้ม — ห้ามให้จอว่างแล้วอ่านว่า "ไม่มีข้อมูล"
  const [loading, setLoading] = useState(true);
  const [focusDieId, setFocusDieId] = useState(null);    // 📊 สถานะ กด 🗺️ → กระโดดมาแท็บผัง
  // 📜 MAT ที่เคยบันทึกใน die_sets (DR) — MAT เก่าที่ Product Master ยังไม่มี ยังเลือกซ้ำได้ ไม่ต้องพิมพ์ใหม่ (2026-09-07)
  const dieMatHist = useColumnHistory(supabaseDR, 'die_sets', 'mat_no', { upper: true });

  const [search, setSearch]       = useState('');
  const [filterLine, setFilterLine] = useState('');
  const [filterKind, setFilterKind] = useState('');
  const [todoOnly, setTodoOnly]   = useState(false);   // 🔎 ดูเฉพาะที่ต้องแก้
  const [expanded, setExpanded]   = useState(() => new Set());

  const [editSet, setEditSet] = useState(null);   // ฟอร์มชุด
  const [editDie, setEditDie] = useState(null);   // ฟอร์มแม่พิมพ์รายตัว
  const [saving, setSaving]   = useState(false);
  // ช่องไลน์ในฟอร์มชุด: เลือกจากรายชื่อที่ใช้อยู่ · "✏️ ระบุใหม่" = พิมพ์เอง (audit #28 · 2026-09-07) — ปิด modal แล้วรีเซ็ต

  const load = useCallback(async () => {
    setLoading(true);
    // ⚠️ ห้ามทำลาย error ด้วย `const { data } = await` — คิวรีล้มแล้วจอขึ้น "ไม่มีแม่พิมพ์"
    //    เหมือนข้อมูลหาย (กฎเหล็กข้อ 1) → เก็บชื่อชุดที่ล้มไปโชว์เป็นแถบเตือน (audit 2026-09-08)
    const warn = [];
    const [lnRes, mcRes, stRes, otRes, pdRes, areaRes, moRes, shRes] = await Promise.all([
      loadLinesRes(),
      // ตัวตนของแม่พิมพ์ยังอยู่ machines — embed ส่วนขยายมาด้วยในนัดเดียว
      supabaseDR.from('machines')
        .select('id, machine_no, machine_name, line_name, is_active, equipment_die(*)')
        .eq('equipment_kind', 'die').order('line_name').order('machine_no'),
      supabaseDR.from('die_sets').select('*').order('line_name').order('part_name'),
      supabaseDR.from('die_op_types').select('*').eq('is_active', true).order('sort_order'),
      /* ⚠️ ตั้งใจ **ไม่** ผ่าน cachedMaster (2026-09-16) — หน้านี้อ่าน `pdRes.error` เพื่อขึ้นแถบเตือน
         "โหลดสินค้าไม่สำเร็จ" · cachedMaster กลืน error แล้วคืน [] ⇒ จะกลายเป็น "ไม่มีสินค้า" เงียบๆ
         (กฎ ENGINEERING-PRINCIPLES: ห้ามล้มเหลวเงียบ · หน้านี้เปิดไม่บ่อย ไม่ใช่ตัวกิน egress) */
      supabaseDR.from('dr_products').select('mat_no, name, line_name').eq('is_active', true).order('mat_no'),
      // ยังไม่ apply migration 20260819 → 42P01 — จับเป็น flag ไปบอกบนจอ ห้ามพังทั้งหน้า
      supabaseDR.from('die_storage_areas').select('*').eq('is_active', true).order('sort_order').order('name'),
      // สถานะ "ซ่อมอยู่" derive จากใบ MO จริง — ห้ามให้คนตั้งซ้ำ (2 แหล่งจะ drift กัน)
      supabaseDR.from('mtn_orders')
        .select('id, mo_no, status, machine_no, mtn_dept, current_step, report_at, quality_related, qa_skipped_at')
        .in('status', OPEN_MO_STATUSES),
      // common die (05/11) — ตารางเล็ก (คู่ชุด↔แม่พิมพ์) ไม่ชนเพดาน 1000 แถวในอนาคตอันใกล้
      supabaseDR.from('die_set_shared_dies').select('die_set_id, machine_id, op_seq, note'),
    ]);
    const { data: ln } = lnRes, { data: mc } = mcRes, { data: st } = stRes, { data: ot } = otRes, { data: pd } = pdRes;
    if (lnRes.error) warn.push('ไลน์');
    if (mcRes.error) warn.push('ทะเบียนแม่พิมพ์');
    if (stRes.error) warn.push('ชุดแม่พิมพ์');
    if (otRes.error) warn.push('ชนิด OP');
    if (pdRes.error) warn.push('สินค้า');
    setLines(ln || []);
    // equipment_die เป็น 1:1 (machine_id เป็นทั้ง PK และ FK) → PostgREST คืนเป็น "object"
    // แต่รับทั้ง 2 ทรงไว้ กันกรณี schema cache มองเป็น 1:N แล้วคืน array (ว่าง = ยังไม่มีแถวส่วนขยาย)
    const extOf = (v) => (Array.isArray(v) ? (v[0] || null) : (v || null));
    setDies((mc || []).map(m => ({ ...m, ext: extOf(m.equipment_die) })));
    setSets(st || []);
    setOpTypes(ot || []);
    setProducts(pd || []);
    setAreas(areaRes.error ? [] : (areaRes.data || []));
    setLayoutReady(!areaRes.error);
    if (moRes.error) toast.error('โหลดใบซ่อม MO ไม่สำเร็จ: ' + moRes.error.message);   // ห้ามเงียบ — สถานะซ่อมจะหายทั้งบอร์ด
    setOpenMos(moRes.data || []);
    // โหลดไม่ได้ ≠ ไม่มีใครยืม — ต้องเขียนบนจอ ไม่งั้นชุดที่ยืมแม่พิมพ์ดูเหมือน OP ขาด
    setShared(shRes.error ? [] : (shRes.data || []));
    setSharedErr(shRes.error ? shRes.error.message : '');
    setDataWarn(warn.length ? `โหลดไม่สำเร็จ: ${warn.join(' · ')} — ข้อมูลบนจอไม่ครบ (ไม่ใช่ว่าไม่มีข้อมูล)` : '');
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDocForms().catch(() => {}); }, []);   // ชื่อไฟล์ Excel อ่านเลขฟอร์มแบบ sync — ต้อง warm cache เอง

  const reloadAreas = useCallback(async () => {
    const { data, error } = await supabaseDR.from('die_storage_areas')
      .select('*').eq('is_active', true).order('sort_order').order('name');
    if (!error) { setAreas(data || []); setLayoutReady(true); }
  }, []);

  /** update ส่วนขยายของแม่พิมพ์ใน state โดยไม่ refetch ทั้งหน้า (ใช้หลังเขียน DB สำเร็จเท่านั้น) */
  const patchDieExt = useCallback((machineId, patch) => {
    setDies(list => list.map(d => d.id === machineId
      ? { ...d, ext: { ...(d.ext || { machine_id: machineId }), ...patch } }
      : d));
  }, []);

  /* ── mandatory scope (pattern มาตรฐาน: leader = family ไลน์ตัวเอง · อื่น = ตาม sections) ── */
  /* 🔴 ชื่อ const ห้ามชนกับฟังก์ชันที่ import มา แล้วเรียกตัวนั้นข้างใน = **TDZ จอขาวทั้งหน้า**
     (`ReferenceError: Cannot access 'scopedLines' before initialization` — เกิดจริง 25-26/10
      กับทุกบัญชีที่ไม่ใช่ leader และมีขอบเขตส่วนงาน · crashsweep จับไม่ได้เพราะ mock ใช้ `sections: []`)
     ⇒ เรียกของกลางผ่านชื่อ alias เสมอ · มีด่าน `no-shadowed-import-call` */
  /* 🔭 ของกลาง `scopedLines()` ตัวเดียว (QC audit 09/11) — สูตรที่เคยก๊อปไว้ที่นี่ให้ leader
     เห็นแค่ครอบครัวไลน์ตัวเอง = แคบกว่าที่ `profiles` ตั้ง (กฎ 26/10: ไลน์ตัวเอง ∪ ส่วนงานที่กำกับ) */
  const scopedLines = useMemo(() => {
    const out = scopedLinesOf({ role, lineId: userLineId, sections: scopeSecs, lines, scopeIdx });
    return out.length ? out : lines;        // ตาข่ายเดิม: กรองแล้วไม่เหลือ = ไม่กรอง (หน่วยสนับสนุนไม่มีไลน์)
  }, [lines, role, userLineId, scopeSecs, scopeIdx]);
  const scopedLineNames = useMemo(() => new Set(scopedLines.map(l => l.name)), [scopedLines]);
  const scopeActive = scopedLines.length !== lines.length;
  const inScope = useCallback((lineName) => !scopeActive || scopedLineNames.has(lineName), [scopeActive, scopedLineNames]);

  /* ⚠️ ไลน์ของแม่พิมพ์เป็นชื่อ "เครื่องปั๊ม/กลุ่มไลน์" ที่ไม่ได้อยู่ใน production_lines ทุกตัว
        (ข้อมูลจริง: LINE A ( 800 Ton ) / LINE B ( 600 Ton ) / HDF1 …)
        → dropdown ไลน์จึงลิสต์จากไลน์ที่แม่พิมพ์ใช้จริง แล้วกรอง scope ทับ
        ห้ามลิสต์จาก production_lines อย่างเดียว ไม่งั้นเลือกไลน์ของแม่พิมพ์ไม่ได้เลย */
  const dieLineNames = useMemo(() => {
    const s = new Set();
    sets.forEach(x => { if (x.line_name && inScope(x.line_name)) s.add(x.line_name); });
    dies.forEach(d => { if (d.line_name && inScope(d.line_name)) s.add(d.line_name); });
    return [...s].sort(lineNameCompare);   // เรียงธรรมชาติชุดเดียวกับ dropdown ไลน์ (2026-10-01)
  }, [sets, dies, inScope]);
  /* 2026-09-08: ตัวเลือกไลน์ในฟอร์มชุด = ทะเบียน die_press_lines ที่เปิดใช้ (ขึ้นก่อน) ∪ ชื่อที่ชุด/แม่พิมพ์ใช้อยู่แล้ว
        (ค่าเก่าที่ยังไม่ลงทะเบียนต้องเลือกซ้ำได้ ห้ามหายเงียบ — SelectOrFree ตัดซ้ำให้เอง) */
  const setLineOptions = useMemo(() => [
    ...pressLines.filter(p => p.is_active !== false).map(p => p.name),
    ...dieLineNames,
  ], [pressLines, dieLineNames]);

  /* ── ประกอบชุด + สมาชิก + ตรวจ "ข้อมูลที่ยังไม่ครบ" ─────────────── */
  /* สมาชิกของชุด = แม่พิมพ์ที่ชุดนี้เป็นบ้าน + ที่ยืมจากชุดอื่น (common die · 05/11)
     แต่ละแถว = { die, opSeq, shared, homeSetId } — OP ของตัวที่ยืม = OP ในชุดที่ยืม (อาจไม่เท่าชุดบ้าน) */
  const diesBySet = useMemo(() => membersBySet(dies, shared), [dies, shared]);

  const unlinked = useMemo(
    () => dies.filter(d => !d.ext?.die_set_id && d.is_active && inScope(d.line_name)),
    [dies, inScope]);

  /** ปัญหาของชุด — คืนลิสต์ข้อความ (ว่าง = ครบ) */
  const issuesOf = useCallback((s) => {
    const mem = diesBySet[s.id] || [];
    const out = [];
    const seqs = mem.map(x => x.opSeq).filter(v => v != null);
    const dup = seqs.length - new Set(seqs).size;
    // OP ซ้ำ = สัญญาณว่าชุดนี้จริงๆ เป็นหลายชุดที่ถูกรวมกัน (เช่นแยกตามวัสดุ RAW/AAW/LAW)
    // เป็นการตัดสินใจของคน ระบบแค่ชี้ให้เห็น **ห้ามแยกให้เองอัตโนมัติ**
    if (dup > 0) out.push(`OP ซ้ำ ${dup} ตัว — อาจเป็นหลายชุดที่ถูกรวมกัน (เช่นแยกตามวัสดุ) ต้องแยกชุดเอง`);
    const noOp = mem.filter(x => x.opSeq == null).length;
    if (noOp) out.push(`ยังไม่ระบุ OP ${noOp} ตัว`);
    if (!s.kind)    out.push('ยังไม่ระบุรูปแบบชุด');
    if (!s.part_no) out.push('ยังไม่ระบุเลขพาร์ท');
    if (!s.mat_no)  out.push('ยังไม่ผูก MAT SAP');
    /* 🔨 ไม่รู้ "ชิ้น/จังหวะ" = PM แม่พิมพ์คิดเป็น shot ไม่ได้ (14/10) — เข้าลิสต์ "ต้องแก้" ให้หน้างานไล่กรอก
       แนบหลักฐานที่พบในชื่อ/เลขพาร์ทไปด้วยเพื่อให้ตัดสินเร็ว · 🔴 ระบบไม่กรอกให้เอง (pairHint ไม่เขียนฐาน) */
    /* ชิ้นออก/shot เป็นของ OP (05/11) — ตัวไหนว่างทั้งที่ OP และชุด = PM คิดเป็น shot ไม่ได้ (ppsOf ตัดสินที่เดียว) */
    const noPps = mem.filter(x => ppsOf(x.die.ext, s) == null).length;
    if (noPps || (!mem.length && s.pieces_per_stroke == null)) {
      const h = pairHint(s);
      out.push(`ยังไม่ระบุ ชิ้นออก/shot${noPps ? ` ${noPps} OP` : ''}` + (h ? ` — น่าจะเป็นงานคู่ (${h.why}) รอยืนยัน` : ''));
    }
    if (s.op_total && mem.length !== s.op_total && dup === 0)
      out.push(`จำนวนแม่พิมพ์ (${mem.length}) ไม่ตรงกับจำนวน OP ที่ระบุ (${s.op_total})`);
    return out;
  }, [diesBySet]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sets
      .filter(s => inScope(s.line_name))                                    // scope ก่อน filter อิสระเสมอ
      .filter(s => !filterLine || s.line_name === filterLine)
      .filter(s => !filterKind || (filterKind === KIND_NONE ? !s.kind : s.kind === filterKind))
      .filter(s => !q || [s.part_no, s.part_name, s.model, s.set_code, s.mat_no, s.mat_no_2]
        .some(v => (v || '').toLowerCase().includes(q))
        || (diesBySet[s.id] || []).some(({ die: d }) => [d.machine_no, d.ext?.die_no]
          .some(v => (v || '').toLowerCase().includes(q))))
      .map(s => ({ ...s, members: diesBySet[s.id] || [], issues: issuesOf(s) }))
      .filter(s => !todoOnly || s.issues.length > 0)
      .sort((a, b) => (a.line_name || '').localeCompare(b.line_name || '')
        || (a.part_name || '').localeCompare(b.part_name || ''));
  }, [sets, diesBySet, search, filterLine, filterKind, todoOnly, inScope, issuesOf]);

  const stat = useMemo(() => {
    const vis = sets.filter(s => inScope(s.line_name));
    const visDie = dies.filter(d => inScope(d.line_name));
    return {
      sets: vis.length,
      dies: visDie.length,
      todo: vis.filter(s => issuesOf(s).length > 0).length,
      unlinked: unlinked.length,
      noTon: visDie.filter(d => d.ext?.tonnage_ton == null).length,
      noHeight: visDie.filter(d => d.ext?.die_height_mm == null).length,
      noKind: vis.filter(s => !s.kind).length,   // รูปแบบชุด = null (ยังไม่ระบุ · 06/10)
    };
  }, [sets, dies, unlinked, inScope, issuesOf]);

  const grouped = useMemo(() => {
    const m = {};
    rows.forEach(r => { (m[r.line_name || '(ไม่ระบุไลน์)'] ||= []).push(r); });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  /* ── ข้อมูลใช้ร่วมแท็บ 🗺️ ผังจัดเก็บ / 📊 สถานะ ── */
  const scopedDies = useMemo(() => dies.filter(d => inScope(d.line_name)), [dies, inScope]);
  const setsById = useMemo(() => Object.fromEntries(sets.map(s => [s.id, s])), [sets]);
  /* ── 📷 สแกนป้ายแม่พิมพ์ → เด้งเข้าหมุดบนผังจัดเก็บ (2026-10-06 · คำสั่ง user) ──
     2 ทางเข้า ใช้ตัวตัดสินเดียวกัน (`findDieByScan`):
       (1) ปุ่ม 📷 ในแท็บผัง  (2) ลิงก์จากหน้า /scan → `?die=layout&focus=<machines.id>`
     ค้นใน `dies` ทั้งหมด (ไม่ใช่ scopedDies) — ไม่งั้นแยก "นอกขอบเขตไลน์" ออกจาก "ไม่มีในทะเบียน" ไม่ได้ */
  const focusFromScan = useCallback((parsed) => {
    const r = findDieByScan(parsed, dies, d => inScope(d.line_name));
    if (r.error) return r.error;
    setFocusDieId(r.die.id);
    return undefined;
  }, [dies, inScope]);
  const [sp] = useSearchParams();
  const setParams = useMergeParams();
  const focusParam = sp.get('focus');
  useEffect(() => {
    if (!focusParam || loading) return;
    const err = focusFromScan(parseQrPayload(buildQrPayload('machine', focusParam)));
    if (err) toast.error(err);   // ห้ามเงียบ — คนสแกนมาจากหน้าชั้นวาง ต้องรู้ว่าทำไมหมุดไม่เด้ง
    setParams({ focus: null, die: 'layout' }, { replace: true });
  }, [focusParam, loading, focusFromScan, setParams]);

  const moDieCount = useMemo(() => {
    const m = buildOpenMoMap(openMos);
    return scopedDies.filter(d => d.is_active && openMosOf(d, m).length > 0).length;
  }, [openMos, scopedDies]);

  /* ── 🔗 common die (05/11) ─────────────────────────────────────
     ตัวเลือก = แม่พิมพ์ในขอบเขตที่ยังไม่อยู่ในชุดนี้ (ทั้งบ้านและที่ยืมแล้ว) · DB กัน "ยืมเข้าชุดบ้านตัวเอง" อีกชั้น */
  const shareOptions = (s) => {
    const inSet = new Set((diesBySet[s.id] || []).map(x => x.die.id));
    return dies.filter(d => d.is_active && inScope(d.line_name) && !inSet.has(d.id))
      .sort((a, b) => String(a.ext?.die_no || '~').localeCompare(String(b.ext?.die_no || '~')));
  };
  const saveShare = async (s) => {
    if (!inScope(s.line_name)) return toast.error('ชุดนี้อยู่นอกส่วนงานของคุณ');
    if (!addShare?.machineId) return toast.error('เลือกแม่พิมพ์ที่จะใช้ร่วมก่อน');
    setSaving(true);
    const ok = checkWrite(await supabaseDR.from('die_set_shared_dies').insert({
      die_set_id: s.id, machine_id: addShare.machineId, op_seq: numOrNull(addShare.opSeq),
    }), 'เพิ่มแม่พิมพ์ใช้ร่วม');
    setSaving(false);
    if (!ok) return;
    toast.success('เพิ่มแม่พิมพ์ใช้ร่วมแล้ว');
    setAddShare(null); load();
  };
  const removeShare = async (s, d) => {
    if (!inScope(s.line_name)) return toast.error('ชุดนี้อยู่นอกส่วนงานของคุณ');
    if (!window.confirm(`เลิกใช้แม่พิมพ์ ${d.ext?.die_no || d.machine_no} ร่วมในชุด ${s.set_code || s.part_name}?\n(แม่พิมพ์ยังอยู่ชุดบ้านเหมือนเดิม ไม่ถูกลบ)`)) return;
    // delete ที่ RLS ปฏิเสธ = "สำเร็จ 0 แถว" ⇒ ต้องนับแถว (กฎเหล็ก DB ข้อ 2)
    if (!checkWriteRows(await supabaseDR.from('die_set_shared_dies').delete()
      .eq('die_set_id', s.id).eq('machine_id', d.id).select('machine_id'), 'เลิกใช้ร่วม')) return;
    toast.success('เลิกใช้ร่วมแล้ว'); load();
  };

  /* ── 📥 Export Excel ให้ทีม DIE ไล่ข้อมูล (05/11) ─────────────────
     ทั้งหมดในขอบเขต (ไม่ตามตัวกรองบนจอ) · แถวแรก = หัวตาราง · เลขฟอร์มอยู่ชื่อไฟล์ (doc_key `xlsx_die_registry`) */
  const exportExcel = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');   // dynamic import — ไม่ให้ bundle หลักบวม
      const vDies = dies.filter(d => inScope(d.line_name));
      const vSets = sets.filter(s => inScope(s.line_name));
      const aoa = dieRegistryAoa({
        dies: vDies, sets: vSets, shared,
        opTypeLabel: (k) => opTypes.find(t => t.key === k)?.label || k,
        kindLabel: (k) => dieSetKindLabel(k, setKinds),
      });
      const wb = XLSX.utils.book_new();
      const wsD = XLSX.utils.aoa_to_sheet(aoa.dies);
      wsD['!cols'] = aoa.dies[0].map((h, i) => ({ wch: i === 1 ? 48 : i <= 6 ? 22 : 12 }));
      XLSX.utils.book_append_sheet(wb, wsD, 'แม่พิมพ์ (ราย OP)');
      const wsS = XLSX.utils.aoa_to_sheet(aoa.sets);
      wsS['!cols'] = aoa.sets[0].map((h, i) => ({ wch: i === 11 ? 60 : i <= 1 ? 32 : 16 }));
      XLSX.utils.book_append_sheet(wb, wsS, 'ชุด');
      // คำอธิบายอยู่ชีตท้าย — ชีตข้อมูลต้องเริ่มที่หัวตาราง (ตัวอ่านของผู้ใช้ยึดแถวแรก = หัว)
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['ทะเบียนแม่พิมพ์', `ส่งออก ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} โดย ${fullName || '-'}`],
        ['ขอบเขต', scopeActive ? 'เฉพาะส่วนงานของผู้ส่งออก' : 'ทั้งโรงงาน'],
        ['ช่องว่าง', 'ยังไม่ได้กรอก (ไม่ใช่ 0) — ไล่เติมแล้วกรอกกลับที่หน้า /equipment?tab=die'],
        ['เลขแม่พิมพ์', 'D-xxxx ระบบออกให้ ห้ามแก้ · 1 เลข = แม่พิมพ์ 1 ตัว = 1 OP'],
        ['ใช้ร่วมกับชุดอื่น', 'common die — ชุดอื่นยืมแม่พิมพ์ตัวนี้ไปเป็น OP ของชุดนั้น'],
        ['ชิ้นเข้า/ชิ้นออก ต่อ shot', 'เช่น OP ตัดแยก LH/RH = เข้า 1 ออก 2 · ม้วน (progressive) ไม่มีชิ้นเข้า ใช้ระยะพิทช์แทน'],
        ...(sharedErr ? [['⚠', `อ่านรายการใช้ร่วมไม่ได้ (${sharedErr}) — คอลัมน์ "ใช้ร่วมกับชุดอื่น" ไม่ครบ`]] : []),
      ]), 'คำอธิบาย');
      XLSX.writeFile(wb, xlsxDocName('xlsx_die_registry', 'die_registry'));
    } catch (e) {
      toast.error(`ส่งออก Excel ไม่สำเร็จ: ${e?.message || e}`);
    } finally { setExporting(false); }
  };

  /* ── บันทึกชุด ─────────────────────────────────────────────── */
  const saveSet = async () => {
    const f = editSet;
    if (!f.part_name?.trim()) return toast.error('กรอกชื่อพาร์ท/ชื่อชุดก่อน');
    setSaving(true);
    const payload = {
      set_code: f.set_code?.trim() || null,
      part_no: f.part_no?.trim() || null,
      part_name: f.part_name.trim(),
      model: f.model?.trim() || null,
      line_name: f.line_name || null,
      kind: f.kind || null,   // null = ยังไม่ระบุ (ห้ามเดาเป็นค่าใดค่าหนึ่ง)
      op_total: numOrNull(f.op_total),
      pieces_per_stroke: numOrNull(f.pieces_per_stroke),   // null = ยังไม่รู้ (ห้าม ?? 1 — งานคู่ = 2)
      mat_no: f.mat_no?.trim() || null,
      mat_no_2: f.mat_no_2?.trim() || null,   // null = ชุดนี้ทำพาร์ทเดียว
      owner: f.owner || null,                 // null = ยังไม่ระบุ (05/11)
      note: f.note?.trim() || null,
      is_active: f.is_active !== false,
    };
    const { error } = f.id
      ? await supabaseDR.from('die_sets').update(payload).eq('id', f.id)
      : await supabaseDR.from('die_sets').insert(payload);
    setSaving(false);
    if (error) return toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    toast.success('บันทึกชุดแม่พิมพ์แล้ว');
    invalidateDieSetKinds(); // ใบแจ้งซ่อมแม่พิมพ์เติม "ชนิดอุปกรณ์" จากรูปแบบชุด — ล้าง cache ให้เห็นค่าใหม่
    setEditSet(null); load();
  };

  /* ── บันทึกแม่พิมพ์รายตัว (ส่วนขยาย equipment_die — 1:1 กับ machines) ── */
  const saveDie = async () => {
    const f = editDie;
    setSaving(true);
    const payload = {
      machine_id: f.machine_id,
      die_set_id: f.die_set_id || null,
      op_seq: numOrNull(f.op_seq),
      op_name: f.op_name?.trim() || null,
      op_type: f.op_type || null,
      tonnage_ton: numOrNull(f.tonnage_ton),
      die_height_mm: numOrNull(f.die_height_mm),
      pieces_per_stroke: numOrNull(f.pieces_per_stroke),          // = ชิ้นออก/shot ของ OP นี้
      // 05/11 · 1 ตัว = 1 OP — ช่องที่ซ่อนตามชนิดป้อนยังบันทึกค่าเดิม (ซ่อน ≠ ล้างค่า) · die_no ไม่ส่ง (trigger ออกให้ ห้ามแก้)
      feed_type: f.feed_type || null,
      pieces_in_per_stroke: numOrNull(f.pieces_in_per_stroke),
      feed_pitch_mm: numOrNull(f.feed_pitch_mm),
      coil_width_mm: numOrNull(f.coil_width_mm),
      weight_kg: numOrNull(f.weight_kg),
      length_mm: numOrNull(f.length_mm),
      width_mm: numOrNull(f.width_mm),
      regrind_count: numOrNull(f.regrind_count) ?? 0,
      regrind_limit: numOrNull(f.regrind_limit),
      note: f.note?.trim() || null,
    };
    // ส่วนขยายเป็น 1:1 กับ machine → upsert ด้วย machine_id (แถวอาจยังไม่มีถ้า backfill ข้ามตัวนี้)
    // ⚠️ ไม่แตะ shot_total ที่นี่ — เป็นตัวนับสะสมจากการผลิต ไม่ใช่ค่าที่คนพิมพ์ทับ
    const { error } = await supabaseDR.from('equipment_die').upsert(payload, { onConflict: 'machine_id' });
    setSaving(false);
    if (error) return toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    toast.success('บันทึกแม่พิมพ์แล้ว');
    invalidateDieSetKinds(); // ประเภท OP ของแม่พิมพ์ = ตัวเติม "ชนิดอุปกรณ์" ในใบแจ้งซ่อม — ล้าง cache ให้เห็นค่าใหม่
    setEditDie(null); load();
  };

  const openDie = (d) => setEditDie({
    machine_id: d.id, machine_no: d.machine_no, machine_name: d.machine_name,
    die_set_id: d.ext?.die_set_id || '',
    op_seq: d.ext?.op_seq ?? '', op_name: d.ext?.op_name || '', op_type: d.ext?.op_type || '',
    tonnage_ton: d.ext?.tonnage_ton ?? '', die_height_mm: d.ext?.die_height_mm ?? '',
    pieces_per_stroke: d.ext?.pieces_per_stroke ?? '',
    die_no: d.ext?.die_no || '', feed_type: d.ext?.feed_type || '',
    pieces_in_per_stroke: d.ext?.pieces_in_per_stroke ?? '', feed_pitch_mm: d.ext?.feed_pitch_mm ?? '',
    coil_width_mm: d.ext?.coil_width_mm ?? '', weight_kg: d.ext?.weight_kg ?? '',
    length_mm: d.ext?.length_mm ?? '', width_mm: d.ext?.width_mm ?? '',
    regrind_count: d.ext?.regrind_count ?? 0, regrind_limit: d.ext?.regrind_limit ?? '',
    note: d.ext?.note || '', shot_total: d.ext?.shot_total ?? 0,
  });

  const toggle = (id) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  if (loading) return <Page><div style={{ padding: 24, color: 'var(--muted)' }}>กำลังโหลด...</div></Page>;

  return (
    <Page>
      {/* 🧩 embedded — หน้านี้เป็นแท็บของ `/equipment` แล้ว (route เดิม redirect มา)
          อยู่ใน <Hub> ⇒ PageHeader ไม่วาดชื่อหน้าซ้ำ เหลือคำอธิบาย + แถบแท็บย่อย `?die=` */}
      <PageHeader
        title="ทะเบียนแม่พิมพ์" icon="🔨"
        sub={`แม่พิมพ์ 1 ตัว = 1 OP (เลข D-xxxx) · ชุด = รวม OP เป็นพาร์ท (ยืมแม่พิมพ์ข้ามชุดได้) · ตัวตนอยู่ฐานเดียวกับเครื่องจักร (QR/ประวัติซ่อมใช้ร่วมกัน)${scopeActive ? ' · เห็นเฉพาะส่วนงานของคุณ' : ''}`}
        tabs={[
          { key: 'registry', label: 'ทะเบียน' },
          { key: 'layout', label: 'ผังจัดเก็บ' },
          { key: 'status', label: 'สถานะ', badge: moDieCount ? `🔧 ${moDieCount}` : null },
        ]}
        tab={tab} onTab={setTab}
      />

      {dataWarn && (
        <NoticeBar tone="bad" style={{ marginBottom: 12 }}>
          {dataWarn}
        </NoticeBar>
      )}

      {sharedErr && tab === 'registry' && (
        <div style={{ ...warnBox, marginBottom: 12 }}>
          ⚠️ อ่านรายการ "แม่พิมพ์ใช้ร่วม (common die)" ไม่ได้ — ชุดที่ยืมแม่พิมพ์ของชุดอื่นจะดูเหมือน OP ขาด
          และเพิ่มการใช้ร่วมไม่ได้จนกว่าจะแก้ ({sharedErr})
        </div>
      )}

      {/* ⚠️ /die-registry เปิดให้ role `mtn` ด้วย — ถ้าวันหน้าถอด machines:edit ออกจาก mtn
          ปุ่มแก้จะหายทั้งหน้าโดยไม่มีคำอธิบาย (กับดักเดียวกับตารางกะ) */}
      <ReadOnlyNote show={!canEdit} role={role} what="แก้ทะเบียนแม่พิมพ์"
        permKey="machines:edit"
        hint="แม่พิมพ์ใช้ตัวตนเดียวกับเครื่องจักร จึงคุมด้วยสิทธิ์เดียวกัน" />

      {tab === 'layout' && (
        <DieLayout
          dies={scopedDies} setsById={setsById} areas={areas} openMos={openMos} products={products}
          canEdit={canEdit} fullName={fullName} ready={layoutReady}
          reload={load} reloadAreas={reloadAreas} patchDieExt={patchDieExt}
          focusDieId={focusDieId} onFocusConsumed={() => setFocusDieId(null)}
          onScanDie={focusFromScan}
        />
      )}

      {tab === 'status' && (
        <DieStatusBoard
          dies={scopedDies} setsById={setsById} areas={areas} openMos={openMos} products={products}
          canEdit={canEdit} fullName={fullName} ready={layoutReady} patchDieExt={patchDieExt}
          onShowOnMap={(d) => { setFocusDieId(d.id); setTab('layout'); }}
        />
      )}

      {tab === 'registry' && <>
      {/* filter bar — มาตรฐาน FilterBar (UI-STANDARD 2026-09-24) · ไลน์ = ชื่อเครื่องปั๊มจากแม่พิมพ์ (ไม่ใช่ production_lines) จึงไม่ใช้ LineSelect */}
      <FilterBar>
        <select value={filterLine} onChange={e => setFilterLine(e.target.value)}>
          <option value="">{ALL.line}</option>
          {dieLineNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filterKind} onChange={e => setFilterKind(e.target.value)}>
          <option value="">{allOf('รูปแบบชุด')}</option>
          <option value={KIND_NONE}>— ยังไม่ระบุ ({stat.noKind}) —</option>
          {setKinds.map(k => <option key={k.key} value={k.key}>{k.label}{k.is_active ? '' : ' (ปิดใช้)'}</option>)}
        </select>
        <SearchInput value={search} onChange={setSearch} fields="พาร์ท / ชื่อชุด / MAT / เลขแม่พิมพ์" />
        <span className="spacer" />
        <span className="filter-count">แสดง {rows.length} ชุด</span>
        {/* 📥 Excel ให้ทีม DIE เอาไปไล่ข้อมูล (05/11 · คำสั่ง user) — ทั้งหมดในขอบเขต ไม่ตามตัวกรอง (worklist ต้องครบ) */}
        <button onClick={exportExcel} disabled={exporting} title="แม่พิมพ์ราย OP + ชุด ทั้งหมดในขอบเขตของคุณ — ช่องว่าง = ยังไม่ได้กรอก"
          style={{ ...cancelBtnStyle, padding: '0 12px' }}>
          {exporting ? 'กำลังสร้างไฟล์…' : 'Export Excel'}
        </button>
        {canEdit && (
          <button onClick={() => setEditSet({ ...emptySet, line_name: filterLine || '' })} style={{ ...saveBtnStyle, padding: '0 14px' }}>
            + เพิ่มชุด
          </button>
        )}
      </FilterBar>

      {/* 🔴 การ์ดสรุป/แถบเตือน = **เนื้อหา** ต้องอยู่ใต้แถบกรอง (UI-STANDARD §2.1 ลำดับตายตัว:
          ชื่อหน้า → แท็บ → แถบกรอง → เนื้อหา) — ย้ายลงมา 20/10 · ข้อยกเว้นมีแค่ <ReadOnlyNote>
          และตัวเลขในการ์ดก็เปลี่ยนตามตัวกรอง ⇒ อ่านจากใต้แถบกรองตรงกว่า */}
      {/* สรุป */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {[
          { t: 'ชุดแม่พิมพ์', v: stat.sets },
          { t: 'แม่พิมพ์', v: stat.dies },
          { t: 'ยังไม่ระบุตัน', v: stat.noTon, warn: stat.noTon > 0 },
          /* ⏱️ ความสูงแม่พิมพ์ = ตัวแปรของเวลาเปลี่ยนรุ่น — ยังไม่ครบ = จัดลำดับผลิตให้ประหยัดที่สุดไม่ได้
             (ตั้งใจโชว์จำนวนที่ "ยังไม่รู้" ตรงๆ ไม่ซ่อน ตามกฎความซื่อสัตย์ของจอ) */
          { t: 'ยังไม่ระบุความสูง', v: stat.noHeight, warn: stat.noHeight > 0,
            hint: 'ความสูงแม่พิมพ์ (มม.) ใช้คำนวณเวลาเปลี่ยนรุ่นงานปั๊ม — ยังไม่กรอก = ระบบจัดลำดับให้ประหยัดเวลาไม่ได้' },
          { t: 'ยังไม่ระบุรูปแบบชุด', v: stat.noKind, warn: stat.noKind > 0,
            hint: 'รูปแบบชุดว่าง = ใบแจ้งซ่อมเติมชนิดอุปกรณ์ให้ไม่ได้ (ถ้าแม่พิมพ์ไม่มีประเภท OP) · กรองด้วยช่อง "รูปแบบชุด" → ยังไม่ระบุ' },
          { t: 'ชุดที่ข้อมูลไม่ครบ', v: stat.todo, warn: stat.todo > 0 },
        ].map(c => (
          <div key={c.t} title={c.hint || undefined} style={{
            background: 'var(--card)', border: `1px solid ${c.warn ? 'var(--amber-line)' : 'var(--border)'}`,
            borderRadius: 'var(--r-md)', padding: '8px 14px', minWidth: 110,
          }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{c.t}</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: c.warn ? 'var(--amber)' : 'var(--text)' }}>{c.v}</div>
          </div>
        ))}
      </div>

      {/* worklist — ห้ามซ่อนของที่ยังไม่ครบ ให้ไล่เก็บได้ */}
      {(stat.todo > 0 || stat.unlinked > 0) && (
        <div style={{ ...warnBox, marginBottom: 12 }}>
          <b>⚠️ ข้อมูลที่ยังต้องเก็บให้ครบ</b>
          <div style={{ marginTop: 4, lineHeight: 1.7 }}>
            ทะเบียนชุดนี้ได้มาจากการ <b>แกะชื่อเครื่องเดิม</b> — ช่องที่แกะไม่ออกถูกปล่อยว่างไว้ (ไม่เดาให้)
            {stat.todo > 0 && <> · ชุดที่ข้อมูลยังไม่ครบ <b>{stat.todo}</b> ชุด</>}
            {stat.unlinked > 0 && <> · แม่พิมพ์ที่ยังไม่ได้อยู่ชุดไหน <b>{stat.unlinked}</b> ตัว</>}
          </div>
          <button onClick={() => setTodoOnly(v => !v)} style={{
            marginTop: 8, background: todoOnly ? 'var(--amber)' : 'var(--bg2)', color: todoOnly ? '#111' : 'var(--text)',
            border: '1px solid var(--amber-line)', borderRadius: 'var(--r-md)', padding: '5px 12px',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
            {todoOnly ? 'กำลังดูเฉพาะที่ต้องแก้' : 'ดูเฉพาะที่ต้องแก้'}
          </button>
        </div>
      )}

      {/* แม่พิมพ์ที่ยังไม่ผูกชุด */}
      {unlinked.length > 0 && (
        <div style={{ ...warnBox, marginBottom: 12 }}>
          <b>ยังไม่ได้อยู่ชุดไหน ({unlinked.length})</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {unlinked.map(d => (
              <button type="button" className="pg-btn sm" key={d.id} onClick={() => canEdit && openDie(d)} disabled={!canEdit} title={d.machine_name || ''}
                style={{ maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.ext?.die_no ? <b style={{ fontFamily: 'monospace', marginRight: 6 }}>{d.ext.die_no}</b> : null}{d.machine_no}
              </button>
            ))}
          </div>
        </div>
      )}


      {rows.length === 0 && (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          {todoOnly ? 'ไม่มีชุดที่ต้องแก้แล้ว 🎉' : 'ไม่พบชุดแม่พิมพ์ตามเงื่อนไข'}
        </div>
      )}

      {grouped.map(([lineName, list]) => (
        <div key={lineName} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', margin: '4px 0 8px' }}>
            {lineName} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>({list.length})</span>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {list.map(s => {
              const open = expanded.has(s.id);
              return (
                <div key={s.id} style={{
                  background: 'var(--card)', borderRadius: 'var(--r-md)',
                  border: `1px solid ${s.issues.length ? 'var(--amber-line)' : 'var(--border)'}`,
                  overflow: 'hidden',
                }}>
                  {/* หัวชุด */}
                  <div onClick={() => toggle(s.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', width: 12 }}>{open ? '▼' : '▶'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.part_name || '(ไม่มีชื่อ)'}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                        พาร์ท {s.part_no || <Blank />}
                        {' · '}MAT {dieSetMats(s).join(' + ') || <Blank />}
                        {s.model && <> · รุ่น {s.model}</>}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 'var(--r-pill)',
                      background: 'var(--bg3)', color: 'var(--text2)', whiteSpace: 'nowrap',
                    ...(s.kind ? null : { color: 'var(--amber)' }) }}>{s.kind ? dieSetKindLabel(s.kind, setKinds) : 'ยังไม่ระบุรูปแบบ'}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {s.members.length} ตัว{s.op_total ? ` / ${s.op_total} OP` : ''}
                    </span>
                    {/* 🔴 "ยังไม่รู้" ต้องเห็นต่างจาก "1 ชิ้น" — เดิมโชว์เฉพาะ >1 ⇒ 2 กรณีนี้หน้าตาเหมือนกันเป๊ะ
                           ทั้งที่กรณีแรกแปลว่า PM แม่พิมพ์ยังคิดเป็น shot ไม่ได้ */}
                    {/* 05/11: ชิ้นออก/shot เป็นของ OP แล้ว — "ยังไม่ระบุ" ขึ้นในรายการ ⚠ ของชุด (นับราย OP ผ่าน ppsOf)
                           ป้ายนี้เหลือไว้บอกค่าระดับชุดที่กรอกไว้เดิม (ใช้เป็นค่าสำรองของ OP ที่ยังว่าง) */}
                    {s.pieces_per_stroke > 1 ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}
                        title="ค่าสำรองระดับชุด — OP ที่ยังไม่กรอกชิ้นออก/shot จะใช้ค่านี้">
                        ชุด: {s.pieces_per_stroke} ชิ้น/shot
                      </span>
                    ) : null}
                    {s.issues.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                        ⚠ {s.issues.length}
                      </span>
                    )}
                    {canEdit && (
                      <button onClick={(e) => { e.stopPropagation(); setEditSet({ ...emptySet, ...s, op_total: s.op_total ?? '' }); }}
                        style={{ ...cancelBtnStyle, padding: '4px 10px', fontSize: 11.5 }}>✏️</button>
                    )}
                  </div>

                  {open && (
                    <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px' }}>
                      {s.issues.length > 0 && (
                        <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 12, color: 'var(--amber)', lineHeight: 1.7 }}>
                          {s.issues.map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                      )}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
                          <thead>
                            <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>OP</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>เลข</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>กระบวนการ</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>ชื่อแม่พิมพ์</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }} title="ชิ้นเข้า → ชิ้นออก ต่อ 1 shot (ม้วน = ป้อนคอยล์)">เข้า→ออก/shot</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>ตัน</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }} title="ความสูงตอนปิดแม่พิมพ์ (มม.) — ใช้คำนวณเวลาเปลี่ยนรุ่น">สูงปิด (มม.)</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>shot สะสม</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>เจียร</th>
                              {canEdit && <th style={{ width: 40 }} />}
                            </tr>
                          </thead>
                          <tbody>
                            {s.members.map(({ die: d, opSeq, shared: isShared, homeSetId }) => {
                              const e = d.ext || {};
                              const opLabel = opTypes.find(t => t.key === e.op_type)?.label;
                              const home = isShared ? setsById[homeSetId] : null;
                              const pps = ppsOf(e, s);
                              return (
                                <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td style={{ padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                    {opSeq != null ? `OP${opSeq}` : <Blank />}
                                  </td>
                                  <td style={{ padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                                    {e.die_no || <Blank />}
                                  </td>
                                  <td style={{ padding: '5px 6px' }}>{opLabel || e.op_name || <Blank />}</td>
                                  <td style={{ padding: '5px 6px', color: 'var(--muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    title={d.machine_no}>
                                    {isShared && (
                                      <span title={`แม่พิมพ์ของชุด ${home?.set_code || home?.part_name || '(ไม่มีชุดบ้าน)'} — ชุดนี้ยืมมาใช้ (common die) · แก้รายละเอียดที่ตัวแม่พิมพ์ได้เลย`}
                                        style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginRight: 6 }}>
                                        ใช้ร่วม · {home?.set_code || home?.part_name || 'ไม่มีชุดบ้าน'}
                                      </span>
                                    )}
                                    {d.machine_no}
                                  </td>
                                  <td style={{ padding: '5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    {e.feed_type === 'coil'
                                      ? <>ม้วน → {pps ?? <Blank />}</>
                                      : <>{e.pieces_in_per_stroke ?? <Blank />} → {pps ?? <Blank />}</>}
                                  </td>
                                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>{e.tonnage_ton ?? <Blank />}</td>
                                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>{e.die_height_mm ?? <Blank />}</td>
                                  <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' }}>
                                    {Number(e.shot_total || 0).toLocaleString()}
                                  </td>
                                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                                    {e.regrind_count || 0}{e.regrind_limit ? ` / ${e.regrind_limit}` : ''}
                                  </td>
                                  {canEdit && (
                                    <td style={{ padding: '5px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                      <button onClick={() => openDie(d)} style={{ ...cancelBtnStyle, padding: '2px 8px', fontSize: 11 }}>✏️</button>
                                      {isShared && (
                                        <button onClick={() => removeShare(s, d)} title="เลิกใช้ร่วมในชุดนี้ (แม่พิมพ์ยังอยู่ชุดบ้าน)"
                                          style={{ ...cancelBtnStyle, padding: '2px 8px', fontSize: 11, marginLeft: 4 }}>✕</button>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {/* 🔗 common die (05/11 · user: ชุด 70/71BA ใช้ OP10/20/40 ของ 70/71AA เปลี่ยนแค่ OP30)
                          ยืมแม่พิมพ์ของชุดอื่นมาเป็น OP ของชุดนี้ — ตัวแม่พิมพ์/เลข/shot ยังเป็นตัวเดียว ไม่สร้างแถวซ้ำ */}
                      {canEdit && !sharedErr && (addShare?.setId === s.id ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
                          <select style={{ ...inputStyle, width: 'auto', minWidth: 260, flex: 1 }} value={addShare.machineId}
                            onChange={e => setAddShare(a => ({ ...a, machineId: e.target.value }))}>
                            <option value="">— เลือกแม่พิมพ์ที่จะใช้ร่วม —</option>
                            {shareOptions(s).map(d => (
                              <option key={d.id} value={d.id}>
                                {d.ext?.die_no || '—'} · {setsById[d.ext?.die_set_id]?.set_code || 'ไม่มีชุด'}
                                {d.ext?.op_seq != null ? ` OP${d.ext.op_seq}` : ''} · {d.machine_no}
                              </option>
                            ))}
                          </select>
                          <input style={{ ...inputStyle, width: 90 }} type="number" step="10" placeholder="OP ในชุดนี้"
                            value={addShare.opSeq} onChange={e => setAddShare(a => ({ ...a, opSeq: e.target.value }))} />
                          <button style={{ ...saveBtnStyle, padding: '6px 12px' }} disabled={saving} onClick={() => saveShare(s)}>บันทึก</button>
                          <button style={{ ...cancelBtnStyle, padding: '6px 12px' }} onClick={() => setAddShare(null)}>ยกเลิก</button>
                        </div>
                      ) : (
                        <button onClick={() => setAddShare({ setId: s.id, machineId: '', opSeq: '' })}
                          style={{ ...cancelBtnStyle, padding: '4px 10px', fontSize: 11.5, marginTop: 8 }}>
                          + เพิ่มแม่พิมพ์ใช้ร่วมจากชุดอื่น
                        </button>
                      ))}
                      {s.note && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>{s.note}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ⚙️ ทะเบียนกลุ่มเครื่องปั๊ม/ไลน์ของแม่พิมพ์ (DR die_press_lines · 2026-09-08) — พับไว้ท้ายแท็บ (ตั้งค่านานๆ ครั้ง)
          code กรอกเอง (สั้น เช่น LINE-A) · ref_production_line = ชื่อไลน์ผลิตจริงเมื่อกลุ่มนั้นคือไลน์ (HDF1) ไว้ต่อ linkage OEE
          SimpleMasterPanel ยืนยันก่อนปิดใช้/ลบเอง (UI-CONVENTIONS §5.4) */}
      <CollapseCard id="die_press_lines" title="กลุ่มเครื่องปั๊ม / ไลน์ของแม่พิมพ์ (ทะเบียน)" count={pressLines.length} defaultOpen={false} storePrefix="die_registry">
        <SimpleMasterPanel client={supabaseDR} table="die_press_lines" keyCol="code" canManage={canEdit}
          /* ด่านนับปลายทางก่อนลบ — die_sets.line_name + machines.line_name (เฉพาะ equipment_kind=die) */
          onBeforeDelete={masterDeleteGuard(supabaseDR, 'die_press_lines')}
          stampCol="updated_by_name" stampName={fullName} onChanged={invalidateDiePressLines}
          help="ชื่อในทะเบียนนี้คือค่าที่เก็บใน die_sets.line_name / machines.line_name (text) — แยกจากทะเบียนไลน์ผลิต (production_lines) ตั้งใจไม่ให้ชื่อเครื่องปั๊มโผล่ใน dropdown ไลน์ผลิตทุกหน้า · ปิดใช้ = ไม่โผล่ให้เลือกใหม่ (ชุดเก่ายังอ่านออก)"
          fields={[
            { key: 'name', label: 'ชื่อกลุ่ม/ไลน์', required: true, placeholder: 'เช่น LINE A ( 800 Ton )' },
            { key: 'tonnage', label: 'Tonnage', type: 'text', placeholder: 'เช่น 800 Ton', width: 120 },
            { key: 'ref_production_line', label: 'ไลน์ผลิตอ้างอิง', placeholder: 'เช่น HDF1 (ถ้าเป็นไลน์ผลิตจริง)' },
            { key: 'note', label: 'หมายเหตุ' },
          ]} />
      </CollapseCard>

      {/* ⚙️ ทะเบียนรูปแบบชุดแม่พิมพ์ (DR die_set_kinds · 2026-10-05) — เดิม hardcode 4 ค่า (Tandem/Progressive/Transfer/Single)
          ทีมแม่พิมพ์เพิ่มเอง (HYDROFORM/BEND ฯลฯ) + ตั้ง "ชื่อที่หน้างานเรียก" เอง (ศัพท์ทางการหน้างานไม่เข้าใจ)
          key สร้างให้อัตโนมัติ — คนกรอกแค่ชื่อ · mo_item_type = ชนิดอุปกรณ์ที่ใบแจ้งซ่อมเติมให้เมื่อเลือกแม่พิมพ์ */}
      {/* ⚙️ ทะเบียนประเภท OP ของแม่พิมพ์ (DR die_op_types · แผงจัดการ 2026-10-06) — เดิมมีตารางแต่ไม่มีที่แก้บนจอ
          mo_item_type = ชนิดอุปกรณ์ในใบแจ้งซ่อม **ชนะรูปแบบชุด** (HDF: ชุดเดียวมี HYDRO/BENDING/PREFORM — คอมเมนต์ทีม DIE 06/10) */}
      <CollapseCard id="die_op_types" title="ประเภท OP ของแม่พิมพ์ (ทะเบียน)" count={opTypes.length} defaultOpen={false} storePrefix="die_registry">
        <SimpleMasterPanel client={supabaseDR} table="die_op_types" keyCol="key" canManage={canEdit}
          onBeforeDelete={masterDeleteGuard(supabaseDR, 'die_op_types', r => r?.label)}
          keyFrom={dieSetKindKey}
          stampCol="updated_by_name" stampName={fullName}
          onChanged={() => { invalidateDieSetKinds(); load(); }}
          help="ประเภท OP = หน้าที่ของแม่พิมพ์ตัวนั้น (ตั้งที่ปุ่มแก้แม่พิมพ์รายตัว) · &quot;ชนิดอุปกรณ์ในใบแจ้งซ่อม&quot; ที่ตั้งตรงนี้ **ชนะ** ค่าของรูปแบบชุด — ใช้กับชุดที่มีแม่พิมพ์ต่างหน้าที่กันในชุดเดียว (เช่น HDF: HYDRO / BENDING / PREFORM) · ว่าง = ใช้ค่าของรูปแบบชุด · ปิดใช้ = ไม่โผล่ให้เลือกใหม่ (แม่พิมพ์เก่ายังอ่านออก)"
          fields={[
            { key: 'label', label: 'ชื่อที่หน้างานเรียก', required: true, placeholder: 'เช่น Hydroform / ดัด' },
            { key: 'mo_item_type', label: 'ชนิดอุปกรณ์ในใบแจ้งซ่อม', type: 'select', options: dieItemTypeOpts, width: 190 },
          ]} />
      </CollapseCard>

      <CollapseCard id="die_set_kinds" title="รูปแบบชุดแม่พิมพ์ (ทะเบียน)" count={setKinds.filter(k => k.is_active).length} defaultOpen={false} storePrefix="die_registry">
        <SimpleMasterPanel client={supabaseDR} table="die_set_kinds" keyCol="key" canManage={canEdit}
          onBeforeDelete={masterDeleteGuard(supabaseDR, 'die_set_kinds', r => r?.label)}
          keyFrom={dieSetKindKey}
          stampCol="updated_by_name" stampName={fullName}
          onChanged={() => { invalidateDieSetKinds(); setKindsVer(v => v + 1); }}
          help="ตั้งชื่อเป็นคำที่หน้างานเรียกจริงได้เลย (แก้ชื่อทีหลังได้ ชุดเดิมไม่กระทบ) · &quot;ชนิดอุปกรณ์ในใบแจ้งซ่อม&quot; = ค่าที่ใบ MO เติมให้เองเมื่อผู้แจ้งเลือกแม่พิมพ์ในชุดแบบนี้ (ว่าง = ให้ผู้แจ้งเลือกเอง · เพิ่มชื่อใหม่ได้ที่ /mtn-repair แท็บข้อมูลหลัก › ชนิดอุปกรณ์) · ปิดใช้ = ไม่โผล่ให้เลือกใหม่ (ชุดเก่ายังอ่านออก)"
          fields={[
            { key: 'label', label: 'ชื่อที่หน้างานเรียก', required: true, placeholder: 'เช่น HYDROFORM DIE / แม่พิมพ์ดัด' },
            { key: 'description', label: 'คำอธิบาย (ภาษาบ้านๆ)', placeholder: 'โชว์ใต้ช่องเลือกตอนแก้ชุด' },
            { key: 'mo_item_type', label: 'ชนิดอุปกรณ์ในใบแจ้งซ่อม', type: 'select', options: dieItemTypeOpts, width: 190 },
          ]} />
      </CollapseCard>

      {/* ⏱️ กฎเวลาเปลี่ยนรุ่น (press_setup_rules · 2026-09-25 · user: setup time change over die เป็นตัวแปร)
          อยู่ที่นี่เพราะ "ความสูงแม่พิมพ์" ที่กฎใช้ ก็กรอกในแท็บนี้ — ตั้งค่านานๆ ครั้ง จึงพับไว้ */}
      <CollapseCard id="press_setup_rules" title="⏱️ กฎเวลาเปลี่ยนรุ่น (setup / change over die)" defaultOpen={false} storePrefix="die_registry">
        <PressSetupRules dies={scopedDies} lineNames={dieLineNames} canEdit={canEdit} />
      </CollapseCard>
      </>}

      {/* ── modal: ชุดแม่พิมพ์ ── */}
      {editSet && (
        <Modal title={editSet.id ? 'แก้ไขชุดแม่พิมพ์' : 'เพิ่มชุดแม่พิมพ์'} onClose={() => setEditSet(null)}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* ชื่อ/เลขพาร์ท เติมอัตโนมัติจาก MAT ที่เลือก — แก้เองได้เฉพาะเมื่อ MAT ยังไม่ผูก Product Master (audit #29 · 2026-09-07) */}
            <Field label="ชื่อพาร์ท / ชื่อชุด *" hint={editSet.mat_no && products.some(p => p.mat_no === editSet.mat_no) ? 'จาก Product Master' : undefined}>
              <input style={{ ...inputStyle, ...(editSet.mat_no && products.some(p => p.mat_no === editSet.mat_no) ? { background: 'var(--bg2)', color: 'var(--text2)' } : null) }}
                value={editSet.part_name || ''} readOnly={!!editSet.mat_no && products.some(p => p.mat_no === editSet.mat_no)}
                onChange={e => setEditSet(f => ({ ...f, part_name: e.target.value }))} />
            </Field>
            <Field label="เลขพาร์ท (P/N ลูกค้า)" hint={editSet.mat_no && products.some(p => p.mat_no === editSet.mat_no) ? 'จาก Product Master' : undefined}>
              <input style={{ ...inputStyle, ...(editSet.mat_no && products.some(p => p.mat_no === editSet.mat_no) ? { background: 'var(--bg2)', color: 'var(--text2)' } : null) }}
                value={editSet.part_no || ''} readOnly={!!editSet.mat_no && products.some(p => p.mat_no === editSet.mat_no)}
                onChange={e => setEditSet(f => ({ ...f, part_no: e.target.value }))} />
            </Field>
            <Field label="MAT SAP" hint="ผูกกับ Product Master">
              {/* <ProductSelect> แทน datalist — mat_no คือคีย์ golden thread (VSM / pieces_per_stroke) · เลือกแล้วเติมชื่อ/P/N ให้ ·
                  ไม่เปิด allowFree (MAT ที่ยังไม่มีให้เพิ่มที่ /products) · ค่าเก่าที่ไม่ตรงทะเบียนยังแสดง/แก้ได้ + กลุ่ม 📜 เคยบันทึกไว้ · 2026-09-07 */}
              <ProductSelect value={editSet.mat_no || ''} lines={editSet.line_name ? [editSet.line_name] : undefined} history={dieMatHist}
                onChange={res => setEditSet(f => ({
                  ...f, mat_no: res.mat_no || '',
                  ...(res.opt ? { part_name: res.name || f.part_name || '', part_no: res.p_no || f.part_no || '' } : null),
                }))} inputStyle={{ background: 'var(--bg)' }} />
            </Field>
            {/* 🔨 MAT ตัวที่ 2 — gang die ปั๊มทีเดียวได้ RH+LH (14/10 · คำสั่ง user)
                เดิมช่องเดียว ⇒ ล็อตของอีกฝั่งหาแม่พิมพ์ไม่เจอ (ProdLotPlanner) = ไม่รู้ความสูง = คิดเวลาเปลี่ยนรุ่นไม่ได้
                ⚠️ ช่องนี้ตอบ "แม่พิมพ์ชุดนี้ทำพาร์ทอะไร" — ไม่ใช่ที่ตั้งว่าใครคู่กับใคร (นั่นคือ Product Master) */}
            <Field label="MAT ตัวที่ 2 (งานคู่ RH/LH)" hint="ว่าง = ชุดนี้ทำพาร์ทเดียว">
              <ProductSelect value={editSet.mat_no_2 || ''} lines={editSet.line_name ? [editSet.line_name] : undefined} history={dieMatHist}
                onChange={res => setEditSet(f => ({ ...f, mat_no_2: res.mat_no || '' }))} inputStyle={{ background: 'var(--bg)' }} />
              <SetPairNote set={editSet} products={products} role={role} onDone={load} prodLines={lines} />
            </Field>
            <Field label="รุ่น / Model">
              <input style={inputStyle} value={editSet.model || ''}
                onChange={e => setEditSet(f => ({ ...f, model: e.target.value }))} />
            </Field>
            <Field label="ไลน์หลัก / กลุ่มเครื่องปั๊ม" hint="ตรงกับฝั่งผลิต">
              {/* ทะเบียน = DR `die_press_lines` (แผง ⚙️ ท้ายแท็บทะเบียน · 2026-09-08 — ปิด audit #28) กลุ่มเครื่องปั๊ม (LINE A ( 800 Ton ) ฯลฯ)
                  ตั้งใจแยกจาก production_lines · ชื่อเก่าที่ชุด/แม่พิมพ์ใช้อยู่แต่ยังไม่ลงทะเบียนยังเลือกซ้ำได้ (กันสะกดต่างจน
                  inScope()/ฟิลเตอร์/MO แตกเป็นคนละไลน์) · "✏️ ระบุใหม่" เฉพาะกรณีจริงที่ยังไม่มีในทะเบียน */}
              <SelectOrFree value={editSet.line_name || ''} options={setLineOptions} placeholder="— เลือกจากทะเบียนกลุ่มเครื่องปั๊ม —"
                freeLabel="✏️ ระบุใหม่ (ยังไม่มีในทะเบียน die_press_lines)" freePlaceholder="เช่น LINE A ( 800 Ton )" style={inputStyle} inputStyle={inputStyle}
                onChange={v => setEditSet(f => ({ ...f, line_name: v }))} />
            </Field>
            <Field label="รูปแบบชุด">
              {/* ตัวเลือกจากทะเบียน die_set_kinds (แผง ⚙️ ท้ายแท็บ) · ค่าปัจจุบันที่ถูกปิดใช้ยังอยู่ในลิสต์ (ไม่บันทึกทับเงียบ) */}
              <select style={inputStyle} value={editSet.kind || ''}
                onChange={e => setEditSet(f => ({ ...f, kind: e.target.value }))}>
                <option value="">— ยังไม่ระบุ —</option>
                {dieSetKindOptions(setKinds, editSet.kind || '').map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                {editSet.kind ? setKinds.find(k => k.key === editSet.kind)?.desc : 'ยังไม่ระบุ — ใบแจ้งซ่อมจะเติมชนิดอุปกรณ์จากรูปแบบชุดไม่ได้ (ถ้าแม่พิมพ์ไม่มีประเภท OP ผู้แจ้งต้องเลือกเอง)'}
                {canEdit && <> · ไม่มีแบบที่ต้องการ? เพิ่มได้ที่แผง ⚙️ รูปแบบชุดแม่พิมพ์ ท้ายแท็บนี้</>}
              </div>
            </Field>
            <Field label="จำนวน OP ทั้งชุด">
              <input style={inputStyle} type="number" min="1" value={editSet.op_total ?? ''}
                onChange={e => setEditSet(f => ({ ...f, op_total: e.target.value }))} />
            </Field>
            <Field label="เจ้าของแม่พิมพ์">
              <select style={inputStyle} value={editSet.owner || ''}
                onChange={e => setEditSet(f => ({ ...f, owner: e.target.value }))}>
                <option value="">— ยังไม่ระบุ —</option>
                {DIE_OWNERS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                {editSet.owner && !DIE_OWNERS.some(o => o.key === editSet.owner) && <option value={editSet.owner}>{dieOwnerLabel(editSet.owner)}</option>}
              </select>
            </Field>
            {/* 05/11: ชิ้น/shot เป็นของ OP แล้ว (OP ตัดแยก LH/RH ออก 2 แต่ OP ก่อนหน้าออก 1) — ช่องนี้เหลือเป็นค่าสำรอง */}
            <Field label="ชิ้น / shot (ค่าสำรองของชุด)" hint="กรอกที่แม่พิมพ์ราย OP ดีกว่า · ใช้กับ OP ที่ยังว่าง">
              <input style={inputStyle} type="number" min="1" value={editSet.pieces_per_stroke ?? ''}
                onChange={e => setEditSet(f => ({ ...f, pieces_per_stroke: e.target.value }))} />
              {/* 🔴 ลง MAT ไว้ 2 ตัว = ปั๊มทีเดียวได้อย่างน้อย 2 ชิ้น — แต่ "เสนอ" เท่านั้น คนกดยืนยันเอง
                  ห้ามเติมให้อัตโนมัติ: บางชุดเป็น 2-out ของทั้งคู่ = 4 ชิ้น/จังหวะ ระบบไม่มีทางรู้ */}
              {suggestPps(editSet) != null && !String(editSet.pieces_per_stroke ?? '').trim() && (
                <button type="button" className="pg-btn sm" onClick={() => setEditSet(f => ({ ...f, pieces_per_stroke: String(suggestPps(f)) }))}
                  style={{ marginTop: 4 }}>
                  ลง MAT ไว้ {suggestPps(editSet)} ตัว — ใช้ {suggestPps(editSet)} ชิ้น/stroke?
                </button>
              )}
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="หมายเหตุ">
              <textarea style={{ ...inputStyle, minHeight: 60 }} value={editSet.note || ''}
                onChange={e => setEditSet(f => ({ ...f, note: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button style={cancelBtnStyle} onClick={() => setEditSet(null)}>ยกเลิก</button>
            <button style={saveBtnStyle} disabled={saving} onClick={saveSet}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
          </div>
        </Modal>
      )}

      {/* ── modal: แม่พิมพ์รายตัว ── */}
      {editDie && (
        <Modal title="แก้ไขแม่พิมพ์" onClose={() => setEditDie(null)}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, wordBreak: 'break-word' }}>
            <b style={{ fontFamily: 'monospace', fontSize: 14, color: 'var(--text)', marginRight: 8 }}>{editDie.die_no || 'D-????'}</b>
            {editDie.machine_no}
            <div style={{ fontSize: 11, marginTop: 2 }}>เลขแม่พิมพ์ระบบออกให้ แก้ไม่ได้ · 1 เลข = แม่พิมพ์ 1 ตัว = 1 OP</div>
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="ชุดบ้าน (อยู่ชุดไหน)" hint="ชุดอื่นยืมไปใช้ได้ที่หน้าชุด">
              <select style={inputStyle} value={editDie.die_set_id || ''}
                onChange={e => setEditDie(f => ({ ...f, die_set_id: e.target.value }))}>
                <option value="">— ยังไม่ระบุ —</option>
                {sets.filter(s => inScope(s.line_name)).map(s => (
                  <option key={s.id} value={s.id}>{s.part_name} {s.line_name ? `· ${s.line_name}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="OP (เลขลำดับ)" hint="เช่น 10 20 30">
              <input style={inputStyle} type="number" step="10" value={editDie.op_seq ?? ''}
                onChange={e => setEditDie(f => ({ ...f, op_seq: e.target.value }))} />
            </Field>
            <Field label="กระบวนการ">
              <select style={inputStyle} value={editDie.op_type || ''}
                onChange={e => setEditDie(f => ({ ...f, op_type: e.target.value }))}>
                <option value="">— ยังไม่ระบุ —</option>
                {opTypes.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="ชื่อ OP (ตามที่เขียนบนแม่พิมพ์)">
              <input style={inputStyle} value={editDie.op_name || ''}
                onChange={e => setEditDie(f => ({ ...f, op_name: e.target.value }))} />
            </Field>
            <Field label="ขนาดตัน (Ton)">
              <input style={inputStyle} type="number" step="1" value={editDie.tonnage_ton ?? ''}
                onChange={e => setEditDie(f => ({ ...f, tonnage_ton: e.target.value }))} />
            </Field>
            {/* ⏱️ ความสูงแม่พิมพ์ — ตัวแปรหลักของเวลาเปลี่ยนรุ่น (user 2026-09-24)
                ต่างกันมาก = ปรับ shut height นาน ⇒ ลำดับผลิตที่ดีคือเรียงความสูงให้ไล่กัน
                ว่าง = "ยังไม่รู้" ระบบจะไม่เดาแทน (pressSetup.js คืน state unknown_height) */}
            <Field label="ความสูงตอนปิดแม่พิมพ์ (มม.)" hint="ใช้คำนวณเวลาเปลี่ยนรุ่น — ว่าง = ยังไม่รู้ ระบบจะไม่เดาให้">
              <input style={inputStyle} type="number" step="0.1" min="0" value={editDie.die_height_mm ?? ''}
                onChange={e => setEditDie(f => ({ ...f, die_height_mm: e.target.value }))} />
            </Field>
            {/* 🔨 ชนิดป้อน + ชิ้นเข้า/ออก ต่อ shot (05/11 · user) — OP ตัดแยก LH/RH = เข้า 1 ออก 2 ·
                ม้วน (progressive/blank) ไม่มี "ชิ้นเข้า" ใช้ระยะพิทช์ + กว้างคอยล์ · ช่องที่ซ่อนยังเก็บค่าเดิม (ซ่อน ≠ ล้าง) */}
            <Field label="ชนิดป้อนเข้า OP นี้">
              <select style={inputStyle} value={editDie.feed_type || ''}
                onChange={e => setEditDie(f => ({ ...f, feed_type: e.target.value }))}>
                <option value="">— ยังไม่ระบุ —</option>
                {FEED_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            {editDie.feed_type !== 'coil' && (
              <Field label="ชิ้นเข้า / shot" hint="gang die ป้อนทีละ 2 แผ่น = 2">
                <input style={inputStyle} type="number" min="1" value={editDie.pieces_in_per_stroke ?? ''}
                  onChange={e => setEditDie(f => ({ ...f, pieces_in_per_stroke: e.target.value }))} />
              </Field>
            )}
            {editDie.feed_type === 'coil' && <>
              <Field label="ระยะพิทช์ (มม.)">
                <input style={inputStyle} type="number" min="0" step="0.1" value={editDie.feed_pitch_mm ?? ''}
                  onChange={e => setEditDie(f => ({ ...f, feed_pitch_mm: e.target.value }))} />
              </Field>
              <Field label="กว้างคอยล์ (มม.)">
                <input style={inputStyle} type="number" min="0" step="0.1" value={editDie.coil_width_mm ?? ''}
                  onChange={e => setEditDie(f => ({ ...f, coil_width_mm: e.target.value }))} />
              </Field>
            </>}
            <Field label="ชิ้นออก / shot" hint="ตัดแยก LH/RH = 2 · ว่าง = ใช้ค่าสำรองของชุด">
              <input style={inputStyle} type="number" min="1" value={editDie.pieces_per_stroke ?? ''}
                onChange={e => setEditDie(f => ({ ...f, pieces_per_stroke: e.target.value }))} />
            </Field>
            <Field label="น้ำหนัก (กก.)">
              <input style={inputStyle} type="number" min="0" step="1" value={editDie.weight_kg ?? ''}
                onChange={e => setEditDie(f => ({ ...f, weight_kg: e.target.value }))} />
            </Field>
            <Field label="ขนาด ยาว × กว้าง (มม.)" hint="สูง = ความสูงตอนปิด">
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={inputStyle} type="number" min="0" placeholder="ยาว" value={editDie.length_mm ?? ''}
                  onChange={e => setEditDie(f => ({ ...f, length_mm: e.target.value }))} />
                <input style={inputStyle} type="number" min="0" placeholder="กว้าง" value={editDie.width_mm ?? ''}
                  onChange={e => setEditDie(f => ({ ...f, width_mm: e.target.value }))} />
              </div>
            </Field>
            <Field label="เจียรไปแล้ว (ครั้ง)">
              <input style={inputStyle} type="number" min="0" value={editDie.regrind_count ?? 0}
                onChange={e => setEditDie(f => ({ ...f, regrind_count: e.target.value }))} />
            </Field>
            <Field label="เจียรได้สูงสุด (ครั้ง)">
              <input style={inputStyle} type="number" min="0" value={editDie.regrind_limit ?? ''}
                onChange={e => setEditDie(f => ({ ...f, regrind_limit: e.target.value }))} />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="หมายเหตุ">
              <textarea style={{ ...inputStyle, minHeight: 50 }} value={editDie.note || ''}
                onChange={e => setEditDie(f => ({ ...f, note: e.target.value }))} />
            </Field>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
            shot สะสม {Number(editDie.shot_total || 0).toLocaleString()} — เป็นตัวนับจากการผลิต แก้ที่นี่ไม่ได้
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button style={cancelBtnStyle} onClick={() => setEditDie(null)}>ยกเลิก</button>
            <button style={saveBtnStyle} disabled={saving} onClick={saveDie}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
        padding: 18, width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
