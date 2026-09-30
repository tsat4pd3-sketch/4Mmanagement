import { useState, useEffect, useContext, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import { inSectionScope } from '../utils/sectionScope';
import { getLineFamilyNames } from '../utils/lineHierarchy';
// picker กลาง (single-source audit 2026-09-07) — ไลน์/คน อ่านจากทะเบียน · สถานีจาก workstations ของไลน์
import LineSelect from '../components/LineSelect';
import PersonSelect from '../components/PersonSelect';
import useColumnHistory from '../utils/useColumnHistory';
import SelectOrFree from '../components/SelectOrFree';
import { loadLinesRes, LINE_COLUMNS } from '../utils/useProductionLines';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import FilterBar from '../components/FilterBar';
import Segmented from '../components/Segmented';
const NO_LINES = [];

/* ── Poka-Yoke Check — ทดสอบอุปกรณ์ error-proofing รายวัน/กะ (TPM · 2026-07-23) ──────
   ทะเบียนอุปกรณ์ต่อไลน์ (pokayoke_devices) + บันทึกทดสอบด้วยชิ้น master NG (pokayoke_checks)
   แท็บที่ 3 ใน Daily Checker · scope ไลน์ตามมาตรฐาน (leader→family · role อื่น→sections · admin/qa→ทั้งหมด)
   สิทธิ์: record = pokayoke:record · จัดการทะเบียน = pokayoke:manage · migration 20260723_pokayoke_check.sql
*/
const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getWorkDate = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return localDateStr(d); };
const getCurrentShift = () => { const h = new Date().getHours(); return h >= 8 && h < 20 ? 'day' : 'night'; };
const SHIFT_LABEL = { day: 'กะเช้า (Shift 01)', night: 'กะดึก (Shift 02)' };

export default function PokaYokeCheck() {
  const { role, lineId: userLineId, sections: scopeSecs, fullName } = useContext(UserContext);
  const canRecord = can('pokayoke', 'record', role);
  const canManage = can('pokayoke', 'manage', role);
  // 📜 ชื่อผู้ตรวจที่เคยบันทึก (Main pokayoke_checks) — คนนอกทะเบียนยังเลือกซ้ำได้ ไม่หายเงียบ (2026-09-07)
  const checkerHist = useColumnHistory(supabase, 'pokayoke_checks', 'checker_name');

  const [lines, setLines] = useState([]);
  const [selLine, setSelLine] = useState('');
  const [selShift, setSelShift] = useState(getCurrentShift());
  const [selDate, setSelDate] = useState(getWorkDate());
  const [devices, setDevices] = useState([]);
  const [checks, setChecks] = useState({});   // device_id → check row
  const [checker, setChecker] = useState(fullName || '');
  const [loading, setLoading] = useState(true);
  const [dEditing, setDEditing] = useState(null); // อุปกรณ์ที่กำลังเพิ่ม/แก้

  useEffect(() => { setChecker(fullName || ''); }, [fullName]);

  useEffect(() => {
    loadLinesRes() // LINE_COLUMNS = ครบตามสัญญา <LineSelect> (2026-09-07)
      .then(({ data }) => setLines(data || []));
  }, []);

  /* สถานีของไลน์ที่กำลังแก้อุปกรณ์ (Main `workstations`) — จุดงานเลือกจากทะเบียน ไม่พิมพ์เอง (audit #24 · 2026-09-07)
     <SelectOrFree> = ระบุเองสำหรับอุปกรณ์ที่ไม่ได้อยู่ประจำสถานี · guard alive กัน stale-response ตอนสลับไลน์ */
  const [stations, setStations] = useState([]);
  const editLine = dEditing?.line_name || '';
  useEffect(() => {
    if (!editLine) { setStations([]); return; }
    let alive = true;
    supabase.from('workstations').select('station_name').eq('line_name', editLine).order('station_name')
      .then(({ data }) => { if (alive) setStations([...new Set((data || []).map(w => w.station_name).filter(Boolean))]); });
    return () => { alive = false; };
  }, [editLine]);
  // ครอบครัวไลน์ที่เลือก — ให้ picker ผู้ตรวจเรียงคนของไลน์ขึ้นก่อน (ไม่ตัดคนอื่น)
  const selFam = useMemo(() => (selLine ? getLineFamilyNames(lines, selLine) : NO_LINES), [lines, selLine]);

  // scope ไลน์มาตรฐาน
  const visibleLines = useMemo(() => {
    let arr = lines;
    if (role === 'leader' && userLineId) {
      const fam = getLineFamilyNames(lines, Number(userLineId) || userLineId);
      arr = lines.filter(l => fam.includes(l.name));
    } else if (scopeSecs?.length) {
      arr = lines.filter(l => inSectionScope(scopeSecs, l.section));
    }
    return [...arr].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [lines, role, userLineId, scopeSecs]);

  useEffect(() => { if (!selLine && visibleLines.length) setSelLine(visibleLines[0].name); }, [visibleLines, selLine]);

  const load = useCallback(async () => {
    if (!selLine) { setDevices([]); setChecks({}); setLoading(false); return; }
    setLoading(true);
    const { data: devs } = await supabase.from('pokayoke_devices').select('*').eq('line_name', selLine).order('sort').order('id');
    const list = devs || [];
    setDevices(list);
    if (list.length) {
      const { data: chk } = await supabase.from('pokayoke_checks')
        .select('*').in('device_id', list.map(d => d.id)).eq('check_date', selDate).eq('shift', selShift);
      const m = {}; (chk || []).forEach(c => { m[c.device_id] = c; });
      setChecks(m);
    } else setChecks({});
    setLoading(false);
  }, [selLine, selDate, selShift]);
  useEffect(() => { load(); }, [load]);

  // บันทึกผลทดสอบ 1 อุปกรณ์ (upsert)
  const saveCheck = async (device, patch) => {
    if (!canRecord) { toast.error('ไม่มีสิทธิ์บันทึก'); return; }
    const prev = checks[device.id] || {};
    const { data: { user } } = await supabase.auth.getUser();
    const row = {
      device_id: device.id, check_date: selDate, shift: selShift,
      result: patch.result ?? prev.result ?? 'pass',
      detected: patch.detected ?? prev.detected ?? null,
      note: patch.note ?? prev.note ?? null,
      checker_name: checker || fullName || null,
      created_by: user?.id || null,
    };
    const { data, error } = await supabase.from('pokayoke_checks')
      .upsert(row, { onConflict: 'device_id,check_date,shift' }).select().single();
    if (error) { toast.error('บันทึกไม่สำเร็จ: ' + error.message); return; }
    setChecks(m => ({ ...m, [device.id]: data }));
  };

  // ── ทะเบียนอุปกรณ์ ──
  const saveDevice = async () => {
    if (!dEditing.name?.trim()) { toast.error('กรอกชื่ออุปกรณ์'); return; }
    const row = {
      ...(dEditing.id ? { id: dEditing.id } : {}),
      line_name: dEditing.line_name || selLine,
      code: dEditing.code?.trim() || null, name: dEditing.name.trim(),
      station: dEditing.station?.trim() || null, test_method: dEditing.test_method?.trim() || null,
      master_ref: dEditing.master_ref?.trim() || null, sort: Number(dEditing.sort) || 0,
      is_active: dEditing.is_active !== false,
    };
    const { error } = await supabase.from('pokayoke_devices').upsert(row, { onConflict: 'id' });
    if (error) { toast.error('บันทึกไม่สำเร็จ: ' + error.message); return; }
    toast.success('บันทึกอุปกรณ์แล้ว'); setDEditing(null); load();
  };
  const deleteDevice = async (d) => {
    if (!window.confirm(`ลบอุปกรณ์ "${d.name}"? (ผลทดสอบที่ผูกอยู่จะถูกลบด้วย)`)) return;
    const { error } = await supabase.from('pokayoke_devices').delete().eq('id', d.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const activeDevs = devices.filter(d => d.is_active);
  const done = activeDevs.filter(d => checks[d.id]).length;
  const failN = activeDevs.filter(d => checks[d.id]?.result === 'fail').length;

  return (
    <Page>
      <PageHeader title="Poka-Yoke Check" icon="🛡️"
        sub={`ทดสอบอุปกรณ์กันความผิดพลาด (error-proofing) ด้วยชิ้น master NG ทุกกะ — จับ NG ได้ = ผ่าน · ${SHIFT_LABEL[selShift]} · ${selDate}`} />

      {/* ตัวเลือก — UI-STANDARD 2026-09-24: FilterBar · กะ 2 ตัวเลือก = Segmented */}
      <FilterBar style={{ marginBottom: 12 }}>
        <span className="filter-label">ไลน์ / พื้นที่</span>
        {/* <LineSelect> — visibleLines กรอง scope แล้ว (ไม่มี option ว่าง เหมือนเดิม) · 2026-09-07 */}
        <LineSelect lines={visibleLines} value={selLine} onChange={setSelLine} placeholder={null} />
        <Segmented value={selShift} onChange={setSelShift} label="กะ"
          options={[{ value: 'day', label: SHIFT_LABEL.day }, { value: 'night', label: SHIFT_LABEL.night }]} />
        <span className="filter-label">วันที่</span>
        <input type="date" value={selDate} onChange={e => setSelDate(e.target.value)} />
        <span className="filter-label">ผู้ตรวจ</span>
        {/* <PersonSelect> profiles+employees ของไลน์ที่เลือกขึ้นก่อน · default = ชื่อผู้ใช้ · เก็บ snapshot checker_name เหมือนเดิม · 2026-09-07 */}
        <PersonSelect value={checker} source="both" lines={selFam} history={checkerHist} onChange={res => setChecker(res.name)} style={{ flex: '1 1 180px', maxWidth: 260 }} inputStyle={{ background: 'var(--bg)' }} />
        <span className="spacer" />
        {canManage && <button onClick={() => setDEditing({ line_name: selLine, name: '', is_active: true, sort: (Math.max(0, ...devices.map(d => d.sort || 0)) + 1) })} style={btnAccent}>➕ เพิ่มอุปกรณ์</button>}
      </FilterBar>

      {/* สรุป */}
      {activeDevs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, fontSize: 12, fontWeight: 700 }}>
          <span style={chip('var(--text2)')}>ทดสอบแล้ว {done}/{activeDevs.length}</span>
          {failN > 0 && <span style={chip('#ef4444')}>❌ ไม่ผ่าน {failN}</span>}
          {done - failN > 0 && <span style={chip('#22c55e')}>✅ ผ่าน {done - failN}</span>}
          {done < activeDevs.length && <span style={chip('#f59e0b')}>รอทดสอบ {activeDevs.length - done}</span>}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div>
      ) : activeDevs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', background: 'var(--card)', border: '1px dashed var(--border2)', borderRadius: 12 }}>
          ยังไม่มีอุปกรณ์ poka-yoke ของไลน์ {selLine} — {canManage ? 'กด "➕ เพิ่มอุปกรณ์"' : 'ให้หัวหน้าลงทะเบียนอุปกรณ์ก่อน'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {activeDevs.map(d => {
            const c = checks[d.id]; const res = c?.result;
            return (
              <div key={d.id} style={{ background: 'var(--card)', border: `1px solid ${res === 'fail' ? '#ef4444' : res === 'pass' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{d.code ? `${d.code} · ` : ''}{d.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                      {d.station ? `📍 ${d.station}` : ''}{d.test_method ? ` · วิธี: ${d.test_method}` : ''}{d.master_ref ? ` · master NG: ${d.master_ref}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button disabled={!canRecord} onClick={() => saveCheck(d, { result: 'pass', detected: true })}
                      style={resBtn(res === 'pass', '#22c55e', canRecord)}>✅ ผ่าน (จับ NG ได้)</button>
                    <button disabled={!canRecord} onClick={() => saveCheck(d, { result: 'fail', detected: false })}
                      style={resBtn(res === 'fail', '#ef4444', canRecord)}>❌ ไม่ผ่าน</button>
                  </div>
                  {canManage && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="tbtn" onClick={() => setDEditing({ ...d })} style={{ ...btnGray, padding: '4px 8px', fontSize: 12 }}>✏️</button>
                      <button className="tbtn" onClick={() => deleteDevice(d)} style={{ ...btnGray, color: '#ef4444', padding: '4px 8px', fontSize: 12 }}>🗑</button>
                    </div>
                  )}
                </div>
                {res && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input placeholder="หมายเหตุ / การแก้ไข (ถ้าไม่ผ่าน)" defaultValue={c?.note || ''}
                      onBlur={e => { if ((e.target.value || '') !== (c?.note || '')) saveCheck(d, { note: e.target.value }); }}
                      disabled={!canRecord} style={{ flex: 1, minWidth: 200, fontSize: 12 }} />
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>ผู้ตรวจ: {c?.checker_name || '—'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* modal ทะเบียนอุปกรณ์ */}
      {dEditing && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(96vw, 560px)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{dEditing.id ? '✏️ แก้ไข' : '➕ เพิ่ม'}อุปกรณ์ Poka-Yoke — {dEditing.line_name}</div>
              <button onClick={() => setDEditing(null)} style={{ background: 'none', border: 'none', fontSize: 20, color: 'var(--muted)', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
                <div><div style={lb}>รหัส</div><input value={dEditing.code || ''} onChange={e => setDEditing(p => ({ ...p, code: e.target.value }))} style={{ width: '100%' }} /></div>
                <div><div style={lb}>ชื่อ/หน้าที่ *</div><input value={dEditing.name || ''} onChange={e => setDEditing(p => ({ ...p, name: e.target.value }))} style={{ width: '100%' }} /></div>
              </div>
              <div><div style={lb}>จุดงาน/ตำแหน่ง</div>
                {/* เลือกจาก workstations ของไลน์ (ทะเบียนสถานี) — "ระบุเอง" เฉพาะอุปกรณ์ที่ไม่อยู่ประจำสถานี · ค่าเก่าที่ไม่ตรงทะเบียนโชว์ในโหมดระบุเอง · 2026-09-07 */}
                <SelectOrFree value={dEditing.station || ''} options={stations} placeholder="— ไม่ระบุสถานี —" freeLabel="✏️ ระบุเอง (ไม่อยู่ประจำสถานี)" freePlaceholder="ระบุเอง (อุปกรณ์ที่ไม่ได้อยู่ประจำสถานี)"
                  onChange={v => setDEditing(p => ({ ...p, station: v }))} style={{ width: '100%' }} />
              </div>
              <div><div style={lb}>วิธีทดสอบ</div><input value={dEditing.test_method || ''} onChange={e => setDEditing(p => ({ ...p, test_method: e.target.value }))} style={{ width: '100%' }} placeholder="เช่น ใส่ชิ้น NG แล้วเครื่องต้อง alarm/ไม่ปล่อยผ่าน" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10 }}>
                <div><div style={lb}>ชิ้น master NG ที่ใช้</div><input value={dEditing.master_ref || ''} onChange={e => setDEditing(p => ({ ...p, master_ref: e.target.value }))} style={{ width: '100%' }} /></div>
                <div><div style={lb}>ลำดับ</div><input type="number" value={dEditing.sort ?? 0} onChange={e => setDEditing(p => ({ ...p, sort: e.target.value }))} style={{ width: '100%' }} /></div>
              </div>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--text2)' }}>
                <input type="checkbox" checked={dEditing.is_active !== false} onChange={e => setDEditing(p => ({ ...p, is_active: e.target.checked }))} style={{ width: 'auto' }} /> ใช้งาน
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button onClick={() => setDEditing(null)} style={btnGray}>ยกเลิก</button>
                <button onClick={saveDevice} style={btnAccent}>💾 บันทึก</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

const lb = { fontSize: 11, color: 'var(--muted)', marginBottom: 3, fontWeight: 600 };
const chip = (c) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, color: c, background: `${c}1a`, border: `1px solid ${c}44`, padding: '3px 10px', borderRadius: 20 });
const btnAccent = { padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', background: 'var(--accent)', color: '#fff', border: 'none' };
const btnGray = { padding: '9px 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)' };
const resBtn = (on, color, enabled) => ({
  padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: enabled ? 'pointer' : 'not-allowed',
  border: `1px solid ${on ? color : 'var(--border2)'}`, background: on ? color : 'var(--bg3)', color: on ? '#fff' : 'var(--text2)', opacity: enabled ? 1 : 0.5,
});
