/* ═══ NpiTooling — แผนพัฒนาเครื่องมือ (แม่พิมพ์/จิ๊ก/CF/เกจ) เป็น Gantt ต่อพาร์ท ═══
   · สร้างแผน → ระบบเสนอขั้นงานจากแม่แบบ npi_tooling_step_templates (คนแก้/ลบ/เพิ่มได้)
   · ไฟสี/ตำแหน่งแท่ง = utils/npi (stepLight/toolingRollup/ganttRange/barPos)
   · transfer แล้วผูก die_set_code (die_sets ฝั่ง DR) — จากนั้น die maintenance รับช่วงต่อ */
import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { toast } from './Toast';
import { fmtDate } from '../utils/dateFormat';
import { TOOL_KIND, TOOL_STATUS, STEP_STATUS, LIGHT, toolingRollup, stepLight, ganttRange, barPos, proposeSteps } from '../utils/npi';
import { inp, card, btn, ghost, Field, Pill, LightDot, MetaSelect, Modal } from './NpiUi';

export default function NpiTooling({ parts, tooling, steps, stepTemplates, dieSets, canEdit, today, onChanged }) {
  const [planModal, setPlanModal] = useState(null);
  const [stepModal, setStepModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openIds, setOpenIds] = useState(() => new Set());
  const [filterPart, setFilterPart] = useState('');

  const rows = useMemo(() => tooling.filter(t => !filterPart || t.part_id === filterPart), [tooling, filterPart]);
  const range = useMemo(() => ganttRange([...tooling, ...steps], today), [tooling, steps, today]);
  const todayPos = range ? barPos(today, today, range) : null;

  const savePlan = async () => {
    const m = planModal;
    if (!m.part_id) return toast.error('เลือกพาร์ท');
    if (!m.tool_name?.trim()) return toast.error('กรอกชื่อเครื่องมือ');
    setSaving(true);
    const row = { part_id: m.part_id, tool_name: m.tool_name.trim(), tool_kind: m.tool_kind, maker_name: m.maker_name?.trim() || null, maker_kind: m.maker_kind,
      po_no: m.po_no?.trim() || null, die_set_code: m.die_set_code?.trim() || null, plan_start: m.plan_start || null, plan_end: m.plan_end || null,
      actual_start: m.actual_start || null, actual_end: m.actual_end || null, status: m.status, owner_name: m.owner_name?.trim() || null, note: m.note?.trim() || null };
    let res;
    if (m.id) res = await supabase.from('npi_tooling_plans').update(row).eq('id', m.id).select().single();
    else res = await supabase.from('npi_tooling_plans').insert(row).select().single();
    if (res.error) { setSaving(false); return toast.error(`บันทึกไม่สำเร็จ: ${res.error.message}`); }
    if (!m.id && m._seedSteps) {
      const st = proposeSteps(stepTemplates, m.tool_kind, m.plan_start || null).map(s => ({ ...s, tooling_id: res.data.id }));
      if (st.length) {
        const { error } = await supabase.from('npi_tooling_steps').insert(st);
        if (error) toast.error(`สร้างแผนแล้ว แต่เพิ่มขั้นงานจากแม่แบบไม่สำเร็จ: ${error.message}`);
        // วันจบแผน = วันจบขั้นสุดท้าย ถ้ายังไม่ได้กรอก
        else if (!m.plan_end && st[st.length - 1].plan_end) await supabase.from('npi_tooling_plans').update({ plan_end: st[st.length - 1].plan_end }).eq('id', res.data.id);
      } else toast.info(`ไม่มีแม่แบบขั้นงานของชนิด "${TOOL_KIND[m.tool_kind]?.label}" — เพิ่มขั้นเองได้`);
    }
    setSaving(false);
    toast.success('บันทึกแผนแล้ว'); setPlanModal(null);
    setOpenIds(s => new Set(s).add(res.data.id));
    onChanged();
  };
  const delPlan = async (t) => {
    if (!window.confirm(`ลบแผน "${t.tool_name}" พร้อมขั้นงานทั้งหมด?`)) return;
    const { error } = await supabase.from('npi_tooling_plans').delete().eq('id', t.id);
    if (error) return toast.error(error.message);
    onChanged();
  };
  const saveStep = async () => {
    const m = stepModal;
    if (!m.name?.trim()) return toast.error('กรอกชื่อขั้นงาน');
    setSaving(true);
    const pct = Math.max(0, Math.min(100, Number(m.progress_pct) || 0));
    const status = pct >= 100 ? 'completed' : m.status === 'completed' ? 'in_progress' : m.status;
    const row = { name: m.name.trim(), seq: Number(m.seq) || 0, plan_start: m.plan_start || null, plan_end: m.plan_end || null,
      actual_start: m.actual_start || null, actual_end: status === 'completed' ? (m.actual_end || today) : (m.actual_end || null),
      progress_pct: status === 'completed' ? 100 : pct, responsible_name: m.responsible_name?.trim() || null, status, note: m.note?.trim() || null };
    let res;
    if (m.id) res = await supabase.from('npi_tooling_steps').update(row).eq('id', m.id);
    else res = await supabase.from('npi_tooling_steps').insert({ ...row, tooling_id: m.tooling_id });
    setSaving(false);
    if (res.error) return toast.error(res.error.message);
    setStepModal(null); onChanged();
  };
  const delStep = async (s) => {
    if (!window.confirm(`ลบขั้น "${s.name}"?`)) return;
    const { error } = await supabase.from('npi_tooling_steps').delete().eq('id', s.id);
    if (error) return toast.error(error.message);
    onChanged();
  };

  const toggle = (id) => setOpenIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>🔧 แผนพัฒนาเครื่องมือ ({rows.length})</div>
          <select value={filterPart} onChange={e => setFilterPart(e.target.value)} style={{ ...inp, width: 'auto', minWidth: 160 }}>
            <option value="">ทุกพาร์ท</option>{parts.map(p => <option key={p.id} value={p.id}>{p.part_no}</option>)}
          </select>
        </div>
        {canEdit && <button style={btn()} onClick={() => setPlanModal({ part_id: filterPart || parts[0]?.id || '', tool_name: '', tool_kind: 'die', maker_name: '', maker_kind: 'external', po_no: '', die_set_code: '', plan_start: today, plan_end: '', actual_start: '', actual_end: '', status: 'planned', owner_name: '', note: '', _seedSteps: true })}>+ แผน tooling</button>}
      </div>
      {!parts.length && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>เพิ่มพาร์ทในโปรเจคก่อน</div>}
      {parts.length > 0 && !rows.length && <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>ยังไม่มีแผน tooling — กด + แผน tooling (ระบบเสนอขั้นงานตามชนิดให้)</div>}

      {range && rows.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span>ช่วงแสดง {fmtDate(range.start)} → {fmtDate(range.end)} ({range.days} วัน)</span>
          <span>▮ แผน · ▮ จริง · เส้นแดง = วันนี้</span>
        </div>
      )}

      {rows.map(t => {
        const st = steps.filter(s => s.tooling_id === t.id).sort((a, b) => a.seq - b.seq);
        const r = toolingRollup(t, st, today);
        const p = parts.find(x => x.id === t.part_id);
        const open = openIds.has(t.id);
        const kind = TOOL_KIND[t.tool_kind] || TOOL_KIND.other;
        const die = t.die_set_code ? dieSets.find(d => d.set_code === t.die_set_code) : null;
        return (
          <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.2fr) minmax(220px, 2fr) auto', gap: 10, alignItems: 'center', padding: '8px 10px', background: 'var(--bg2)', borderRadius: 8 }}>
              <div onClick={() => toggle(t.id)} style={{ cursor: 'pointer', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <LightDot light={r.light} /><span>{kind.icon}</span><span style={{ fontWeight: 800, fontSize: 13 }}>{t.tool_name}</span>
                  <Pill label={TOOL_STATUS[t.status]?.label} color={TOOL_STATUS[t.status]?.color} small />
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {p?.part_no || '—'} · {kind.label} · ผู้ทำ {t.maker_name || '—'} ({t.maker_kind === 'internal' ? 'ภายใน' : 'ภายนอก'}) · {r.done}/{r.total} ขั้น · {r.pct}%{r.delayed ? <span style={{ color: '#ef4444', fontWeight: 800 }}> · ล่าช้า {r.delayed}</span> : null}
                  {t.die_set_code && <> · 🧱 {die ? <Link to="/die-registry" style={{ color: '#4d9fff' }}>{t.die_set_code}</Link> : <span style={{ color: '#f59e0b' }} title="ไม่พบใน die_sets">{t.die_set_code} (ไม่พบในทะเบียน)</span>}</>}
                </div>
              </div>
              <GanttRow plan={[t.plan_start, t.plan_end]} actual={[t.actual_start, t.actual_end]} range={range} todayPos={todayPos} pct={r.pct} light={r.light} />
              <div style={{ whiteSpace: 'nowrap' }}>
                {canEdit && <><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setPlanModal({ ...t, plan_start: t.plan_start || '', plan_end: t.plan_end || '', actual_start: t.actual_start || '', actual_end: t.actual_end || '', maker_name: t.maker_name || '', po_no: t.po_no || '', die_set_code: t.die_set_code || '', owner_name: t.owner_name || '', note: t.note || '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => delPlan(t)}>🗑</button> </>}
                <button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => toggle(t.id)}>{open ? '▲' : '▼'}</button>
              </div>
            </div>
            {open && (
              <div style={{ padding: '6px 10px 10px' }}>
                {!st.length && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีขั้นงาน</div>}
                {st.map(s => {
                  const lt = stepLight(s, today);
                  return (
                    <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.2fr) minmax(220px, 2fr) auto', gap: 10, alignItems: 'center', padding: '4px 0', borderTop: '1px solid var(--border)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><LightDot light={lt} size={10} /><span style={{ fontSize: 12.5, fontWeight: 700 }}>{s.seq}. {s.name}</span><Pill label={`${s.progress_pct}%`} color={(LIGHT[lt] || LIGHT.grey).color} small /></div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>แผน {s.plan_start ? fmtDate(s.plan_start) : '—'}→{s.plan_end ? fmtDate(s.plan_end) : '—'} · จริง {s.actual_start ? fmtDate(s.actual_start) : '—'}→{s.actual_end ? fmtDate(s.actual_end) : '—'} · {s.responsible_name || '—'}{s.note ? ` · ${s.note}` : ''}</div>
                      </div>
                      <GanttRow plan={[s.plan_start, s.plan_end]} actual={[s.actual_start, s.actual_end]} range={range} todayPos={todayPos} pct={s.progress_pct} light={lt} thin />
                      <div style={{ whiteSpace: 'nowrap' }}>
                        {canEdit && <><button className="tbtn" style={{ ...ghost, padding: '2px 7px' }} onClick={() => setStepModal({ ...s, plan_start: s.plan_start || '', plan_end: s.plan_end || '', actual_start: s.actual_start || '', actual_end: s.actual_end || '', responsible_name: s.responsible_name || '', note: s.note || '' })}>✏️</button> <button className="tbtn" style={{ ...ghost, padding: '2px 7px', color: '#ef4444' }} onClick={() => delStep(s)}>🗑</button></>}
                      </div>
                    </div>
                  );
                })}
                {canEdit && <button style={{ ...ghost, marginTop: 6 }} onClick={() => setStepModal({ tooling_id: t.id, name: '', seq: (st[st.length - 1]?.seq || 0) + 10, plan_start: '', plan_end: '', actual_start: '', actual_end: '', progress_pct: 0, responsible_name: '', status: 'not_started', note: '' })}>+ ขั้นงาน</button>}
              </div>
            )}
          </div>
        );
      })}

      {planModal && (
        <Modal title={planModal.id ? `แก้ไขแผน ${planModal.tool_name}` : 'เพิ่มแผน tooling'} onClose={() => setPlanModal(null)} width={680}
          footer={<><button style={ghost} onClick={() => setPlanModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={savePlan}>{saving ? 'กำลังบันทึก…' : '💾 บันทึก'}</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="พาร์ท *"><select style={inp} value={planModal.part_id} onChange={e => setPlanModal({ ...planModal, part_id: e.target.value })}><option value="">—</option>{parts.map(p => <option key={p.id} value={p.id}>{p.part_no} · {p.part_name || ''}</option>)}</select></Field>
            <Field label="ชนิด"><select style={inp} value={planModal.tool_kind} onChange={e => setPlanModal({ ...planModal, tool_kind: e.target.value })}>{Object.entries(TOOL_KIND).map(([k, m]) => <option key={k} value={k}>{m.icon} {m.label}</option>)}</select></Field>
            <Field label="ชื่อเครื่องมือ *" span={2}><input style={inp} value={planModal.tool_name} onChange={e => setPlanModal({ ...planModal, tool_name: e.target.value })} placeholder="OP10 DRAW DIE / CHECKING FIXTURE RH" /></Field>
            <Field label="ผู้ทำ (maker)" hint="text ไปก่อน — supplier master เฟส 4"><input style={inp} value={planModal.maker_name} onChange={e => setPlanModal({ ...planModal, maker_name: e.target.value })} /></Field>
            <Field label="ทำที่"><select style={inp} value={planModal.maker_kind} onChange={e => setPlanModal({ ...planModal, maker_kind: e.target.value })}><option value="external">ภายนอก</option><option value="internal">ภายใน (JIG/DIE shop)</option></select></Field>
            <Field label="P/O"><input style={inp} value={planModal.po_no} onChange={e => setPlanModal({ ...planModal, po_no: e.target.value })} /></Field>
            <Field label="สถานะ"><MetaSelect value={planModal.status} onChange={v => setPlanModal({ ...planModal, status: v })} meta={TOOL_STATUS} /></Field>
            <Field label="แผนเริ่ม"><input type="date" style={inp} value={planModal.plan_start} onChange={e => setPlanModal({ ...planModal, plan_start: e.target.value })} /></Field>
            <Field label="แผนส่งมอบ" hint="เว้นว่าง = ใช้วันจบขั้นสุดท้าย"><input type="date" style={inp} value={planModal.plan_end} onChange={e => setPlanModal({ ...planModal, plan_end: e.target.value })} /></Field>
            <Field label="เริ่มจริง"><input type="date" style={inp} value={planModal.actual_start} onChange={e => setPlanModal({ ...planModal, actual_start: e.target.value })} /></Field>
            <Field label="ส่งมอบจริง"><input type="date" style={inp} value={planModal.actual_end} onChange={e => setPlanModal({ ...planModal, actual_end: e.target.value })} /></Field>
            <Field label="ผูกชุดแม่พิมพ์ (die_sets) หลัง transfer" hint="ทะเบียนที่ /die-registry"><input style={inp} value={planModal.die_set_code} onChange={e => setPlanModal({ ...planModal, die_set_code: e.target.value })} list="npi-die-sets" placeholder="set_code" /></Field>
            <Field label="ผู้รับผิดชอบ"><input style={inp} value={planModal.owner_name} onChange={e => setPlanModal({ ...planModal, owner_name: e.target.value })} list="npi-users" /></Field>
            <Field label="หมายเหตุ" span={2}><input style={inp} value={planModal.note} onChange={e => setPlanModal({ ...planModal, note: e.target.value })} /></Field>
          </div>
          {!planModal.id && (
            <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
              <input type="checkbox" checked={!!planModal._seedSteps} onChange={e => setPlanModal({ ...planModal, _seedSteps: e.target.checked })} />
              สร้างขั้นงานจากแม่แบบชนิด "{TOOL_KIND[planModal.tool_kind]?.label}" ({stepTemplates.filter(s => s.tool_kind === planModal.tool_kind).length} ขั้น · วันแผนต่อเนื่องจากวันเริ่ม — แก้ทีหลังได้)
            </label>
          )}
          <datalist id="npi-die-sets">{dieSets.map(d => <option key={d.set_code} value={d.set_code}>{d.part_no || ''} {d.model || ''}</option>)}</datalist>
        </Modal>
      )}

      {stepModal && (
        <Modal title={stepModal.id ? `ขั้น ${stepModal.name}` : 'เพิ่มขั้นงาน'} onClose={() => setStepModal(null)} width={600}
          footer={<><button style={ghost} onClick={() => setStepModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveStep}>💾 บันทึก</button></>}>
          <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' }}>
            <Field label="ชื่อขั้นงาน *" span={2}><input style={inp} value={stepModal.name} onChange={e => setStepModal({ ...stepModal, name: e.target.value })} /></Field>
            <Field label="ลำดับ"><input type="number" style={inp} value={stepModal.seq} onChange={e => setStepModal({ ...stepModal, seq: e.target.value })} /></Field>
            <Field label="ความคืบหน้า %" hint="100 = เสร็จ"><input type="number" min={0} max={100} style={inp} value={stepModal.progress_pct} onChange={e => setStepModal({ ...stepModal, progress_pct: e.target.value })} /></Field>
            <Field label="แผนเริ่ม"><input type="date" style={inp} value={stepModal.plan_start} onChange={e => setStepModal({ ...stepModal, plan_start: e.target.value })} /></Field>
            <Field label="แผนจบ"><input type="date" style={inp} value={stepModal.plan_end} onChange={e => setStepModal({ ...stepModal, plan_end: e.target.value })} /></Field>
            <Field label="เริ่มจริง"><input type="date" style={inp} value={stepModal.actual_start} onChange={e => setStepModal({ ...stepModal, actual_start: e.target.value })} /></Field>
            <Field label="จบจริง"><input type="date" style={inp} value={stepModal.actual_end} onChange={e => setStepModal({ ...stepModal, actual_end: e.target.value })} /></Field>
            <Field label="สถานะ"><MetaSelect value={stepModal.status} onChange={v => setStepModal({ ...stepModal, status: v, progress_pct: v === 'completed' ? 100 : stepModal.progress_pct })} meta={STEP_STATUS} /></Field>
            <Field label="ผู้รับผิดชอบ"><input style={inp} value={stepModal.responsible_name} onChange={e => setStepModal({ ...stepModal, responsible_name: e.target.value })} list="npi-users" /></Field>
            <Field label="หมายเหตุ" span={2}><input style={inp} value={stepModal.note} onChange={e => setStepModal({ ...stepModal, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** แถว Gantt: แท่งแผน (จาง) + แท่งจริง/ความคืบหน้า (เข้ม) + เส้นวันนี้ */
function GanttRow({ plan, actual, range, todayPos, pct, light, thin }) {
  if (!range) return <div style={{ fontSize: 11, color: 'var(--muted)' }}>ยังไม่มีวันแผน</div>;
  const pb = barPos(plan[0], plan[1], range);
  const ab = barPos(actual[0], actual[1] || null, range);
  const c = (LIGHT[light] || LIGHT.grey).color;
  const h = thin ? 10 : 16;
  return (
    <div style={{ position: 'relative', height: h + 6, background: 'var(--bg)', borderRadius: 4, border: '1px solid var(--border)' }}>
      {pb && <div title={`แผน ${plan[0] || ''} → ${plan[1] || ''}`} style={{ position: 'absolute', top: 3, height: h, left: `${pb.left}%`, width: `${pb.width}%`, background: `${c}44`, borderRadius: 3 }}>
        {pct > 0 && <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: c, borderRadius: 3, opacity: 0.9 }} />}
      </div>}
      {ab && <div title={`จริง ${actual[0] || ''} → ${actual[1] || 'กำลังทำ'}`} style={{ position: 'absolute', top: 3 + h - 3, height: 3, left: `${ab.left}%`, width: `${ab.width}%`, background: 'var(--text)', borderRadius: 2 }} />}
      {todayPos && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPos.left}%`, width: 2, background: '#ef4444' }} />}
    </div>
  );
}
