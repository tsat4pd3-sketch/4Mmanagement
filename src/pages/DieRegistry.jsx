import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { DIE_SET_KINDS, dieSetKindLabel } from '../utils/equipmentKinds';
import { OPEN_MO_STATUSES, buildOpenMoMap, openMosOf } from '../utils/dieStatus';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import DieLayout from '../components/DieLayout';
import DieStatusBoard from '../components/DieStatusBoard';

/* ═══════════════════════════════════════════════════════════════
   ทะเบียนแม่พิมพ์ & DIE MAINTENANCE — /die-registry

   3 แท็บ (useTabParam):
     📋 ทะเบียน   — ชุดแม่พิมพ์ + สมาชิกราย OP (ของเดิม)
     🗺️ ผังจัดเก็บ — layout แม่พิมพ์: รูปจริง + หมุดตำแหน่งรายตัว (DieLayout)
     📊 สถานะ     — บอร์ดติดตามสถานะ + ใบซ่อม MO ค้าง (DieStatusBoard)

   ⚠️ หน้านี้ "แยกจอ" จากฐานข้อมูลเครื่องจักร แต่ **ไม่ได้แยกฐานข้อมูล**
      ตัวตนของแม่พิมพ์ยังอยู่ `machines` (machine_no unique · MO/downtime/QR อ้างเลขนี้)
      หน้านี้อ่าน machines ที่ equipment_kind='die' แล้วต่อ:
        die_sets          = ชุดแม่พิมพ์ (1 พาร์ท = 1 ชุด)
        equipment_die     = ส่วนขยาย 1:1 (OP/ตัน/shot/regrind + สถานะ/ตำแหน่งจัดเก็บ)
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
  background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
  padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const cancelBtnStyle = {
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
};
const warnBox = {
  background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)',
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
const Blank = () => <span style={{ color: '#f59e0b', fontWeight: 700 }} title="ยังไม่ได้กรอก">—</span>;

const numOrNull = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const emptySet = {
  id: null, set_code: '', part_no: '', part_name: '', model: '', line_name: '',
  kind: 'tandem', op_total: '', pieces_per_stroke: 1, mat_no: '', note: '', is_active: true,
};

export default function DieRegistry() {
  const { role, lineId: userLineId, sections: scopeSecs, fullName } = useContext(UserContext);
  // ใช้สิทธิ์ชุดเดียวกับฐานข้อมูลเครื่องจักร — แม่พิมพ์อยู่ตาราง machines เดียวกัน คนดูแลกลุ่มเดียวกัน
  // (เลี่ยงการ seed permission key ใหม่ ซึ่งมีกับดัก enum_range ทำให้ role ที่เพิ่มทีหลัง fail-closed)
  const canEdit = can('machines', 'edit', role);
  const [tab, setTab] = useTabParam(['registry', 'layout', 'status'], 'registry');

  const [lines, setLines]   = useState([]);
  const [dies, setDies]     = useState([]);   // machines (equipment_kind='die') + equipment_die
  const [sets, setSets]     = useState([]);
  const [opTypes, setOpTypes] = useState([]);
  const [products, setProducts] = useState([]); // dr_products — ผูก mat_no ของชุด
  const [areas, setAreas]     = useState([]);   // die_storage_areas — ผังจัดเก็บ
  const [openMos, setOpenMos] = useState([]);   // ใบซ่อม MO ที่ยังไม่ปิด (derive สถานะซ่อม)
  const [layoutReady, setLayoutReady] = useState(false); // migration 20260819 apply แล้วหรือยัง
  const [loading, setLoading] = useState(true);
  const [focusDieId, setFocusDieId] = useState(null);    // 📊 สถานะ กด 🗺️ → กระโดดมาแท็บผัง

  const [search, setSearch]       = useState('');
  const [filterLine, setFilterLine] = useState('');
  const [filterKind, setFilterKind] = useState('');
  const [todoOnly, setTodoOnly]   = useState(false);   // 🔎 ดูเฉพาะที่ต้องแก้
  const [expanded, setExpanded]   = useState(() => new Set());

  const [editSet, setEditSet] = useState(null);   // ฟอร์มชุด
  const [editDie, setEditDie] = useState(null);   // ฟอร์มแม่พิมพ์รายตัว
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ln }, { data: mc }, { data: st }, { data: ot }, { data: pd }, areaRes, moRes] = await Promise.all([
      supabase.from('production_lines').select('id, name, section, parent_line_name').order('name'),
      // ตัวตนของแม่พิมพ์ยังอยู่ machines — embed ส่วนขยายมาด้วยในนัดเดียว
      supabaseDR.from('machines')
        .select('id, machine_no, machine_name, line_name, is_active, equipment_die(*)')
        .eq('equipment_kind', 'die').order('line_name').order('machine_no'),
      supabaseDR.from('die_sets').select('*').order('line_name').order('part_name'),
      supabaseDR.from('die_op_types').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('dr_products').select('mat_no, name, line_name').eq('is_active', true).order('mat_no'),
      // ยังไม่ apply migration 20260819 → 42P01 — จับเป็น flag ไปบอกบนจอ ห้ามพังทั้งหน้า
      supabaseDR.from('die_storage_areas').select('*').eq('is_active', true).order('sort_order').order('name'),
      // สถานะ "ซ่อมอยู่" derive จากใบ MO จริง — ห้ามให้คนตั้งซ้ำ (2 แหล่งจะ drift กัน)
      supabaseDR.from('mtn_orders')
        .select('id, mo_no, status, machine_no, mtn_dept, current_step, report_at')
        .in('status', OPEN_MO_STATUSES),
    ]);
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
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

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
  const scopedLines = useMemo(() => {
    if (role === 'leader' && userLineId) {
      const myLine = lines.find(l => String(l.id) === String(userLineId));
      const fam = new Set(myLine ? getLineFamilyNames(lines, myLine.name) : []);
      return fam.size ? lines.filter(l => fam.has(l.name)) : lines;
    }
    if (scopeSecs?.length) return lines.filter(l => inSectionScope(scopeSecs, l.section));
    return lines;
  }, [lines, role, userLineId, scopeSecs]);
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
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [sets, dies, inScope]);

  /* ── ประกอบชุด + สมาชิก + ตรวจ "ข้อมูลที่ยังไม่ครบ" ─────────────── */
  const diesBySet = useMemo(() => {
    const m = {};
    dies.forEach(d => { const k = d.ext?.die_set_id; if (k) (m[k] ||= []).push(d); });
    Object.values(m).forEach(arr => arr.sort((a, b) => (a.ext?.op_seq ?? 9e9) - (b.ext?.op_seq ?? 9e9)));
    return m;
  }, [dies]);

  const unlinked = useMemo(
    () => dies.filter(d => !d.ext?.die_set_id && d.is_active && inScope(d.line_name)),
    [dies, inScope]);

  /** ปัญหาของชุด — คืนลิสต์ข้อความ (ว่าง = ครบ) */
  const issuesOf = useCallback((s) => {
    const mem = diesBySet[s.id] || [];
    const out = [];
    const seqs = mem.map(d => d.ext?.op_seq).filter(v => v != null);
    const dup = seqs.length - new Set(seqs).size;
    // OP ซ้ำ = สัญญาณว่าชุดนี้จริงๆ เป็นหลายชุดที่ถูกรวมกัน (เช่นแยกตามวัสดุ RAW/AAW/LAW)
    // เป็นการตัดสินใจของคน ระบบแค่ชี้ให้เห็น **ห้ามแยกให้เองอัตโนมัติ**
    if (dup > 0) out.push(`OP ซ้ำ ${dup} ตัว — อาจเป็นหลายชุดที่ถูกรวมกัน (เช่นแยกตามวัสดุ) ต้องแยกชุดเอง`);
    const noOp = mem.filter(d => d.ext?.op_seq == null).length;
    if (noOp) out.push(`ยังไม่ระบุ OP ${noOp} ตัว`);
    if (!s.part_no) out.push('ยังไม่ระบุเลขพาร์ท');
    if (!s.mat_no)  out.push('ยังไม่ผูก MAT SAP');
    if (s.op_total && mem.length !== s.op_total && dup === 0)
      out.push(`จำนวนแม่พิมพ์ (${mem.length}) ไม่ตรงกับจำนวน OP ที่ระบุ (${s.op_total})`);
    return out;
  }, [diesBySet]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sets
      .filter(s => inScope(s.line_name))                                    // scope ก่อน filter อิสระเสมอ
      .filter(s => !filterLine || s.line_name === filterLine)
      .filter(s => !filterKind || s.kind === filterKind)
      .filter(s => !q || [s.part_no, s.part_name, s.model, s.set_code, s.mat_no]
        .some(v => (v || '').toLowerCase().includes(q))
        || (diesBySet[s.id] || []).some(d => (d.machine_no || '').toLowerCase().includes(q)))
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
  const moDieCount = useMemo(() => {
    const m = buildOpenMoMap(openMos);
    return scopedDies.filter(d => d.is_active && openMosOf(d, m).length > 0).length;
  }, [openMos, scopedDies]);

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
      kind: f.kind || 'tandem',
      op_total: numOrNull(f.op_total),
      pieces_per_stroke: numOrNull(f.pieces_per_stroke) ?? 1,
      mat_no: f.mat_no?.trim() || null,
      note: f.note?.trim() || null,
      is_active: f.is_active !== false,
    };
    const { error } = f.id
      ? await supabaseDR.from('die_sets').update(payload).eq('id', f.id)
      : await supabaseDR.from('die_sets').insert(payload);
    setSaving(false);
    if (error) return toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    toast.success('บันทึกชุดแม่พิมพ์แล้ว');
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
      pieces_per_stroke: numOrNull(f.pieces_per_stroke),
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
    setEditDie(null); load();
  };

  const openDie = (d) => setEditDie({
    machine_id: d.id, machine_no: d.machine_no, machine_name: d.machine_name,
    die_set_id: d.ext?.die_set_id || '',
    op_seq: d.ext?.op_seq ?? '', op_name: d.ext?.op_name || '', op_type: d.ext?.op_type || '',
    tonnage_ton: d.ext?.tonnage_ton ?? '', pieces_per_stroke: d.ext?.pieces_per_stroke ?? '',
    regrind_count: d.ext?.regrind_count ?? 0, regrind_limit: d.ext?.regrind_limit ?? '',
    note: d.ext?.note || '', shot_total: d.ext?.shot_total ?? 0,
  });

  const toggle = (id) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  if (loading) return <div style={{ padding: 24, color: 'var(--muted)' }}>กำลังโหลด...</div>;

  return (
    <div style={{ padding: '16px 18px 40px', maxWidth: 1500, margin: '0 auto' }}>
      <PageHeader
        title="ทะเบียนแม่พิมพ์" icon="🔨"
        sub={`1 พาร์ท = 1 ชุด · ตัวตนของแม่พิมพ์อยู่ในฐานเดียวกับเครื่องจักร (เลขเครื่อง/QR/ประวัติซ่อมใช้ร่วมกัน)${scopeActive ? ' · เห็นเฉพาะส่วนงานของคุณ' : ''}`}
        tabs={[
          { key: 'registry', label: '📋 ทะเบียน' },
          { key: 'layout', label: '🗺️ ผังจัดเก็บ' },
          { key: 'status', label: '📊 สถานะ', badge: moDieCount ? `🔧 ${moDieCount}` : null },
        ]}
        tab={tab} onTab={setTab}
      />

      {tab === 'layout' && (
        <DieLayout
          dies={scopedDies} setsById={setsById} areas={areas} openMos={openMos} products={products}
          canEdit={canEdit} fullName={fullName} ready={layoutReady}
          reload={load} reloadAreas={reloadAreas} patchDieExt={patchDieExt}
          focusDieId={focusDieId} onFocusConsumed={() => setFocusDieId(null)}
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
      {/* สรุป */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {[
          { t: 'ชุดแม่พิมพ์', v: stat.sets },
          { t: 'แม่พิมพ์', v: stat.dies },
          { t: 'ยังไม่ระบุตัน', v: stat.noTon, warn: stat.noTon > 0 },
          { t: 'ชุดที่ข้อมูลไม่ครบ', v: stat.todo, warn: stat.todo > 0 },
        ].map(c => (
          <div key={c.t} style={{
            background: 'var(--card)', border: `1px solid ${c.warn ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
            borderRadius: 10, padding: '8px 14px', minWidth: 110,
          }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{c.t}</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: c.warn ? '#f59e0b' : 'var(--text)' }}>{c.v}</div>
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
            marginTop: 8, background: todoOnly ? '#f59e0b' : 'var(--bg2)', color: todoOnly ? '#111' : 'var(--text)',
            border: '1px solid rgba(245,158,11,0.5)', borderRadius: 8, padding: '5px 12px',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
            {todoOnly ? '✓ กำลังดูเฉพาะที่ต้องแก้' : '🔎 ดูเฉพาะที่ต้องแก้'}
          </button>
        </div>
      )}

      {/* แม่พิมพ์ที่ยังไม่ผูกชุด */}
      {unlinked.length > 0 && (
        <div style={{ ...warnBox, marginBottom: 12 }}>
          <b>🧩 ยังไม่ได้อยู่ชุดไหน ({unlinked.length})</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {unlinked.map(d => (
              <button key={d.id} onClick={() => canEdit && openDie(d)} disabled={!canEdit} title={d.machine_name || ''}
                style={{
                  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '4px 10px', fontSize: 11.5, color: 'var(--text)',
                  cursor: canEdit ? 'pointer' : 'default', maxWidth: 460, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                {d.machine_no}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหา พาร์ท / ชื่อชุด / MAT / เลขแม่พิมพ์"
          style={{ ...inputStyle, width: 280 }} />
        <select value={filterLine} onChange={e => setFilterLine(e.target.value)} style={{ ...inputStyle, width: 190 }}>
          <option value="">ทุกไลน์</option>
          {dieLineNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filterKind} onChange={e => setFilterKind(e.target.value)} style={{ ...inputStyle, width: 200 }}>
          <option value="">ทุกรูปแบบชุด</option>
          {DIE_SET_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        {canEdit && (
          <button onClick={() => setEditSet({ ...emptySet, line_name: filterLine || '' })} style={{ ...saveBtnStyle, padding: '8px 14px' }}>
            + เพิ่มชุด
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
          แสดง {rows.length} ชุด
        </span>
      </div>

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
                  background: 'var(--card)', borderRadius: 10,
                  border: `1px solid ${s.issues.length ? 'rgba(245,158,11,0.45)' : 'var(--border)'}`,
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
                        {' · '}MAT {s.mat_no || <Blank />}
                        {s.model && <> · รุ่น {s.model}</>}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                      background: 'var(--bg3)', color: 'var(--text2)', whiteSpace: 'nowrap',
                    }}>{dieSetKindLabel(s.kind)}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {s.members.length} ตัว{s.op_total ? ` / ${s.op_total} OP` : ''}
                    </span>
                    {s.pieces_per_stroke > 1 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', whiteSpace: 'nowrap' }}
                        title="1 stroke ได้กี่ชิ้น — งานคู่ LH/RH ปั๊มครั้งเดียวได้ 2 ชิ้น">
                        {s.pieces_per_stroke} ชิ้น/stroke
                      </span>
                    )}
                    {s.issues.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', whiteSpace: 'nowrap' }}>
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
                        <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 12, color: '#f59e0b', lineHeight: 1.7 }}>
                          {s.issues.map((t, i) => <li key={i}>{t}</li>)}
                        </ul>
                      )}
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
                          <thead>
                            <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>OP</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>กระบวนการ</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600 }}>เลขแม่พิมพ์</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>ตัน</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>shot สะสม</th>
                              <th style={{ padding: '4px 6px', fontWeight: 600, textAlign: 'right' }}>เจียร</th>
                              {canEdit && <th style={{ width: 40 }} />}
                            </tr>
                          </thead>
                          <tbody>
                            {s.members.map(d => {
                              const e = d.ext || {};
                              const opLabel = opTypes.find(t => t.key === e.op_type)?.label;
                              return (
                                <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td style={{ padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                    {e.op_seq != null ? `OP${e.op_seq}` : <Blank />}
                                  </td>
                                  <td style={{ padding: '5px 6px' }}>{opLabel || e.op_name || <Blank />}</td>
                                  <td style={{ padding: '5px 6px', color: 'var(--muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    title={d.machine_no}>{d.machine_no}</td>
                                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>{e.tonnage_ton ?? <Blank />}</td>
                                  <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--muted)' }}>
                                    {Number(e.shot_total || 0).toLocaleString()}
                                  </td>
                                  <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                                    {e.regrind_count || 0}{e.regrind_limit ? ` / ${e.regrind_limit}` : ''}
                                  </td>
                                  {canEdit && (
                                    <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                                      <button onClick={() => openDie(d)} style={{ ...cancelBtnStyle, padding: '2px 8px', fontSize: 11 }}>✏️</button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {s.note && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>📝 {s.note}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      </>}

      {/* ── modal: ชุดแม่พิมพ์ ── */}
      {editSet && (
        <Modal title={editSet.id ? 'แก้ไขชุดแม่พิมพ์' : 'เพิ่มชุดแม่พิมพ์'} onClose={() => setEditSet(null)}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="ชื่อพาร์ท / ชื่อชุด *">
              <input style={inputStyle} value={editSet.part_name || ''}
                onChange={e => setEditSet(f => ({ ...f, part_name: e.target.value }))} />
            </Field>
            <Field label="เลขพาร์ท (P/N ลูกค้า)">
              <input style={inputStyle} value={editSet.part_no || ''}
                onChange={e => setEditSet(f => ({ ...f, part_no: e.target.value }))} />
            </Field>
            <Field label="MAT SAP" hint="ผูกกับ Product Master">
              <input style={inputStyle} list="die-mat-list" value={editSet.mat_no || ''}
                onChange={e => setEditSet(f => ({ ...f, mat_no: e.target.value }))} />
              <datalist id="die-mat-list">
                {products.filter(p => p.mat_no).map(p => <option key={p.mat_no} value={p.mat_no}>{p.name}</option>)}
              </datalist>
            </Field>
            <Field label="รุ่น / Model">
              <input style={inputStyle} value={editSet.model || ''}
                onChange={e => setEditSet(f => ({ ...f, model: e.target.value }))} />
            </Field>
            <Field label="ไลน์ / กลุ่มเครื่องปั๊ม">
              <input style={inputStyle} list="die-line-list" value={editSet.line_name || ''}
                onChange={e => setEditSet(f => ({ ...f, line_name: e.target.value }))} />
              <datalist id="die-line-list">
                {dieLineNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </Field>
            <Field label="รูปแบบชุด">
              <select style={inputStyle} value={editSet.kind || 'tandem'}
                onChange={e => setEditSet(f => ({ ...f, kind: e.target.value }))}>
                {DIE_SET_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                {DIE_SET_KINDS.find(k => k.key === editSet.kind)?.desc}
              </div>
            </Field>
            <Field label="จำนวน OP ทั้งชุด">
              <input style={inputStyle} type="number" min="1" value={editSet.op_total ?? ''}
                onChange={e => setEditSet(f => ({ ...f, op_total: e.target.value }))} />
            </Field>
            <Field label="ชิ้น / stroke" hint="งานคู่ LH+RH = 2">
              <input style={inputStyle} type="number" min="1" value={editSet.pieces_per_stroke ?? 1}
                onChange={e => setEditSet(f => ({ ...f, pieces_per_stroke: e.target.value }))} />
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
            {editDie.machine_no}
          </div>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="อยู่ชุดไหน">
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
            <Field label="ชิ้น / stroke" hint="ว่าง = ใช้ค่าของชุด">
              <input style={inputStyle} type="number" min="1" value={editDie.pieces_per_stroke ?? ''}
                onChange={e => setEditDie(f => ({ ...f, pieces_per_stroke: e.target.value }))} />
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
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: 18, width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
