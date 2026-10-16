/* ══════════════════════════════════════════════════════════════════════════
   🗺️ ผังเครื่องจักรของไลน์ ระบายสีตาม "เลนส์" = แท็บที่เลือกบนผังรวม (2026-10-16)

   ใช้ในกล่องรายละเอียดไลน์ของ `/factory-map` — แสดงคู่กับรายละเอียด
   (user 16/10: "tab PM ไม่ได้อยากดูคน อยากดูสถานะเครื่องจักร" · "สถานะ PM แล้ว/ใกล้/หลุด ยังไม่ลิ้งไปที่แต่ละจุด")
   · ข้อมูลผัง+PM ต่อเครื่อง = `lib/lineMachineMap.js` (ตัวเดียวกับ /mtn-layout)
   · สี/ป้ายหมุด = `markerFor()` (`utils/lineLens.js`) — PM กับ Downtime คนละคำถาม ห้ามเอาสีมาทับกัน
   · หมุด = `MachineFloorMap` (วงกลม+ป้ายใต้ ตาม UI-CONVENTIONS §1)
   ⚠️ โหลดไม่ได้ = เขียนบนจอ ห้ามโชว์ผังว่างเหมือน "ไม่มีเครื่อง"
   ══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import MachineFloorMap from './MachineFloorMap';
import { loadLineMachines } from '../lib/lineMachineMap';
import { STATUS_META } from '../lib/pmSchedule';
import { machineKey } from '../utils/machineNo';
import { markerFor, dtByMachine, dtWithoutMachine, LENS_LABEL, DT_COLOR, NO_DATA_COLOR } from '../utils/lineLens';

const LEGEND = {
  pm: [['overdue', STATUS_META.overdue], ['due_soon', STATUS_META.due_soon], ['ok', STATUS_META.ok], ['never', STATUS_META.never], ['no_plan', { label: 'ไม่มีแผน PM', color: NO_DATA_COLOR }]],
  am: [['overdue', STATUS_META.overdue], ['due_soon', STATUS_META.due_soon], ['ok', STATUS_META.ok], ['no_plan', { label: 'ไม่มีแผน AM', color: NO_DATA_COLOR }]],
  breakdown: [['open', { label: 'กำลังหยุด', color: DT_COLOR.open }], ['had', { label: 'หยุดในวันนั้น', color: DT_COLOR.had }], ['none', { label: 'ไม่มีหยุดนอกแผน', color: DT_COLOR.none }]],
  health: [['open', { label: 'กำลังหยุด', color: DT_COLOR.open }], ['overdue', { label: 'PM เกินกำหนด', color: STATUS_META.overdue.color }], ['had', { label: 'หยุดในวันนั้น', color: DT_COLOR.had }], ['due_soon', { label: 'PM ใกล้ครบ', color: STATUS_META.due_soon.color }], ['ok', { label: 'ปกติ', color: DT_COLOR.none }]],
};

/**
 * @param {{ lineName:string, family:string[], parentName:string|null, lens:'pm'|'am'|'breakdown'|'health',
 *           dtRows:object[]|null, height?:string }} p
 *   family = ไลน์นี้ + ไลน์ลูกทั้งหมด · dtRows = DT นอกแผนของวันที่เปิดดู ({machine, mins, open})
 */
export default function LineLensMap({ lineName, family, parentName, lens, dtRows, height, onSelectMachine }) {
  const [pick, setPick] = useState(null);          // ไลน์ลูกที่เลือกดูผัง (กรณีไลน์นี้ไม่มีผังของตัวเอง)
  const [state, setState] = useState({ loading: true });
  const [selId, setSelId] = useState(null);
  const [crop, setCrop] = useState(true);        // ✂️ ครอปเฉพาะโซนที่มีหมุด (default) · กดดูทั้งผังได้
  const famKey = (family || []).join('|');

  useEffect(() => { setPick(null); setSelId(null); }, [lineName]);
  useEffect(() => { setSelId(null); }, [pick]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setState({ loading: true });
      try {
        const fam = famKey ? famKey.split('|') : [lineName];
        const names = [...new Set([...fam, parentName].filter(Boolean))];
        const { data: lays, error } = await supabase.from('line_layouts').select('line_name, image_url').in('line_name', names);
        if (error) throw error;
        const imgOf = Object.fromEntries((lays || []).filter(l => l.image_url).map(l => [l.line_name, l.image_url]));
        const base = pick || lineName;
        let image = imgOf[base] || null;
        if (!image && !pick && parentName && imgOf[parentName]) image = imgOf[parentName];
        const choices = fam.filter(n => n !== lineName && imgOf[n]);
        if (!image) { if (alive) setState({ loading: false, image: null, choices }); return; }
        // หมุดที่อยู่บนรูปนี้ = ไลน์ฐาน + ไลน์ลูกที่ไม่มีผังของตัวเอง (ลูกที่มีผังเองพิกัดอ้างรูปของมัน)
        const pointLines = pick ? [pick] : fam.filter(n => n === lineName || !imgOf[n]);
        const { points, info } = await loadLineMachines(pointLines);
        if (alive) setState({ loading: false, image, choices, points, info });
      } catch (e) {
        if (alive) setState({ loading: false, error: e?.message || String(e) });
      }
    })();
    return () => { alive = false; };
  }, [lineName, famKey, parentName, pick]);

  const dtMap = useMemo(() => dtByMachine(dtRows || []), [dtRows]);
  const markers = useMemo(() => (state.points || []).map(p => {
    const inf = state.info?.[p.machine_no] || { name: '', checklists: [] };
    const m = markerFor(lens, { checklists: inf.checklists, dt: dtMap.get(machineKey(p.machine_no)) || null, statusMeta: STATUS_META });
    return { id: p.id, pos_top: p.pos_top, pos_left: p.pos_left, label: p.machine_no, sub: m.sub, color: m.color,
      /* ป้ายโผล่เฉพาะหมุดที่เลือก — สถานะดูจากสีหมุด */ alwaysLabel: false, blink: m.blink, _state: m.state, _name: inf.name, _cls: inf.checklists, _no: p.machine_no };
  }), [state.points, state.info, lens, dtMap]);

  const counts = useMemo(() => {
    const c = {}; markers.forEach(m => { c[m._state] = (c[m._state] || 0) + 1; }); return c;
  }, [markers]);
  // DT ที่วางบนผังไม่ได้ (ไม่มีเลขเครื่อง หรือเครื่องไม่มีหมุด) — ต้องบอก ห้ามหายเงียบ
  const dtOffMap = useMemo(() => {
    if (lens !== 'breakdown' && lens !== 'health') return 0;
    const onMap = new Set(markers.map(m => machineKey(m._no)));
    return dtWithoutMachine(dtRows || []) + [...dtMap.keys()].filter(k => !onMap.has(k)).length;
  }, [lens, markers, dtRows, dtMap]);

  const sel = markers.find(m => m.id === selId) || null;
  // หน้าแม่วางการ์ดเอง (คอลัมน์ขวา) — ส่งเครื่องที่เลือกขึ้นไปทุกครั้งที่เปลี่ยน/สีเปลี่ยน
  useEffect(() => { onSelectMachine?.(sel); }, [sel?.id, sel?.color, lens]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = { background: 'var(--bg3)', border: '1px dashed var(--border2)', borderRadius: 10, padding: '14px 12px', fontSize: 12.5, color: 'var(--text2)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>🗺️ ผังเครื่องจักร · {LENS_LABEL[lens]}</span>
        {pick && <span style={{ fontSize: 11, color: 'var(--muted)' }}>ผังของ {pick}</span>}
      </div>
      {state.choices?.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <button onClick={() => setPick(null)} style={chip(!pick)}>{lineName}</button>
          {state.choices.map(n => <button key={n} onClick={() => setPick(n)} style={chip(pick === n)}>{n}</button>)}
        </div>
      )}
      {state.loading ? (
        <div style={box}>กำลังโหลดผังเครื่องจักร…</div>
      ) : state.error ? (
        <div style={{ ...box, borderColor: '#ef4444', color: '#ef4444' }}>⚠ โหลดผังเครื่องจักรไม่สำเร็จ — {state.error}</div>
      ) : !state.image ? (
        <div style={box}>
          ไลน์นี้ยังไม่มีผังเลย์เอาต์{state.choices?.length ? ' — เลือกไลน์ย่อยด้านบนเพื่อดูผังของมัน' : ' — อัปโหลดผังที่หน้า ตั้งค่าไลน์ (/linesetup)'}
        </div>
      ) : (<>
        {/* ป้ายชื่อปิดเป็นค่าเริ่มต้น — หมุดถี่แล้วป้ายทับกันจนอ่านไม่ออก (user 16/10) · ชื่อโผล่เมื่อคลิกหมุด */}
        <MachineFloorMap imageUrl={state.image} points={markers} selectedId={selId} onSelect={p => setSelId(p.id === selId ? null : p.id)}
          height={height || 'clamp(320px, 58vh, 720px)'} defaultPills={false} autoCrop={crop} />
        {markers.length > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, color: 'var(--muted)' }}>
            <button onClick={() => setCrop(v => !v)} style={chip(crop)}>{crop ? '✂️ ครอปเฉพาะโซนที่มีหมุด' : '🗺️ ทั้งผัง'}</button>
            <span>คลิกหมุดเพื่อดูชื่อ + รายละเอียดเครื่อง</span>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11.5 }}>
          {(LEGEND[lens] || []).map(([k, m]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: counts[k] ? 'var(--text)' : 'var(--muted)', fontWeight: counts[k] ? 800 : 500 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color }} />{m.label} {counts[k] || 0}
            </span>
          ))}
        </div>
        {!markers.length && <div style={{ fontSize: 11.5, color: '#f59e0b' }}>⚠ ยังไม่ได้วางหมุดเครื่องบนผังนี้ — วางที่หน้า ตั้งค่าไลน์ (/linesetup)</div>}
        {dtOffMap > 0 && <div style={{ fontSize: 11.5, color: '#f59e0b' }}>⚠ Downtime {dtOffMap} รายการวางบนผังไม่ได้ (ไม่ระบุเครื่อง หรือเครื่องนั้นไม่มีหมุด) — ดูในรายการด้านข้าง</div>}
        {sel && !onSelectMachine && <MachineDetailCard m={sel} lens={lens} />}
      </>)}
    </div>
  );
}

/** การ์ดรายละเอียดเครื่องที่คลิก — แยกออกมาให้หน้าแม่วางในคอลัมน์ขวาได้ (กดหมุดแล้วผังไม่ดันตัวเองขึ้นลง · 16/10) */
export function MachineDetailCard({ m, lens, onClose }) {
  if (!m) return null;
  return (
          <div style={{ background: 'var(--bg3)', border: `1px solid ${m.color}66`, borderLeft: `4px solid ${m.color}`, borderRadius: 9, padding: '8px 10px', fontSize: 12 }}>
            <div style={{ fontWeight: 800, color: 'var(--text)', display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ flex: 1, minWidth: 0 }}>⚙️ {m._no}{m._name ? ` · ${m._name}` : ''} — <span style={{ color: m.color }}>{m.sub}</span></span>{onClose && <button onClick={onClose} title="ปิด" style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>}</div>
            {(lens === 'pm' || lens === 'am' || lens === 'health') && (() => {
              const cls = (m._cls || []).filter(c => (lens === 'am' ? c.am : !c.am));
              if (!cls.length) return <div style={{ color: 'var(--muted)', marginTop: 3 }}>ไม่มีแผน{lens === 'am' ? ' AM' : ' PM'} ของเครื่องนี้</div>;
              return (
                <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
                  {cls.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_META[c.status]?.color || NO_DATA_COLOR, flexShrink: 0 }} />
                      <span style={{ color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.eqName} · {c.clName}</span>
                      <span style={{ marginLeft: 'auto', flexShrink: 0, fontWeight: 700, color: STATUS_META[c.status]?.color || 'var(--muted)' }}>
                        {STATUS_META[c.status]?.label || c.status}{c.nextDue ? ` · ${c.nextDue.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
  );
}

const chip = (on) => ({
  padding: '3px 10px', borderRadius: 14, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`, background: on ? 'var(--accent-dim)' : 'var(--bg3)', color: on ? 'var(--accent)' : 'var(--text2)',
});
