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
import { unitParentId, nodeMap, isUpperKind, UPPER_META } from '../utils/orgLayers.js';   // 🏢 แม่ที่เป็นหน่วย + ป้ายชั้นบน (04/11 · 20/11)
import { supabase } from '../supabaseClient';
import { checkWriteRows } from '../utils/dbWrite';
import { toast } from './Toast';
import { buildCcIndex } from '../utils/ccScope';
import { ORG_PARENT_KIND, orgSaveBlockReason, filterParentOptions } from '../utils/orgNodeEdit';
import { orgNodeCompare } from '../utils/listOrder';
import SearchInput from './SearchInput';
import { tr } from '../utils/i18n';
import { printOrgChart } from '../lib/orgChartPrint';   // 🖨️ ใบผังองค์กร FM-HRM-I-001

/** ชั้นในผัง ↔ "เลเวล" ที่โรงงานใช้ (= หลักที่ 5 ของรหัส CC · ดู utils/roleMeta.js ORG_LEVELS)
 *  🔴 ป้ายอ่านอย่างเดียว — ระบบไม่เคยตัดสินชั้นจากตัวเลข */
const KIND_META = {
  section:    { th: 'ส่วนงาน', icon: '🏢', level: 4, color: '#4d9fff' },
  department: { th: 'แผนก',    icon: '🏭', level: 5, color: '#22c55e' },
  line:       { th: 'กลุ่ม',    icon: '▦',  level: 6, color: '#f59e0b' },
  /* 🏢 ชั้นบน เลเวล 0–3 (20/11) — ป้าย/เลเวลมาจาก UPPER_META ที่เดียว · ไม่มีรหัส CC (ใช้รหัส SAP ใน `code`) */
  ...Object.fromEntries(Object.entries(UPPER_META).map(([k, m]) => [k, { ...m, color: 'var(--purple)' }])),
};

/* 🔴 "ทีม" ไม่ใช่ชั้นในผังองค์กรจริง (22/10 · คำสั่ง user: *"ระดับ team คือไว้ set กะ การทำงาน
   ไม่มีอยู่ใน organize จริง"*) — ยืนยันจากข้อมูล: ทีมทั้ง 24 แถว **ไม่มี cost_center เลยสักตัว**
   และไม่มีในใบ ORG-001/ORG-015 ที่ HR ออกจริง
   ⇒ มุมมองผัง + ใบ export ตัดทีมออก · ทีมยังอยู่ใน `org_nodes` และจัดการที่แท็บ "จัดการหน่วยงาน"
     เพราะ `useOrgTeams()` อ่านไปทำลิสต์กะทั้งระบบ — **ห้ามลบแถวทีมทิ้ง**
   🔴 กฎความซื่อสัตย์ของจอ: กรองออกแล้วต้องเขียนบนจอว่าซ่อนไปกี่รายการ ห้ามหายเงียบ */
const ORG_KINDS = ['section', 'department', 'line'];   // 🏢 ชั้นบน (plant/company) ไม่อยู่ในผังโรงงาน — orgLayers.UNIT_KINDS

export default function OrgTreeView({ nodes = [], scopeCtx = {}, canEdit = false, onChanged }) {
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [empCount, setEmpCount] = useState(null);   // null = ยังไม่โหลด (ห้ามโชว์ 0 ตอนไม่รู้)
  const [moving, setMoving] = useState(null);       // id ของโหนดที่กำลังเลือกปลายทาง
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

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

  /* ผังองค์กรจริง = ส่วนงาน/แผนก/กลุ่ม เท่านั้น (ดูคอมเมนต์ที่ ORG_KINDS) */
  const orgNodes = useMemo(() => nodes.filter(n => ORG_KINDS.includes(n.kind)), [nodes]);
  /* 🏢 ชั้นบน (Group → SPG → Company → Plant) วาดเป็นหัวสายเหนือส่วนงาน (20/11) — เฉพาะที่เปิดใช้ */
  const upperNodes = useMemo(() => nodes.filter(n => isUpperKind(n.kind) && n.is_active !== false), [nodes]);
  const treeNodes = useMemo(() => [...upperNodes, ...orgNodes], [upperNodes, orgNodes]);
  /* 🔴 นับเฉพาะ kind='team' — เดิมเป็น `nodes.length - orgNodes.length` = นับชั้นบนเป็นทีมด้วย */
  const teamCount = nodes.filter(n => n.kind === 'team').length;

  const ccIdx = useMemo(() => buildCcIndex(nodes), [nodes]);
  const kids = useMemo(() => {
    const m = new Map();
    treeNodes.forEach(n => {
      const k = n.parent_id || '__root__';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(n);
    });
    m.forEach(arr => arr.sort(orgNodeCompare));
    return m;
  }, [treeNodes]);

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
    treeNodes.forEach(n => walk(n.id));
    return memo;
  }, [empCount, kids, treeNodes]);

  /* ค้นหา: โชว์โหนดที่ตรง + บรรพบุรุษของมัน (ไม่งั้นกิ่งขาด อ่านไม่รู้เรื่อง) */
  const matchSet = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return null;
    const byId = new Map(treeNodes.map(n => [n.id, n]));
    const keep = new Set();
    treeNodes.forEach(n => {
      const hay = [n.name, n.code, n.cost_center].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(kw)) return;
      let cur = n;
      while (cur) { keep.add(cur.id); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
    });
    return keep;
  }, [q, treeNodes]);

  const roots = useMemo(() => {
    const byId = nodeMap(nodes);   // ผังทั้งต้น (รวมชั้นบน) — "ลอย" = ไม่มีแม่ที่เป็นหน่วย
    /* อยู่ใต้ชั้นบนที่วาดอยู่ = วาดผ่านสายของชั้นบนแล้ว (ห้ามวาดซ้ำที่ราก) */
    const upIds = new Set(upperNodes.map(n => String(n.id)));
    const underUpper = (n) => n.parent_id != null && upIds.has(String(n.parent_id));
    const uppers = upperNodes.filter(n => !underUpper(n));
    const secs = orgNodes.filter(n => n.kind === 'section' && !underUpper(n));
    const floats = orgNodes.filter(n => n.kind !== 'section' && unitParentId(n, byId) == null && !underUpper(n));
    return { uppers: [...uppers].sort(orgNodeCompare), secs: [...secs].sort(orgNodeCompare), floats: [...floats].sort(orgNodeCompare) };
  }, [orgNodes, upperNodes, nodes]);

  /* 🔒 สลับ "ขอบเขตของหน่วยแม่ครอบหน่วยนี้ไหม" — ผังยังโชว์ใต้แม่เหมือนเดิม
     (22/10 · user: "องค์กรเรามันแปลกตรงเอาจิ๊กมาฝากกับผลิต") */
  const toggleInherit = async (node) => {
    const next = node.inherit_scope === false;   // false → เปิดคืน · true/null → ปิด
    const why = orgSaveBlockReason({ kind: node.kind, parentId: node.parent_id, editing: node }, scopeCtx);
    if (why) { toast.error(why); return; }
    setBusy(true);
    const ok = checkWriteRows(await supabase.from('org_nodes').update({ inherit_scope: next }).eq('id', node.id).select('id'), `${tr("ตั้งการตกทอดสิทธิ์ของ")} ${node.name}`);
    setBusy(false);
    if (!ok) return;
    toast.success(next ? `${node.name}: ${tr("สิทธิ์ตกทอดจากหน่วยแม่ตามปกติ")}` : `${node.name}: ${tr("หน่วยแม่จะไม่มีสิทธิ์แก้ข้อมูลหน่วยนี้")}`);
    onChanged?.();
  };

  const doMove = async (node, parentId) => {
    const why = orgSaveBlockReason({ kind: node.kind, parentId, editing: node }, scopeCtx);
    if (why) { toast.error(why); return; }
    setBusy(true);
    const ok = checkWriteRows(await supabase.from('org_nodes').update({ parent_id: parentId || null }).eq('id', node.id).select('id'), `${tr("ย้าย")} ${node.name}`);
    setBusy(false);
    if (!ok) return;
    toast.success(`${tr("ย้าย")} ${node.name} ${tr("แล้ว")}`);
    setMoving(null);
    onChanged?.();
  };

  /* 🖨️ ออกใบผังองค์กรตามฟอร์มจริง — ผังใหญ่ = ทั้งโรงงาน · ผังย่อย = กางเฉพาะหน่วยที่เลือก
     เปิดหน้าต่างพิมพ์ไม่ได้ = ต้องบอก ห้ามเงียบ (ส่วนใหญ่คือ popup ถูกบล็อก) */
  const doPrint = async (opts) => {
    setPrinting(true);
    try {
      const ok = await printOrgChart({ ...opts, nodes });
      if (!ok) toast.error('เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป๊อปอัป ให้อนุญาตแล้วลองใหม่');
    } catch (e) {
      toast.error(`${tr("ออกใบผังไม่สำเร็จ")}: ${e?.message || e}`);
    }
    setPrinting(false);
  };

  const Row = ({ n, depth }) => {
    if (matchSet && !matchSet.has(n.id)) return null;
    if (n.is_active === false && !showOff) return null;
    const meta = KIND_META[n.kind] || { th: n.kind, icon: '•', level: null, color: 'var(--muted)' };
    if (isUpperKind(n.kind)) {
      /* ชั้นบน: อ่านอย่างเดียว · ไม่มี CC/ย้าย/ตกทอด (การตกทอดทุกชนิดหยุดที่ชั้นบน — orgLayers.js) */
      const up = deepCount?.get(n.id);
      return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
            padding: '5px 8px', marginLeft: depth * 22, borderLeft: depth ? '2px solid var(--border2)' : 'none',
            background: 'var(--bg3)', borderRadius: 'var(--r-md)', marginBottom: 2 }}>
            <span style={{ fontSize: 13 }}>{meta.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{n.name}</span>
            {n.code && n.code !== n.name && (
              <span title={tr('รหัสในทะเบียนกลุ่ม (SAP / Com Code)')} style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>({n.code})</span>
            )}
            {/* สีเป็น token (var) ⇒ ต่อท้าย alpha แบบป้ายชั้นหน่วยไม่ได้ — ใช้กรอบเส้นแทน */}
            <span style={{ fontSize: 11, fontWeight: 700, padding: '0 6px', borderRadius: 'var(--r-xs)',
              color: meta.color, border: `1px solid ${meta.color}` }}>
              {tr(meta.th)} · {tr("เลเวล")} {meta.level}
            </span>
            {deepCount === null
              ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>👤 …</span>
              : up > 0 && <span title={tr('จำนวนพนักงานทั้งสาย (รวมหน่วยลูก)')} style={{ fontSize: 11, color: 'var(--text2)' }}>{up}</span>}
          </div>
          {(kids.get(n.id) || []).map(k => <Row key={k.id} n={k} depth={depth + 1} />)}
        </>
      );
    }
    const cc = ccIdx.ccOfNode(n.id);
    const inherited = cc?.cc && cc?.from && cc.from.id !== n.id;
    const kidRows = (kids.get(n.id) || []);
    const cnt = deepCount?.get(n.id);
    const parentKind = ORG_PARENT_KIND[n.kind];
    const parentOpts = parentKind
      ? filterParentOptions(n.kind, orgNodes.filter(x => x.kind === parentKind && x.is_active !== false), scopeCtx)
      : null;
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
          padding: '5px 8px', marginLeft: depth * 22, borderLeft: depth ? '2px solid var(--border2)' : 'none',
          background: (depth === 0 || n.kind === 'section') ? 'var(--bg3)' : 'transparent', borderRadius: 'var(--r-md)', marginBottom: 2,
          opacity: n.is_active === false ? 0.55 : 1 }}>
          <span style={{ fontSize: 13 }}>{meta.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{n.name}</span>
          {n.code && n.code !== n.name && (
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>({n.code})</span>
          )}
          <span style={{ fontSize: 11, fontWeight: 700, padding: '0 6px', borderRadius: 'var(--r-xs)',
            background: `${meta.color}1f`, color: meta.color, border: `1px solid ${meta.color}55` }}>
            {tr(meta.th)}{meta.level ? ` · ${tr("เลเวล")} ${meta.level}` : ''}
          </span>
          {cc?.cc ? (
            <span title={inherited ? `${tr("ตกทอดจาก")} ${cc.from?.name || tr('หน่วยแม่')}` : tr("รหัสของหน่วยนี้เอง")}
              style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                color: inherited ? 'var(--muted)' : '#22c55e' }}>
              {cc.cc}{inherited ? tr(" · ตกทอด") : ''}
            </span>
          ) : (
            <span title={tr('ไม่มีรหัส Cost Center ทั้งสาย — ตั้งที่หน่วยนี้หรือหน่วยแม่')}
              style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>{tr('⚠ ไม่มีรหัส CC')}</span>
          )}
          {deepCount === null
            ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>👤 …</span>
            : cnt > 0 && <span title={tr('จำนวนพนักงานทั้งสาย (รวมหน่วยลูก)')} style={{ fontSize: 11, color: 'var(--text2)' }}>{cnt}</span>}
          {n.is_active === false && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444' }}>{tr('⛔ ปิดใช้งาน')}</span>}
          {n.inherit_scope === false && (
            <span title={tr('อยู่ใต้หน่วยแม่ในผัง แต่ขอบเขตสิทธิ์ของหน่วยแม่ไม่ครอบหน่วยนี้ (เช่น หน่วยที่มาฝากไว้)')}
              style={{ fontSize: 11, fontWeight: 700, color: '#a855f7' }}>{tr('ไม่ตกทอดสิทธิ์')}</span>
          )}
          {unitParentId(n, nodes) == null && n.kind !== 'section' && (
            <span title={tr('ไม่มีหน่วยแม่ในผัง — ลำดับชั้น/รหัสจะตกทอดไม่ได้')}
              style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>{tr('ไม่มีหน่วยแม่')}</span>
          )}
          {canEdit && parentKind && (
            moving === n.id ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <select disabled={busy} defaultValue={n.parent_id || ''}
                  onChange={e => doMove(n, e.target.value)} style={{ width: 'auto', fontSize: 12 }}>
                  <option value="">{tr('— เลือกหน่วยแม่ —')}</option>
                  {parentOpts.rows.map(o => <option key={o.id} value={o.id}>{tr(o.name)}</option>)}
                </select>
                {parentOpts.hidden > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('ซ่อน')} {parentOpts.hidden} {tr('หน่วยนอกขอบเขตคุณ')}</span>
                )}
                <button type="button" className="tbtn" onClick={() => setMoving(null)}
                  style={{ fontSize: 11, padding: '2px 8px' }}>{tr('ยกเลิก')}</button>
              </span>
            ) : (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                {(n.kind === 'section' || n.kind === 'department') && (
                  <button type="button" className="tbtn" onClick={() => doPrint({ mode: 'dept', rootId: n.id })}
                    disabled={printing} title={tr('ออกใบผังองค์กรเฉพาะหน่วยนี้ (กางถึงกลุ่ม + รายชื่อ)')}
                    style={{ fontSize: 11, padding: '2px 8px' }}>{tr('ผังย่อย')}</button>
                )}
                {n.parent_id && (
                  <button type="button" className="tbtn" onClick={() => toggleInherit(n)} disabled={busy}
                    title={n.inherit_scope === false
                      ? tr("ให้ขอบเขตของหน่วยแม่ครอบหน่วยนี้ตามปกติ")
                      : tr("หน่วยนี้มาฝากไว้ใต้หน่วยแม่ — ไม่ให้หน่วยแม่มีสิทธิ์แก้ข้อมูล")}
                    style={{ fontSize: 11, padding: '2px 8px' }}>
                    {n.inherit_scope === false ? tr('🔓 ให้ตกทอด') : tr('🔒 ไม่ตกทอด')}
                  </button>
                )}
                <button type="button" className="tbtn" onClick={() => setMoving(n.id)} disabled={busy}
                  style={{ fontSize: 11, padding: '2px 8px' }}>{tr('↕ ย้าย')}</button>
              </span>
            )
          )}
        </div>
        {kidRows.map(k => <Row key={k.id} n={k} depth={depth + 1} />)}
      </>
    );
  };

  const offCount = orgNodes.filter(n => n.is_active === false).length;
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <SearchInput value={q} onChange={setQ} fields={tr("ชื่อหน่วย / รหัส / CC")} />
        <button type="button" className="tbtn" onClick={() => doPrint({ mode: 'overall' })} disabled={printing}
          title={tr('ออกใบแผนผังองค์กรทั้งโรงงาน (ฝ่าย → ส่วน → แผนก) ตามฟอร์ม FM-HRM-I-001')}
          style={{ fontSize: 12, padding: '3px 10px' }}>{tr('ผังใหญ่ (ทั้งโรงงาน)')}</button>
        <label style={{ fontSize: 12, color: 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} style={{ margin: 0 }} />
          {tr('โชว์ที่ปิดใช้งาน (')}{offCount})
        </label>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto', lineHeight: 1.5 }}>
          {tr("ลำดับชั้นมาจากผัง (หน่วยแม่) ไม่ใช่ตัวเลขรหัส · เทา = ตกทอดจากหน่วยแม่")}
        </span>
      </div>
      {/* 🔴 ห้ามซ่อนเงียบ — บอกตรงๆ ว่าตัดอะไรออกและของนั้นไปอยู่ไหน */}
      {teamCount > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text2)', marginBottom: 6 }}>
          {tr("ไม่นับทีม")} {teamCount} {tr('รายการ —')} <b>{tr('ทีม A/B/C ใช้จัดกะการทำงาน ไม่ใช่ชั้นในผังองค์กร')}</b>
          {' '}({tr("จัดการที่แท็บ “จัดการหน่วยงาน")}”)
        </div>
      )}
      {empCount === undefined && (
        <div style={{ fontSize: 11.5, color: '#f59e0b', marginBottom: 6 }}>
          ⚠ {tr("อ่านจำนวนพนักงานไม่สำเร็จ — ตัวเลข 👤 จะไม่ขึ้น (ไม่ได้แปลว่าหน่วยนั้นไม่มีคน")})
        </div>
      )}
      <div style={{ display: 'grid', alignContent: 'start', gap: 2 }}>
        {roots.uppers.map(n => <Row key={n.id} n={n} depth={0} />)}
        {roots.secs.map(n => <Row key={n.id} n={n} depth={0} />)}
        {roots.floats.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', marginTop: 10 }}>
              {tr("หน่วยที่ยังไม่มีหน่วยแม่")} ({roots.floats.length})
              <span style={{ fontWeight: 400, color: 'var(--muted)' }}> {tr('— ตกทอดรหัส/ขอบเขตจากใครไม่ได้ ควรย้ายเข้าสาย')}</span>
            </div>
            {roots.floats.map(n => <Row key={n.id} n={n} depth={0} />)}
          </>
        )}
      </div>
    </div>
  );
}
