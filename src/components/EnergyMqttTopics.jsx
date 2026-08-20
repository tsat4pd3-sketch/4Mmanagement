/* 📡 ทะเบียน MQTT topic ของมิเตอร์ไฟฟ้า — ให้ทีมช่างเพิ่ม topic เองจากหน้าจอ
   user: "ทำเป็นหน้าให้ user mtn สามารถเพิ่ม topic ที่จะให้ read เลยได้มั้ย"
   แบบเต็ม + เหตุผลของทุกข้อ: docs/ENERGY_MONITORING_DESIGN.md §14

   ⚠️⚠️ หน้านี้เป็น "ทะเบียนตั้งค่า" — **การเพิ่ม topic ที่นี่ยังไม่ทำให้มีข้อมูลเข้ามา**
      ต้องมี MQTT bridge บนเครื่องในโรงงาน + edge function ingest-energy ก่อน
      → ต้องบอกบนจอให้ชัดที่สุด ไม่งั้นช่างเพิ่ม topic แล้วนั่งรอข้อมูลที่ไม่มีวันมา
      (กฎโปรเจค: ห้ามล้มเหลวเงียบ)

   ⚠️ สิทธิ์ใช้ `energy:record` เดิม ไม่สร้าง key ใหม่ — เลี่ยงกับดัก seed enum_range
      (role ที่เพิ่มทีหลังจะไม่มีแถว = เข้าไม่ได้แบบ fail-closed) · mtn/engineer มีอยู่แล้ว */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from '../components/Toast';
import { MQTT_FIELDS, mqttField, LIVE_STALE_MIN, liveAgeMin } from '../utils/energy';

const inp = { width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 };
const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, padding: '7px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 12.5 };
const secTitle = { fontSize: 13, fontWeight: 800, color: 'var(--text)', margin: '0 0 8px' };
const GOOD = '#22c55e', WARN = '#f59e0b', BAD = '#ef4444';

const EMPTY = { topic: '', field: 'kw', scope_kind: 'zone', scope_name: '', json_path: '', scale: '1', note: '' };

export default function EnergyMqttTopics({ points, canEdit }) {
  const [rows, setRows] = useState([]);
  const [live, setLive] = useState([]);
  const [unmapped, setUnmapped] = useState([]);
  const [missing, setMissing] = useState(false);   // ยังไม่ apply migration
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: t, error: tErr }, { data: lv }, { data: um }] = await Promise.all([
      supabaseDR.from('energy_meter_topics').select('*').order('scope_name').order('topic'),
      supabaseDR.from('energy_live').select('*'),
      supabaseDR.from('energy_topic_unmapped').select('*').order('last_seen', { ascending: false }).limit(50),
    ]);
    setMissing(!!tErr);
    setRows(t || []); setLive(lv || []); setUnmapped(um || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const liveOf = useMemo(() => {
    const m = {};
    for (const l of live) m[`${l.scope_kind}::${l.scope_name}::${l.field}`] = l;
    return m;
  }, [live]);

  /* มี bridge ทำงานอยู่จริงไหม — ดูจากค่าล่าสุดที่เคยรับเข้ามา (ไม่ใช่จากจำนวน topic ที่ตั้งไว้) */
  const newestAge = useMemo(() => {
    const ages = live.map(l => liveAgeMin(l.received_at)).filter(a => a != null);
    return ages.length ? Math.min(...ages) : null;
  }, [live]);
  const bridgeAlive = newestAge != null && newestAge <= LIVE_STALE_MIN;

  const save = async () => {
    const topic = form.topic.trim();
    if (!topic) return toast.error('ใส่ topic ด้วย');
    if (!form.scope_name) return toast.error('เลือกจุดวัดที่ topic นี้ผูกอยู่');
    const scale = Number(form.scale);
    if (!Number.isFinite(scale) || scale === 0) return toast.error('ตัวคูณต้องเป็นตัวเลขและไม่เป็น 0');
    setBusy(true);
    const payload = {
      topic, field: form.field, scope_kind: form.scope_kind, scope_name: form.scope_name,
      json_path: form.json_path.trim() || null, scale, note: form.note.trim() || null,
    };
    const q = editId
      ? supabaseDR.from('energy_meter_topics').update(payload).eq('id', editId).select('id')
      : supabaseDR.from('energy_meter_topics').insert(payload).select('id');
    const { data, error } = await q;
    setBusy(false);
    if (error) {
      // ห้ามโยน error ดิบใส่หน้างาน — แปลเป็นภาษาคนตามเคสที่เจอจริง
      if (error.code === '42P01') return toast.error('ยังไม่ได้ apply migration 20260820_energy_mqtt_topics (แจ้ง admin)');
      if (error.code === '23505') return toast.error(`topic นี้ผูกกับค่า "${mqttField(form.field).label}" ไปแล้ว`);
      return toast.error(error.message);
    }
    // RLS ปฏิเสธ update = คืน 0 แถวโดยไม่ error → ต้องนับแถว ห้ามขึ้นว่าสำเร็จ
    if (editId && !(data || []).length) return toast.error('บันทึกไม่สำเร็จ (ไม่มีแถวถูกแก้)');
    toast.success(editId ? 'แก้ไขแล้ว' : 'เพิ่ม topic แล้ว');
    setForm(EMPTY); setEditId(null); load();
  };

  const del = async (r) => {
    if (!confirm(`ลบ topic "${r.topic}" (${mqttField(r.field).label})?\n\nค่าที่เคยอ่านเข้ามาแล้วยังอยู่ ไม่ถูกลบ`)) return;
    const { error } = await supabaseDR.from('energy_meter_topics').delete().eq('id', r.id);
    if (error) return toast.error(error.message);
    load();
  };
  const toggleActive = async (r) => {
    const { error } = await supabaseDR.from('energy_meter_topics').update({ is_active: !r.is_active }).eq('id', r.id).select('id');
    if (error) return toast.error(error.message);
    load();
  };
  const editRow = (r) => {
    setEditId(r.id);
    setForm({ topic: r.topic, field: r.field, scope_kind: r.scope_kind, scope_name: r.scope_name,
      json_path: r.json_path || '', scale: String(r.scale ?? 1), note: r.note || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  /* topic ที่ระบบเจอแต่ยังไม่มีใครผูก → กดแล้วเติมลงฟอร์มให้เลย (ไม่ต้องพิมพ์ตาม) */
  const adoptTopic = (u) => {
    setEditId(null);
    setForm({ ...EMPTY, topic: u.topic });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) return <div style={{ color: 'var(--muted)', padding: 20 }}>กำลังโหลด…</div>;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* ⚠️ สถานะระบบ — เรื่องสำคัญที่สุดของหน้านี้ ต้องอยู่บนสุดและอ่านไม่ผิด */}
      {missing ? (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 8, padding: '10px 12px', fontSize: 12.5 }}>
          ⚠️ <b>ยังไม่ได้ apply migration <code>20260820_energy_mqtt_topics</code></b> — ยังเพิ่ม topic ไม่ได้ (แจ้ง admin)
        </div>
      ) : !bridgeAlive ? (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.65 }}>
          📡 <b>ยังไม่มีข้อมูลเข้ามาจากมิเตอร์</b>
          {newestAge != null && <> (ล่าสุดเมื่อ {newestAge} นาทีที่แล้ว — เกิน {LIVE_STALE_MIN} นาที ถือว่าขาดการติดต่อ)</>}
          <div style={{ marginTop: 4, color: 'var(--text2)' }}>
            <b>ตั้ง topic ไว้ล่วงหน้าที่นี่ได้เลย</b> แต่จะยังไม่มีค่าเข้ามาจนกว่าจะมีครบ 2 อย่าง:
            <div style={{ marginTop: 3 }}>① <b>MQTT bridge</b> — โปรแกรมเล็กๆ บนเครื่องในโรงงาน ที่ subscribe broker แล้วส่งเข้าระบบ
              (ตัวอย่างสคริปต์: <code>docs/mqtt-bridge-example.js</code>)</div>
            <div>② <b>Edge function <code>ingest-energy</code></b> — ยังไม่ deploy</div>
          </div>
        </div>
      ) : (
        <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid #22c55e', borderRadius: 8, padding: '10px 12px', fontSize: 12.5 }}>
          ✅ <b>ระบบกำลังรับข้อมูลอยู่</b> — ค่าล่าสุดเข้ามาเมื่อ {newestAge} นาทีที่แล้ว
        </div>
      )}

      {/* ── ฟอร์มเพิ่ม/แก้ไข ── */}
      {canEdit && !missing && (
        <div style={{ ...card, background: 'var(--bg3)' }}>
          <div style={secTitle}>{editId ? '✏️ แก้ไข topic' : '➕ เพิ่ม topic'}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', flex: '2 1 260px' }}>MQTT topic<br />
              <input value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                placeholder="plant/utility/steel/power" style={{ ...inp, fontFamily: 'monospace' }} /></label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', flex: '1 1 170px' }}>ค่าที่อ่าน<br />
              <select value={form.field} onChange={e => setForm(f => ({ ...f, field: e.target.value }))} style={inp}>
                {MQTT_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}{f.unit ? ` (${f.unit})` : ''}</option>)}
              </select></label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', flex: '2 1 220px' }}>ผูกกับจุดวัด<br />
              <select value={form.scope_name ? `${form.scope_kind}::${form.scope_name}` : ''}
                onChange={e => { const [k, ...n] = e.target.value.split('::'); setForm(f => ({ ...f, scope_kind: k || 'zone', scope_name: n.join('::') })); }}
                style={inp}>
                <option value="">— เลือกจุดวัด —</option>
                <optgroup label="🔧 โซน utility / facility">
                  {points.filter(p => p.kind === 'zone').map(p => <option key={`z${p.name}`} value={`zone::${p.name}`}>{p.name}</option>)}
                </optgroup>
                <optgroup label="🏭 ไลน์ผลิต">
                  {points.filter(p => p.kind === 'line').map(p => <option key={`l${p.name}`} value={`line::${p.name}`}>{p.name}</option>)}
                </optgroup>
              </select></label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', flex: '1 1 90px' }}>ตัวคูณ<br />
              <input value={form.scale} onChange={e => setForm(f => ({ ...f, scale: e.target.value }))}
                title="มิเตอร์บางตัวส่งเป็น W (×0.001) หรือคูณ 10 มาแล้ว" style={inp} /></label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', flex: '1 1 180px' }}>ตำแหน่งใน JSON (ถ้ามี)<br />
              <input value={form.json_path} onChange={e => setForm(f => ({ ...f, json_path: e.target.value }))}
                placeholder="$.data.activePower" style={{ ...inp, fontFamily: 'monospace' }} /></label>
            <label style={{ fontSize: 11.5, color: 'var(--muted)', flex: '1 1 160px' }}>หมายเหตุ<br />
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inp} /></label>
            <button onClick={save} disabled={busy}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {busy ? '⏳' : editId ? '💾 บันทึก' : '+ เพิ่ม'}
            </button>
            {editId && <button onClick={() => { setEditId(null); setForm(EMPTY); }}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>ยกเลิก</button>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
            <b>payload เป็นตัวเลขล้วน</b> (เช่น <code>26.2</code>) → เว้นช่อง JSON ว่าง ·
            <b> payload เป็น JSON</b> (เช่น <code>{'{"data":{"activePower":26.2}}'}</code>) → ใส่ <code>$.data.activePower</code><br />
            📌 topic เดียวส่งได้หลายค่า — เพิ่มหลายแถวโดยใช้ topic เดิมแต่เปลี่ยน "ค่าที่อ่าน" (เช่น kW กับ kWh สะสม)
          </div>
        </div>
      )}

      {/* ── topic ที่ระบบเจอแต่ยังไม่มีใครผูก — ห้ามหายเงียบ ── */}
      {unmapped.length > 0 && (
        <div style={{ ...card, borderColor: WARN }}>
          <div style={secTitle}>❓ topic ที่ระบบได้รับ แต่ยังไม่ได้ผูกกับจุดวัด ({unmapped.length})</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
            ค่าจาก topic พวกนี้ <b>ยังไม่ถูกเก็บ</b> — กด "ผูก" เพื่อเติมลงฟอร์มด้านบน
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>topic</th><th style={th}>ตัวอย่างค่า</th><th style={th}>เห็นล่าสุด</th><th style={th} /></tr></thead>
            <tbody>
              {unmapped.map(u => (
                <tr key={u.topic}>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>{u.topic}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.sample || '—'}</td>
                  <td style={{ ...td, color: 'var(--muted)' }}>{liveAgeMin(u.last_seen) != null ? `${liveAgeMin(u.last_seen)} นาทีก่อน` : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {canEdit && <button onClick={() => adoptTopic(u)}
                      style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--accent)', cursor: 'pointer' }}>+ ผูก</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ทะเบียน topic ── */}
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <div style={{ ...secTitle, padding: '12px 14px 0' }}>📋 topic ที่ตั้งไว้ ({rows.length})</div>
        {rows.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12.5, color: 'var(--muted)' }}>
            ยังไม่มี topic — {canEdit ? 'เพิ่มจากฟอร์มด้านบน' : 'ต้องมีสิทธิ์บันทึกถึงจะเพิ่มได้'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead><tr>
              <th style={th}>topic</th><th style={th}>ค่าที่อ่าน</th><th style={th}>จุดวัด</th>
              <th style={th}>ตัวคูณ</th><th style={th}>ค่าล่าสุด</th><th style={th}>สถานะ</th>
              {canEdit && <th style={{ ...th, textAlign: 'right' }}>จัดการ</th>}
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const f = mqttField(r.field);
                const l = liveOf[`${r.scope_kind}::${r.scope_name}::${r.field}`];
                const age = liveAgeMin(l?.received_at);
                const stale = age != null && age > LIVE_STALE_MIN;
                return (
                  <tr key={r.id} style={r.is_active ? null : { opacity: 0.5 }}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 11.5 }}>
                      {r.topic}
                      {r.json_path && <div style={{ color: 'var(--muted)', fontSize: 10.5 }}>{r.json_path}</div>}
                      {r.note && <div style={{ color: 'var(--muted)', fontSize: 10.5, fontFamily: 'var(--font-body)' }}>{r.note}</div>}
                    </td>
                    <td style={td}>{f.label}<span style={{ color: 'var(--muted)' }}>{f.unit ? ` (${f.unit})` : ''}</span></td>
                    <td style={td}>{r.scope_kind === 'zone' ? '🔧' : '🏭'} {r.scope_name}</td>
                    <td style={{ ...td, color: Number(r.scale) === 1 ? 'var(--muted)' : 'var(--text)' }}>×{r.scale}</td>
                    <td style={{ ...td, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {l?.value != null ? `${l.value}${f.unit ? ` ${f.unit}` : ''}` : <span style={{ color: 'var(--muted)', fontWeight: 400 }}>—</span>}
                    </td>
                    <td style={{ ...td, fontSize: 11.5 }}>
                      {/* ⚠️ "ยังไม่เคยได้รับ" ≠ "ค่าเป็น 0" — ต้องแยกให้ขาด */}
                      {l == null ? <span style={{ color: 'var(--muted)' }}>ยังไม่เคยได้รับข้อมูล</span>
                        : stale ? <span style={{ color: WARN, fontWeight: 700 }}>⚠ ขาดการติดต่อ {age} นาที</span>
                          : <span style={{ color: GOOD, fontWeight: 700 }}>✓ {age} นาทีก่อน</span>}
                    </td>
                    {canEdit && (
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => toggleActive(r)} title={r.is_active ? 'ปิดใช้ชั่วคราว (ไม่ลบ)' : 'เปิดใช้'}
                          style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, marginRight: 4, border: '1px solid var(--border2)', background: 'var(--bg3)', color: r.is_active ? GOOD : 'var(--muted)', cursor: 'pointer' }}>
                          {r.is_active ? 'ใช้อยู่' : 'ปิด'}
                        </button>
                        <button onClick={() => editRow(r)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, marginRight: 4, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', cursor: 'pointer' }}>✏️</button>
                        <button onClick={() => del(r)} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 11, border: '1px solid var(--border2)', background: 'var(--bg3)', color: BAD, cursor: 'pointer' }}>🗑</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7 }}>
        <b>สิ่งที่ต้องเตรียมฝั่งโรงงาน:</b> MQTT broker (Mosquitto ฟรี) · เครื่องเล็กๆ 1 เครื่องรัน bridge ตลอดเวลา ·
        มิเตอร์/gateway ที่ publish ค่าได้<br />
        ⚠️ <b>bridge ต้องสรุปค่าเป็นช่วง 15 นาทีก่อนส่ง ห้ามส่งทุก message</b> — มิเตอร์ publish ทุก 1-5 วินาที
        20 ตัว = 1.7 ล้าน message/วัน เขียนลงฐานตรงๆ พื้นที่เต็มในไม่กี่สัปดาห์ (ดู `ENERGY_MONITORING_DESIGN.md` §14.2)
      </div>
    </div>
  );
}
