/* 👔 แผง "ใครคุมหน่วยไหน + รักษาการ" — ใน /org-setup                2026-09-24
 *
 * ที่มา: ผังองค์กรจริง ORG-001 Rev.09 → **7 จาก 14 ส่วน (50%) หัวหน้าเป็นรักษาการ**
 * และผังไม่ได้เขียนวันสิ้นสุดไว้เลยสักใบ ⇒ สิทธิ์ชั่วคราวกลายเป็นถาวรโดยไม่มีใครรู้
 * (ISO 27001 A.5.18 บังคับให้ทบทวนสิทธิ์เป็นรอบ — แผงนี้คือคิวงานนั้น)
 *
 * 🔴 แผงนี้ **ยังไม่ได้ต่อเข้าตัวคำนวณขอบเขตจริง** — เก็บ/แสดง/เตือนเท่านั้น
 *    การต่อสายทำพร้อม `scope_depth` ครั้งเดียว (ORG-AXES-DECISION §7.6)
 */
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { checkWrite } from '../utils/dbWrite';
import SearchSelect from './SearchSelect';
import {
  ASSIGNMENT_KINDS, kindLabel, assignmentStatus, STATUS,
  needsConfirm, reviewSummary, todayLocal,
} from '../utils/orgAssignments';

const NODE_KIND_TH = { section: 'ส่วน', department: 'แผนก', line: 'กลุ่ม', team: 'ทีม' };

export default function OrgAssignmentsPanel({ nodes = [] }) {
  const { role } = useContext(UserContext);
  const canEdit = can('org', 'manage', role) || can('org', 'manage_own_unit', role);

  const [rows, setRows]   = useState([]);
  const [people, setPeople] = useState([]);
  const [busy, setBusy]   = useState(false);
  const [open, setOpen]   = useState(false);          // ฟอร์มเพิ่ม
  const [form, setForm]   = useState({ profile_id: '', org_node_id: '', kind: 'acting', ends_on: '' });

  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const today = todayLocal();

  const load = useCallback(async () => {
    const [{ data: a }, { data: p }] = await Promise.all([
      supabase.from('org_assignments')
        .select('id, profile_id, org_node_id, kind, starts_on, ends_on, note, source, confirmed_at'),
      supabase.from('profiles').select('id, full_name, role').order('full_name'),
    ]);
    setRows(a || []);
    setPeople(p || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const nameOf = useCallback(
    (id) => people.find(p => p.id === id)?.full_name || '(ไม่ทราบชื่อ)', [people]);

  const sum = useMemo(() => reviewSummary(rows, { today }), [rows, today]);

  /* ── เขียน ─────────────────────────────────────────────────────────── */
  const setEnd = async (row, value) => {
    setBusy(true);
    const ok = checkWrite(await supabase.from('org_assignments')
      .update({ ends_on: value || null }).eq('id', row.id).select('id'), 'กำหนดวันสิ้นสุด');
    setBusy(false);
    if (ok) { toast.success(value ? `กำหนดวันสิ้นสุด ${value}` : 'ล้างวันสิ้นสุดแล้ว'); load(); }
  };
  const confirmRow = async (row) => {
    setBusy(true);
    const ok = checkWrite(await supabase.from('org_assignments')
      .update({ confirmed_at: new Date().toISOString() }).eq('id', row.id).select('id'), 'ยืนยันรายการ');
    setBusy(false);
    if (ok) { toast.success('ยืนยันแล้ว'); load(); }
  };
  const remove = async (row) => {
    if (!window.confirm(`ลบ "${nameOf(row.profile_id)} — ${nodeById.get(row.org_node_id)?.name || '?'}" ?`)) return;
    setBusy(true);
    const ok = checkWrite(await supabase.from('org_assignments').delete().eq('id', row.id).select('id'), 'ลบรายการ');
    setBusy(false);
    if (ok) { toast.success('ลบแล้ว'); load(); }
  };
  const add = async () => {
    if (!form.profile_id || !form.org_node_id) return toast.error('เลือกคนและหน่วยงานก่อน');
    setBusy(true);
    const ok = checkWrite(await supabase.from('org_assignments').insert({
      profile_id: form.profile_id, org_node_id: form.org_node_id, kind: form.kind,
      ends_on: form.ends_on || null, source: 'manual',
      confirmed_at: new Date().toISOString(),          // คนกรอกเอง = ยืนยันในตัว
    }).select('id'), 'เพิ่มรายการ');
    setBusy(false);
    if (ok) { toast.success('เพิ่มแล้ว'); setOpen(false);
      setForm({ profile_id: '', org_node_id: '', kind: 'acting', ends_on: '' }); load(); }
  };

  const chip = (bg, color, children, key) => (
    <span key={key} style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
      background: bg, color, whiteSpace: 'nowrap' }}>{children}</span>
  );

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontFamily: 'var(--font-display)' }}>👔 หัวหน้าหน่วย / รักษาการ</h3>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          ตอบ “ใครคุมหน่วยไหน” — คนละเรื่องกับ “สังกัดที่ไหน” · คนเดียวคุมได้หลายหน่วย
        </span>
        {canEdit && (
          <button onClick={() => setOpen(v => !v)} style={{ marginLeft: 'auto', padding: '5px 12px',
            borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            background: open ? 'var(--bg3)' : 'var(--accent)', color: open ? 'var(--text2)' : '#fff',
            border: `1px solid ${open ? 'var(--border2)' : 'var(--accent)'}` }}>
            {open ? 'ยกเลิก' : '➕ เพิ่ม'}
          </button>
        )}
      </div>

      {/* 📋 คิวทบทวนสิทธิ์ — โชว์เฉพาะที่มีของจริง ไม่ขึ้นแถบว่างให้รก */}
      {(sum.openEnded.length + sum.expired.length + sum.expiring.length + sum.unconfirmed.length) > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontSize: 12,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 9, padding: '8px 11px', alignItems: 'center' }}>
          <b style={{ color: '#f59e0b' }}>📋 ต้องทบทวน</b>
          {sum.openEnded.length > 0 && chip('rgba(245,158,11,0.2)', '#f59e0b',
            `🔄 รักษาการไม่มีวันสิ้นสุด ${sum.openEnded.length}`)}
          {sum.expired.length > 0 && chip('rgba(239,68,68,0.2)', '#ef4444',
            `⌛ หมดอายุแล้ว ${sum.expired.length}`)}
          {sum.expiring.length > 0 && chip('rgba(59,130,246,0.2)', '#3b82f6',
            `⏳ ใกล้หมดใน 30 วัน ${sum.expiring.length}`)}
          {sum.unconfirmed.length > 0 && chip('rgba(148,163,184,0.25)', 'var(--text2)',
            `❓ ยังไม่ยืนยัน ${sum.unconfirmed.length}`)}
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>
            · รักษาการที่ไม่มีวันจบ = สิทธิ์ชั่วคราวที่กลายเป็นถาวรโดยไม่มีใครรู้
          </span>
        </div>
      )}

      {open && canEdit && (
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
          background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 9, padding: 11, marginBottom: 10 }}>
          {/* ⚠️ <SearchSelect> ใช้ `options: [{id,label}]` และคืนค่าเป็น `({id})` — ไม่ใช่ value ดิบ
              (ส่งผิดรูปแล้ว build ยังผ่าน แต่ลิสต์จะว่างและเลือกไม่ติด) */}
          <SearchSelect value={form.profile_id} placeholder="— เลือกคน —"
            onChange={({ id }) => setForm(f => ({ ...f, profile_id: id || '' }))}
            options={people.map(p => ({ id: p.id, label: p.full_name || '(ไม่ระบุชื่อ)', sub: p.role }))} />
          <SearchSelect value={form.org_node_id} placeholder="— เลือกหน่วยงาน —"
            onChange={({ id }) => setForm(f => ({ ...f, org_node_id: id || '' }))}
            options={nodes.map(n => ({ id: n.id, label: n.name,
              group: NODE_KIND_TH[n.kind] || n.kind }))} />
          <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
            {Object.entries(ASSIGNMENT_KINDS).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}
          </select>
          <div>
            <input type="date" value={form.ends_on} style={{ width: '100%' }}
              onChange={e => setForm(f => ({ ...f, ends_on: e.target.value }))} />
            <div style={{ fontSize: 10, color: form.kind === 'acting' && !form.ends_on ? '#f59e0b' : 'var(--muted)', marginTop: 2 }}>
              {form.kind === 'acting'
                ? (form.ends_on ? 'วันสิ้นสุด' : '⚠️ รักษาการควรมีวันสิ้นสุด')
                : 'วันสิ้นสุด (ไม่ใส่ก็ได้)'}
            </div>
          </div>
          <button onClick={add} disabled={busy} style={{ padding: '7px 14px', borderRadius: 7, fontWeight: 700,
            fontSize: 12, cursor: busy ? 'default' : 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' }}>
            บันทึก
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 2px' }}>
          ยังไม่มีข้อมูล — กด “➕ เพิ่ม” เพื่อระบุว่าใครคุมหน่วยไหน
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 640, fontSize: 12 }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>หน่วยงาน</th>
              <th style={{ textAlign: 'left' }}>ผู้รับผิดชอบ</th>
              <th style={{ textAlign: 'center' }}>บทบาท</th>
              <th style={{ textAlign: 'center' }}>สถานะ</th>
              <th style={{ textAlign: 'center', minWidth: 148 }}>วันสิ้นสุด</th>
              {canEdit && <th style={{ textAlign: 'center' }}>จัดการ</th>}
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const n = nodeById.get(r.org_node_id);
                const st = assignmentStatus(r, today);
                const m = STATUS[st] || STATUS.active;
                return (
                  <tr key={r.id}>
                    <td>{n ? `${NODE_KIND_TH[n.kind] || n.kind} · ${n.name}` : '(หน่วยถูกลบ)'}</td>
                    <td>{nameOf(r.profile_id)}
                      {r.note && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{r.note}</div>}</td>
                    <td style={{ textAlign: 'center' }}>
                      {ASSIGNMENT_KINDS[r.kind]?.icon} {kindLabel(r.kind)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {chip(`${m.color}22`, m.color, m.label)}
                      {needsConfirm(r) && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>จากผังองค์กร</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {canEdit
                        ? <input type="date" value={r.ends_on || ''} disabled={busy}
                            onChange={e => setEnd(r, e.target.value)} style={{ width: 140 }} />
                        : (r.ends_on || '—')}
                    </td>
                    {canEdit && (
                      <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {needsConfirm(r) && (
                          <button className="tbtn" onClick={() => confirmRow(r)} disabled={busy}
                            title="ยืนยันว่าข้อมูลจากผังองค์กรถูกต้อง"
                            style={{ fontSize: 11, marginRight: 4 }}>✓ ยืนยัน</button>
                        )}
                        <button className="tbtn" onClick={() => remove(r)} disabled={busy}
                          style={{ fontSize: 11, color: '#ef4444' }}>🗑</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
