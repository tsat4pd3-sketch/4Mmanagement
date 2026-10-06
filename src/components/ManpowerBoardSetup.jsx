import { useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import { orgNodeCompare } from '../utils/listOrder';
import { sortLineNames } from '../utils/lineHierarchy';
import { lineFamilyOf } from '../utils/manpowerBoard';
import { positionLabel } from '../utils/positions';
import PersonSelect from './PersonSelect';
import { DeleteButton } from './IconButton';

/* ═══════════════════════════════════════════════════════════════════════════════════════
   ⚙️ ตั้งค่า Manpower Control Board ของส่วนงาน (2026-10-06 · คำสั่ง user "ทำส่วนที่ยังไม่ได้ทำต่อ")
   2 เรื่อง — ตาราง Main (migration 20261006b) · สิทธิ์ `manpower_board:edit` (RLS has_perm คีย์เดียวกัน)
     1. ช่องตำแหน่งต่อ (แผนก × ทีม) → manpower_slot_plans · ช่องว่าง = ใช้ std ของไลน์เหมือนเดิม
     2. ช่างประจำไลน์ → line_technicians (ช่างแผนกไหนก็ได้ — ไม่แตะ employees.line_id ของเขา)
   บันทึกทีละแถวทันที (ไม่มีปุ่มบันทึกรวม) ⇒ ไม่มีข้อมูลค้างให้หายเวลาปิดหน้าต่าง
   🔴 RLS ปฏิเสธ UPDATE/DELETE = "สำเร็จ 0 แถว" ⇒ ทุกการเขียน `.select('id')` แล้วนับแถว (กฎเหล็กข้อ 2)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const TEAMS = ['A', 'B', 'C', ''];          // '' = คอลัมน์ "ไม่ระบุทีม" บนบอร์ด
const teamText = (t) => (t ? `ทีม ${t}` : 'ไม่ระบุทีม');

export default function ManpowerBoardSetup({ section, nodes, lines, employees, slotPlans, lineTechs, onChanged, onClose }) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({});    // key `${node}|${team}` → ข้อความในช่อง (ยังไม่บันทึก)

  const depts = useMemo(() => nodes.filter(n => n.kind === 'department' && n.parent_id === section.id).sort(orgNodeCompare), [nodes, section]);
  const planOf = (nodeId, team) => slotPlans.find(p => p.org_node_id === nodeId && (p.team || '') === team) || null;

  // ไลน์ของส่วนงาน = ไลน์ที่ผังชี้ (ทั้งครอบครัว) — ช่างผูกได้ทุกไลน์ในนี้
  const secLines = useMemo(() => {
    const ids = new Set(nodes.map(n => n.id));
    const under = (n) => { for (let p = n; p; p = nodes.find(x => x.id === p.parent_id)) if (p.id === section.id) return true; return false; };
    const refs = nodes.filter(n => n.kind === 'line' && n.ref_line_id != null && ids.has(n.id) && under(n)).map(n => n.ref_line_id);
    const fam = lineFamilyOf(lines, refs);
    const order = sortLineNames(fam.map(l => l.name), lines);
    return order.map(nm => fam.find(l => l.name === nm)).filter(Boolean);
  }, [nodes, lines, section]);
  const empById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const saveSlot = async (nodeId, team) => {
    const key = `${nodeId}|${team}`;
    const raw = String(draft[key] ?? '').trim();
    const cur = planOf(nodeId, team);
    setBusy(true);
    try {
      if (raw === '') {                         // ลบค่าที่ตั้งไว้ = กลับไปใช้ std
        if (!cur) return;
        const res = await supabase.from('manpower_slot_plans').delete().eq('id', cur.id).select('id');
        if (!checkWrite(res, 'ล้างจำนวนช่อง')) return;
        if (!res.data?.length) { toast.error('ล้างไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์ manpower_board:edit'); return; }
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 500) { toast.error('จำนวนช่องต้องเป็นเลขเต็ม 0–500'); return; }
        const res = await supabase.from('manpower_slot_plans')
          .upsert({ org_node_id: nodeId, team, slots: n }, { onConflict: 'org_node_id,team' }).select('id');
        if (!checkWrite(res, 'บันทึกจำนวนช่อง')) return;
        if (!res.data?.length) { toast.error('บันทึกไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์ manpower_board:edit'); return; }
      }
      setDraft(d => { const x = { ...d }; delete x[key]; return x; });
      toast.success('บันทึกแล้ว');
      onChanged();
    } finally { setBusy(false); }
  };

  const addTech = async (lineId, emp) => {
    if (!emp?.employee_id) return;
    if (lineTechs.some(t => t.line_id === lineId && t.employee_id === emp.employee_id)) { toast.info('ผูกไว้แล้ว'); return; }
    setBusy(true);
    try {
      const res = await supabase.from('line_technicians').insert({ employee_id: emp.employee_id, line_id: lineId }).select('id');
      if (!checkWrite(res, 'ผูกช่างประจำไลน์')) return;
      toast.success(`ผูก ${emp.name} แล้ว`);
      onChanged();
    } finally { setBusy(false); }
  };
  const removeTech = async (row) => {
    const e = empById.get(row.employee_id);
    if (!window.confirm(`เอา ${e?.name || 'ช่างคนนี้'} ออกจากช่างประจำไลน์?`)) return;
    setBusy(true);
    try {
      const res = await supabase.from('line_technicians').delete().eq('id', row.id).select('id');
      if (!checkWrite(res, 'เอาช่างออก')) return;
      if (!res.data?.length) { toast.error('ลบไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์ manpower_board:edit'); return; }
      onChanged();
    } finally { setBusy(false); }
  };

  const th = { textAlign: 'center', fontSize: 12, padding: '6px 8px', color: 'var(--muted)' };
  return (
    /* ไม่ปิดจาก backdrop (UI §5) — ปิดได้จากปุ่ม ✕ / ปิด เท่านั้น */
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card" onClick={e => e.stopPropagation()}
        style={{ width: 'min(960px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: 18, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <strong style={{ fontSize: 16 }}>⚙️ ตั้งค่าบอร์ด · {section.name}</strong>
          <span style={{ marginLeft: 'auto' }} />
          <button type="button" className="tbtn" onClick={onClose} title="ปิด"
            style={{ height: 30, padding: '0 12px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer' }}>✕ ปิด</button>
        </div>

        <section style={{ marginBottom: 18 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>1. จำนวนช่องตำแหน่งต่อทีม</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            ช่องว่าง = จำนวนที่ตั้ง − พนักงานในทะเบียนของทีมนั้น · <b>เว้นว่าง = ใช้คนมาตรฐานของไลน์ (std)</b> ตามกะของทีมวันนี้ · กด Enter หรือ 💾 เพื่อบันทึก
          </div>
          {!depts.length ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>ส่วนงานนี้ยังไม่มีแผนกในผังองค์กร</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={{ ...th, textAlign: 'left' }}>แผนก</th>{TEAMS.map(t => <th key={t} style={th}>{teamText(t)}</th>)}</tr></thead>
                <tbody>
                  {depts.map(d => (
                    <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 700 }}>{d.name}</td>
                      {TEAMS.map(t => {
                        const key = `${d.id}|${t}`;
                        const cur = planOf(d.id, t);
                        const val = draft[key] ?? (cur ? String(cur.slots) : '');
                        const dirty = draft[key] != null && String(draft[key]).trim() !== (cur ? String(cur.slots) : '');
                        return (
                          <td key={t} style={{ padding: '6px 8px', textAlign: 'center' }}>
                            <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              <input type="number" min={0} max={500} inputMode="numeric" value={val} placeholder="std" disabled={busy}
                                aria-label={`จำนวนช่อง ${d.name} ${teamText(t)}`}
                                onChange={e => setDraft(x => ({ ...x, [key]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') saveSlot(d.id, t); }}
                                style={{ width: 72, textAlign: 'center' }} />
                              {dirty && <button type="button" className="icon-btn tbtn" disabled={busy} onClick={() => saveSlot(d.id, t)} title="บันทึก">💾</button>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>2. ช่างประจำไลน์</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            ช่างแผนกไหนก็ได้ (MTN · DIE · JIG …) — ขึ้นแถว "ช่างเทคนิคประจำไลน์" ของแผนกที่ดูแลไลน์นั้น · <b>ไม่เปลี่ยนสังกัดของช่าง</b>
          </div>
          {!secLines.length ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>ส่วนงานนี้ยังไม่ได้ผูกไลน์ผลิตในผังองค์กร (ตั้งที่ /org-setup)</div> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {secLines.map(l => {
                const rows = lineTechs.filter(t => t.line_id === l.id);
                return (
                  <div key={l.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr', gap: 8, alignItems: 'start', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{l.name}{l.parent_line_name ? <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>ใต้ {l.parent_line_name}</div> : null}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {rows.map(r => {
                        const e = empById.get(r.employee_id);
                        return (
                          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 4px 2px 10px', border: '1px solid var(--border2)', borderRadius: 999, background: 'var(--bg2)', fontSize: 13 }}>
                            🔧 {e ? e.name : '(ไม่อยู่ในทะเบียน active)'}
                            {e?.position && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{positionLabel(e.position)}</span>}
                            <DeleteButton disabled={busy} onClick={() => removeTech(r)} title={`เอา ${e?.name || ''} ออก`} style={{ width: 26, height: 26 }} />
                          </span>
                        );
                      })}
                      <div style={{ minWidth: 220, flex: '1 1 220px', maxWidth: 360 }}>
                        <PersonSelect source="employees" allowFree={false} value="" disabled={busy}
                          placeholder="+ เพิ่มช่าง: ค้นชื่อ / รหัส…" onChange={(p) => addTech(l.id, p)} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
