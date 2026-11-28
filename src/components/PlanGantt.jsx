/* ══ 📅 แผนภูมิแท่งเวลาแผนงานกิจกรรม `<PlanGantt>` (2026-11-28 · คำสั่ง user "สร้างแผนงาน · กิจกรรมอื่นต้องมีด้วย" — แบบเว็บ TSAT4 Activity) ══
   ซ้าย: ลำดับ · รายการ · ผู้รับผิดชอบ · % (จุดสีตามสถานะ) · ข้อหลักกดย่อ/ขยายข้อย่อยได้
   ขวา: 12 เดือน × 4 สัปดาห์ · แท่งบน (อ่อน) = แผน · แท่งล่าง (เข้ม) = ทำจริง ถึงวันเสร็จ/วันนี้ · ส่วนเลยวันจบ = แดง · เส้นแดง = วันนี้
   ป้ายข้างแท่ง = ช่วงวันที่ · สถานะเทียบแผน (สูตรกลาง `utils/planTasks.js` · ตำแหน่งแท่ง `utils/planGantt.js`)
   · ความสูงพอดีจอ (useFitHeight) · หัวตารางค้าง · ใช้ทุกกิจกรรม (5S · Smart Factory · กิจกรรมอื่น) — ห้ามวาด Gantt เองในหน้า */
import { useMemo, useState } from 'react';
import useFitHeight from '../utils/useFitHeight';
import { tr } from '../utils/i18n';
import { fmtDate, monthsShort } from '../utils/dateFormat';
import { taskTree } from '../utils/planTasks.js';
import { STATUS_LEGEND, WEEKS, barsOf, todayCol } from '../utils/planGantt.js';

const GROUP = ['blue', 'green', 'amber', 'purple', 'accent'];   // สีของแต่ละข้อหลัก (ข้อย่อยใช้สีเดียวกับข้อหลัก)
const LEFT = 470;      // กว้างฝั่งรายการ (px)
const ROW_H = 40;
const HEAD_H = 52;
const pct = (c) => `${(c / WEEKS) * 100}%`;
const toneVar = (t) => (t === 'muted' ? 'var(--border2)' : `var(--${t})`);

function Bars({ row, year, today, color }) {
  const b = barsOf(row, year, today);
  if (!b.plan) return null;
  const label = `${fmtDate(row.start_date)} – ${fmtDate(row.end_date)}${b.status.text ? ` · ${tr(b.status.text)}` : ''}`;
  const after = b.late || b.actual || b.plan;
  const nearRight = after.to > WEEKS - 12;
  return (
    <>
      {/* แผน (บน · อ่อน) */}
      <div title={label} style={{ position: 'absolute', top: 7, height: 9, left: pct(b.plan.from), width: pct(b.plan.to - b.plan.from + 1), borderRadius: 5,
        background: 'var(--card)', border: `1.5px solid ${toneVar(color)}`, opacity: 0.85 }}>
        <div style={{ position: 'absolute', inset: 0, background: toneVar(color), opacity: 0.22, borderRadius: 4 }} />
      </div>
      {/* ทำจริง (ล่าง · เข้ม) + ส่วนช้า (แดง) */}
      {b.actual && <div title={label} style={{ position: 'absolute', top: 20, height: 10, left: pct(b.actual.from), width: pct(b.actual.to - b.actual.from + 1), borderRadius: 5, background: toneVar(color) }} />}
      {b.late && <div title={label} style={{ position: 'absolute', top: 20, height: 10, left: pct(b.late.from), width: pct(b.late.to - b.late.from + 1), borderRadius: 5, background: 'var(--red)' }} />}
      {/* ป้าย: ช่วงวัน · สถานะ (ข้างขวาแท่ง · ใกล้ขอบขวา = ข้างซ้าย) + % ใต้ป้าย */}
      <div style={{ position: 'absolute', top: 3, fontSize: 11.5, lineHeight: '15px', color: 'var(--text2)', whiteSpace: 'nowrap', pointerEvents: 'none',
        ...(nearRight ? { right: `calc(${pct(WEEKS - b.plan.from)} + 6px)`, textAlign: 'right' } : { left: `calc(${pct(after.to + 1)} + 6px)` }) }}>
        {label}
        {(b.actual || b.late) && <div style={{ fontWeight: 700, color: 'var(--text)' }}>{Number(row.progress) || 0}%</div>}
      </div>
    </>
  );
}

/**
 * @param {{ rows: object[], year: number, today: string, ownerOf?: (r) => string, empty?: string, query?: string }} p
 */
export default function PlanGantt({ rows, year, today, ownerOf = (r) => r.owner_name || r.owner_code || '-', empty, query = '' }) {
  const [closed, setClosed] = useState(() => new Set());
  const [fitRef, fitH] = useFitHeight(0, 300);
  const months = monthsShort();
  const tree = useMemo(() => taskTree(rows), [rows]);
  const needle = query.trim().toLowerCase();
  const hit = (r) => !needle || `${r.title} ${ownerOf(r)} ${r.note || ''}`.toLowerCase().includes(needle);
  const flat = [];
  tree.forEach(({ row, kids }, gi) => {
    const kidsShown = kids.filter(hit);
    if (!hit(row) && !kidsShown.length) return;
    flat.push({ r: row, head: true, no: String(row.sort_no), gi, kids: kids.length });
    if (!closed.has(row.act_task)) (needle ? kidsShown : kids).forEach(k => flat.push({ r: k, head: false, no: `${row.sort_no}.${k.sort_no}`, gi }));
  });
  const tc = todayCol(today, year);
  const toggle = (id) => setClosed(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const cell = { borderTop: '1px solid var(--border)', height: ROW_H, display: 'flex', alignItems: 'center', fontSize: 13, padding: '0 8px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' };
  const headCell = { position: 'sticky', top: 0, zIndex: 3, background: 'var(--bg3)', fontSize: 12, fontWeight: 700, color: 'var(--muted)' };

  if (!rows.length) return <div style={{ fontSize: 13, color: 'var(--muted)', padding: 16 }}>{empty || tr('ยังไม่มีแผนงาน')}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div ref={fitRef} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--card)', overflow: 'auto', ...(fitH != null ? { height: fitH - 44 } : { maxHeight: '70vh' }) }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${LEFT}px minmax(820px, 1fr)`, minWidth: LEFT + 820 }}>
          {/* หัวฝั่งซ้าย */}
          <div style={{ ...headCell, left: 0, zIndex: 4, height: HEAD_H, display: 'grid', gridTemplateColumns: '56px 1fr 130px 54px', alignItems: 'center', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ padding: '0 8px' }}>{tr('ลำดับ')}</span><span style={{ padding: '0 8px' }}>{tr('รายการ')}</span><span style={{ padding: '0 8px' }}>{tr('ผู้รับผิดชอบ')}</span><span style={{ padding: '0 8px', textAlign: 'right' }}>%</span>
          </div>
          {/* หัวฝั่งขวา: เดือน + สัปดาห์ */}
          <div style={{ ...headCell, height: HEAD_H, borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', height: 26, alignItems: 'center' }}>
              {months.map(m => <div key={m} style={{ textAlign: 'center', borderLeft: '1px solid var(--border)' }}>{m}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, height: 26, alignItems: 'center' }}>
              {Array.from({ length: WEEKS }, (_, i) => <div key={i} style={{ textAlign: 'center', fontWeight: 500, borderLeft: i % 4 === 0 ? '1px solid var(--border)' : 'none' }}>{(i % 4) + 1}</div>)}
            </div>
          </div>
          {/* แถว */}
          {flat.map(({ r, head, no, gi, kids }) => {
            const color = GROUP[gi % GROUP.length];
            const st = barsOf(r, year, today);
            return (
              <div key={r.act_task} style={{ display: 'contents' }}>
                <div style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--card)', display: 'grid', gridTemplateColumns: '56px 1fr 130px 54px', borderRight: '1px solid var(--border)' }}>
                  <div style={cell}>{no}</div>
                  <div style={{ ...cell, fontWeight: head ? 700 : 400, paddingLeft: head ? 8 : 22 }} title={r.title}>
                    {head && kids > 0 && (
                      <button type="button" onClick={() => toggle(r.act_task)} aria-label={tr(closed.has(r.act_task) ? 'แสดงข้อย่อย' : 'ซ่อนข้อย่อย')}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '0 4px 0 0', fontSize: 11 }}>{closed.has(r.act_task) ? '▸' : '▾'}</button>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                  </div>
                  <div style={{ ...cell, color: 'var(--text2)' }} title={ownerOf(r)}>{ownerOf(r)}</div>
                  <div style={{ ...cell, justifyContent: 'flex-end', gap: 5, fontWeight: 700, color: st.tone === 'red' ? 'var(--red)' : 'var(--text)' }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: toneVar(st.tone), flexShrink: 0 }} />{Number(r.progress) || 0}
                  </div>
                </div>
                <div style={{ position: 'relative', height: ROW_H, borderTop: '1px solid var(--border)',
                  backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px)', backgroundSize: `calc(100% / 12) 100%` }}>
                  {tc != null && <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: pct(tc + 0.5), width: 2, background: 'var(--red)', zIndex: 1, opacity: 0.85 }} />}
                  <Bars row={r} year={year} today={today} color={color} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: 'var(--text2)', alignItems: 'center' }}>
        {STATUS_LEGEND.map(l => <span key={l.tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: toneVar(l.tone) }} />{tr(l.label)}</span>)}
        <span style={{ color: 'var(--muted)' }}>{tr('แท่งบน (อ่อน) = แผน · แท่งล่าง (เข้ม) = ทำจริงถึงวันเสร็จ/วันนี้ · แดง = เลยกำหนด · เส้นแดง = วันนี้')}</span>
      </div>
    </div>
  );
}
