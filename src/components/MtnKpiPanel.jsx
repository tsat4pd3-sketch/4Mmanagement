import { useState, useMemo } from 'react';
import LineSelect from './LineSelect';
import MachineReliability from './MachineReliability';
import { getLineFamilyNames } from '../utils/lineHierarchy';
import { techRepairMin } from '../utils/mtnVendor';
import TimeRangeBar from './TimeRangeBar';
import useTimeRange from '../utils/useTimeRange';
import { rangeDays } from '../utils/timeRange';

/* ══ 📊 KPI ช่าง — MTTA / MTTR / MDT + ความพึงพอใจ + ความน่าเชื่อถือรายอุปกรณ์ ══════════
   ย้ายมาจากแท็บ `?tab=kpi` ของ `/mtn-repair` เมื่อ 2026-09-22 (คำสั่ง user: *"ฟังก์ชันของช่าง
   เหมือนไปกระจายอยู่หลายหน้า"* → ยุบของ "วิเคราะห์" ไปไว้ที่ `/mtn-analysis` ที่เดียว)

   ทำไมต้องย้าย:
     · `/mtn-repair` = หน้า**ทำงาน** (เปิดใบ/เดินขั้น) · KPI เป็นหน้า**วิเคราะห์** คนละจังหวะใช้งาน
     · เดิมมี **พาเรโตลักษณะปัญหาซ้ำกัน 2 ที่** (แท็บนี้ กับ `/mtn-analysis`) ⇒ ถอดออกจากที่นี่
       แล้วให้แท็บ 🧪 QC 7 Tools เป็นเจ้าของพาเรโตที่เดียว (ของนั่นแยกตามชนิดสินทรัพย์ด้วย)

   🔴 **2 ฐานข้อมูลในจอเดียว ต้องติดป้ายที่มาเสมอ** (บทเรียนเดิมของโมดูลนี้):
      การ์ดด้านบน = นับจาก **ใบซ่อม MO ที่ปิดแล้ว** (วัดการตอบสนองของทีมช่าง)
      ตารางด้านล่าง = นับจาก **downtime จริงของเครื่อง** (วัดตัวเครื่อง)
      ⇒ MTTR 2 ตัวไม่เท่ากันเป็นเรื่องปกติ ไม่ใช่บั๊ก — ห้ามถอดป้ายกำกับออก
   ═════════════════════════════════════════════════════════════════════════════════════════ */

const minutesBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null);
const fmtMin = (m) => (m == null ? '—' : m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} นาที`);
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };

/* ความพึงพอใจ 5 ด้าน × 3 ระดับ — **คีย์ต้องตรงกับ SAT_DIMS ใน MtnRepair.jsx เป๊ะ**
   (ค่าที่เก็บใน `mtn_orders.satisfaction` เป็น jsonb คีย์ชุดนี้ · เปลี่ยนคีย์ = ใบเก่าอ่านไม่ออก) */
const SAT_DIMS = [
  { key: 'quality',    label: 'คุณภาพงาน' },
  { key: 'response',   label: 'ความรวดเร็วในการทำงาน' },
  { key: 'problem',    label: 'ความสามารถในการแก้ปัญหา' },
  { key: 'politeness', label: 'ความสุภาพ' },
  { key: 'readiness',  label: 'ความกระตือรือร้น' },
];
const satAvg = (s) => {
  if (!s) return null;
  const vs = SAT_DIMS.map(d => Number(s[d.key])).filter(v => v >= 1 && v <= 3);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
};

export default function MtnKpiPanel({ orders = [], scopeLines = null, lineObjs = [], machines = [], onGoQc7 }) {
  const [line, setLine] = useState('');
  /* ⏱️ ช่วงข้อมูล = แถบกลาง (UI §6.16) — เดิมเป็น dropdown "N วันล่าสุด" อย่างเดียว เลือกช่วงในอดีตไม่ได้
     · แผงนี้ฝังอยู่ในหน้าแม่ ⇒ ใช้ `?from=&to=` ร่วมกับแท็บอื่นของหน้าเดียวกัน (สลับแท็บแล้วช่วงไม่หาย)
     · `days` ยังคงไว้เพราะโค้ดคำนวณด้านล่างใช้ตัวเลขนี้ — แต่มาจากช่วงที่เลือกจริงแล้ว ไม่ใช่ค่าคงที่ */
  const tr = useTimeRange({ defaultDays: 30 });
  const days = rangeDays(tr.from, tr.to) || 30;

  const rows = useMemo(() => {
    /* 🔴 ต้องยึด "ช่วงที่เลือกจริง" ไม่ใช่ "N วันนับถอยจากตอนนี้" — ไม่งั้นพอเลือกช่วงในอดีต
       จำนวนวันถูกแต่หน้าต่างเวลาผิด (ยังลากถึงวันนี้เสมอ) = ตัวเลขไม่ตรงกับที่จอบอก */
    const since = new Date(`${tr.from}T00:00:00`);
    const until = new Date(`${tr.to}T00:00:00`); until.setDate(until.getDate() + 1);
    // กางครอบครัวไลน์เหมือนลิสต์หลัก — เลือกไลน์แม่ต้องนับใบของไลน์ลูกด้วย (fam ว่าง = ถอยไปเทียบตรงตัว)
    const fam = line ? new Set(getLineFamilyNames(lineObjs, line)) : null;
    const inLine = (o) => !line || (fam?.size ? fam.has(o.line_name) : o.line_name === line);
    return orders.filter(o => (!scopeLines || !o.line_name || scopeLines.has(o.line_name)) && inLine(o) && new Date(o.report_at) >= since && new Date(o.report_at) < until && o.repair_done_at);
  }, [orders, scopeLines, line, tr.from, tr.to, lineObjs]);

  const stat = useMemo(() => {
    const resp = [], ttr = [], bd = [];
    for (const o of rows) {
      const r = minutesBetween(o.report_at, o.accept_at); if (r != null) resp.push(r);
      // MTTR หักช่วงอยู่กับ supplier · Breakdown ไม่หัก (ไลน์หยุดจริง) — ดู mtnVendor.js
      const t = techRepairMin(o); if (t != null) ttr.push(t);
      const b = minutesBetween(o.report_at, o.repair_done_at); if (b != null) bd.push(b);
    }
    const avg = a => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
    // ความพึงพอใจ (KPI หน่วยงานซ่อม) — เฉลี่ยรวม + รายด้าน จากใบที่มีการประเมิน
    const rated = rows.filter(o => satAvg(o.satisfaction) != null);
    const satOverall = rated.length ? rated.reduce((s, o) => s + satAvg(o.satisfaction), 0) / rated.length : null;
    const satByDim = SAT_DIMS.map(d => {
      const vs = rated.map(o => Number(o.satisfaction?.[d.key])).filter(v => v >= 1 && v <= 3);
      return { label: d.label, avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null, n: vs.length };
    });
    return { n: rows.length, resp: avg(resp), ttr: avg(ttr), bd: avg(bd), satOverall, satByDim, satN: rated.length };
  }, [rows]);

  // h = คำแปลของชื่อย่อสากล — ต้องอ่านได้บนจอเลย ห้ามซ่อนใน tooltip อย่างเดียว (จอ TV ไม่มี hover)
  const Card = ({ t, v, c, h }) => (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, flex: 1, minWidth: 170 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: c || 'var(--text)', marginTop: 2 }}>{v}</div>
      {h && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 }}>{h}</div>}
    </div>
  );

  return (
    <div>
      {/* ⏱️ แถบกรองเวลามาตรฐาน (UI §6.16) — ใช้ `?from=&to=` ร่วมกับแท็บอื่นของหน้าแม่ */}
      <TimeRangeBar
        scale={tr.scale} from={tr.from} to={tr.to} today={tr.today} scales={null}
        onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset} style={{ marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {/* <LineSelect> — lineObjs ถูก scope จากหน้าแม่แล้ว · 2026-09-07 */}
        <LineSelect lines={lineObjs} value={line} onChange={setLine} placeholder="ทุกไลน์" style={{ ...inp, width: 200 }} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.7 }}>
        📋 <b style={{ color: 'var(--text2)' }}>นับจากใบแจ้งซ่อม (MO) ที่ปิดแล้ว</b> — วัดการตอบสนองของทีมช่าง
        · ส่วน <b style={{ color: 'var(--text2)' }}>MTTR/MTBF รายอุปกรณ์</b> ที่อยู่ล่างสุดของหน้านี้นับจาก
        <b style={{ color: 'var(--text2)' }}> downtime จริงของเครื่อง</b> — คนละฐาน ตัวเลขไม่เท่ากันเป็นเรื่องปกติ
        {/* พาเรโตถูกย้ายไปแท็บ QC7 (แยกตามชนิดสินทรัพย์) — ต้องมีทางไปให้ชัด ไม่ใช่หายเงียบ */}
        {onGoQc7 && (
          <div>
            🧪 อยากดู <b style={{ color: 'var(--text2)' }}>พาเรโต / ก้างปลา / ฮิสโตแกรม / กราฟควบคุม</b> แยกตามชนิดอุปกรณ์ →{' '}
            <button type="button" onClick={onGoQc7} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontWeight: 800, fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline' }}>
              ไปแท็บ QC 7 Tools
            </button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <Card t="งานที่ปิด (ในช่วง)" v={stat.n} />
        <Card t="MTTA — เข้าดำเนินการเฉลี่ย" v={fmtMin(stat.resp)} c="#3b82f6" h="Mean Time To Acknowledge = แจ้ง → ช่างรับงาน" />
        <Card t="MTTR — เวลาซ่อมเฉลี่ย" v={fmtMin(stat.ttr)} c="#f59e0b" h="Mean Time To Repair = รับงาน → ซ่อมเสร็จ (ไม่รวมเวลารอช่าง และหักช่วงที่ส่งซ่อมภายนอกออกแล้ว)" />
        <Card t="MDT — หยุดรวมเฉลี่ย" v={fmtMin(stat.bd)} c="#ef4444" h="Mean Down Time = แจ้ง → ซ่อมเสร็จ (MTTA + MTTR)" />
        <Card t={`ความพึงพอใจเฉลี่ย (${stat.satN} ใบ)`} v={stat.satOverall != null ? `${Math.round(stat.satOverall / 3 * 100)}%` : '—'}
          c={stat.satOverall == null ? 'var(--muted)' : stat.satOverall >= 2.5 ? '#22c55e' : stat.satOverall >= 2 ? '#f59e0b' : '#ef4444'} />
      </div>
      {stat.satN > 0 && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>ความพึงพอใจบริการซ่อม รายด้าน (KPI หน่วยงานซ่อม)</div>
          {stat.satByDim.map(d => {
            const pct = d.avg != null ? Math.round(d.avg / 3 * 100) : 0;
            const col = d.avg == null ? 'var(--muted)' : d.avg >= 2.5 ? '#22c55e' : d.avg >= 2 ? '#f59e0b' : '#ef4444';
            return (
              <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <div style={{ width: 200, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
                <div style={{ flex: 1, height: 16, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: col }} /></div>
                <div style={{ width: 70, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: col }}>{d.avg != null ? `${d.avg.toFixed(2)}/3` : '—'}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ⚙️ ความน่าเชื่อถือรายอุปกรณ์ — เดิมเป็นแท็บแยก ยุบเข้ามาที่นี่ (คำสั่ง user 2026-09-15)
          🔴 คนละฐานกับการ์ดข้างบน: ข้างบนนับจาก "ใบซ่อม MO" · ข้างล่างนับจาก "downtime จริงของเครื่อง"
             ⇒ MTTR 2 ตัวไม่เท่ากันเป็นเรื่องปกติ **ต้องมีป้ายกำกับที่มาเสมอ** ไม่งั้นกลายเป็น
             "จอเดียวกันตอบคนละเลข" (บทเรียนเดิมของโมดูลนี้) */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '2px solid var(--border2)' }}>
        {/* หัวข้อคั่น — ส่วนนี้มีแถบกรองของตัวเอง (ช่วงวัน/ไลน์/ชนิด) คนละชุดกับด้านบน
            ไม่มีหัวข้อคั่น = คนเห็นแถบกรอง 2 ชุดติดกันแล้วงงว่าอันไหนคุมอะไร */}
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
          ⚙️ ความน่าเชื่อถือรายอุปกรณ์ — MTTR / MTBF
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
          นับจาก <b style={{ color: 'var(--text2)' }}>downtime จริงของเครื่อง</b> ไม่ใช่ใบแจ้งซ่อม — มีตัวกรองของตัวเองด้านล่าง
        </div>
        <MachineReliability machines={machines} lineObjs={lineObjs} scopeLines={scopeLines} />
      </div>
    </div>
  );
}
