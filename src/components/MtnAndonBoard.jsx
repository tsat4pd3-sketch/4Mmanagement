/* ══════════════════════════════════════════════════════════════════════════
   🚨 จอห้องช่าง (Maintenance Andon Board) — `/dept-dashboard?dept=maintenance&view=andon`

   ที่มา (feedback หน้างาน 2026-08-24): จอ TV ในห้องช่างเปิด `/factory-map` อยู่
   ซึ่งเป็น "ผังภาพรวมทั้งโรงงาน" ใบเดียวกับที่ผู้บริหารดู — ตอบคำถามของช่างไม่ได้
   และ **ไม่มีเสียงเตือนเครื่องเบรคดาวน์เลย** (DowntimeSiren ไม่ได้ mount ที่หน้านั้น)

   จอนี้ตอบ 3 คำถามของช่าง เรียงตามความเร่งด่วน — อ่านจากอีกฝั่งห้องได้:
     ① ตอนนี้มีเครื่องไหนหยุดอยู่ · กี่นาทีแล้ว · ใครเรียกช่างบ้าง   ← ใหญ่สุด + มีเสียง
     ② ใบซ่อมที่รับไปแล้วค้างอยู่ขั้นไหน
     ③ PM ที่เกินกำหนด/ครบวันนี้

   ⚠️ กฎที่ห้ามแหก (Andon · CLAUDE.md):
     · **หยุดตามแผน (planned) ห้ามแดง ห้ามส่งเสียง** — นับสต๊อก/5ส/ไม่มีแผนผลิต ไม่ใช่ความเสียหาย
       แต่ **ห้ามซ่อน** → แสดงแยกเป็นบล็อกเทาสงบ
     · **กระพริบเฉพาะแดง** (เรียกช่างแล้วยังไม่รับทราบ) · เกินเกณฑ์ = ส้ม "นิ่ง"
     · เสียงใช้ `DowntimeSiren mode="call_mtn"` ตัวเดียวกับ `/mtn-layout`
       (`open_15min` เป็นของจอฝ่ายผลิตตามกติกาเดิม — ที่นี่เห็นด้วยตา ไม่ส่งเสียงซ้ำ)
     · **อ่านอย่างเดียว** ทุกอย่างที่กดได้ = ลิงก์ไปหน้าที่ทำงานจริง
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { isOpenDT, isPlannedDT, dtElapsedMin } from '../utils/downtimeRules';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { OPEN_MO_STATUSES, MO_STATUS_LABEL } from '../utils/dieStatus';
import DowntimeSiren from './DowntimeSiren';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
/* ⚠️ downtime ที่กรอกแค่จำนวนนาที (ไม่มี started_at) จะไม่รู้ว่าหยุดมากี่นาที — ต้องบอกว่า "ไม่รู้"
   ห้ามแปลงเป็น 0 (0 น. อ่านเป็น "เพิ่งหยุด" ซึ่งคนละเรื่องกับ "ไม่รู้เวลาเริ่ม") */
const fmtMin = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} น.` : `${m} น.`);
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / 86400000) : null);

/** จัดระดับความเร่งด่วนของ downtime ที่ยังเปิดค้าง — ใช้ทั้งสี ลำดับ และการนับ */
function severity(x) {
  if (isPlannedDT(x)) return { k: 'planned', rank: 3, color: '#6b7280', label: '🗓️ หยุดตามแผน', blink: false };
  if (x.call_mtn && !x.call_mtn_ack_at) return { k: 'call', rank: 0, color: '#ef4444', label: '📞 เรียกช่าง', blink: true };
  if (x.open_alerted_at && !x.open_ack_at) return { k: 'over', rank: 1, color: '#f59e0b', label: '⏰ หยุดเกินเกณฑ์', blink: false };
  return { k: 'new', rank: 2, color: '#facc15', label: '⏱️ เพิ่งหยุด', blink: false };
}

export default function MtnAndonBoard({ d, ctx }) {
  const { inScope, navigate, isMobile, workDate } = ctx;
  const [dts, setDts] = useState([]);
  const [dtErr, setDtErr] = useState(null);
  const [, setTick] = useState(0);          // นาฬิกาเดิน — ให้ "กี่นาทีแล้ว" ขยับเอง

  const load = useCallback(async () => {
    /* เปิดค้าง = ยังไม่ปิดรายการ (ไม่มีทั้งเวลาจบและจำนวนนาที) — เกณฑ์เดียวกับ DowntimeSiren
       ⚠️ คอลัมน์ชื่อประเภทคือ `name_th` (dr_*_types ทุกตัว) — ใส่ `name` = 42703 คิวรีล้มทั้งก้อนเงียบ */
    const { data, error } = await supabaseDR.from('downtime_logs')
      .select('id, machine_no, description, started_at, call_mtn, call_mtn_at, call_mtn_ack_at, open_alerted_at, open_ack_at, duration_min, ended_at, dr_downtime_types(name_th, category), production_sessions(line_name, status, shift)')
      .is('duration_min', null).is('ended_at', null);
    if (error) { setDtErr(error.message); return; }
    setDtErr(null);
    // เอาเฉพาะของกะที่ยังเปิดจริง + อยู่ในขอบเขตที่ผู้ใช้ดูแล
    setDts((data || []).filter(x =>
      ['open', 'pending_close'].includes(x.production_sessions?.status) && inScope(x.production_sessions?.line_name)));
  }, [inScope]);

  useEffect(() => {
    load();
    const stopPoll = visibleInterval(load, RATE.ANDON);      // กันเหนียวเผื่อ realtime หลุด
    const ch = supabaseDR.channel('mtn-andon')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_logs' }, () => setTimeout(load, 400))
      .subscribe();
    const clk = setInterval(() => setTick(t => t + 1), 30000); // นาฬิกาอย่างเดียว ไม่ยิง DB
    return () => { stopPoll(); supabaseDR.removeChannel(ch); clearInterval(clk); };
  }, [load]);

  const rows = useMemo(() => dts
    .filter(isOpenDT)
    .map(x => ({ ...x, _s: severity(x), _min: dtElapsedMin(x) }))
    .sort((a, b) => a._s.rank - b._s.rank || (b._min ?? -1) - (a._min ?? -1)), [dts]);

  const live = rows.filter(r => r._s.k !== 'planned');
  const planned = rows.filter(r => r._s.k === 'planned');
  const nCall = live.filter(r => r._s.k === 'call').length;

  /* ── ใบซ่อมค้าง (จาก loader ของส่วนงานซ่อมบำรุง — ไม่ยิงซ้ำ) ── */
  const mo = useMemo(() => (d.mo || [])
    .filter(o => OPEN_MO_STATUSES.includes(o.status))
    .filter(o => !o.line_name || inScope(o.line_name))
    .sort((a, b) => String(a.report_at || '').localeCompare(String(b.report_at || ''))), [d.mo, inScope]);
  const moByStep = useMemo(() => {
    const m = {}; mo.forEach(o => { m[o.status] = (m[o.status] || 0) + 1; }); return m;
  }, [mo]);

  /* ── PM เกินกำหนด / ครบใน 3 วัน ── */
  const pm = useMemo(() => {
    const clById = {}; (d.cls || []).forEach(c => { clById[c.id] = c; });
    const jigById = {}; (d.jigs || []).forEach(j => { jigById[j.id] = j; });
    return (d.plans || []).filter(p => p.next_due_date).map(p => {
      const j = jigById[clById[p.checklist_id]?.equipment_id];
      return {
        ...p, name: j?.name || j?.jig_no || j?.machine_no || 'อุปกรณ์ (ไม่พบชื่อ)', line: j?.line_name || '',
        days: Math.round((new Date(`${p.next_due_date}T00:00:00`) - new Date(`${workDate}T00:00:00`)) / 86400000),
      };
    }).filter(p => p.days <= 3).sort((a, b) => a.days - b.days);
  }, [d, workDate]);

  const big = isMobile ? 1 : 2;   // ตัวคูณขนาดตัวอักษรสำหรับจอ TV

  return (
    <>
      <DowntimeSiren mode="call_mtn" />

      {/* ── แถบสรุปบนสุด — อ่านจากอีกฝั่งห้องได้ ── */}
      <div style={{
        ...card, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', justifyContent: 'space-between',
        borderColor: nCall ? '#ef4444' : live.length ? '#f59e0b' : 'var(--border)',
        background: nCall ? 'rgba(239,68,68,0.10)' : live.length ? 'rgba(245,158,11,0.08)' : 'var(--card)',
      }}>
        <div style={{ fontSize: 15 * big, fontWeight: 900, color: nCall ? '#ef4444' : live.length ? '#f59e0b' : '#22c55e' }}>
          {nCall ? `📞 เรียกช่าง ${nCall} เครื่อง` : live.length ? `🔧 เครื่องหยุดอยู่ ${live.length} เครื่อง` : '✅ ไม่มีเครื่องหยุดอยู่ตอนนี้'}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 * big, fontWeight: 800 }}>
          <span style={{ color: mo.length ? '#f59e0b' : '#22c55e' }}>🛠️ ใบซ่อมค้าง {mo.length}</span>
          <span style={{ color: pm.filter(p => p.days < 0).length ? '#ef4444' : 'var(--muted)' }}>📅 PM เกินกำหนด {pm.filter(p => p.days < 0).length}</span>
        </div>
      </div>

      {/* โหลด downtime ไม่สำเร็จ = ต้องบอก ห้ามขึ้นจอเขียว "ไม่มีเครื่องหยุด" ทั้งที่แค่ดึงไม่ได้ */}
      {dtErr && (
        <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: 13 }}>
          ⚠ ดึงสถานะเครื่องหยุดไม่สำเร็จ — ตัวเลขด้านล่างยังไม่ใช่ของจริง ({dtErr})
        </div>
      )}
      {d.loadErr && (
        <div style={{ ...card, borderColor: '#f59e0b', color: '#f59e0b', fontSize: 13 }}>
          ⚠ ข้อมูล downtime ย้อนหลังโหลดไม่ครบ — ตัวเลขสรุปอาจต่ำกว่าจริง
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,2fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
        {/* ══ ① เครื่องที่หยุดอยู่ตอนนี้ ══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ fontSize: 13 * big, fontWeight: 900 }}>🚨 เครื่องที่หยุดอยู่ตอนนี้</div>

          {!live.length && (
            <div style={{ ...card, textAlign: 'center', padding: 30, fontSize: 14 * big, fontWeight: 800, color: '#22c55e' }}>
              ✅ ไม่มีเครื่องหยุดอยู่ตอนนี้
            </div>
          )}

          {live.map(r => (
            <div key={r.id} className={r._s.blink ? 'dt-alarm-blink' : undefined}
              onClick={() => navigate('/mtn-repair')}
              style={{
                ...card, cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
                borderColor: r._s.color, borderLeft: `7px solid ${r._s.color}`,
                background: r._s.k === 'call' ? 'rgba(239,68,68,0.12)' : 'var(--card)',
              }}>
              <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                <div style={{ fontSize: 17 * big, fontWeight: 900, color: 'var(--text)', lineHeight: 1.15 }}>
                  {r.machine_no || 'ไม่ระบุเครื่อง'}
                </div>
                <div style={{ fontSize: 12 * big, color: 'var(--text2)', marginTop: 2 }}>
                  {r.production_sessions?.line_name || '-'} · {r.dr_downtime_types?.name_th || 'ไม่ระบุประเภท'}
                </div>
                {r.description && <div style={{ fontSize: 11 * big, color: 'var(--muted)', marginTop: 2 }}>💬 {r.description}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 18 * big, fontWeight: 900, color: r._s.color, lineHeight: 1 }}>{fmtMin(r._min)}</div>
                {r._min == null && <div style={{ fontSize: 10 * big, color: 'var(--muted)' }}>ไม่ได้ระบุเวลาเริ่ม</div>}
                <div style={{ fontSize: 11 * big, fontWeight: 800, color: r._s.color, marginTop: 3 }}>{r._s.label}</div>
              </div>
            </div>
          ))}

          {/* ⚠️ หยุดตามแผนไม่ใช่ alarm — แต่ห้ามซ่อน (ช่างต้องรู้ว่าเครื่องไหนหยุดอยู่ด้วยเหตุอะไร) */}
          {planned.length > 0 && (
            <div style={{ ...card, background: 'var(--bg3)' }}>
              <div style={{ fontSize: 11.5 * big, fontWeight: 800, color: 'var(--muted)', marginBottom: 6 }}>
                🗓️ หยุดตามแผน {planned.length} รายการ (ไม่นับเป็น Andon)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {planned.map(r => (
                  <span key={r.id} style={{ fontSize: 11 * big, color: 'var(--text2)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 9px' }}>
                    {r.machine_no || r.production_sessions?.line_name} · {r.dr_downtime_types?.name_th || ''} · {fmtMin(r._min)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ══ ② ใบซ่อมค้าง + ③ PM ══ */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 13 * big, fontWeight: 900, marginBottom: 8 }}>🛠️ ใบซ่อมค้าง ({mo.length})</div>
            {!mo.length && <div style={{ fontSize: 12 * big, color: '#22c55e', fontWeight: 700 }}>✅ ไม่มีใบค้าง</div>}
            {mo.length > 0 && (<>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 9 }}>
                {OPEN_MO_STATUSES.filter(k => moByStep[k]).map(k => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 * big }}>
                    <span style={{ color: 'var(--text2)' }}>{MO_STATUS_LABEL[k] || k}</span>
                    <b style={{ color: 'var(--text)' }}>{moByStep[k]}</b>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10.5 * big, fontWeight: 800, color: 'var(--muted)', marginBottom: 4 }}>ค้างนานสุด</div>
              {mo.slice(0, 4).map(o => {
                const age = daysSince(o.report_at);
                return (
                  <div key={o.id} onClick={() => navigate('/mtn-repair')}
                    style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)', fontSize: 11 * big }}>
                    <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.machine_no || o.line_name || o.mo_no || '-'}
                    </span>
                    <b style={{ flexShrink: 0, color: age >= 3 ? '#ef4444' : 'var(--muted)' }}>{age != null ? `${age} วัน` : '-'}</b>
                  </div>
                );
              })}
            </>)}
          </div>

          <div style={card}>
            <div style={{ fontSize: 13 * big, fontWeight: 900, marginBottom: 8 }}>📅 PM ที่ต้องทำ</div>
            {!pm.length && <div style={{ fontSize: 12 * big, color: 'var(--muted)' }}>ไม่มีแผนที่ครบกำหนดใน 3 วัน</div>}
            {pm.slice(0, 6).map(p => (
              <div key={p.id} onClick={() => navigate('/pm-schedule')}
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)', fontSize: 11 * big }}>
                <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <b style={{ flexShrink: 0, color: p.days < 0 ? '#ef4444' : p.days === 0 ? '#f59e0b' : 'var(--muted)' }}>
                  {p.days < 0 ? `เกิน ${Math.abs(p.days)} วัน` : p.days === 0 ? 'วันนี้' : `อีก ${p.days} วัน`}
                </b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
