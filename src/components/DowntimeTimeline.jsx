import { useMemo, useState } from 'react';

/**
 * ⏱ ไทม์ไลน์เครื่องหยุดรายไลน์ — "หยุดตอนไหนของวัน" ไม่ใช่แค่ "หยุดรวมกี่นาที"
 *
 * ที่มา (คำขอหน้างาน 2026-08-26): หน้า OEE แท็บภาพรวมวันนี้ตอบได้แค่ยอดรวม/พาเรโต้
 *   → เห็นว่า "รอชิ้นงาน 26 นาที" แต่ไม่รู้ว่ากระจุกช่วงต้นกะหรือกระจายทั้งวัน
 *   ซึ่งเปลี่ยนวิธีแก้คนละเรื่อง (กระจุก = เหตุการณ์เดียว · กระจาย = ปัญหาเรื้อรังของกระบวนการ)
 *
 * ⚠️ กฎที่ห้ามพลาดในแผงนี้
 *   1. **หยุดตามแผนห้ามแดง** (กฎ Andon) — planned = เทาสงบเสมอ ไม่ว่า master จะตั้งสีอะไรไว้
 *      (ประเภท planned บางตัวตั้งสีแดงไว้ในทะเบียน ถ้าใช้สีตามทะเบียนตรงๆ จะกลายเป็นสัญญาณเตือนปลอม)
 *   2. **downtime ที่กรอกแค่จำนวนนาที (ไม่มี `started_at`) วางบนแกนเวลาไม่ได้**
 *      → ห้ามตัดทิ้งเงียบ ต้องนับแยกให้เห็นเป็นชิปท้ายแถว (ข้อมูลจริงมีเคสนี้เยอะ)
 *   3. กรอบเวลา = **08:00 วันงาน → 08:00 วันถัดไป** ตามกฎ getWorkDate ของโปรเจค
 *      (กะดึกเริ่ม 20:00 จบ 08:00 ของวันปฏิทินถัดไป แต่ยังเป็นวันงานเดียวกัน)
 *   4. อ่านข้อมูลชุดเดียวกับที่แผงอื่นในหน้าใช้ (`tdSessionsTeamFiltered` / `tdDowntimesScoped`)
 *      — ตัวเลขในแผงนี้ต้องไม่ขัดกับพาเรโต้ที่อยู่ใต้มันเอง
 */

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

/** "HH:mm" ในกรอบวันงาน → epoch ms (ก่อน 08:00 = วันปฏิทินถัดไป) */
export function tsOfWorkDay(workDate, hhmm) {
  if (!workDate || !hhmm) return null;
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  const d = new Date(`${workDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(h, Number.isFinite(m) ? m : 0, 0, 0);
  if (h < 8) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** ช่วงเวลาที่กะนี้กินจริง — กะที่ยังเปิดลากถึง "ตอนนี้" */
export function sessionSpan(s, workDate, nowMs) {
  const st = tsOfWorkDay(workDate, s?.start_time);
  if (st == null) return null;
  let en = s?.end_time ? tsOfWorkDay(workDate, s.end_time) : null;
  if (en != null && en < st) en += DAY_MS;              // จบ 08:00 ของวันถัดไป (กะดึก)
  if (en == null) en = s?.status === 'closed' ? st + (Number(s.shift_min) || 0) * 60000 : nowMs;
  if (!(en > st)) en = st + (Number(s?.shift_min) || 0) * 60000;
  return { st, en };
}

/** ช่วงเวลาของ downtime — null = กรอกแค่จำนวนนาที วางบนแกนไม่ได้ */
export function downtimeSpan(d, nowMs) {
  if (!d?.started_at) return null;
  const st = new Date(d.started_at).getTime();
  if (!Number.isFinite(st)) return null;
  let en = d.ended_at ? new Date(d.ended_at).getTime() : NaN;
  if (!Number.isFinite(en)) {
    const mins = Number(d.duration_min) || 0;
    en = mins > 0 ? st + mins * 60000 : nowMs;          // ไม่มีทั้งเวลาจบและนาที = ยังหยุดอยู่
  }
  return { st, en: Math.max(en, st) };
}

const PLANNED_COLOR = '#64748b';   // เทาสงบ — หยุดตามแผนไม่ใช่ loss (กฎ Andon: ห้ามแดง ห้ามกระพริบ)
const RUN_COLOR     = 'rgba(34,197,94,0.55)';
const hhmm = (ms) => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

export default function DowntimeTimeline({ sessions = [], downtimes = [], workDate, isMobile = false }) {
  const [sel, setSel] = useState(null);
  const nowMs = Date.now();

  const view = useMemo(() => {
    const sessById = {};
    sessions.forEach(s => { sessById[s.id] = s; });

    // แถว = ไลน์ (กะเช้า+ดึกของไลน์เดียวกันอยู่แถวเดียวกัน คนละตำแหน่งบนแกน 24 ชม.)
    const byLine = new Map();
    const push = (line, key, val) => {
      const row = byLine.get(line) || { line, runs: [], stops: [], untimed: 0, untimedMin: 0 };
      row[key].push(val);
      byLine.set(line, row);
    };

    let lo = Infinity, hi = -Infinity;
    for (const s of sessions) {
      const sp = sessionSpan(s, workDate, nowMs);
      if (!sp) continue;
      push(s.line_name || '—', 'runs', { ...sp, shift: s.shift, status: s.status });
      lo = Math.min(lo, sp.st); hi = Math.max(hi, sp.en);
    }

    for (const d of downtimes) {
      const s = sessById[d.session_id];
      const line = s?.line_name || '—';
      const row = byLine.get(line) || { line, runs: [], stops: [], untimed: 0, untimedMin: 0 };
      byLine.set(line, row);
      const sp = downtimeSpan(d, nowMs);
      if (!sp) {                                     // กรอกแค่จำนวนนาที — นับแยก ห้ามตัดทิ้งเงียบ
        row.untimed += 1;
        row.untimedMin += Number(d.duration_min) || 0;
        continue;
      }
      const planned = d.dr_downtime_types?.category === 'planned';
      row.stops.push({
        ...sp, planned,
        open: !d.ended_at && !(Number(d.duration_min) > 0),
        name: d.dr_downtime_types?.name_th || 'ไม่ระบุประเภท',
        color: planned ? PLANNED_COLOR : (d.dr_downtime_types?.color || '#ef4444'),
        machine: d.machine_no || '',
        note: d.description || '',
        mins: Number(d.duration_min) || Math.round((sp.en - sp.st) / 60000),
      });
      lo = Math.min(lo, sp.st); hi = Math.max(hi, sp.en);
    }

    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
    // ปัดหัว-ท้ายเป็นชั่วโมงเต็ม ให้เส้นตารางอ่านง่าย
    lo = Math.floor(lo / HOUR_MS) * HOUR_MS;
    hi = Math.ceil(hi / HOUR_MS) * HOUR_MS;

    const ticks = [];
    const step = (hi - lo) / HOUR_MS > 14 ? 2 * HOUR_MS : HOUR_MS;
    for (let t = lo; t <= hi; t += step) ticks.push(t);

    const rows = [...byLine.values()].sort((a, b) => {
      const am = a.stops.filter(x => !x.planned).reduce((s, x) => s + x.mins, 0);
      const bm = b.stops.filter(x => !x.planned).reduce((s, x) => s + x.mins, 0);
      return bm - am || a.line.localeCompare(b.line);   // หยุดนอกแผนมากสุดขึ้นบน
    });
    return { lo, hi, ticks, rows };
  }, [sessions, downtimes, workDate, nowMs]);

  if (!view) return null;
  const { lo, hi, ticks, rows } = view;
  const pct = (ms) => ((ms - lo) / (hi - lo)) * 100;
  const nowPct = nowMs >= lo && nowMs <= hi ? pct(nowMs) : null;
  const labelW = isMobile ? 92 : 130;
  const totalUntimed = rows.reduce((s, r) => s + r.untimed, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
        <span><span style={{ display: 'inline-block', width: 12, height: 10, background: RUN_COLOR, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />เดินเครื่อง</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 10, background: '#ef4444', borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />หยุดนอกแผน (สีตามประเภท)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 10, background: PLANNED_COLOR, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />หยุดตามแผน (ไม่นับเป็น loss)</span>
        <span style={{ opacity: 0.8 }}>· แตะแถบเพื่อดูรายละเอียด</span>
      </div>

      {/* ตารางกว้าง → เลื่อนแนวนอนในกรอบตัวเอง (หน้าห้ามเลื่อนแนวนอน) */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: isMobile ? 560 : 0 }}>
          {/* แกนเวลา */}
          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 2 }}>
            <div style={{ width: labelW, flexShrink: 0 }} />
            <div style={{ position: 'relative', flex: 1, height: 16 }}>
              {ticks.map(t => (
                <span key={t} style={{ position: 'absolute', left: `${pct(t)}%`, transform: 'translateX(-50%)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {hhmm(t)}
                </span>
              ))}
            </div>
          </div>

          {rows.map(r => {
            const unplannedMin = r.stops.filter(x => !x.planned).reduce((s, x) => s + x.mins, 0);
            return (
              <div key={r.line} style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 4 }}>
                <div style={{ width: labelW, flexShrink: 0, paddingRight: 8, minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.line}>{r.line}</div>
                  <div style={{ fontSize: 10, color: unplannedMin > 0 ? '#ef4444' : 'var(--muted)' }}>
                    {unplannedMin > 0 ? `หยุด ${unplannedMin} น.` : 'ไม่มีหยุดนอกแผน'}
                  </div>
                </div>

                <div style={{ position: 'relative', flex: 1, height: 26, background: 'var(--bg2)', borderRadius: 5, border: '1px solid var(--border)', overflow: 'hidden' }}>
                  {/* เส้นตารางรายชั่วโมง */}
                  {ticks.map(t => (
                    <div key={t} style={{ position: 'absolute', left: `${pct(t)}%`, top: 0, bottom: 0, width: 1, background: 'var(--border)', opacity: 0.5 }} />
                  ))}
                  {/* ช่วงที่กะเปิด = เดินเครื่อง (พื้นเทา = ไม่ได้เปิดกะ) */}
                  {r.runs.map((x, i) => (
                    <div key={`r${i}`} title={`${x.shift === 'night' ? '🌙 กะดึก' : '☀️ กะเช้า'} ${hhmm(x.st)}–${hhmm(x.en)}`}
                      style={{ position: 'absolute', left: `${pct(x.st)}%`, width: `${Math.max(0.3, pct(x.en) - pct(x.st))}%`, top: 0, bottom: 0, background: RUN_COLOR }} />
                  ))}
                  {/* ช่วงหยุด — วาดทับช่วงเดินเครื่อง */}
                  {r.stops.map((x, i) => (
                    <div key={`s${i}`} onClick={() => setSel({ ...x, line: r.line })}
                      title={`${x.planned ? '🗓️ ' : '🔴 '}${x.name}${x.machine ? ` · ${x.machine}` : ''}\n${hhmm(x.st)}–${x.open ? 'ยังหยุดอยู่' : hhmm(x.en)} · ${x.mins} นาที${x.note ? `\n💬 ${x.note}` : ''}`}
                      style={{
                        position: 'absolute', left: `${pct(x.st)}%`, width: `${Math.max(0.4, pct(x.en) - pct(x.st))}%`,
                        top: x.planned ? 9 : 0, bottom: 0, background: x.color,
                        opacity: x.planned ? 0.55 : 0.95, cursor: 'pointer',
                        borderLeft: x.open ? '2px solid #fff' : 'none',
                      }} />
                  ))}
                  {nowPct != null && <div className="now-line" style={{ position: 'absolute', left: `${nowPct}%`, top: 0, bottom: 0 }} />}
                </div>

                {/* กรอกแค่จำนวนนาที = วางบนแกนไม่ได้ — ต้องเห็น ห้ามหายเงียบ */}
                {r.untimed > 0 && (
                  <div title="รายการที่กรอกแค่จำนวนนาที ไม่มีเวลาเริ่ม — วางบนไทม์ไลน์ไม่ได้ (ยอดรวม/พาเรโต้ยังนับให้ครบ)"
                    style={{ marginLeft: 6, flexShrink: 0, fontSize: 10, fontWeight: 700, color: '#f59e0b', whiteSpace: 'nowrap' }}>
                    ⏱ +{r.untimed} ({r.untimedMin} น.)
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {sel && (
        <div style={{ marginTop: 8, padding: '8px 11px', background: 'var(--bg2)', border: `1px solid ${sel.color}`, borderRadius: 8, fontSize: 11.5, lineHeight: 1.65 }}>
          <b style={{ color: sel.planned ? PLANNED_COLOR : sel.color }}>{sel.planned ? '🗓️ หยุดตามแผน' : '🔴 หยุดนอกแผน'} · {sel.name}</b>
          {' '}<span style={{ color: 'var(--muted)' }}>{sel.line}</span>
          {sel.machine && <> · เครื่อง <b>{sel.machine}</b></>}
          <div style={{ color: 'var(--text2)' }}>
            {hhmm(sel.st)} – {sel.open ? <b style={{ color: '#ef4444' }}>ยังหยุดอยู่</b> : hhmm(sel.en)} · <b>{sel.mins}</b> นาที
          </div>
          {sel.note && <div style={{ color: 'var(--text2)' }}>💬 {sel.note}</div>}
          <button onClick={() => setSel(null)} style={{ marginTop: 4, background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer', padding: 0 }}>✕ ปิด</button>
        </div>
      )}

      {totalUntimed > 0 && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: '#f59e0b', lineHeight: 1.55 }}>
          ⏱ มี <b>{totalUntimed} รายการ</b> ที่กรอกแค่จำนวนนาที ไม่มีเวลาเริ่ม — วางบนไทม์ไลน์ไม่ได้
          (ยอดรวมและพาเรโต้ด้านล่างยังนับให้ครบ) · กรอกเวลาเริ่มตอนบันทึก Downtime จะเห็นช่วงจริงบนแถบนี้
        </div>
      )}
    </div>
  );
}
