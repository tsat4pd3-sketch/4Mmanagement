/* ══ 📦 อัพเดทโปรแกรม — `/program-update`           2026-10-01 · คำสั่ง user ═══════════
   *"เพิ่มหน้า program update … อัพเดทฟีเจอร์อะไรไปบ้าง แก้อะไรไปบ้างด้วย"*

   ใครใช้: ทีมงาน/หัวหน้า/ผู้บริหาร (และผู้มาเยี่ยมชม) — ตอบว่า "ระบบนี้ยังมีคนดูแลอยู่ไหม
   ช่วงนี้แก้อะไรไปแล้ว" โดยไม่ต้องไปเปิด git

   ── 🔴 กติกาที่ห้ามพลาด ──────────────────────────────────────────────────────────
   1. **แหล่งความจริงคือ git** — `public/changelog.json` สร้างจาก `scripts/gen-changelog.mjs`
      (รันอยู่ในขั้น build) **ห้ามพิมพ์รายการอัพเดทมือลงไฟล์ไหน** ทะเบียนที่ต้องมีคนจดจะตายใน 2 สัปดาห์
   2. **อ่านอย่างเดียว · ไม่แตะ Supabase เลย** — ไม่มี egress, ไม่มีสิทธิ์เขียน
   3. **ต้องบอกว่าข้อมูลสดถึงเมื่อไหร่** (`generatedAt`) — ไฟล์เก่าค้างต้องเห็นเอง ห้ามเนียนว่าสด
   4. **โหลดไม่ได้ = เขียนบนจอว่าโหลดไม่ได้** ห้ามขึ้น "ไม่มีอัพเดท" (0 คนละความหมายกับ "ล้มเหลว")
   5. ช่วงเวลาใช้ `<TimeRangeBar>` ของกลาง (`scales={null}` = ไม่มีกราฟ ไม่ต้องมีปุ่มขนาดแท่ง)
   ═══════════════════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import TimeRangeBar from '../components/TimeRangeBar';
import Segmented from '../components/Segmented';
import SearchInput from '../components/SearchInput';
import useTimeRange from '../utils/useTimeRange';
import { KINDS, kindOf, buildFeed, countByKind } from '../utils/changelog';

const fmtThaiDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return ymd || '—';
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('th-TH',
    { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' });
};
const fmtStamp = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' })
    : '—';
};

export default function ProgramUpdate() {
  const tr = useTimeRange({ defaultDays: 30, finest: 'day' });
  const { from, to } = tr;
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;                       // กฎ stale-response: โหลดเสร็จช้า + ออกจากหน้า = ห้าม setState
    (async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}changelog.json`, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!Array.isArray(j?.commits)) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
        if (alive) { setData(j); setErr(null); }
      } catch (e) {
        if (alive) { setData(null); setErr(e.message || 'โหลดไม่สำเร็จ'); }
      }
    })();
    return () => { alive = false; };
  }, []);

  const inRange = useMemo(
    () => (data?.commits || []).filter(c => c.d >= from && c.d <= to),
    [data, from, to]);
  const counts = useMemo(() => countByKind(inRange), [inRange]);
  const feed = useMemo(() => buildFeed(inRange, { kind, q }), [inRange, kind, q]);
  const shown = feed.reduce((s, g) => s + g.items.length, 0);

  const segOpts = [
    { value: 'all', label: `ทั้งหมด ${inRange.length}` },
    ...KINDS.map(k => ({ value: k.key, label: `${k.icon} ${k.label}${counts[k.key] ? ` ${counts[k.key]}` : ''}`,
      disabled: !counts[k.key], title: k.hint })),
  ];

  return (
    <Page>
      <PageHeader
        icon="📦" title="อัพเดทโปรแกรม"
        sub={data
          ? `ข้อมูลสดถึง ${fmtStamp(data.generatedAt)} · เก็บจากประวัติการแก้จริงของระบบ`
          : 'รายการสิ่งที่เพิ่ม/แก้ไปในระบบ — อ่านจากประวัติการแก้จริง'}
        filters={(
          <TimeRangeBar
            scale={tr.scale} from={from} to={to} today={tr.today} scales={null}
            onFrom={tr.setFrom} onTo={tr.setTo} onPreset={tr.setPreset}
            note={data?.truncated
              ? `เก็บได้ถึง ${fmtThaiDate(data.from)} · เก่ากว่านั้นอยู่ในประวัติของระบบแต่ไม่อยู่ในไฟล์นี้`
              : null}
          >
            <Segmented value={kind} onChange={setKind} options={segOpts} label="ชนิดการเปลี่ยนแปลง" />
            <SearchInput value={q} onChange={setQ} fields="ข้อความ / เรื่อง" />
          </TimeRangeBar>
        )}
      />

      {err && (
        <div style={{ background: 'var(--card)', border: '1px solid #ef444466', borderLeft: '4px solid #ef4444',
                      borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
          ❌ <b>โหลดรายการอัพเดทไม่สำเร็จ</b> ({err}) — <b>ไม่ได้หมายความว่าไม่มีอัพเดท</b>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            ไฟล์ <code>changelog.json</code> ถูกสร้างตอน build — ถ้าเพิ่ง deploy ลองรีเฟรชอีกครั้ง
          </div>
        </div>
      )}

      {!data && !err && (
        <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 2px' }}>กำลังโหลดรายการอัพเดท…</div>
      )}

      {data && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12, alignContent: 'start' }}>
            {KINDS.map(k => (
              <div key={k.key} style={{
                background: 'var(--card)', border: `1px solid ${k.color}44`, borderLeft: `4px solid ${k.color}`,
                borderRadius: 10, padding: '8px 14px', minWidth: 132, boxShadow: 'var(--shadow-sm)',
              }}>
                <div style={{ fontSize: 11.5, color: 'var(--text2)', fontWeight: 700 }}>{k.icon} {k.label}</div>
                <div style={{ fontSize: 21, fontWeight: 800, color: k.color, lineHeight: 1.25 }}>
                  {(counts[k.key] || 0).toLocaleString()}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{k.hint}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
            {fmtThaiDate(from)} – {fmtThaiDate(to)} · <b style={{ color: 'var(--text2)' }}>{shown.toLocaleString()}</b> รายการ
            {' '}ใน {feed.length} วันที่มีการแก้
            {(kind !== 'all' || q) && inRange.length !== shown
              ? <> · กรองจากทั้งหมด {inRange.length.toLocaleString()} รายการในช่วงนี้</> : null}
          </div>

          {!feed.length ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '14px 2px' }}>
              {inRange.length
                ? 'ไม่มีรายการที่ตรงกับตัวกรอง — ลองเปลี่ยนชนิดหรือล้างคำค้น'
                : 'ช่วงเวลานี้ไม่มีการเปลี่ยนแปลงระบบ (ไม่ใช่โหลดไม่ได้ — ข้อมูลโหลดครบแล้ว)'}
            </div>
          ) : feed.map(day => (
            <div key={day.date} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>{fmtThaiDate(day.date)}</div>
                <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{day.items.length} รายการ</div>
              </div>
              {day.items.map(c => {
                const k = kindOf(c.t);
                return (
                  <div key={c.h} style={{
                    display: 'flex', gap: 9, alignItems: 'flex-start', padding: '5px 10px',
                    borderLeft: `3px solid ${k.color}`, background: 'var(--card)',
                    border: '1px solid var(--border)', borderLeftWidth: 3, borderRadius: 7, marginBottom: 4,
                  }}>
                    <span style={{ fontSize: 13, flexShrink: 0 }} title={k.label}>{k.icon}</span>
                    {/* 📱 ข้อความ commit มีคำยาวไม่มีช่องว่าง (ชื่อไฟล์/ชื่อฟังก์ชัน) ⇒ ต้องตัดคำได้
                        ไม่ใส่ = ล้นแล้วปัดไม่ได้ที่ 390px (mobilesweep จับได้ 01/10) */}
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{c.m}</span>
                      {c.s && (
                        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>· {c.s}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </Page>
  );
}
