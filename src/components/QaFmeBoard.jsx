/**
 * QaFmeBoard — บอร์ดไทม์ไลน์ "วันนี้ QA ต้องไปตรวจไลน์ไหน กี่โมง"
 * (2026-08-31 · คำขอ user: "งาน daily ที่จะต้องไปตรวจไลน์ไหน ใช้คอนเซปต์ timeline
 *  heijunka board เหมือนสโตร์ได้มั้ย")
 *
 * ใช้ InternalTimeBoard ตัวเดียวกับบอร์ดรอบส่งของ Store — แถว = ไลน์ผลิต · บล็อก = จุดที่ต้องไปตรวจ
 * · playhead ชมพู = ตอนนี้ · แถบลายเฉียง = เวลาพัก (มาตรฐานเดียวกับบอร์ด Heijunka)
 *
 * ⚠️⚠️ กฎเหล็กของจอนี้ — **ของจริงกับของเดา ห้ามวาดเหมือนกัน**
 *   บล็อกทึบ  = งานตรวจที่ระบบบันทึกไว้จริง (`qa_fme_obligations` — ผลิตเปลี่ยนรุ่น/เปลี่ยนกะจริง)
 *   บล็อกเส้นประ = **คาดการณ์** ว่ารุ่นที่กำลังวิ่งจะจบเมื่อไหร่ (คำนวณจาก CT × ยอดที่เหลือ)
 *   → ห้ามถอดเส้นประ/ป้าย "คาดการณ์" ออก และห้ามเอาเวลาคาดการณ์ไปเขียนลง DB
 *     (มันเปลี่ยนได้ตลอดตามจังหวะผลิต · ตัวที่สร้างงานตรวจจริงคือ edge `qa-fme-scan` เท่านั้น)
 *
 * ⚠️ พาร์ทที่ยังไม่ตั้ง CT = **ไม่วาดบล็อกคาดการณ์เลย** ห้ามเดาเวลาให้
 *    (ขึ้นเป็นข้อความบอกว่ามีกี่รุ่นที่ประเมินไม่ได้ + ต้องไปตั้ง CT ที่ไหน — ห้ามเงียบ)
 *
 * อ่านอย่างเดียว — กดบล็อกเพื่อเปิดใบตรวจของรุ่นนั้น (งานตรวจจริงเท่านั้น · บล็อกคาดการณ์ยังไม่มีใบ)
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import InternalTimeBoard from './InternalTimeBoard';
import { frameMinFromIso, breaksToFrame, FRAME_START } from '../utils/timeFrame';
import { modelRuns, forecastEnd } from '../utils/qaFmeForecast';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { cachedMaster } from '../utils/masterCache';
import { RATE } from '../utils/refreshRates';
import { visibleInterval } from '../utils/usePolling';

const STAGE = {
  first:  { label: 'ชิ้นแรก',      icon: '1️⃣' },
  middle: { label: 'ระหว่างผลิต',  icon: '2️⃣' },
  end:    { label: 'ชิ้นสุดท้าย',  icon: '3️⃣' },
};
/* สีบล็อก = สถานะของงานตรวจ (ไม่ใช่สเตจ) — คนดูบอร์ดถามว่า "อะไรยังไม่ได้ทำ" ก่อนเสมอ
   เกินเวลา = แดง **นิ่ง ไม่กระพริบ** (UI-CONVENTIONS §2 กระพริบสงวนให้เครื่องหยุดที่ยังค้าง) */
const C = { late: '#ef4444', pending: '#f59e0b', acked: '#4d9fff', ok: '#22c55e', ng: '#f97316', cancel: '#6b7280', eta: '#a78bfa' };

/* ⚠️ ต้องคืน '—' เมื่อไม่มีค่า — hhmm(null) จะได้ "00:00" ซึ่งอ่านเหมือนเที่ยงคืนจริง (ข้อมูลเท็จเงียบๆ) */
const hhmm = (min) => (min == null || !Number.isFinite(min)) ? '—'
  : `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const getWorkDate = () => {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function QaFmeBoard({ scopedLineNames, onOpen }) {
  // วันงานต้องกลิ้งตามเวลาจริง — จอ QA เปิดค้างข้าม 08:00 ได้ ถ้าล็อกไว้ตอน mount บอร์ดจะค้างวันเก่าเงียบๆ
  const [wd, setWd] = useState(() => getWorkDate());
  const [obs, setObs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [ctMap, setCtMap] = useState({});
  const [breaks, setBreaks] = useState([]);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [popup, setPopup] = useState(null);

  const load = useCallback(async () => {
    // ── ข้อเท็จจริง: งานตรวจของวันงานนี้ (ทุกสถานะ — บอร์ดต้องเล่าทั้งวัน ไม่ใช่แค่ที่ค้าง) ──
    const { data: rows, error } = await supabase.from('qa_fme_obligations')
      .select('*').eq('work_date', wd).order('triggered_at').limit(400);
    if (error) { setErr(error.code === '42P01' ? 'migration' : error.message); return; }
    setErr(null);
    const ok = scopedLineNames ? new Set(scopedLineNames) : null;
    setObs((rows || []).filter(o => !ok || ok.has(o.line_name)));

    // ── คาดการณ์: รุ่นที่ยังวิ่งอยู่ (กะที่ยังไม่ปิด) จะจบเมื่อไหร่ ──
    // best-effort ทั้งก้อน — ฝั่ง DR ล่ม/คอลัมน์ไม่มี = บอร์ดยังโชว์ของจริงได้ตามปกติ
    try {
      await loadOpInfo();
      const [{ data: sess }, prods, { data: bp }] = await Promise.all([
        supabaseDR.from('production_sessions').select('id, line_name, shift')
          .eq('work_date', wd).eq('status', 'open').limit(200),
        // ⚠️ dr_products โตเกิน 1000 แถวได้ → ต้องแบ่งหน้า ไม่งั้นพาร์ทท้ายตารางหาย CT เงียบๆ
        cachedMaster('dr_products_ct_pair', async () => {
          const out = [];
          for (let from = 0; ; from += 1000) {
            const { data, error: e } = await supabaseDR.from('dr_products')
              .select('mat_no, cycle_time_sec, pair_mat_no').order('mat_no').range(from, from + 999);
            if (e) throw e;
            out.push(...(data || []));
            if (!data || data.length < 1000) break;
          }
          return out;
        }),
        supabaseDR.from('break_policies').select('*').eq('is_active', true).order('sort_order'),
      ]);
      setBreaks(breaksToFrame(bp));
      const ct = {}, pair = {};
      (prods || []).forEach(p => { ct[p.mat_no] = p.cycle_time_sec || 0; if (p.pair_mat_no) pair[p.mat_no] = p.pair_mat_no; });
      setCtMap(ct);
      const inScope = (sess || []).filter(s => !ok || ok.has(s.line_name));
      if (!inScope.length) { setRuns([]); return; }
      // ⚠️ .in() ยาวเกินไป URL จะถูก proxy ตัด → แบ่งก้อนละ 120 id (กฎเดียวกับ inChunks ใน AdoptionOutlook)
      // และดึงแบบแบ่งหน้า ไม่ตั้ง limit ตายตัว — ใบตกหล่นแปลว่า "เหลืออีกกี่ชิ้น" ผิด แล้วเวลาคาดการณ์ผิดตาม
      const ords = [];
      const ids = inScope.map(s => s.id);
      for (let i = 0; i < ids.length; i += 120) {
        const part = ids.slice(i, i + 120);
        for (let from = 0; ; from += 1000) {
          const { data, error: e } = await supabaseDR.from('prod_orders')
            .select('session_id, mat_no, qty, qty_target, qty_actual, opened_at')
            .in('session_id', part).eq('status', 'open').order('id').range(from, from + 999);
          if (e) throw e;
          ords.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
      }
      const sMap = new Map(inScope.map(s => [s.id, s]));
      const orders = ords.map(o => ({
        ...o, line_name: sMap.get(o.session_id)?.line_name, shift: sMap.get(o.session_id)?.shift,
      })).filter(o => o.line_name);
      setRuns(modelRuns({ orders, opMap: opInfoSync(), pairOf: (m) => pair[m] || null, toMin: frameMinFromIso }));
    } catch (e) {
      console.warn('QaFmeBoard forecast:', e?.message || e);
      setRuns([]);
    }
  }, [wd, scopedLineNames]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => visibleInterval(() => { setNow(Date.now()); setWd(getWorkDate()); load(); }, RATE.BOARD), [load]);

  const nowMin = useMemo(() => {
    if (wd !== getWorkDate()) return null;      // ไม่ใช่วันงานปัจจุบัน = ไม่วาด playhead
    const d = new Date(now), m = d.getHours() * 60 + d.getMinutes();
    return m < FRAME_START ? m + 1440 : m;
  }, [now, wd]);

  const { groups, etaCount, noCt } = useMemo(() => {
    const byLine = new Map();
    const push = (line, item) => {
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line).push(item);
    };

    // ① ของจริง — งานตรวจที่ระบบสร้างไว้
    obs.forEach(o => {
      const tm = frameMinFromIso(o.triggered_at);
      if (tm == null) return;
      const st = STAGE[o.stage] || STAGE.first;
      const isLate = o.status === 'pending' && new Date(o.due_at).getTime() < now;
      const color = o.status === 'cancelled' ? C.cancel
        : o.status === 'done_ng' ? C.ng
        : o.status?.startsWith('done') ? C.ok
        : isLate ? C.late : o.status === 'acked' ? C.acked : C.pending;
      push(o.line_name, {
        // บล็อกแคบ (~40 นาทีบนกรอบ 24 ชม.) ใส่เลข MAT 8 หลักไม่ลง จะถูกตัดกลางเลขจนอ่านผิด
        // → โชว์ สเตจ+เวลา แล้วเลข MAT เต็มอยู่ใน tooltip/popup (หลักเดียวกับบอร์ดรอบส่งของ Store)
        id: o.id, timeMin: tm, color, text: `${st.icon}${hhmm(tm)}`,
        title: `${o.line_name} · ${o.mat_no} · ${st.label}\n`
          + `เรียกตอน ${hhmm(tm)} · ครบกำหนด ${hhmm(frameMinFromIso(o.due_at) ?? tm)}\n`
          + (isLate ? '⚠️ เกินเวลาแล้ว' : o.status === 'acked' ? '📝 กำลังตรวจ'
            : o.status === 'cancelled' ? 'ยกเลิก' : o.status?.startsWith('done') ? 'ตรวจแล้ว' : 'รอตรวจ'),
        data: { kind: 'ob', o, isLate },
      });
    });

    // ② คาดการณ์ — รุ่นที่กำลังวิ่งจะจบเมื่อไหร่ (= ต้องไปตรวจชิ้นสุดท้าย)
    // ข้ามรุ่นที่มีงานตรวจ End อยู่แล้ว (ของจริงมาแล้ว ไม่ต้องเดาซ้อน)
    let n = 0;
    const hasEnd = new Set(obs.filter(o => o.stage === 'end').map(o => `${o.line_name}|${o.mat_no}`));
    const cantEstimate = [];
    if (nowMin != null) runs.forEach(r => {
      if (hasEnd.has(`${r.lineName}|${r.matNo}`)) return;
      const fc = forecastEnd(r, { ctOf: (m) => ctMap[m] || 0, nowMin, breaks });
      if (!fc) return;
      if (fc.noCt) { cantEstimate.push(r); return; }        // ⚠️ ไม่รู้ CT = ไม่วาด ห้ามเดา
      if (fc.etaMin > FRAME_START + 1440) return;           // เลยกรอบวันงาน = ไม่วาด
      n++;
      push(r.lineName, {
        id: `eta-${r.lineName}-${r.matNo}`, timeMin: fc.etaMin, color: C.eta, dashed: true,
        text: `3️⃣~${hhmm(fc.etaMin)}`,                      // ~ = ประมาณ (ย้ำอีกชั้นนอกจากเส้นประ)
        title: `คาดการณ์ (ยังไม่ใช่งานตรวจจริง)\n${r.lineName} · ${r.matNo}\n`
          + `เหลืออีก ${r.remaining.toLocaleString()} ชิ้น × CT ${fc.ct} วิ → น่าจะจบ ~${hhmm(fc.etaMin)}\n`
          + 'เวลานี้ขยับได้ตามจังหวะผลิตจริง · งานตรวจจะถูกสร้างเมื่อรุ่นจบจริง',
        data: { kind: 'eta', r, etaMin: fc.etaMin, ct: fc.ct },
      });
    });
    const lines = [...byLine.keys()].sort();
    return {
      etaCount: n,
      noCt: cantEstimate,
      groups: lines.map(l => {
        const items = byLine.get(l);
        const open = items.filter(i => i.data.kind === 'ob' && ['pending', 'acked'].includes(i.data.o.status)).length;
        return { key: l, label: l, sub: open ? `ค้าง ${open}` : `${items.length} จุด`, items };
      }),
    };
  }, [obs, runs, ctMap, nowMin, breaks, now]);

  if (err === 'migration') return (
    <div style={warnBox}>⚠️ บอร์ดยังใช้ไม่ได้ — ยังไม่ได้ apply migration <code>20260819_qa_fme_call.sql</code> (แจ้ง admin)</div>
  );
  if (err) return <div style={warnBox}>โหลดบอร์ดไม่สำเร็จ: {err}</div>;

  return (
    <>
      <InternalTimeBoard
        title="🗓️ วันนี้ต้องไปตรวจไลน์ไหน กี่โมง"
        hint="บล็อกทึบ = งานตรวจจริง · เส้นประ = คาดการณ์จาก CT (ยังไม่ใช่งานตรวจ)"
        groups={groups} nowMin={nowMin} breaks={breaks}
        onItemClick={(d, x, y) => setPopup({ d, x, y })}
      />

      {/* คำอธิบายสี — บอร์ดที่คนอ่านไม่ออกว่าสีไหนแปลว่าอะไร = บอร์ดที่ไม่มีใครใช้ */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--muted)', padding: '8px 4px 0' }}>
        <Key c={C.pending} t="รอตรวจ" /><Key c={C.late} t="เกินเวลา" /><Key c={C.acked} t="กำลังตรวจ" />
        <Key c={C.ok} t="ตรวจแล้ว" /><Key c={C.ng} t="เจอของเสีย" /><Key c={C.cancel} t="ยกเลิก" />
        <Key c={C.eta} t={`คาดการณ์ชิ้นสุดท้าย${etaCount ? ` (${etaCount})` : ''}`} dashed />
      </div>

      {noCt.length > 0 && (
        <div style={{ ...warnBox, marginTop: 8 }}>
          ⏱️ คาดการณ์เวลาไม่ได้ <b>{noCt.length} รุ่น</b> (ยังไม่ได้ตั้ง Cycle Time):{' '}
          {noCt.slice(0, 6).map(r => `${r.lineName}·${r.matNo}`).join(' · ')}{noCt.length > 6 ? ` … อีก ${noCt.length - 6}` : ''}
          <div style={{ marginTop: 3, opacity: 0.85 }}>
            ระบบไม่เดาเวลาให้ — ตั้ง CT ที่ <b>Product Master</b> แล้วบล็อกคาดการณ์จะขึ้นเอง
            (งานตรวจจริงยังทำงานปกติ ไม่กระทบ)
          </div>
        </div>
      )}

      {popup && (() => {
        const W = 268, d = popup.d;
        const left = Math.max(8, Math.min(popup.x - W / 2, window.innerWidth - W - 12));
        const top = Math.min(popup.y + 12, window.innerHeight - 220);
        const isEta = d.kind === 'eta';
        const o = d.o;
        return (
          <>
            <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
            <div style={{ position: 'fixed', left, top, width: W, zIndex: 1300, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
              <div style={{ height: 4, background: isEta ? C.eta : (d.isLate ? C.late : C.pending) }} />
              <div style={{ padding: '10px 14px', fontSize: 12.5, lineHeight: 1.7 }}>
                {isEta ? (
                  <>
                    <b style={{ fontSize: 13 }}>{d.r.lineName} · {d.r.matNo}</b>
                    <div style={{ color: C.eta, fontWeight: 700, marginTop: 2 }}>
                      🔮 คาดการณ์ — ยังไม่ใช่งานตรวจจริง
                    </div>
                    <div>น่าจะผลิตครบ ~<b>{hhmm(d.etaMin)}</b></div>
                    <div style={{ color: 'var(--muted)' }}>
                      เหลืออีก {d.r.remaining.toLocaleString()} ชิ้น · CT {d.ct} วิ/ชิ้น (หักเวลาพักแล้ว)
                    </div>
                    <div style={{ color: 'var(--muted)', marginTop: 5, fontSize: 11.5 }}>
                      เวลานี้ขยับตามจังหวะผลิตจริง · ระบบจะสร้างงานตรวจ “ชิ้นสุดท้าย” ให้เองเมื่อรุ่นนี้จบจริง
                    </div>
                  </>
                ) : (
                  <>
                    <b style={{ fontSize: 13 }}>{o.line_name} · {o.mat_no}</b>
                    <div>{(STAGE[o.stage] || STAGE.first).icon} {(STAGE[o.stage] || STAGE.first).label}
                      {' · '}{o.shift === 'night' ? 'กะดึก' : 'กะเช้า'}</div>
                    <div style={{ color: 'var(--muted)' }}>
                      เรียกตอน {hhmm(frameMinFromIso(o.triggered_at))} · ครบกำหนด {hhmm(frameMinFromIso(o.due_at))}
                    </div>
                    {d.isLate && <div style={{ color: C.late, fontWeight: 700 }}>⚠️ เกินเวลาแล้ว</div>}
                    {o.status === 'cancelled' && o.cancel_reason && (
                      <div style={{ color: 'var(--muted)' }}>ยกเลิก: {o.cancel_reason}</div>
                    )}
                    {!o.part_id && (
                      <div style={{ color: '#f59e0b', fontSize: 11.5 }}>
                        ⚠️ ยังไม่ผูกกับพาร์ทในระบบตรวจ — ตั้งเลข MAT ที่ /qa-setup ก่อนถึงเปิดใบอัตโนมัติได้
                      </div>
                    )}
                    {['pending', 'acked'].includes(o.status) && (
                      <button disabled={!o.part_id}
                        onClick={() => { onOpen?.(o); setPopup(null); }}
                        style={{ marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 7, fontSize: 12,
                          fontWeight: 700, cursor: o.part_id ? 'pointer' : 'not-allowed',
                          background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                          border: '1px solid var(--border2)', opacity: o.part_id ? 1 : 0.45 }}>
                        เปิดใบตรวจ
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}

const warnBox = {
  fontSize: 12.5, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
  borderRadius: 8, padding: '7px 11px', lineHeight: 1.65,
};

function Key({ c, t, dashed }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: dashed ? 'transparent' : `${c}33`,
        border: `1.5px ${dashed ? 'dashed' : 'solid'} ${c}` }} />
      {t}
    </span>
  );
}
