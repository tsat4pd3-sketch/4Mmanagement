import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { normMat, baseOfPart } from '../utils/matResolve';
import { fetchByIds } from '../utils/fetchByIds';
import cachedMaster from '../utils/masterCache';
import PageHeader from '../components/PageHeader';
import ReadOnlyNote from '../components/ReadOnlyNote';
import useTabParam from '../utils/useTabParam';
import FixtureClassify from '../components/FixtureClassify';
import FixtureShimPanel from '../components/FixtureShimPanel';
import {
  DEFAULT_POINT_KINDS, resolveFixtureParts, shotsFromPieces,
  shimStack, pointDueStatus, toolLifeStatus, n0,
} from '../utils/fixturePoints';

/* ═══════════════════════════════════════════════════════════════
   🧩 ทะเบียนจิ๊ก/ฟิกเจอร์ + Shim Record — /fixture
   ออกแบบเต็ม + กฎเหล็ก 11 ข้อ: docs/FIXTURE-SHIM-DESIGN.md

   4 แท็บ (useTabParam):
     📋 ทะเบียนจุด — จุดปรับ/จุดอ้างอิงของฟิกเจอร์ + baseline + เกณฑ์ + ความถี่ 2 แกน
     🔧 บันทึกชิม  — งานประจำวันของช่าง (ค่ารวมคือความจริง)
     📊 สถานะ      — จุดที่ถึงกำหนด/ใกล้ตัน ทุกฟิกเจอร์ใน scope
     ⚙️ จัดชนิด    — เฟส 0: ติ๊กเครื่องที่จริงๆ เป็นจิ๊กให้เป็น equipment_kind='jig'

   ⚠️ ตัวตนฟิกเจอร์อยู่ `machines` (equipment_kind='jig') — **ห้ามสร้างทะเบียนใหม่**
      หน้านี้ต่อยอดด้วย fixture_points / fixture_shim_events (pattern เดียวกับ equipment_die)

   ⚠️ shot สะสม = **ค่าประมาณจากยอดผลิตของพาร์ทที่ฟิกเจอร์จับ** ไม่ใช่ตัวนับที่เครื่อง
      ต้องเขียนกำกับบนจอเสมอ · จับคู่พาร์ทไม่ได้ = null (ไม่รู้) ห้ามตีเป็น 0
═══════════════════════════════════════════════════════════════ */

const TABS = [
  { k: 'points',   icon: '📋', label: 'ทะเบียนจุด' },
  { k: 'shim',     icon: '🔧', label: 'บันทึกชิม' },
  { k: 'status',   icon: '📊', label: 'สถานะ' },
  { k: 'classify', icon: '⚙️', label: 'จัดชนิดอุปกรณ์' },
];

const inp = {
  width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 };
const Blank = () => <span style={{ color: '#f59e0b', fontWeight: 700 }} title="ยังไม่ได้กรอก">—</span>;

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

const emptyPoint = {
  id: null, point_no: '', kind_code: 'locator_pin', name: '',
  baseline_shim_mm: '', baseline_at: '', max_shim_mm: '',
  interval_days: '', interval_cycles: '', expected_life_cycles: '', note: '',
};

export default function FixtureRegistry() {
  const { role, lineId: userLineId, sections: scopeSecs, fullName } = useContext(UserContext);
  const canManage = can('fixture_point', 'manage', role);
  const canRecord = can('fixture_shim', 'record', role);
  const canApprove = can('fixture_shim', 'approve', role);
  const canClassify = can('machines', 'edit', role);
  const [tab, setTab] = useTabParam(TABS.map(t => t.k), 'points');

  const [lines, setLines] = useState([]);
  const [machines, setMachines] = useState([]);   // ทุกชนิด (ใช้แท็บจัดชนิด)
  const [jigsShadow, setJigsShadow] = useState([]);
  const [mapKeys, setMapKeys] = useState(() => new Set());
  const [products, setProducts] = useState([]);
  const [kinds, setKinds] = useState(DEFAULT_POINT_KINDS);
  const [points, setPoints] = useState([]);
  const [allPoints, setAllPoints] = useState([]);  // ทุกฟิกเจอร์ (แท็บสถานะ)
  const [loading, setLoading] = useState(true);
  const [dataWarn, setDataWarn] = useState('');
  const [fxId, setFxId] = useState('');
  const [pointId, setPointId] = useState('');
  const [shot, setShot] = useState({ shots: null, assumed: false, note: '' });
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState('');

  // ── โหลด master ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    const warn = [];
    const [ln, mc, jg, mp, pr, kd, fp] = await Promise.all([
      cachedMaster('fx_lines', () => supabase.from('production_lines')
        .select('id, name, section, parent_line_name, is_active').order('name')),
      supabaseDR.from('machines')
        .select('id, machine_no, machine_name, line_name, equipment_kind, equipment_category, is_active, pieces_per_cycle')
        .eq('is_active', true).order('machine_no'),
      supabaseDR.from('jigs').select('id, machine_id, part_no, part_name, line_name'),
      supabase.from('machine_points').select('machine_no'),
      cachedMaster('fx_products', () => supabaseDR.from('dr_products')
        .select('mat_no, p_no, name, line_name, is_active').eq('is_active', true)),
      supabaseDR.from('fixture_point_kinds').select('*').eq('is_active', true).order('sort_order'),
      supabaseDR.from('fixture_points').select('*').eq('is_active', true).order('sort_order'),
    ]);

    if (ln.error) warn.push('ไลน์');
    if (mc.error) warn.push('เครื่องจักร');
    if (pr.error) warn.push('สินค้า');
    if (fp.error) warn.push('ทะเบียนจุด');
    setLines(ln.data || []);
    setMachines(mc.data || []);
    setJigsShadow(jg.data || []);
    setMapKeys(new Set((mp.data || []).map(r => String(r.machine_no ?? '').trim().toUpperCase())));
    setProducts(pr.data || []);
    if (kd.data?.length) setKinds(kd.data);
    setAllPoints(fp.data || []);
    setDataWarn(warn.length ? `โหลดไม่สำเร็จ: ${warn.join(' · ')} — ตัวเลขบางส่วนอาจไม่ครบ` : '');
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── scope (pattern มาตรฐาน) ──────────────────────────────────────────────
  const scopedLines = useMemo(() => {
    if (role === 'leader' && userLineId) {
      const my = lines.find(l => l.id === userLineId);
      const fam = new Set(my ? getLineFamilyNames(lines, my.name) : []);
      const out = lines.filter(l => fam.has(l.name));
      return out.length ? out : lines;
    }
    if (scopeSecs?.length) {
      const out = lines.filter(l => inSectionScope(scopeSecs, l.section));
      return out.length ? out : lines;   // กรองแล้วไม่เหลือ = ไม่กรอง (หน่วยงานสนับสนุนไม่มีไลน์)
    }
    return lines;
  }, [lines, role, userLineId, scopeSecs]);
  const scopeNames = useMemo(() => new Set(scopedLines.map(l => l.name)), [scopedLines]);
  const scopeOn = scopedLines.length !== lines.length;
  const inScope = useCallback((n) => !scopeOn || scopeNames.has(n), [scopeOn, scopeNames]);

  const fixtures = useMemo(
    () => machines.filter(m => m.equipment_kind === 'jig' && inScope(m.line_name)),
    [machines, inScope],
  );
  const shownFixtures = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return kw ? fixtures.filter(f => `${f.machine_no} ${f.machine_name}`.toLowerCase().includes(kw)) : fixtures;
  }, [fixtures, q]);

  const fx = useMemo(() => fixtures.find(f => f.id === fxId) || null, [fixtures, fxId]);
  const shadow = useMemo(() => jigsShadow.find(j => j.machine_id === fxId) || null, [jigsShadow, fxId]);
  const partInfo = useMemo(
    () => resolveFixtureParts(shadow?.part_no, products, { normMat, baseOfPart }),
    [shadow, products],
  );

  // จุดของฟิกเจอร์ที่เลือก
  useEffect(() => {
    setPoints(allPoints.filter(p => p.machine_id === fxId));
    setPointId('');
  }, [allPoints, fxId]);

  // ── shot สะสม (ค่าประมาณจากยอดผลิตของพาร์ทที่จับ) ────────────────────────
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!fx || !partInfo.mats.length) {
        setShot({ shots: null, assumed: false,
                  note: !fx ? '' : partInfo.status === 'empty'
                    ? 'ยังไม่ได้ระบุพาร์ทที่ฟิกเจอร์นี้จับ (ตั้งที่ทะเบียนอุปกรณ์ PM)'
                    : 'จับคู่พาร์ทกับระบบสินค้าไม่ได้ — ยังนับ shot ไม่ได้' });
        return;
      }
      const { rows, error, truncated } = await fetchByIds(
        partInfo.mats,
        (part) => supabaseDR.from('prod_orders')
          .select('mat_no, qty, qty_ok, qty_actual, status')
          .in('mat_no', part).eq('status', 'confirmed'),
      );
      if (dead) return;
      if (error) {
        setShot({ shots: null, assumed: false, note: `นับ shot ไม่ได้: ${error}` });
        return;
      }
      const pieces = rows.reduce((s, o) => s + Number(o.qty_ok ?? o.qty ?? 0), 0);
      const { shots, assumed } = shotsFromPieces(pieces, fx.pieces_per_cycle);
      setShot({
        shots, assumed,
        note: [
          `ประมาณจากยอดผลิต ${pieces.toLocaleString()} ชิ้น`,
          partInfo.status === 'partial' ? '⚠ จับคู่พาร์ทได้บางส่วน' : '',
          truncated ? '⚠ ข้อมูลถูกตัด ยอดอาจต่ำกว่าจริง' : '',
        ].filter(Boolean).join(' · '),
      });
    })();
    return () => { dead = true; };
  }, [fx, partInfo]);

  // ── บันทึกจุด ────────────────────────────────────────────────────────────
  const savePoint = async () => {
    if (!editing || !fx) return;
    const no = editing.point_no.trim();
    if (!no) return toast.error('ต้องมีเลขจุด (ตาม drawing)');
    const payload = {
      machine_id: fx.id, point_no: no, kind_code: editing.kind_code || null,
      name: editing.name.trim() || null,
      baseline_shim_mm: n0(editing.baseline_shim_mm),
      baseline_at: editing.baseline_at || null,
      max_shim_mm: n0(editing.max_shim_mm),
      interval_days: n0(editing.interval_days),
      interval_cycles: n0(editing.interval_cycles),
      expected_life_cycles: n0(editing.expected_life_cycles),
      note: editing.note.trim() || null,
      updated_by_name: fullName || null,
    };
    if (!editing.id && payload.baseline_shim_mm != null && !payload.baseline_at) {
      payload.baseline_at = new Date().toISOString().slice(0, 10);
      payload.baseline_by = fullName || null;
      payload.current_shim_mm = payload.baseline_shim_mm;   // เริ่มต้น = baseline
    }
    const q2 = editing.id
      ? supabaseDR.from('fixture_points').update(payload).eq('id', editing.id).select('id')
      : supabaseDR.from('fixture_points').insert(payload).select('id');
    const { data, error } = await q2;
    if (error) {
      return toast.error(error.code === '23505'
        ? `เลขจุด "${no}" ซ้ำกับจุดที่มีอยู่แล้วในฟิกเจอร์นี้`
        : `บันทึกไม่สำเร็จ: ${error.message}`);
    }
    if (!data?.length) return toast.error('บันทึกไม่สำเร็จ — ไม่มีแถวถูกเขียน');
    toast.success('บันทึกจุดแล้ว');
    setEditing(null);
    load();
  };

  const genTemplate = async () => {
    if (!fx) return;
    const kind = window.prompt(`สร้างจุดจากแม่แบบ — ชนิดจุด:\n${kinds.map(k => k.code).join(' / ')}`, 'locator_pin');
    if (!kind) return;
    const k = kinds.find(x => x.code === kind);
    if (!k) return toast.error('ไม่รู้จักชนิดนี้');
    const nRaw = window.prompt('สร้างกี่จุด?', '6');
    const n = Number(nRaw);
    if (!Number.isFinite(n) || n < 1 || n > 60) return toast.error('จำนวนต้องอยู่ระหว่าง 1–60');
    const prefix = window.prompt('ตัวนำหน้าเลขจุด', kind === 'locator_pin' ? 'L' : 'P') || 'P';

    const exist = new Set(points.map(p => p.point_no));
    const rows = [];
    for (let i = 1; i <= n; i++) {
      const no = `${prefix}${i}`;
      if (exist.has(no)) continue;
      rows.push({
        machine_id: fx.id, point_no: no, kind_code: kind,
        interval_days: k.default_interval_days ?? null,
        interval_cycles: k.default_interval_cycles ?? null,
        expected_life_cycles: k.default_life_cycles ?? null,
        sort_order: i, updated_by_name: fullName || null,
      });
    }
    if (!rows.length) return toast.info('มีจุดเหล่านี้อยู่แล้วทั้งหมด');
    const { data, error } = await supabaseDR.from('fixture_points').insert(rows).select('id');
    if (error) return toast.error(`สร้างไม่สำเร็จ: ${error.message}`);
    toast.success(`สร้าง ${data?.length ?? 0} จุด — อย่าลืมกรอก baseline ของแต่ละจุด`);
    load();
  };

  const copyFrom = async () => {
    if (!fx) return;
    const others = fixtures.filter(f => f.id !== fx.id && allPoints.some(p => p.machine_id === f.id));
    if (!others.length) return toast.error('ยังไม่มีฟิกเจอร์ตัวอื่นที่ลงจุดไว้');
    const pick = window.prompt(
      `คัดลอกชุดจุดจากฟิกเจอร์ไหน? (พิมพ์เลขเครื่อง)\n\n${others.map(o => o.machine_no).join(', ')}`,
      others[0].machine_no,
    );
    const src = others.find(o => o.machine_no === String(pick || '').trim());
    if (!src) return;
    const exist = new Set(points.map(p => p.point_no));
    const rows = allPoints.filter(p => p.machine_id === src.id && !exist.has(p.point_no)).map(p => ({
      machine_id: fx.id, point_no: p.point_no, kind_code: p.kind_code, name: p.name,
      max_shim_mm: p.max_shim_mm, interval_days: p.interval_days,
      interval_cycles: p.interval_cycles, expected_life_cycles: p.expected_life_cycles,
      sort_order: p.sort_order, updated_by_name: fullName || null,
      // ⚠️ ไม่คัดลอก baseline/current — เป็นค่าเฉพาะตัวของฟิกเจอร์แต่ละตัว ต้องวัดเอง
    }));
    if (!rows.length) return toast.info('ไม่มีจุดใหม่ให้คัดลอก');
    const { data, error } = await supabaseDR.from('fixture_points').insert(rows).select('id');
    if (error) return toast.error(`คัดลอกไม่สำเร็จ: ${error.message}`);
    toast.success(`คัดลอก ${data?.length ?? 0} จุด (ไม่รวม baseline — ต้องวัดของตัวเอง)`);
    load();
  };

  const removePoint = async (p) => {
    if (!window.confirm(`ปิดใช้งานจุด ${p.point_no}?\nประวัติชิมยังอยู่ครบ`)) return;
    const { error } = await supabaseDR.from('fixture_points')
      .update({ is_active: false, updated_by_name: fullName || null }).eq('id', p.id);
    if (error) return toast.error(`ลบไม่สำเร็จ: ${error.message}`);
    toast.success('ปิดใช้งานจุดแล้ว');
    load();
  };

  // ── สถานะรวม (แท็บ 📊) ───────────────────────────────────────────────────
  const statusRows = useMemo(() => {
    const byId = new Map(fixtures.map(f => [f.id, f]));
    return allPoints
      .filter(p => byId.has(p.machine_id))
      .map(p => {
        const st = shimStack(p);
        const due = pointDueStatus(p, { nowMs: Date.now() });
        return { p, fx: byId.get(p.machine_id), st, due };
      })
      .filter(r => r.st.level === 'over' || r.st.level === 'warn' || r.due.due || r.due.level === 'soon')
      .sort((a, b) => {
        const rank = (r) => (r.st.level === 'over' ? 0 : r.due.due ? 1 : r.st.level === 'warn' ? 2 : 3);
        return rank(a) - rank(b);
      });
  }, [allPoints, fixtures]);

  const kindMeta = useCallback((c) => kinds.find(k => k.code === c) || { label: c || '—', icon: '•' }, [kinds]);

  return (
    <div style={{ padding: '16px 20px 40px', maxWidth: 1500, margin: '0 auto' }}>
      <PageHeader
        tabs={TABS.map(t => ({ key: t.k, label: `${t.icon} ${t.label}` }))}
        activeTab={tab} onTab={setTab}
      />

      {dataWarn && (
        <div style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.45)',
                      borderRadius: 10, padding: '9px 14px', fontSize: 12.5, marginBottom: 12 }}>
          ⚠️ {dataWarn}
        </div>
      )}

      {/* เลือกฟิกเจอร์ — ใช้ร่วม 2 แท็บแรก */}
      {(tab === 'points' || tab === 'shim') && (
        <div style={{ ...card, marginBottom: 12, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔎 ค้นฟิกเจอร์"
                   style={{ ...inp, width: 200 }} />
            <select value={fxId} onChange={e => setFxId(e.target.value)} style={{ ...inp, width: 340 }}>
              <option value="">— เลือกจิ๊ก / ฟิกเจอร์ ({shownFixtures.length}) —</option>
              {shownFixtures.map(f => (
                <option key={f.id} value={f.id}>
                  {f.machine_no} · {f.machine_name || '—'}{f.line_name ? ` (${f.line_name})` : ''}
                </option>
              ))}
            </select>
            {scopeOn && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>👥 เห็นเฉพาะส่วนงานของคุณ</span>}
          </div>

          {fx && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
              <span>พาร์ทที่จับ: {shadow?.part_no ? <b style={{ color: 'var(--text)' }}>{shadow.part_no}</b> : <Blank />}</span>
              <span>
                shot สะสม: {shot.shots == null
                  ? <span style={{ color: '#f59e0b', fontWeight: 700 }}>ยังนับไม่ได้</span>
                  : <b style={{ color: 'var(--text)' }}>{shot.shots.toLocaleString()}</b>}
                {shot.note && <span style={{ marginLeft: 6 }}>· {shot.note}</span>}
              </span>
              <span>ชิ้นต่อ 1 ครั้ง: {fx.pieces_per_cycle ?? <span style={{ color: '#f59e0b' }}>ยังไม่ตั้ง (ถือว่า 1)</span>}</span>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>กำลังโหลด…</div>
      ) : tab === 'classify' ? (
        <>
          <ReadOnlyNote show={!canClassify} role={role} what="เปลี่ยนชนิดอุปกรณ์" permKey="machines:edit" />
          <FixtureClassify machines={machines} mapKeys={mapKeys} canEdit={canClassify}
                           lines={lines} onSaved={load} />
        </>
      ) : tab === 'status' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            จุดที่ต้องดูแล — เกินเพดานชิม · ถึงกำหนดตรวจ · ใกล้ครบ · จากทุกฟิกเจอร์ในขอบเขตของคุณ
          </div>
          {!statusRows.length ? (
            <div style={{ background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.45)',
                          borderRadius: 10, padding: '14px 16px', fontSize: 13 }}>
              ✅ ไม่มีจุดที่ต้องดูแลตอนนี้
              {!allPoints.length && (
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
                  (ยังไม่มีจุดในทะเบียนเลย — เริ่มที่แท็บ 📋 ทะเบียนจุด)
                </div>
              )}
            </div>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead style={{ background: 'var(--bg2)' }}>
                  <tr style={{ textAlign: 'left' }}>
                    {['ฟิกเจอร์', 'จุด', 'ชิม (รวม/เพดาน)', 'กำหนดตรวจ', 'สิ่งที่ต้องทำ'].map(h =>
                      <th key={h} style={{ padding: '8px 10px' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {statusRows.map(({ p, fx: f, st, due }) => (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 10px' }}>
                        <b>{f.machine_no}</b>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.line_name || '—'}</div>
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        {kindMeta(p.kind_code).icon} {p.point_no}
                      </td>
                      <td style={{ padding: '7px 10px', color: st.level === 'over' ? '#ef4444' : st.level === 'warn' ? '#f59e0b' : 'inherit' }}>
                        {st.current ?? '—'} / {p.max_shim_mm ?? '—'} mm
                      </td>
                      <td style={{ padding: '7px 10px', color: due.due ? '#ef4444' : due.level === 'soon' ? '#f59e0b' : 'var(--muted)' }}>
                        {due.text}
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        {st.level === 'over' ? '🔴 เกินเพดาน — เปิดใบซ่อมเปลี่ยนชิ้นส่วน'
                          : due.due ? '🟠 ถึงกำหนดตรวจ'
                          : st.level === 'warn' ? '🟠 ใกล้เพดานชิม' : '⏳ ใกล้ครบกำหนด'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : !fx ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          เลือกจิ๊ก/ฟิกเจอร์ก่อน
          {!fixtures.length && (
            <div style={{ marginTop: 8, color: '#f59e0b' }}>
              ⚠️ ยังไม่มีอุปกรณ์ที่เป็นชนิด “จิ๊ก / ฟิกเจอร์” ในขอบเขตของคุณ —
              ไปที่แท็บ <b>⚙️ จัดชนิดอุปกรณ์</b> เพื่อติ๊กเครื่องที่จริงๆ เป็นจิ๊กก่อน
            </div>
          )}
        </div>
      ) : tab === 'shim' ? (
        <>
          <ReadOnlyNote show={!canRecord} role={role} what="บันทึกการใส่/ถอดชิม" permKey="fixture_shim:record" />
          <FixtureShimPanel
            points={points} pointId={pointId} onPickPoint={setPointId}
            canRecord={canRecord} canApprove={canApprove} canManage={canManage}
            fullName={fullName} currentShot={shot.shots} shotAssumed={shot.assumed}
            onSaved={load}
          />
        </>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <ReadOnlyNote show={!canManage} role={role} what="จัดการทะเบียนจุด/baseline/เกณฑ์"
                        permKey="fixture_point:manage" />
          {canManage && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => setEditing({ ...emptyPoint })}
                      style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
                               padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                ➕ เพิ่มจุด
              </button>
              <button onClick={genTemplate}
                      style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
                               borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                🧩 สร้างจากแม่แบบ
              </button>
              <button onClick={copyFrom}
                      style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
                               borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                ⧉ คัดลอกจากฟิกเจอร์อื่น
              </button>
            </div>
          )}

          {!points.length ? (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              ยังไม่มีจุดในทะเบียนของฟิกเจอร์ตัวนี้
              {canManage && ' — กด “สร้างจากแม่แบบ” เพื่อเริ่มเร็วที่สุด'}
            </div>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead style={{ background: 'var(--bg2)' }}>
                  <tr style={{ textAlign: 'left' }}>
                    {['จุด', 'ชนิด', 'baseline', 'ปัจจุบัน', 'เพดาน', 'ความถี่ตรวจ', 'อายุชิ้นส่วน', ''].map(h =>
                      <th key={h} style={{ padding: '8px 10px' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {points.map(p => {
                    const st = shimStack(p);
                    const due = pointDueStatus(p, { nowMs: Date.now(), currentShot: shot.shots });
                    const life = toolLifeStatus(p, shot.shots);
                    return (
                      <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 10px', fontWeight: 700 }}>
                          {p.point_no}
                          {p.name && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--muted)' }}>{p.name}</div>}
                        </td>
                        <td style={{ padding: '7px 10px' }}>{kindMeta(p.kind_code).icon} {kindMeta(p.kind_code).label}</td>
                        <td style={{ padding: '7px 10px' }}>{p.baseline_shim_mm ?? <Blank />}</td>
                        <td style={{ padding: '7px 10px',
                                     color: st.level === 'over' ? '#ef4444' : st.level === 'warn' ? '#f59e0b' : 'inherit',
                                     fontWeight: st.level === 'over' || st.level === 'warn' ? 700 : 400 }}>
                          {st.current ?? <Blank />}
                        </td>
                        <td style={{ padding: '7px 10px' }}>
                          {p.max_shim_mm ?? <span style={{ color: 'var(--muted)' }} title="ไม่ตั้ง = ไม่เตือน">ไม่ตั้ง</span>}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 11.5,
                                     color: due.due ? '#ef4444' : due.level === 'soon' ? '#f59e0b' : 'var(--muted)' }}>
                          {due.text}
                        </td>
                        <td style={{ padding: '7px 10px', fontSize: 11.5 }}>
                          {life.pct == null ? <span style={{ color: 'var(--muted)' }}>—</span>
                            : <span style={{ color: life.level === 'over' ? '#ef4444' : life.level === 'warn' ? '#f59e0b' : 'inherit' }}>
                                {Math.round(life.pct)}%
                              </span>}
                        </td>
                        <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                          {canManage && (
                            <>
                              <button onClick={() => setEditing({
                                ...emptyPoint, ...p,
                                baseline_shim_mm: p.baseline_shim_mm ?? '', baseline_at: p.baseline_at ?? '',
                                max_shim_mm: p.max_shim_mm ?? '', interval_days: p.interval_days ?? '',
                                interval_cycles: p.interval_cycles ?? '',
                                expected_life_cycles: p.expected_life_cycles ?? '',
                                name: p.name ?? '', note: p.note ?? '',
                              })}
                                style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
                                         padding: '3px 9px', fontSize: 11.5, cursor: 'pointer', color: 'var(--text)' }}>✏️</button>
                              <button onClick={() => removePoint(p)}
                                style={{ marginLeft: 4, background: 'var(--bg2)', border: '1px solid var(--border)',
                                         borderRadius: 6, padding: '3px 9px', fontSize: 11.5, cursor: 'pointer',
                                         color: 'var(--text)' }}>🚫</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {points.some(p => p.baseline_shim_mm == null) && (
            <div style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.45)',
                          borderRadius: 10, padding: '10px 14px', fontSize: 12.5 }}>
              ⚠️ ยังไม่ได้วัด baseline <b>{points.filter(p => p.baseline_shim_mm == null).length}</b> จุด —
              ถ้าไม่มี baseline ระบบจะตอบได้แค่ “ใส่ชิมไปกี่ครั้ง” แต่ตอบไม่ได้ว่า
              <b> ห่างจากตอนรับมอบเท่าไหร่แล้ว</b> ซึ่งเป็นคำถามที่ลูกค้าถามจริง
            </div>
          )}
        </div>
      )}

      {/* ── modal แก้ไขจุด ── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                        padding: 18, width: 'min(620px,100%)', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>
              {editing.id ? `แก้ไขจุด ${editing.point_no}` : 'เพิ่มจุดใหม่'} · {fx?.machine_no}
            </div>
            <div className="mgrid" style={{ display: 'grid', gap: 10,
                                            gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
              <Field label="เลขจุด (ตาม drawing)" hint="L1, C3, RP2">
                <input value={editing.point_no} onChange={e => setEditing(p => ({ ...p, point_no: e.target.value }))} style={inp} />
              </Field>
              <Field label="ชนิดจุด">
                <select value={editing.kind_code || ''} onChange={e => {
                  const k = kinds.find(x => x.code === e.target.value);
                  setEditing(p => ({
                    ...p, kind_code: e.target.value,
                    // เติมค่าเริ่มต้นของชนิดให้เฉพาะจุดใหม่ที่ยังไม่กรอก (เสนอ — แก้ทับได้)
                    interval_days: p.id || p.interval_days !== '' ? p.interval_days : (k?.default_interval_days ?? ''),
                    interval_cycles: p.id || p.interval_cycles !== '' ? p.interval_cycles : (k?.default_interval_cycles ?? ''),
                    expected_life_cycles: p.id || p.expected_life_cycles !== '' ? p.expected_life_cycles : (k?.default_life_cycles ?? ''),
                  }));
                }} style={inp}>
                  {kinds.map(k => <option key={k.code} value={k.code}>{k.icon} {k.label}</option>)}
                </select>
              </Field>
              <Field label="คำอธิบายจุด" hint="ถ้ามี">
                <input value={editing.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} style={inp} />
              </Field>
              <Field label="baseline (mm)" hint={editing.id ? '⚠️ แก้ = เปลี่ยนจุดอ้างอิง' : 'ค่า ณ วันรับมอบ'}>
                <input value={editing.baseline_shim_mm} inputMode="decimal"
                       onChange={e => setEditing(p => ({ ...p, baseline_shim_mm: e.target.value }))} style={inp} />
              </Field>
              <Field label="วันที่วัด baseline">
                <input type="date" value={editing.baseline_at || ''}
                       onChange={e => setEditing(p => ({ ...p, baseline_at: e.target.value }))} style={inp} />
              </Field>
              <Field label="เพดานชิม (mm)" hint="เว้นว่าง = ไม่เตือน">
                <input value={editing.max_shim_mm} inputMode="decimal"
                       onChange={e => setEditing(p => ({ ...p, max_shim_mm: e.target.value }))} style={inp} />
              </Field>
              <Field label="ตรวจทุกกี่วัน" hint="เว้นว่าง = ตามเช็คลิสต์">
                <input value={editing.interval_days} inputMode="numeric"
                       onChange={e => setEditing(p => ({ ...p, interval_days: e.target.value }))} style={inp} />
              </Field>
              <Field label="ตรวจทุกกี่ shot" hint="เว้นว่าง = ไม่ใช้แกนนี้">
                <input value={editing.interval_cycles} inputMode="numeric"
                       onChange={e => setEditing(p => ({ ...p, interval_cycles: e.target.value }))} style={inp} />
              </Field>
              <Field label="อายุชิ้นส่วน (shot)" hint="tool life — ปรับได้เมื่อมีประวัติจริง">
                <input value={editing.expected_life_cycles} inputMode="numeric"
                       onChange={e => setEditing(p => ({ ...p, expected_life_cycles: e.target.value }))} style={inp} />
              </Field>
              <Field label="หมายเหตุ">
                <input value={editing.note} onChange={e => setEditing(p => ({ ...p, note: e.target.value }))} style={inp} />
              </Field>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.6 }}>
              • ไม่ตั้งเพดาน = ระบบจะไม่เตือนเรื่องชิมของจุดนี้ (ตั้งทีหลังได้เมื่อมีข้อมูลพอ)<br />
              • ไม่ตั้งความถี่ทั้ง 2 แกน = ใช้ความถี่ของเช็คลิสต์ PM เหมือนเดิม
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)}
                      style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)',
                               borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={savePoint}
                      style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
                               padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>บันทึก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
