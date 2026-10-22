/* 🌳 มุมมองผังองค์กรแบบต้นไม้ — "หน่วยไหนอยู่ใต้หน่วยไหน · รหัส CC ซ้อนกันยังไง"  2026-10-22
 *
 * ที่มา (คำสั่ง user): *"ผังองค์กรจะเป็นตัวบอกว่าหน่วยงานไหนอยู่ level ไหน … ต้องคล้ายๆ BOM มั้ย
 * จะได้เห็นชัดว่าคอสไหนอยู่ใต้คอสไหน"* + *"เราอยากมีหน้าวาดผังอะ"*
 *
 * จอเดิม (`/org-setup`) วาดเป็น 4 คอลัมน์แยก (ส่วน | แผนก | กลุ่ม | ทีม) ⇒ เห็นทีละชั้น
 * ไม่เห็นภาพรวมว่าสายไหนต่อกับสายไหน และไม่เห็นรหัส CC ซ้อนชั้นเลย
 *
 * 🔴 กฎที่ยึดในไฟล์นี้
 *   · ลำดับชั้น = `org_nodes.parent_id` เท่านั้น — **ห้ามแกะเลขรหัสมาเดาชั้น** (กฎเหล็ก CLAUDE.md)
 *   · รหัส CC ของโหนดที่ไม่ได้กรอกเอง = **ตกทอดจากแม่** ผ่าน `buildCcIndex().ccOfNode()` (ของกลาง)
 *   · ย้ายหน่วย = เขียน DB จริง ⇒ ต้องผ่านด่านชั้นที่ 3 (`orgSaveBlockReason`) + นับแถวที่เขียน
 *   · ของที่ "ผิดรูป" (ลอย/ไม่มีรหัส/ปิดใช้งาน) **ต้องเห็นบนจอ ห้ามซ่อน** (กฎความซื่อสัตย์ของจอ)
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { checkWriteRows } from '../utils/dbWrite';
import { toast } from './Toast';
import { buildCcIndex } from '../utils/ccScope';
import { ORG_PARENT_KIND, orgSaveBlockReason, filterParentOptions } from '../utils/orgNodeEdit';
import { orgNodeCompare } from '../utils/listOrder';
import SearchInput from './SearchInput';

/** ชั้นในผัง ↔ "เลเวล" ที่โรงงานใช้ (= หลักที่ 5 ของรหัส CC · ดู utils/roleMeta.js ORG_LEVELS)
 *  🔴 ป้ายอ่านอย่างเดียว — ระบบไม่เคยตัดสินชั้นจากตัวเลข */
const KIND_META = {
  section:    { th: 'ส่วนงาน', icon: '🏢', level: 4, color: '#4d9fff' },
  department: { th: 'แผนก',    icon: '🏭', level: 5, color: '#22c55e' },
  line:       { th: 'กลุ่ม',    icon: '▦',  level: 6, color: '#f59e0b' },
  team:       { th: 'ทีม',     icon: '👥', level: null, color: 'var(--muted)' },
};

export default function OrgTreeView({ nodes = [], scopeCtx = {}, canEdit = false, onChanged }) {
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [empCount, setEmpCount] = useState(null);   // null = ยังไม่โหลด (ห้ามโชว์ 0 ตอนไม่รู้)
  const [moving, setMoving] = useState(null);       // id ของโหนดที่กำลังเลือกปลายทาง
  const [busy, setBusy] = useState(false);

  /* 👤 จำนวนคนต่อหน่วย — ดึงแค่คอลัมน์เดียว (egress: 250 แถว ≈ ไม่กี่ KB) */
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.from('employees').select('org_node_id').eq('is_active', true);
      if (!alive) return;
      if (error) { setEmpCount(undefined); return; }   // undefined = อ่านไม่ได้ (จอต้องเขียนบอก)
      const m = new Map();
      (data || []).forEach(r => { if (r.org_node_id) m.set(r.org_node_id, (m.get(r.org_node_id) || 0) + 1); });
      setEmpCount(m);
    })();
    return () => { alive = false; };
  }, []);

  const ccIdx = useMemo(() => buildCcIndex(nodes), [nodes]);
  const kids = useMemo(() => {
    const m = new Map();
    nodes.forEach(n => {
      const k = n.parent_id || '__root__';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(n);
    });
    m.forEach(arr => arr.sort(orgNodeCompare));
    return m;
  }, [nodes]);

  /** นับคนทั้งสาย (ตัวเอง + ลูกหลาน) — `null` = ยังไม่รู้ */
  const deepCount = useMemo(() => {
    if (!(empCount instanceof Map)) return null;
    const memo = new Map();
    const walk = (id) => {
      if (memo.has(id)) return memo.get(id);
      const own = empCount.get(id) || 0;
      const sum = (kids.get(id) || []).reduce((a, c) => a + walk(c.id), own);
      memo.set(id, sum);
      return sum;
    };
    nodes.forEach(n => walk(n.id));
    return memo;
  }, [empCount, kids, nodes]);

  /* ค้นหา: โชว์โหนดที่ตรง + บรรพบุรุษของมัน (ไม่งั้นกิ่งขาด อ่านไม่รู้เรื่อง) */
  const matchSet = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return null;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const keep = new Set();
    nodes.forEach(n => {
      const hay = [n.name, n.code, n.cost_center].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(kw)) return;
      let cur = n;
      while (cur) { keep.add(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
    });
    return keep;
  }, [q, nodes]);

  const roots = useMemo(() => {
    const secs = nodes.filter(n => n.kind === 'section');
    const floats = nodes.filter(n => n.kind !== 'section' && !n.parent_id);
    return { secs: [...secs].sort(orgNodeCompare), floats: [...floats].sort(orgNodeCompare) };
  }, [nodes]);

  const doMove = async (node, parentId) => {
    const why = orgSaveBlockReason({ kind: node.kind, parentId, editing: node }, scopeCtx);
    if (why) { toast.error(why); return; }
    setBusy(true);
    const ok = checkWriteRows(await supabase.from('org_nodes').update({ parent_id: parentId || null }).eq('id', node.id).select('id'), `ย้าย ${node.name}`);
    setBusy(false);
    if (!ok) return;
    toast.success(`ย้าย ${node.name} แล้ว`);
    setMoving(null);
    onChanged?.();
  };

  const Row = ({ n, depth }) => {
    if (matchSet && !matchSet.has(n.id)) return null;
    if (n.is_active === false && !showOff) return null;
    const meta = KIND_META[n.kind] || KIND_META.team;
    const cc = ccIdx.ccOfNode(n.id);
    const inherited = cc?.cc && cc?.from && cc.from.id !== n.id;
    const kidRows = (kids.get(n.id) || []);
    const cnt = deepCount?.get(n.id);
    const parentKind = ORG_PARENT_KIND[n.kind];
    const parentOpts = parentKind
      ? filterParentOptions(n.kind, nodes.filter(x => x.kind === parentKind && x.is_active !== false), scopeCtx)
      : null;
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
          padding: '5px 8px', marginLeft: depth * 22, borderLeft: depth ? '2px solid var(--border2)' : 'none',
          background: depth === 0 ? 'var(--bg3)' : 'transparent', borderRadius: 7, marginBottom: 2,
          opacity: n.is_active === false ? 0.55 : 1 }}>
          <span style={{ fontSize: 13 }}>{meta.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{n.name}</span>
          {n.code && n.code !== n.name && (
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>({n.code})</span>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, padding: '0 6px', borderRadius: 5,
            background: `${meta.color}1f`, color: meta.color, border: `1px solid ${meta.color}55` }}>
            {meta.th}{meta.level ? ` · เลเวล ${meta.level}` : ''}
          </span>
          {cc?.cc ? (
            <span title={inherited ? `ตกทอดจาก ${cc.from?.name || 'หน่วยแม่'}` : 'รหัสของหน่วยนี้เอง'}
              style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                color: inherited ? 'var(--muted)' : '#22c55e' }}>
              💰 {cc.cc}{inherited ? ' · ตกทอด' : ''}
            </span>
          ) : (
            <span title="ไม่มีรหัส Cost Center ทั้งสาย — ตั้งที่หน่วยนี้หรือหน่วยแม่"
              style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>⚠ ไม่มีรหัส CC</span>
          )}
          {deepCount === null
            ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>👤 …</span>
            : cnt > 0 && <span title="จำนวนพนักงานทั้งสาย (รวมหน่วยลูก)" style={{ fontSize: 11, color: 'var(--text2)' }}>👤 {cnt}</span>}
          {n.is_active === false && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}>⛔ ปิดใช้งาน</span>}
          {!n.parent_id && n.kind !== 'section' && (
            <span title="ไม่มีหน่วยแม่ในผัง — ลำดับชั้น/รหัสจะตกทอดไม่ได้"
              style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>🚩 ไม่มีหน่วยแม่</span>
          )}
          {canEdit && parentKind && (
            moving === n.id ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <select disabled={busy} defaultValue={n.parent_id || ''}
                  onChange={e => doMove(n, e.target.value)} style={{ width: 'auto', fontSize: 12 }}>
                  <option value="">— เลือกหน่วยแม่ —</option>
                  {parentOpts.rows.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                {parentOpts.hidden > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>ซ่อน {parentOpts.hidden} หน่วยนอกขอบเขตคุณ</span>
                )}
                <button type="button" className="tbtn" onClick={() => setMoving(null)}
                  style={{ fontSize: 11, padding: '2px 8px' }}>ยกเลิก</button>
              </span>
            ) : (
              <button type="button" className="tbtn" onClick={() => setMoving(n.id)} disabled={busy}
                style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}>↕ ย้าย</button>
            )
          )}
        </div>
        {kidRows.map(k => <Row key={k.id} n={k} depth={depth + 1} />)}
      </>
    );
  };

  const offCount = nodes.filter(n => n.is_active === false).length;
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <SearchInput value={q} onChange={setQ} fields="ชื่อหน่วย / รหัส / CC" />
        <label style={{ fontSize: 12, color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} style={{ margin: 0 }} />
          โชว์ที่ปิดใช้งาน ({offCount})
        </label>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto', lineHeight: 1.5 }}>
          ลำดับชั้นมาจากผัง (หน่วยแม่) ไม่ใช่ตัวเลขรหัส · 💰 เทา = ตกทอดจากหน่วยแม่
        </span>
      </div>
      {empCount === undefined && (
        <div style={{ fontSize: 11.5, color: '#f59e0b', marginBottom: 6 }}>
          ⚠ อ่านจำนวนพนักงานไม่สำเร็จ — ตัวเลข 👤 จะไม่ขึ้น (ไม่ได้แปลว่าหน่วยนั้นไม่มีคน)
        </div>
      )}
      <div style={{ display: 'grid', alignContent: 'start', gap: 2 }}>
        {roots.secs.map(n => <Row key={n.id} n={n} depth={0} />)}
        {roots.floats.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', marginTop: 10 }}>
              🚩 หน่วยที่ยังไม่มีหน่วยแม่ ({roots.floats.length})
              <span style={{ fontWeight: 400, color: 'var(--muted)' }}> — ตกทอดรหัส/ขอบเขตจากใครไม่ได้ ควรย้ายเข้าสาย</span>
            </div>
            {roots.floats.map(n => <Row key={n.id} n={n} depth={0} />)}
          </>
        )}
      </div>
    </div>
  );
}
