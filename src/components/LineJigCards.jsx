/* 🏭 แถวการ์ดรายจิ๊ก (ข้อมูลเครื่องจาก Node-RED) บนจอ OEE รายไลน์ /line-oee (2026-11-13 · คำสั่ง user)
   📄 docs/modules/integration-hub.md §OEE รายจิ๊ก
   - วาดเฉพาะไลน์ที่มีจิ๊กผูก Node-RED แล้ว · ไลน์อื่น = return null (หน้าตาเดิมทุกพิกเซล)
   - กะปัจจุบัน (getWorkDate/getCurrentShift) · โหลดใหม่ทุก RATE.METER (1 นาที · usePolling หยุดเมื่อแท็บถูกซ่อน)
   - 🔴 เลขบนการ์ด = OEE รายจิ๊กจากเครื่อง ไม่ใช่ OEE ไลน์ด้านบน — หัวแถวเขียนกำกับ */
import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { getWorkDate, getCurrentShift } from '../utils/workDate';
import { loadJigShift } from '../lib/jigOeeData';
import { lineNameCompare } from '../utils/lineHierarchy';
import { JigOeeCard, KindLegend } from './JigOee';

export default function LineJigCards({ lineNames = [], target = 0.85, style }) {
  const [data, setData] = useState(null);
  const req = useRef(0);
  const key = [...lineNames].sort(lineNameCompare).join('\u0001');
  const load = useCallback(async () => {
    const id = ++req.current;
    const names = key ? key.split('\u0001') : [];
    if (!names.length) { setData({ jigs: [], errors: [] }); return; }
    const wd = getWorkDate(), sh = getCurrentShift();
    const r = await loadJigShift({ lineNames: names, workDate: wd, shift: sh, nowMs: Date.now() });
    if (id !== req.current) return;
    setData({ ...r, wd, sh });
  }, [key]);
  usePolling(load, RATE.METER);

  if (!data || !data.jigs.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8, ...style }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
        <b style={{ fontSize: 14, color: 'var(--text)' }}>🏭 รายจิ๊ก — ข้อมูลจากเครื่อง (สด)</b>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {data.sh === 'day' ? 'กะเช้า' : 'กะดึก'} {data.wd} · คนละชุดกับ OEE ไลน์ด้านบน (ที่คนลง) ·{' '}
          <Link to={`/oee-analytics?tab=machine&wd=${data.wd}&sh=${data.sh}`}>ดูลึกรายเครื่อง →</Link>
        </span>
        <span style={{ marginLeft: 'auto' }}><KindLegend kinds={['run', 'minor', 'fault', 'idle', 'planned_stop', 'no_plan']} /></span>
      </div>
      {data.errors?.length > 0 && <div style={{ fontSize: 12, color: 'var(--red)' }}>อ่านไม่สำเร็จ: {data.errors.join(' · ')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10, alignContent: 'start' }}>
        {data.jigs.map(j => <JigOeeCard key={`${j.sourceId}|${j.tag}`} j={j} target={target} />)}
      </div>
    </div>
  );
}
