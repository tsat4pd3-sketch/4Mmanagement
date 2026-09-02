import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import {
  shimStack, SHIM_REASONS, SHIM_ACTIONS, n0,
  toolLifeStatus, learnedToolLife, suggestMaxShim,
} from '../utils/fixturePoints';

/* ═══════════════════════════════════════════════════════════════
   🔧 บันทึกการใส่/ถอดชิม — หัวใจของโมดูล

   🔴 กฎเหล็ก (docs/FIXTURE-SHIM-DESIGN.md §7):
     **ค่ารวม (shim_after_mm) คือความจริง · +/- เป็นแค่วิธีกรอก**
     ห้ามเก็บ delta เป็นความจริงแล้วบวกสะสม — พลาดรายการเดียวค่ารวมเพี้ยนตลอดกาล
     และหาต้นตอไม่เจอ · เก็บค่ารวมทุกครั้ง = ตรวจนับจริงแล้วพิมพ์ทับได้เลย (action='recount')

   ⚠️ ไม่ตั้งเพดาน (max_shim_mm = null) = ไม่เตือนอะไรเลย — ห้ามตีเป็น 0
   ⚠️ ระบบ "เสนอ" เกณฑ์/tool life จากข้อมูลจริง แต่ไม่ตั้งให้เอง (คนกดยืนยัน)
═══════════════════════════════════════════════════════════════ */

const inp = {
  width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
const LV = {
  ok:       { c: '#22c55e', t: 'อยู่ในเกณฑ์' },
  warn:     { c: '#f59e0b', t: 'ใกล้เพดาน' },
  over:     { c: '#ef4444', t: 'เกินเพดาน — ควรซ่อมจริง ไม่ใช่ใส่ชิมเพิ่ม' },
  no_limit: { c: '#94a3b8', t: 'ยังไม่ตั้งเพดาน (ไม่เตือน)' },
  unknown:  { c: '#94a3b8', t: 'ยังไม่เคยบันทึกชิม' },
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

const fmt = (v, unit = ' mm') => (v == null ? '—' : `${v}${unit}`);
const dt = (s) => (s ? new Date(s).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function FixtureShimPanel({
  points, pointId, onPickPoint, canRecord, canApprove, canManage,
  fullName, currentShot, shotAssumed, onSaved,
}) {
  const point = useMemo(() => points.find(p => p.id === pointId) || null, [points, pointId]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [saving, setSaving] = useState(false);

  const [mode, setMode] = useState('delta');   // delta = พิมพ์ +/- · total = พิมพ์ค่ารวม
  const [f, setF] = useState({
    action: 'add', delta: '', total: '', plates_text: '',
    measure_before: '', measure_after: '', reason: 'wear', note: '',
  });

  const load = useCallback(async () => {
    if (!pointId) { setEvents([]); return; }
    setLoading(true); setLoadErr('');
    const { data, error } = await supabaseDR
      .from('fixture_shim_events').select('*')
      .eq('point_id', pointId).order('event_at', { ascending: false }).limit(200);
    if (error) { setLoadErr(error.message); setEvents([]); }
    else setEvents(data || []);
    setLoading(false);
  }, [pointId]);
  useEffect(() => { load(); }, [load]);

  // รีเซ็ตฟอร์มเมื่อเปลี่ยนจุด — กันค่าค้างจากจุดก่อนหน้าถูกบันทึกผิดจุด
  useEffect(() => {
    setF({ action: 'add', delta: '', total: '', plates_text: '',
           measure_before: '', measure_after: '', reason: 'wear', note: '' });
    setMode('delta');
  }, [pointId]);

  const st = useMemo(() => (point ? shimStack(point) : null), [point]);
  const life = useMemo(() => (point ? toolLifeStatus(point, currentShot) : null), [point, currentShot]);
  const learned = useMemo(() => learnedToolLife(events), [events]);
  const maxSug = useMemo(() => suggestMaxShim(events), [events]);

  // ── ค่ารวมใหม่ที่จะถูกบันทึกจริง (คำนวณจาก 2 โหมดให้ลงที่เดียวกัน) ──
  const before = st?.current ?? null;
  const preview = useMemo(() => {
    if (mode === 'total') {
      const t = n0(f.total);
      return { after: t, delta: t != null && before != null ? +(t - before).toFixed(3) : null };
    }
    const d0 = n0(f.delta);
    const d = d0 == null ? null : (f.action === 'remove' ? -Math.abs(d0) : d0);
    return { after: d != null ? +((before ?? 0) + d).toFixed(3) : null, delta: d };
  }, [mode, f.total, f.delta, f.action, before]);

  const afterStack = useMemo(
    () => (point ? shimStack({ ...point, current_shim_mm: preview.after }) : null),
    [point, preview.after],
  );

  const save = async () => {
    if (!point) return;
    if (preview.after == null) { toast.error('กรอกค่าชิมก่อน'); return; }
    if (preview.after < 0)     { toast.error('ค่ารวมติดลบไม่ได้'); return; }
    if (f.reason === 'other' && !f.note.trim()) { toast.error('เหตุผล "อื่นๆ" ต้องระบุรายละเอียด'); return; }
    if (afterStack?.level === 'over' &&
        !window.confirm(`หลังบันทึกจะเป็น ${preview.after} mm ซึ่ง **เกินเพดาน ${point.max_shim_mm} mm**\n\nชิมชดเชยต่อไปไม่ไหวแล้ว — ควรเปิดใบซ่อมเพื่อเปลี่ยนชิ้นส่วนจริง\n\nยืนยันบันทึกต่อ?`)) return;

    setSaving(true);
    try {
      const isReplace = f.action === 'part_replaced';
      const { error } = await supabaseDR.from('fixture_shim_events').insert({
        point_id: point.id,
        action: f.action,
        shim_before_mm: before,
        shim_after_mm: preview.after,
        delta_mm: preview.delta,
        plates_text: f.plates_text.trim() || null,
        measure_before: n0(f.measure_before),
        measure_after: n0(f.measure_after),
        reason: f.reason,
        note: f.note.trim() || null,
        by_name: fullName || null,
        shot_at_event: currentShot ?? null,
      });
      if (error) throw error;

      // ค่ารวมปัจจุบันของจุด = ค่าจาก event ล่าสุดเสมอ (ไม่บวกสะสม)
      const patch = { current_shim_mm: preview.after };
      if (isReplace) {
        patch.last_replaced_at = new Date().toISOString();
        patch.last_replaced_shot = currentShot ?? null;
      }
      const { error: pErr } = await supabaseDR
        .from('fixture_points').update(patch).eq('id', point.id).select('id');
      if (pErr) {
        toast.error(`บันทึกเหตุการณ์แล้ว แต่อัปเดตค่ารวมของจุดไม่สำเร็จ: ${pErr.message}`);
      } else {
        toast.success(`บันทึกแล้ว · ค่ารวมใหม่ ${preview.after} mm`);
      }
      setF(p => ({ ...p, delta: '', total: '', plates_text: '', measure_before: '', measure_after: '', note: '' }));
      await load();
      onSaved?.();
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e.message}`);
    } finally { setSaving(false); }
  };

  const approve = async (ev) => {
    const { data, error } = await supabaseDR.from('fixture_shim_events')
      .update({ approved_by: fullName || 'ไม่ระบุ', approved_at: new Date().toISOString() })
      .eq('id', ev.id).select('id');
    if (error) return toast.error(`อนุมัติไม่สำเร็จ: ${error.message}`);
    if (!data?.length) return toast.error('อนุมัติไม่สำเร็จ — ไม่มีแถวถูกเขียน');
    toast.success('อนุมัติแล้ว');
    load();
  };

  if (!points.length) {
    return <div style={{ fontSize: 13, color: 'var(--muted)' }}>
      ยังไม่มีจุดในทะเบียนของฟิกเจอร์ตัวนี้ — ไปที่แท็บ <b>📋 ทะเบียนจุด</b> เพื่อลงจุดก่อน
    </div>;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>จุด:</span>
        <select value={pointId || ''} onChange={e => onPickPoint(e.target.value)} style={{ ...inp, width: 300 }}>
          <option value="">— เลือกจุด —</option>
          {points.map(p => {
            const s = shimStack(p);
            const mark = s.level === 'over' ? '🔴 ' : s.level === 'warn' ? '🟠 ' : '';
            return <option key={p.id} value={p.id}>
              {mark}{p.point_no}{p.name ? ` · ${p.name}` : ''} — {s.current == null ? 'ยังไม่บันทึก' : `${s.current} mm`}
            </option>;
          })}
        </select>
      </div>

      {!point ? (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>เลือกจุดที่ต้องการบันทึก</div>
      ) : (
        <>
          {/* สถานะปัจจุบันของจุด */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              ['ค่ารวมปัจจุบัน', fmt(st.current), LV[st.level].c],
              ['baseline (วันรับมอบ)', fmt(st.baseline), '#94a3b8'],
              ['ห่างจาก baseline', st.added == null ? '—' : `${st.added > 0 ? '+' : ''}${st.added} mm`, '#94a3b8'],
              ['เพดาน', fmt(n0(point.max_shim_mm)), LV[st.level].c],
            ].map(([k, v, c]) => (
              <div key={k} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
                                    padding: '8px 14px', minWidth: 128 }}>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{k}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: c }}>{v}</div>
              </div>
            ))}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
                          padding: '8px 14px', minWidth: 150 }}>
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>อายุชิ้นส่วน (tool life)</div>
              <div style={{ fontSize: 17, fontWeight: 800,
                            color: life.level === 'over' ? '#ef4444' : life.level === 'warn' ? '#f59e0b'
                                 : life.level === 'unknown' ? '#94a3b8' : '#22c55e' }}>
                {life.pct == null ? 'ประเมินไม่ได้' : `${Math.round(life.pct)}%`}
              </div>
              {life.pct == null && (
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {point.expected_life_cycles == null ? 'ยังไม่ตั้งอายุชิ้นส่วน' : 'ยังนับ shot ไม่ได้'}
                </div>
              )}
            </div>
          </div>

          <div style={{ fontSize: 12, color: LV[st.level].c, fontWeight: 600 }}>
            {st.level === 'over' ? '🔴 ' : st.level === 'warn' ? '🟠 ' : ''}{LV[st.level].t}
          </div>

          {shotAssumed && (
            <div style={{ fontSize: 11.5, color: '#f59e0b' }}>
              ⚠️ shot สะสมเป็นค่าประมาณจากยอดผลิต (ยังไม่ตั้ง “ชิ้นต่อ 1 ครั้ง” ของฟิกเจอร์นี้ — ระบบถือว่า 1:1)
            </div>
          )}

          {/* ── ฟอร์มบันทึก ── */}
          {canRecord ? (
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14,
                          display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
                <Field label="สิ่งที่ทำ">
                  <select value={f.action} onChange={e => setF(p => ({ ...p, action: e.target.value }))} style={inp}>
                    {SHIM_ACTIONS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </Field>
                <Field label="วิธีกรอก" hint="ลงที่ค่ารวมเหมือนกัน">
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['delta', '+ / − จากเดิม'], ['total', 'พิมพ์ค่ารวม']].map(([k, l]) => (
                      <button key={k} onClick={() => setMode(k)}
                              style={{ flex: 1, padding: '7px 4px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                                       border: `1px solid ${mode === k ? '#16a34a' : 'var(--border)'}`,
                                       background: mode === k ? 'rgba(34,197,94,0.15)' : 'var(--bg)',
                                       color: 'var(--text)', fontWeight: mode === k ? 700 : 400 }}>{l}</button>
                    ))}
                  </div>
                </Field>
                {mode === 'delta' ? (
                  <Field label={f.action === 'remove' ? 'ถอดออก (mm)' : 'ใส่เพิ่ม (mm)'} hint="เช่น 0.2">
                    <input value={f.delta} onChange={e => setF(p => ({ ...p, delta: e.target.value }))}
                           inputMode="decimal" placeholder="0.2" style={inp} />
                  </Field>
                ) : (
                  <Field label="ค่ารวมหลังทำ (mm)" hint="ตรวจนับจริงแล้วพิมพ์ทับได้">
                    <input value={f.total} onChange={e => setF(p => ({ ...p, total: e.target.value }))}
                           inputMode="decimal" placeholder="0.7" style={inp} />
                  </Field>
                )}
                <Field label="แผ่นที่ใช้" hint="ข้อความประกอบ">
                  <input value={f.plates_text} onChange={e => setF(p => ({ ...p, plates_text: e.target.value }))}
                         placeholder="0.5 + 0.2" style={inp} />
                </Field>
                <Field label="ค่าที่วัดได้ ก่อน">
                  <input value={f.measure_before} onChange={e => setF(p => ({ ...p, measure_before: e.target.value }))}
                         inputMode="decimal" style={inp} />
                </Field>
                <Field label="ค่าที่วัดได้ หลัง">
                  <input value={f.measure_after} onChange={e => setF(p => ({ ...p, measure_after: e.target.value }))}
                         inputMode="decimal" style={inp} />
                </Field>
                <Field label="เหตุผล">
                  <select value={f.reason} onChange={e => setF(p => ({ ...p, reason: e.target.value }))} style={inp}>
                    {SHIM_REASONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </Field>
                <Field label="หมายเหตุ" hint={f.reason === 'other' ? 'บังคับ' : 'ถ้ามี'}>
                  <input value={f.note} onChange={e => setF(p => ({ ...p, note: e.target.value }))} style={inp} />
                </Field>
              </div>

              {/* พรีวิวสิ่งที่จะถูกบันทึกจริง — เห็นทั้ง 2 ทางเสมอ */}
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5 }}>
                {preview.after == null ? (
                  <span style={{ color: 'var(--muted)' }}>กรอกค่าชิมเพื่อดูผลลัพธ์</span>
                ) : (
                  <>
                    จะบันทึกเป็น <b style={{ fontSize: 15 }}>{preview.after} mm</b>
                    <span style={{ color: 'var(--muted)' }}>
                      {' '}({before == null ? 'ยังไม่เคยบันทึกค่าเดิม' : `จากเดิม ${before} mm`}
                      {preview.delta != null && `, ${preview.delta > 0 ? '+' : ''}${preview.delta} mm`})
                    </span>
                    {afterStack?.level === 'over' && (
                      <div style={{ color: '#ef4444', fontWeight: 700, marginTop: 4 }}>
                        🔴 เกินเพดาน {point.max_shim_mm} mm — ชิมชดเชยต่อไม่ไหว ควรเปิดใบซ่อมเปลี่ยนชิ้นส่วนจริง
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <button onClick={save} disabled={saving || preview.after == null}
                        style={{ background: preview.after != null ? '#16a34a' : 'var(--bg2)',
                                 color: preview.after != null ? '#fff' : 'var(--muted)', border: 'none',
                                 borderRadius: 8, padding: '9px 22px', fontSize: 13, fontWeight: 700,
                                 cursor: saving || preview.after == null ? 'not-allowed' : 'pointer' }}>
                  {saving ? 'กำลังบันทึก…' : '💾 บันทึก'}
                </button>
              </div>
            </div>
          ) : null}

          {/* ── ข้อเสนอจากข้อมูลจริง (เสนอ ไม่ตั้งให้เอง) ── */}
          {canManage && (learned.suggested != null || (maxSug.suggested != null && point.max_shim_mm == null)) && (
            <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.35)',
                          borderRadius: 10, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.7 }}>
              <b>💡 ข้อเสนอจากประวัติจริงของจุดนี้</b> — ระบบไม่ตั้งให้เอง ไปกดยืนยันที่แท็บทะเบียนจุด
              {learned.suggested != null && (
                <div>• อายุชิ้นส่วนจริงเฉลี่ย <b>{learned.suggested.toLocaleString()} shot</b> (จาก {learned.samples} ช่วงการเปลี่ยน)</div>
              )}
              {maxSug.suggested != null && point.max_shim_mm == null && (
                <div>• เพดานชิมที่เหมาะ ~<b>{maxSug.suggested} mm</b> (จากค่าที่เคยใช้จริง {maxSug.samples} ครั้ง)</div>
              )}
            </div>
          )}

          {/* ── ประวัติ ── */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
              ประวัติของจุดนี้ {loading && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· กำลังโหลด…</span>}
            </div>
            {loadErr ? (
              <div style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.45)',
                            borderRadius: 8, padding: '8px 12px', fontSize: 12.5 }}>
                ⚠️ โหลดประวัติไม่สำเร็จ: {loadErr} — <b>ไม่ใช่ว่าไม่มีประวัติ</b>
                <button onClick={load} style={{ marginLeft: 8, padding: '3px 10px', borderRadius: 6, fontSize: 12,
                        background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                  ลองใหม่
                </button>
              </div>
            ) : !events.length ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่มีประวัติ</div>
            ) : (
              <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--bg2)' }}>
                    <tr style={{ textAlign: 'left' }}>
                      {['เมื่อ', 'ทำอะไร', 'ก่อน → หลัง', 'เหตุผล', 'ผู้ทำ', 'อนุมัติ'].map(h => (
                        <th key={h} style={{ padding: '7px 10px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(ev => (
                      <tr key={ev.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>{dt(ev.event_at)}</td>
                        <td style={{ padding: '6px 10px' }}>
                          {SHIM_ACTIONS.find(a => a.key === ev.action)?.label || ev.action}
                        </td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                          {fmt(n0(ev.shim_before_mm))} → <b>{fmt(n0(ev.shim_after_mm))}</b>
                          {ev.plates_text && <span style={{ color: 'var(--muted)' }}> ({ev.plates_text})</span>}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          {SHIM_REASONS.find(r => r.key === ev.reason)?.label || ev.reason || '—'}
                          {ev.note && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{ev.note}</div>}
                        </td>
                        <td style={{ padding: '6px 10px' }}>{ev.by_name || '—'}</td>
                        <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                          {ev.approved_by ? (
                            <span style={{ color: '#22c55e' }}>✓ {ev.approved_by}</span>
                          ) : canApprove ? (
                            <button onClick={() => approve(ev)}
                                    style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
                                             background: '#16a34a', color: '#fff', border: 'none' }}>อนุมัติ</button>
                          ) : (
                            <span style={{ color: '#f59e0b' }}>รออนุมัติ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
