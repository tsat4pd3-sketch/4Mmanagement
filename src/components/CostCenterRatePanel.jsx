import { Fragment, useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { toast } from '../components/Toast';
import CollapseCard from './CollapseCard';
import { RATE_COMPONENTS, rateFor, fmtBaht } from '../utils/costSaving';

/* ═══ 💰 Activity Rate ต่อ Cost Center — แผงใน /org-setup (2026-08-11) ═══
   rate ที่บัญชีคำนวณ ต่อ cost center (ก้อนตาม RATE_COMPONENTS) — ใช้แปลงผล Improvement เป็น cost saving
   ลิสต์ cost center = union จากผังองค์กร (org_nodes.cost_center) + ไลน์ผลิต (production_lines.cost_center)
   → เห็นทันทีว่ารหัสไหนไลน์ใช้อยู่แต่ยังไม่มี rate (⚠) และรหัสฝั่งผัง/ฝั่งไลน์ไม่ตรงกัน (data drift)
   เก็บแบบ effective_from (บช. ปรับรายปี) — เพิ่ม rate ปีใหม่เป็นแถวใหม่ ไม่ทับประวัติ */

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/* timestamp ที่ระบบ stamp เอง (created_at/updated_at) — แสดงผลอย่างเดียว ห้ามให้กรอก */
const fmtStamp = (v) => (v ? new Date(v).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }) : '—');

/* ⚠️ ช่อง rate ทั้งหมด generate จาก RATE_COMPONENTS — เพิ่มก้อนใหม่ที่ costSaving.js ที่เดียว
   ฟอร์ม/ตาราง/ยอดรวม ตามให้เอง ห้ามพิมพ์ชื่อคอลัมน์ rate ซ้ำในไฟล์นี้ */
/* เป็นฟังก์ชัน ไม่ใช่ const — todayStr() ที่ประเมินตอน import จะค้างวันเดิมบนจอที่เปิดข้ามคืน */
const emptyForm = () => ({
  cost_center: '', effective_from: todayStr(), note: '',
  ...Object.fromEntries(RATE_COMPONENTS.map(c => [c.field, ''])),
});

export default function CostCenterRatePanel({ nodes, lines }) {
  const [rates, setRates] = useState([]);
  const [form, setForm] = useState(null);      // {id?, cost_center, effective_from, <rate fields จาก RATE_COMPONENTS>, note}
  const [histOpen, setHistOpen] = useState({}); // cc -> bool
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('cost_center_rates').select('*')
      .order('cost_center').order('effective_from');
    // ตารางยังไม่ apply migration = แผงโชว์ว่างพร้อมเพิ่มไม่ได้ — ไม่ทำหน้า OrgSetup หลักพัง
    if (!error) setRates(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* union cost center: ผัง + ไลน์ + ที่มีใน rate table (รหัสเก่าที่เลิกใช้ยังเห็นประวัติ)
     ⚠️ activity rate มีที่ "ระดับกลุ่ม" (21406 — org kind='line' / production_lines) เท่านั้น (คำสั่ง user 2026-08-11)
     ระดับส่วน (21404) / แผนก (21405) ไม่กรอก rate — ต้นทุน/saving ระดับบน = sum ขึ้นตาม hierarchy จากกลุ่ม */
  const ccList = useMemo(() => {
    const map = new Map(); // cc -> { orgGroup: [], orgOther: [], lines: [] }
    const put = (cc) => { const k = String(cc || '').trim(); if (!k) return null; if (!map.has(k)) map.set(k, { orgGroup: [], orgOther: [], lines: [] }); return map.get(k); };
    (nodes || []).filter(n => n.is_active && n.cost_center).forEach(n => {
      const e = put(n.cost_center); if (!e) return;
      if (n.kind === 'line') e.orgGroup.push(n.name);
      else e.orgOther.push(`${n.kind === 'section' ? 'ส่วน' : n.kind === 'department' ? 'แผนก' : n.kind} ${n.name}`);
    });
    (lines || []).filter(l => l.cost_center).forEach(l => { put(l.cost_center)?.lines.push(l.name); });
    rates.forEach(r => put(r.cost_center));
    return [...map.entries()].map(([cc, u]) => ({ cc, ...u })).sort((a, b) => a.cc.localeCompare(b.cc));
  }, [nodes, lines, rates]);

  const rateCcSet = useMemo(() => new Set(rates.map(r => String(r.cost_center).trim())), [rates]);
  // ระดับกลุ่ม = ไลน์ผลิตใช้จริง หรือเป็น group node ในผัง (+ รหัสที่มี rate แล้ว — ประวัติต้องไม่หาย)
  const groupList = useMemo(() => ccList.filter(e => e.lines.length || e.orgGroup.length || rateCcSet.has(e.cc)), [ccList, rateCcSet]);
  const otherCount = ccList.length - groupList.length;
  const [showAllLevels, setShowAllLevels] = useState(false);
  const shownList = showAllLevels ? ccList : groupList;

  const handleSave = async () => {
    const cc = form.cost_center.trim();
    if (!cc) { toast.error('กรอกรหัส cost center ก่อน'); return; }
    if (!form.effective_from) { toast.error('เลือกวันเริ่มใช้ rate (effective) ก่อน'); return; }
    setSaving(true);
    const payload = {
      cost_center: cc, effective_from: form.effective_from,
      ...Object.fromEntries(RATE_COMPONENTS.map(c => [c.field, Number(form[c.field]) || 0])),
      note: form.note?.trim() || null,
    };
    const q = form.id
      ? supabase.from('cost_center_rates').update(payload).eq('id', form.id)
      : supabase.from('cost_center_rates').insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) {
      toast.error(error.code === '23505' ? `มี rate ของ ${cc} วันที่ ${form.effective_from} อยู่แล้ว — แก้แถวเดิมแทน` : error.message);
      return;
    }
    toast.success('บันทึก rate แล้ว');
    setForm(null);
    load();
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`ลบ rate ${r.cost_center} (effective ${r.effective_from})?`)) return;
    const { error } = await supabase.from('cost_center_rates').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  /* วัน Effective ตอนแก้แถวเดิม = ล็อกกันแก้พลาด แต่ปลดล็อกได้ (แถว seed เป็น 2000-01-01 ต้องแก้เป็นวันจริงได้)
     `_unlockDate` เป็นคีย์ client-only ขึ้นต้น `_` — handleSave เลือกฟิลด์เองอยู่แล้ว ไม่มีทางหลุดลง DB */
  const dateLocked = !!form?.id && !form._unlockDate;
  const unlockDate = () => {
    if (!window.confirm(
      'ปลดล็อกวัน Effective?\n\n'
      + 'วันนี้บอกว่า rate แถวนี้เริ่มมีผลเมื่อไหร่ — เปลี่ยนแล้ว cost saving ของโปรเจคปรับปรุงที่คิดด้วย rate ช่วงนี้จะขยับตาม\n\n'
      + 'ถ้าเป็นการ "ปรับ rate รอบใหม่" ให้กดยกเลิก แล้วใช้ปุ่ม ＋ rate ในตารางแทน (rate เดิมเก็บไว้เป็นประวัติ)'
    )) return;
    setForm(f => ({ ...f, _unlockDate: true }));
  };

  const noRateUsed = groupList.filter(c => c.lines.length && !rateCcSet.has(c.cc)).length;

  return (
    <CollapseCard id="cc_rates" storePrefix="orgsetup" count={groupList.length}
      title={<span>💰 Activity Rate ต่อ Cost Center — ระดับกลุ่ม (21406) <span style={{ fontWeight: 600, color: 'var(--muted)' }}>({RATE_COMPONENTS.map(c => c.label).join('/')} บาท/ชม. — ใช้คิด cost saving ในโปรเจคปรับปรุง)</span></span>}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
        rate ตั้งที่ <b>ระดับกลุ่มไลน์ (รหัส 21406)</b> เท่านั้น — ระดับแผนก/ส่วน ไม่ต้องกรอก (ต้นทุน/saving ระดับบนรวมขึ้นจากกลุ่มตาม hierarchy)
        · <b>บัญชีส่ง rate รอบใหม่ = กด “＋ rate ใหม่”</b> (ประวัติเดิมคงไว้ โปรเจคเก่าคำนวณด้วย rate ณ ช่วงนั้น) — ปุ่ม ✏️ ไว้แก้เฉพาะตอนกรอกตัวเลขผิด
        {noRateUsed > 0 && <span style={{ color: '#f59e0b', fontWeight: 700 }}> · ⚠ มี {noRateUsed} รหัสที่ไลน์ใช้อยู่แต่ยังไม่ตั้ง rate</span>}
        {otherCount > 0 && (
          <span> · ซ่อนรหัสระดับส่วน/แผนก {otherCount} รหัส{' '}
            <button onClick={() => setShowAllLevels(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
              {showAllLevels ? 'กลับมาแสดงเฉพาะระดับกลุ่ม' : 'แสดงทั้งหมด'}
            </button>
          </span>
        )}
      </div>
      <div className="table-sticky" style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead style={{ background: 'var(--bg2)' }}>
            <tr>
              {/* ⚠️ หัวตารางต้อง generate จาก RATE_COMPONENTS เหมือน body —
                  เดิม hardcode 3 ก้อน (DL/OH/DP) แต่ body วน 4 ก้อน → คอลัมน์เลื่อนกันทั้งตาราง
                  (ตัวเลข IDP ไปโผล่ใต้หัว OH · ตัวเลข OH ไปอยู่ใต้ "รวม") */}
              {[
                { h: 'Cost Center', right: false }, { h: 'ใช้โดย', right: false },
                ...RATE_COMPONENTS.map(c => ({ h: c.label, right: true, title: c.full })),
                { h: 'รวม/ชม.', right: true }, { h: 'Effective', right: true }, { h: '', right: false },
              ].map((c, i) => (
                <th key={i} title={c.title} style={{ padding: '7px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: c.right ? 'right' : 'left', whiteSpace: 'nowrap' }}>{c.h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* colSpan ต้องคิดจาก RATE_COMPONENTS ด้วย (2 คอลัมน์หน้า + ก้อน rate + รวม/effective/ปุ่ม) */}
            {shownList.length === 0 && (
              <tr><td colSpan={2 + RATE_COMPONENTS.length + 3} style={{ padding: 14, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>ยังไม่มี cost center ระดับกลุ่ม — กรอกที่ฟอร์มกลุ่มในผัง หรือหน้าจัดการไลน์ (ไลน์แม่) ก่อน</td></tr>
            )}
            {shownList.map(({ cc, orgGroup, orgOther, lines: lns }) => {
              const cur = rateFor(rates, cc, todayStr());
              const hist = rates.filter(r => String(r.cost_center).trim() === cc);
              const total = cur ? RATE_COMPONENTS.reduce((a, c) => a + (Number(cur[c.field]) || 0), 0) : null;
              const open = !!histOpen[cc];
              return (
                <Fragment key={cc}>
                  <tr style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)', whiteSpace: 'nowrap' }}>
                      {cc}
                      {lns.length > 0 && !cur && <span title="ไลน์ใช้รหัสนี้อยู่ แต่ยังไม่ตั้ง rate — cost saving ของไลน์นี้จะคำนวณไม่ได้" style={{ marginLeft: 6, fontSize: 11, color: '#f59e0b', fontWeight: 800 }}>⚠</span>}
                      {lns.length > 0 && !cc.startsWith('21406') && (
                        <span title="ไลน์ใช้รหัสนี้อยู่ แต่ไม่ใช่ชุดระดับกลุ่ม (21406) — เช็คกับบัญชีแล้วแก้ที่หน้าจัดการไลน์/ผังองค์กร"
                          style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: '#f59e0b', background: 'rgba(245,158,11,0.13)', borderRadius: 5, padding: '1px 5px' }}>ไม่ใช่ 21406?</span>
                      )}
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--muted)', maxWidth: 260 }}>
                      {orgGroup.length > 0 && <span>▦ {orgGroup.join(', ')}</span>}
                      {orgGroup.length > 0 && lns.length > 0 && ' · '}
                      {lns.length > 0 && <span>🏭 {lns.join(', ')}</span>}
                      {orgOther.length > 0 && <span style={{ opacity: 0.7 }}>{(orgGroup.length || lns.length) ? ' · ' : ''}🏛️ {orgOther.join(', ')}</span>}
                      {!orgGroup.length && !lns.length && !orgOther.length && <span style={{ opacity: 0.6 }}>— ไม่มีในผัง/ไลน์แล้ว (ประวัติ)</span>}
                    </td>
                    {RATE_COMPONENTS.map(c => (
                      <td key={c.key} style={{ padding: '7px 10px', fontSize: 12, textAlign: 'right', fontFamily: 'monospace', color: cur ? 'var(--text2)' : 'var(--muted)' }}>
                        {cur ? fmtBaht(Number(cur[c.field]) || 0) : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '7px 10px', fontSize: 12, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: cur ? 'var(--accent)' : 'var(--muted)' }}>{total != null ? fmtBaht(total) : '—'}</td>
                    <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {cur ? cur.effective_from : '—'}
                      {hist.length > 1 && (
                        <button onClick={() => setHistOpen(p => ({ ...p, [cc]: !open }))} style={{ marginLeft: 6, background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>
                          ประวัติ {hist.length} {open ? '▲' : '▼'}
                        </button>
                      )}
                    </td>
                    {/* ⚠️ ＋ rate = ทางหลัก (บัญชีส่ง rate รอบใหม่ = แถวใหม่ ประวัติเดิมคงไว้)
                        ✏️ = ทางรอง ใช้เฉพาะกรอกผิด — จงใจให้จืดกว่า ไม่ให้เผลอกดแก้ทับ rate ปีเก่า */}
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button onClick={() => setForm({ ...emptyForm(), cost_center: cc, ...(cur ? Object.fromEntries(RATE_COMPONENTS.map(c => [c.field, cur[c.field]])) : {}) })}
                        title="บัญชีปรับ rate รอบใหม่ → กดปุ่มนี้ (rate เดิมเก็บเป็นประวัติ โปรเจคเก่ายังคิดด้วยตัวเดิม)"
                        style={{ background: 'none', border: '1px solid var(--accent)', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 800, color: 'var(--accent)', padding: '2px 9px' }}>＋ rate ใหม่</button>
                      {cur && <button onClick={() => setForm({ ...emptyForm(), ...cur, id: cur.id })}
                        title="แก้ตัวเลขที่กรอกผิดของแถวนี้ — ไม่ใช่สำหรับ rate รอบใหม่ (ใช้ ＋ rate ใหม่ แทน)"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, opacity: 0.55, marginLeft: 6 }}>✏️</button>}
                    </td>
                  </tr>
                  {open && hist.map(r => (
                    <tr key={r.id} style={{ background: 'var(--bg3)' }}>
                      <td style={{ padding: '4px 10px 4px 24px', fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>↳ {r.effective_from}</td>
                      <td style={{ padding: '4px 10px', fontSize: 11, color: 'var(--muted)' }}>{r.note || ''}</td>
                      {RATE_COMPONENTS.map(c => (
                        <td key={c.key} style={{ padding: '4px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)' }}>{fmtBaht(Number(r[c.field]) || 0)}</td>
                      ))}
                      <td style={{ padding: '4px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'monospace', color: 'var(--muted)' }}>{fmtBaht(RATE_COMPONENTS.reduce((a, c) => a + (Number(r[c.field]) || 0), 0))}</td>
                      <td style={{ padding: '4px 10px' }} />
                      <td style={{ padding: '4px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button onClick={() => setForm({ ...emptyForm(), ...r })} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>✏️</button>
                        <button onClick={() => handleDelete(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <button onClick={() => setForm({ ...emptyForm() })} style={{ marginTop: 8, padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        ➕ เพิ่ม rate (พิมพ์รหัสเอง)
      </button>

      {/* modal ฟอร์ม rate — ห้ามปิดจาก backdrop ตาม UI-CONVENTIONS §5 */}
      {form && (
        <div className="overlay">
          <div className="modal" style={{ width: 'min(560px, 94vw)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{form.id ? '✏️ แก้ Activity Rate' : '➕ เพิ่ม Activity Rate'}</h3>
              <button onClick={() => setForm(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', flex: 1 }}>Cost Center *
                  {/* readOnly ไม่ใช่ disabled — disabled ทำให้กล่องหน้าตาคนละแบบกับโมดัลเพิ่มใหม่ */}
                  <input list="cc-rate-codes" value={form.cost_center} readOnly={!!form.id}
                    onChange={e => setForm({ ...form, cost_center: e.target.value })} placeholder="เช่น 2140662101"
                    title={form.id ? 'ย้าย rate ข้าม cost center ไม่ได้ — ถ้ากรอกรหัสผิด ให้ลบแถวนี้แล้วเพิ่มใหม่' : ''}
                    style={{ marginTop: 4, fontFamily: 'monospace', opacity: form.id ? 0.75 : 1, cursor: form.id ? 'not-allowed' : 'auto' }} />
                  <datalist id="cc-rate-codes">{groupList.map(c => <option key={c.cc} value={c.cc} />)}</datalist>
                </label>
                {/* ⚠️ Effective = "วันที่ rate เริ่มมีผลตามบัญชี" ไม่ใช่ timestamp ตอนแก้
                    (เวลาแก้ระบบ stamp เองที่ updated_at + audit_log — ไม่ต้องกรอก)
                    ตอนแก้แถวเดิม "กันพลาด" ไว้ก่อน แต่ต้องปลดล็อกได้ — แถวที่ seed ไว้เป็น 2000-01-01
                    (วันตั้งต้นให้ครอบโปรเจคที่มีอยู่แล้ว) พอบัญชีบอกวันจริง ต้องแก้ทับได้ ไม่ใช่ลบทิ้งแล้วสร้างใหม่
                    ⚠️ ห้าม disabled แล้วจบ — input[type=date] ที่ disabled หน้าตาไม่เหมือนตอนเพิ่มใหม่
                    (ไม่มีไอคอนปฏิทิน) โมดัล 2 ตัวเลยดูคนละแบบ */}
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Effective *
                  <input type="date" value={form.effective_from} readOnly={dateLocked}
                    onChange={e => setForm({ ...form, effective_from: e.target.value })}
                    onKeyDown={e => { if (dateLocked) e.preventDefault(); }}
                    onClick={e => { if (dateLocked) { e.preventDefault(); e.currentTarget.blur(); } }}
                    title={dateLocked ? 'ล็อกกันแก้พลาด — กด 🔓 ถ้าต้องแก้วันจริงๆ' : ''}
                    style={{ marginTop: 4, width: 145, display: 'block', opacity: dateLocked ? 0.75 : 1, cursor: dateLocked ? 'not-allowed' : 'auto' }} />
                </label>
              </div>
              {form.id && (
                <div style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--bg3)', borderRadius: 6, padding: '6px 9px', lineHeight: 1.6 }}>
                  {dateLocked ? (
                    <>
                      🔒 วัน Effective ล็อกกันแก้พลาด — <b>ปรับ rate รอบใหม่ให้กด ＋ rate ในตาราง</b> (แถวเดิมเก็บเป็นประวัติ โปรเจคที่เริ่มก่อนหน้ายังคิดด้วย rate เดิม)
                      <button onClick={unlockDate} style={{ marginLeft: 6, background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--accent)', fontSize: 11, fontWeight: 800, cursor: 'pointer', padding: '1px 7px' }}>🔓 แก้วันที่</button>
                    </>
                  ) : (
                    <span style={{ color: '#f59e0b', fontWeight: 700 }}>🔓 ปลดล็อกวันที่แล้ว — เปลี่ยนวันนี้ = เปลี่ยนย้อนหลังว่า rate นี้ครอบช่วงไหน cost saving ของโปรเจคที่คำนวณด้วย rate ช่วงนี้จะขยับตาม</span>
                  )}
                  <div style={{ marginTop: 3, opacity: 0.85 }}>
                    เวลาที่แก้ระบบบันทึกเอง: สร้าง {fmtStamp(form.created_at)} · แก้ล่าสุด {fmtStamp(form.updated_at)} (ใครแก้ดูได้ที่ audit log)
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                {RATE_COMPONENTS.map(c => (
                  <label key={c.key} style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{c.label} <span style={{ fontWeight: 600 }}>({c.full})</span>
                    <input type="number" min="0" step="any" value={form[c.field]} onChange={e => setForm({ ...form, [c.field]: e.target.value })} placeholder="บาท/ชม." style={{ marginTop: 4 }} />
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', textAlign: 'right' }}>
                รวม {fmtBaht(RATE_COMPONENTS.reduce((a, c) => a + (Number(form[c.field]) || 0), 0))} บาท/ชม.
              </div>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>หมายเหตุ
                <input value={form.note || ''} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="เช่น rate ปี 2026 จากบัญชี" style={{ marginTop: 4 }} />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setForm(null)} style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>ยกเลิก</button>
                <button onClick={handleSave} disabled={saving} style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#08130a', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </CollapseCard>
  );
}
