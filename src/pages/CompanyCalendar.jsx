import { useState, useEffect, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { can } from '../utils/permissions';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { DAY_TYPE_META } from '../utils/companyCalendar';

const MONTH_NAMES = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const WEEKDAY_HEAD = ['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
const DAY_TYPES = ['working', 'ot15', 'ot2', 'shutdown75'];

const toDateStr = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default function CompanyCalendar() {
  const { role } = useContext(UserContext);
  const canEdit = can('company_calendar', 'edit', role);

  const [year, setYear] = useState(new Date().getFullYear());
  const [calendar, setCalendar] = useState({}); // work_date -> day_type (saved)
  const [draft, setDraft] = useState({});       // work_date -> day_type (ยังไม่บันทึก)
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bulkWeekday, setBulkWeekday] = useState('6'); // เสาร์ = 6
  const [bulkType, setBulkType] = useState('ot15');
  const [singleDate, setSingleDate] = useState('');
  const [singleType, setSingleType] = useState('ot2');
  const [singleNote, setSingleNote] = useState('');

  useEffect(() => { fetchYear(); }, [year]);

  const fetchYear = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('company_calendar')
      .select('work_date, day_type')
      .gte('work_date', `${year}-01-01`)
      .lte('work_date', `${year}-12-31`);
    const map = {};
    (data || []).forEach(r => { map[r.work_date] = r.day_type; });
    setCalendar(map);
    setDraft({});
    setLoading(false);
  };

  const cycleDay = (dateStr) => {
    if (!canEdit) return;
    const current = draft[dateStr] ?? calendar[dateStr] ?? 'working';
    const next = DAY_TYPES[(DAY_TYPES.indexOf(current) + 1) % DAY_TYPES.length];
    setDraft(prev => {
      const updated = { ...prev, [dateStr]: next };
      // ถ้าค่ากลับมาเท่าของเดิมที่บันทึกไว้ ให้เอาออกจาก draft (ไม่ถือว่าเปลี่ยน)
      if ((calendar[dateStr] ?? 'working') === next) delete updated[dateStr];
      return updated;
    });
  };

  const pendingCount = Object.keys(draft).length;

  const handleSaveDraft = async () => {
    if (pendingCount === 0) return;
    setSaving(true);
    const rows = Object.entries(draft).map(([work_date, day_type]) => ({
      work_date, day_type, updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('company_calendar').upsert(rows, { onConflict: 'work_date' });
    if (error) {
      toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    } else {
      setCalendar(prev => ({ ...prev, ...draft }));
      setDraft({});
      toast.success(`บันทึก ${rows.length} วันเรียบร้อย`);
    }
    setSaving(false);
  };

  const handleDiscardDraft = () => setDraft({});

  const handleBulkWeekday = async () => {
    if (!canEdit) return;
    const wd = parseInt(bulkWeekday);
    const dates = [];
    const d = new Date(year, 0, 1);
    while (d.getFullYear() === year) {
      if (d.getDay() === wd) dates.push(toDateStr(d.getFullYear(), d.getMonth(), d.getDate()));
      d.setDate(d.getDate() + 1);
    }
    // เขียนทับทั้งปีทีเดียว — ยืนยันก่อน (ต่างจากคลิกรายวันที่มี draft)
    if (!confirm(`ตั้งค่า ${dates.length} วัน (ทุกวันในสัปดาห์ที่เลือก ทั้งปี ${year}) เป็น "${bulkType}" ?\n\nเขียนทับค่าเดิมของวันเหล่านี้ทันที`)) return;
    setLoading(true);
    const { error } = await supabase.from('company_calendar').upsert(
      dates.map(dt => ({ work_date: dt, day_type: bulkType, updated_at: new Date().toISOString() })),
      { onConflict: 'work_date' }
    );
    if (error) toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    else toast.success(`ตั้งค่า ${dates.length} วันเรียบร้อย`);
    await fetchYear();
    setLoading(false);
  };

  const handleAddSingle = async () => {
    if (!canEdit) return;
    if (!singleDate) return toast.error('เลือกวันที่ก่อน');
    setLoading(true);
    const { error } = await supabase.from('company_calendar').upsert({
      work_date: singleDate, day_type: singleType, note: singleNote.trim() || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'work_date' });
    if (error) toast.error('บันทึกไม่สำเร็จ: ' + error.message);
    else toast.success('เพิ่มวันหยุดเรียบร้อย');
    await fetchYear();
    setLoading(false);
    setSingleDate(''); setSingleNote('');
  };

  const counts = DAY_TYPES.reduce((acc, t) => {
    acc[t] = Object.values({ ...calendar, ...draft }).filter(v => v === t).length;
    return acc;
  }, {});

  return (
    <div className="page-content">
      <div style={{ display: 'flex', paddingRight: 52, justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(16px,3vw,22px)', color: 'var(--text)' }}>
          📅 ปฏิทินบริษัท — วันทำงาน/วันหยุด
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setYear(y => y - 1)} style={navBtnSt}>‹</button>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', minWidth: 50, textAlign: 'center' }}>{year}</span>
          <button onClick={() => setYear(y => y + 1)} style={navBtnSt}>›</button>
        </div>
      </div>

      {/* Legend / summary */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        {DAY_TYPES.map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: DAY_TYPE_META[t].color, flexShrink: 0 }} />
            {DAY_TYPE_META[t].label} <strong style={{ color: 'var(--text)' }}>{counts[t]} วัน</strong>
          </div>
        ))}
        {!canEdit && (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>🔒 ดูได้อย่างเดียว — แก้ไขได้เฉพาะชุดสิทธิ์ ผู้ดูแลระบบ / งานเอกสาร</span>
        )}
      </div>

      {canEdit && (
        <div className="card" style={{ padding: 14, marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
              ตั้งค่าวันหยุดประจำสัปดาห์ทั้งปี
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* width กัน index.css input/select {width:100%} ยืดเต็ม toolbar (กับดัก CSS ใน CLAUDE.md) */}
              <select value={bulkWeekday} onChange={e => setBulkWeekday(e.target.value)} style={{ width: 'auto' }}>
                {WEEKDAY_HEAD.map((w, i) => <option key={i} value={i}>{w}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>เป็น</span>
              <select value={bulkType} onChange={e => setBulkType(e.target.value)} style={{ width: 'auto' }}>
                {DAY_TYPES.filter(t => t !== 'working').map(t => <option key={t} value={t}>{DAY_TYPE_META[t].label}</option>)}
              </select>
              <button onClick={handleBulkWeekday} disabled={loading} style={primaryBtnSt}>ตั้งค่าทั้งปี</button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
              เพิ่มวันหยุดพิเศษ/ประเพณีนิยม/แลกเปลี่ยน
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* width กัน index.css input/select {width:100%} ยืดเต็ม toolbar (กับดัก CSS ใน CLAUDE.md) */}
              <input type="date" value={singleDate} onChange={e => setSingleDate(e.target.value)} style={{ width: 150 }} />
              <select value={singleType} onChange={e => setSingleType(e.target.value)} style={{ width: 'auto' }}>
                {DAY_TYPES.filter(t => t !== 'working').map(t => <option key={t} value={t}>{DAY_TYPE_META[t].label}</option>)}
              </select>
              <input placeholder="หมายเหตุ เช่น วันสงกรานต์" value={singleNote} onChange={e => setSingleNote(e.target.value)} style={{ width: 180 }} />
              <button onClick={handleAddSingle} disabled={loading} style={primaryBtnSt}>เพิ่ม</button>
            </div>
          </div>
        </div>
      )}

      {canEdit && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
          💡 คลิกที่ตัวเลขวันที่เพื่อสลับสถานะ: วันทำงาน → OT×1.5 → OT×2 → หยุดจ่าย 75% → วันทำงาน — ยังไม่บันทึกจนกว่าจะกด "บันทึก" ด้านล่าง · <b>หยุดจ่าย 75% (ม.75)</b> = หยุดชั่วคราวเหตุลูกค้าลด order: หยุดได้ค่าจ้าง 75% · มาทำงาน = ค่าแรงปกติ (ไม่ใช่ OT วันหยุด)
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 14, opacity: loading ? 0.5 : 1 }}>
        {MONTH_NAMES.map((name, m) => {
          const daysInMonth = new Date(year, m + 1, 0).getDate();
          const firstWeekday = new Date(year, m, 1).getDay();
          const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
          return (
            <div key={m} className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>{name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, marginBottom: 4 }}>
                {WEEKDAY_HEAD.map(w => (
                  <div key={w} style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{w}</div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
                {cells.map((day, i) => {
                  if (!day) return <div key={i} />;
                  const dateStr = toDateStr(year, m, day);
                  const isDirty = Object.prototype.hasOwnProperty.call(draft, dateStr);
                  const type = draft[dateStr] ?? calendar[dateStr] ?? 'working';
                  const meta = DAY_TYPE_META[type];
                  return (
                    <div
                      key={i}
                      className="cal-day"
                      onClick={() => cycleDay(dateStr)}
                      title={isDirty ? `${meta.label} (ยังไม่บันทึก)` : meta.label}
                      style={{
                        position: 'relative',
                        fontSize: 11, textAlign: 'center', padding: '4px 0', borderRadius: 5,
                        background: type === 'working' ? 'transparent' : meta.color + '33',
                        color: type === 'working' ? 'var(--text2)' : meta.color,
                        fontWeight: type === 'working' ? 400 : 700,
                        cursor: canEdit ? 'pointer' : 'default',
                        border: isDirty ? `1px dashed ${meta.color}` : (type === 'working' ? '1px solid transparent' : `1px solid ${meta.color}66`),
                        boxShadow: isDirty ? `0 0 0 1px ${meta.color}` : 'none',
                      }}
                    >
                      {day}
                      {isDirty && (
                        <span style={{ position: 'absolute', top: -3, right: -3, width: 6, height: 6, borderRadius: '50%', background: '#fff', border: `1px solid ${meta.color}` }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky save bar — แสดงเมื่อมีการคลิกเปลี่ยนสถานะแบบรายวันที่ยังไม่บันทึก */}
      {canEdit && pendingCount > 0 && (
        <div style={{
          position: 'sticky', bottom: 16, marginTop: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          background: 'var(--bg3)', border: '1px solid var(--accent)', borderRadius: 10,
          padding: '12px 16px', boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            ● มีการเปลี่ยนแปลงที่ยังไม่บันทึก {pendingCount} วัน
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleDiscardDraft} disabled={saving} style={cancelBtnSt}>ยกเลิก</button>
            <button onClick={handleSaveDraft} disabled={saving} style={saveBtnSt}>{saving ? 'กำลังบันทึก...' : `💾 บันทึก (${pendingCount})`}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const navBtnSt = { padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', cursor: 'pointer', fontSize: 16, flexShrink: 0 };
const primaryBtnSt = { padding: '7px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 };
const saveBtnSt = { padding: '8px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontWeight: 800, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
const cancelBtnSt = { padding: '8px 18px', background: 'var(--bg2)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' };
