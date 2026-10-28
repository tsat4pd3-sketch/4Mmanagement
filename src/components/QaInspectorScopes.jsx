/* ══ 🔬 QaInspectorScopes — "QC ประจำไลน์" (แท็บใน /qa-setup?tab=inspectors · 2026-10-27) ═══
 *
 * > คำสั่ง user 26/10: *"QA ที่มาอยู่กับผลิต คือต้องอยู่ส่วน QA แต่หน้างาน ตรวจคุณภาพให้ไลน์ไหน
 * >  ไม่ควรขึ้นกับผลิตรึป่าว"* → ใช่ · และ *"QA ต้องเห็นทั้งโรงงานในเรื่องของคุณภาพ"*
 *
 * เดิม "ตรวจให้ไลน์ไหน" ถูกยัดไว้ใน `profiles.sections` (ช่อง**ขอบเขตที่เห็น**) และ
 * `profiles.section` ของ QC 13 คนถูกตั้งเป็น `PD3` (ฝ่ายผลิต) ทั้งที่สังกัดจริงคือ QA
 * ⇒ แยกออกมาเป็นแกนที่ 3 ที่ `qa_inspector_scopes` — กฎอยู่ที่ `src/utils/qaScope.js`
 *
 * 🔴 **อ้างอิงเท่านั้น** — ไม่ย้ายสังกัด · ไม่แตะ cost center · **ไม่นับเป็นกำลังคนของไลน์**
 * 🔴 **ไม่ใช่ด่านสิทธิ์** — role `qa` ถือ `scope:all_units` อยู่แล้ว (ตั้งใจ ตามคำสั่ง user)
 * โครงจอ = ชุดเดียวกับ "คนวิ่งข้ามแผนก" ใน `ManpowerBoardSetup` (หน่วยเป็นแถว · PersonSelect ต่อท้าย)
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { checkWriteRows } from '../utils/dbWrite';
import { orgNodeCompare } from '../utils/listOrder';
import { positionLabel } from '../utils/positions';
import PersonSelect from './PersonSelect';
import { DeleteButton } from './IconButton';

const KIND_TH = { section: 'ส่วนงาน', department: 'แผนก', line: 'กลุ่ม/ไลน์' };

export default function QaInspectorScopes({ canManage = false }) {
  const [nodes, setNodes] = useState([]);
  const [emps,  setEmps]  = useState([]);
  const [rows,  setRows]  = useState([]);
  const [busy,  setBusy]  = useState(false);
  /* 🔴 ลิสต์ว่างมี 2 ความหมาย — โหลดไม่สำเร็จต้องเขียนบนจอ ห้ามโชว์เป็น "ยังไม่มีใคร" (กฎ DB ข้อ 12) */
  const [loadFail, setLoadFail] = useState('');

  const load = useCallback(async (alive = () => true) => {
    const [n, e, r] = await Promise.all([
      supabase.from('org_nodes').select('id, code, name, kind, parent_id, sort_order').eq('is_active', true),
      supabase.from('employees').select('id, name, employee_id_code, position, section, department').eq('is_active', true),
      supabase.from('qa_inspector_scopes').select('id, employee_id, org_node_id, note'),
    ]);
    if (!alive()) return;
    const bad = [n.error && 'ผังองค์กร', e.error && 'ทะเบียนพนักงาน', r.error && 'ทะเบียน QC ประจำหน่วย'].filter(Boolean);
    setLoadFail(bad.length ? `อ่าน${bad.join(' · ')}ไม่สำเร็จ — รายการที่เห็นอาจไม่ครบ` : '');
    setNodes([...(n.data || [])].sort(orgNodeCompare));
    setEmps(e.data || []);
    setRows(r.data || []);
  }, []);

  useEffect(() => { let on = true; load(() => on); return () => { on = false; }; }, [load]);

  const empById  = useMemo(() => new Map(emps.map(e => [e.id, e])), [emps]);
  const nameOf   = useMemo(() => new Map(nodes.map(n => [n.id, n.code || n.name])), [nodes]);
  /* หน่วยที่ตั้งได้ = ส่วนงาน + แผนก + กลุ่ม/ไลน์ · เรียงตามผัง (listOrder — ห้าม .sort() ดิบ) */
  const units = useMemo(() => nodes.filter(n => ['section', 'department', 'line'].includes(n.kind)), [nodes]);
  const pathOf = useCallback((n) => {
    const seg = [];
    let cur = n, guard = 0;
    while (cur?.parent_id && guard++ < 8) {
      const p = nodes.find(x => x.id === cur.parent_id);
      if (!p) break;
      seg.unshift(p.code || p.name);
      cur = p;
    }
    return seg.join(' › ');
  }, [nodes]);

  const add = async (nodeId, person) => {
    const empId = person?.employee_id;
    if (!empId) { toast.error('เลือกคนจากทะเบียนพนักงาน (ยังไม่ผูกตัวตน เพิ่มไม่ได้)'); return; }
    if (rows.some(r => r.org_node_id === nodeId && r.employee_id === empId)) { toast.info('ผูกไว้แล้ว'); return; }
    setBusy(true);
    const res = await supabase.from('qa_inspector_scopes')
      .insert({ employee_id: empId, org_node_id: nodeId }).select('id');
    const ok = checkWriteRows(res, 'ผูก QC กับหน่วยที่รับตรวจ');
    setBusy(false);
    if (ok) { toast.success('ผูกแล้ว'); load(); }
  };

  const remove = async (row) => {
    setBusy(true);
    const res = await supabase.from('qa_inspector_scopes')
      .delete().eq('id', row.id).select('id');
    const ok = checkWriteRows(res, 'เอา QC ออกจากหน่วย');
    setBusy(false);
    if (ok) load();
  };

  const unsetCount = useMemo(() => {
    const has = new Set(rows.map(r => r.employee_id));
    return emps.filter(e => (e.section || '').trim().toUpperCase() === 'QA' && !has.has(e.id)).length;
  }, [emps, rows]);

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>🔬 QC หน้างานคนนี้ตรวจคุณภาพให้หน่วยไหน</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          QC ที่ไปประจำหน้างาน <b>ยังสังกัดส่วน QA เหมือนเดิม</b> — ตารางนี้บอกแค่ว่ารับตรวจให้หน่วยไหน
          <div style={{ marginTop: 4 }}>
            <b>ไม่ย้ายสังกัด · cost center ไม่เปลี่ยน · ไม่นับเป็นกำลังคนของไลน์ · ไม่ใช่ด่านสิทธิ์</b>
            {' '}(QA ยังเห็นทั้งโรงงานในเรื่องคุณภาพตามที่ตั้งไว้)
          </div>
          <div style={{ marginTop: 4 }}>ตั้งที่ชั้นไหนก็ได้ — ตั้ง "ส่วนงาน" = รับตรวจทุกแผนก/กลุ่มที่อยู่ใต้ลงไป</div>
        </div>
        {loadFail && <div style={{ marginTop: 8, fontSize: 12, color: '#f59e0b' }}>⚠️ {loadFail}</div>}
        {!canManage && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>🔒 ดูได้อย่างเดียว — แก้ได้เฉพาะบัญชีที่มีสิทธิ์จัดการ QA</div>}
        {/* 🔴 "ยังไม่ได้ตั้ง" ≠ "ไม่รับผิดชอบอะไรเลย" — ต้องเขียนบนจอ (qaScope.js §UNSET) */}
        {unsetCount > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#f59e0b' }}>
            ⚠️ มีคนในส่วน QA อีก <b>{unsetCount}</b> คนที่ยังไม่ได้ตั้งว่ารับตรวจหน่วยไหน
          </div>
        )}
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px 14px', boxShadow: 'var(--shadow-sm)', display: 'grid', gap: 8 }}>
        {!units.length && !loadFail && <div style={{ fontSize: 13, color: 'var(--muted)' }}>ยังไม่มีหน่วยงานในผังองค์กร (ตั้งที่ /org-setup)</div>}
        {units.map(u => {
          const mine = rows.filter(r => r.org_node_id === u.id);
          return (
            <div key={u.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 240px) 1fr', gap: 8, alignItems: 'start', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div style={{ fontWeight: 700, overflowWrap: 'anywhere', fontSize: 13 }}>
                {u.code || u.name}
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
                  {KIND_TH[u.kind] || u.kind}{pathOf(u) ? ` · ${pathOf(u)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {mine.map(r => {
                  const e = empById.get(r.employee_id);
                  return (
                    <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px 2px 10px', border: '1px solid var(--border2)', borderRadius: 999, background: 'var(--bg2)', fontSize: 13 }}>
                      🔬 {e ? e.name : '(ไม่อยู่ในทะเบียน active)'}
                      {e?.position && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{positionLabel(e.position)}</span>}
                      {canManage && <DeleteButton disabled={busy} onClick={() => remove(r)} title={`เอา ${e?.name || ''} ออกจาก ${u.code || u.name}`} style={{ width: 26, height: 26 }} />}
                    </span>
                  );
                })}
                {canManage && (
                  <div style={{ minWidth: 220, flex: '1 1 220px', maxWidth: 360 }}>
                    <PersonSelect source="employees" allowFree={false} value="" disabled={busy}
                      placeholder="+ เพิ่ม QC ที่รับตรวจหน่วยนี้: ค้นชื่อ / รหัส…" onChange={(p) => add(u.id, p)} />
                  </div>
                )}
                {!mine.length && !canManage && <span style={{ fontSize: 12, color: 'var(--muted)' }}>— ยังไม่ได้ตั้ง —</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
