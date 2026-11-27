import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { useLiveBoard } from '../utils/useLiveBoard';
import { RATE } from '../utils/refreshRates';
import useTvShell, { tvSizer } from '../utils/useTvShell';
import { ageText, DEFAULT_STALE_MIN } from '../utils/stockReceipts';
import {
  buildSendBoard, buildRecvBoard, storeTvSteps, STORE_TV_FLIP_SEC, STORE_TV_PER_PAGE, CALL_WARN_MIN, CALL_BAD_MIN,
} from '../utils/storeTvBoard';
import MatLabel from './MatLabel';
import StoreCallSiren from './StoreCallSiren';
import { tr } from '../utils/i18n';

/* ══ 📺 จอทีวีสโตร์ — ส่งของเข้าไลน์ ↔ รับของเข้าคลัง สลับเอง (`/tv?dept=storeq` · 2026-11-24 · คำสั่ง user)
   ⚠️ **ไม่ใช่หน้าใหม่** — มุมมองที่ 5 ของ Andon Board (`/tv` = จอแขวน · ไม่เด้ง login · อ่านอย่างเดียว) แบบเดียวกับ `<MoTvBoard>`
   · mockup ที่ user เคาะ: https://claude.ai/artifact/HLTn1Qzx7L3nWt6mqSy5oy · กฎ/เกณฑ์ = `utils/storeTvBoard.js` (มีเทส)
   · ไม่มีปุ่มทำรายการ (กติกา kiosk) · แถบไลน์เรียกของ = `<StoreCallSiren variant="inline">` ฝั่ง "ไม่ใช่แท็บส่งของ"
     (มีแค่ลิงก์ + แตะเปิดเสียง ไม่เขียนฐาน) · เสียงยังดังตามใบที่ยังไม่มีใครรับทราบ
   · `?dest=<ชื่อคลัง>` = จอนี้ดูรับของเฉพาะคลังนั้น (เช่นจอ FG WAREHOUSE) · ไม่ใส่ = ทุกคลัง
   · ตัวใหญ่เมื่ออยู่ในกรอบจอ TV (`?tvshell=1` / บัญชี display · `tvSizer`) · จอคอมเปิดดูได้ขนาดปกติ */
const SEND_COLS = 'id, line_name, mat_no, part_name, request_qty, uom, status, requested_at, delivered_at';
const RECV_COLS = 'id, mat_no, part_name, qty_expected, source_line, dest_line_name, status, created_at';
const CAP = 1000;
const TONE = { bad: 'var(--red)', warn: 'var(--amber)', ok: 'var(--blue)', done: 'var(--green)', none: 'var(--border2)' };
const fmt = (n) => Number(n || 0).toLocaleString();

export default function StoreTvBoard({ inScope }) {
  const [sp] = useSearchParams();
  const dest = sp.get('dest') || '';
  const tv = useTvShell();
  const fz = tvSizer(tv);
  const [send, setSend] = useState(null);
  const [recv, setRecv] = useState(null);
  const [stale, setStale] = useState({});
  const [errS, setErrS] = useState(null);
  const [errR, setErrR] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const loadSend = useCallback(async () => {
    const { data, error } = await supabase.from('wip_replenish_requests').select(SEND_COLS)
      .in('status', ['pending', 'preparing', 'delivered']).order('requested_at', { ascending: true }).limit(CAP);
    setErrS(error ? error.message : null);
    if (!error) setSend(data || []);
  }, []);
  const loadRecv = useCallback(async () => {
    const [rq, rules] = await Promise.all([
      supabaseDR.from('stock_receipts').select(RECV_COLS).eq('status', 'pending').order('created_at').limit(CAP),
      supabaseDR.from('stock_inflow_rules').select('dest_line_name, stale_after_min'),
    ]);
    setErrR(rq.error ? rq.error.message : null);
    if (!rq.error) setRecv(rq.data || []);
    if (!rules.error) {
      const m = {};
      (rules.data || []).forEach(r => { m[r.dest_line_name] = Math.min(m[r.dest_line_name] ?? Infinity, r.stale_after_min || DEFAULT_STALE_MIN); });
      setStale(m);
    }
  }, []);
  useLiveBoard(loadSend, { tables: ['wip_replenish_requests'], topic: 'tv-store-send', rate: RATE.BOARD, client: supabase });
  useLiveBoard(loadRecv, { tables: ['stock_receipts'], topic: 'tv-store-recv', rate: RATE.BOARD });

  /* นาฬิกา 1 วิ — แถบนับถอยหลังก่อนสลับหน้า + อายุใบเดินเอง (ไม่ยิงฐาน) */
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const minute = Math.floor(now / 60000);

  const sb = useMemo(() => buildSendBoard(send || [], { now: minute * 60000, inScope: inScope || (() => true) }), [send, minute, inScope]);
  const rb = useMemo(() => buildRecvBoard(recv || [], {
    now: minute * 60000, staleOf: (d) => stale[d] ?? DEFAULT_STALE_MIN, inScope: inScope || (() => true), dest,
  }), [recv, stale, minute, inScope, dest]);

  const steps = useMemo(() => storeTvSteps(sb.cards.length, rb.cards.length), [sb.cards.length, rb.cards.length]);
  const [stepAt, setStepAt] = useState(() => Date.now());
  const tick = Math.floor((now - stepAt) / (STORE_TV_FLIP_SEC * 1000));
  const step = steps[((tick % steps.length) + steps.length) % steps.length];
  useEffect(() => { setStepAt(Date.now()); }, [steps.length]);   // จำนวนหน้าเปลี่ยน = เริ่มรอบใหม่ (ไม่กระโดดข้ามหน้า)
  const leftPct = 100 - (((now - stepAt) % (STORE_TV_FLIP_SEC * 1000)) / (STORE_TV_FLIP_SEC * 10));

  const isSend = step.view === 'send';
  const b = isSend ? sb : rb;
  const err = isSend ? errS : errR;
  const loaded = isSend ? send !== null : recv !== null;
  const cards = b.cards.slice(step.page * STORE_TV_PER_PAGE, (step.page + 1) * STORE_TV_PER_PAGE);
  const kpis = isSend
    ? [['ไลน์เรียก รอหยิบ', sb.kpi.pending, 'var(--amber)'], ['กำลังเตรียม', sb.kpi.preparing, 'var(--blue)'],
       ['ส่งแล้ว รอไลน์รับ', sb.kpi.delivered, 'var(--green)'], [`รอเกิน ${CALL_BAD_MIN} นาที`, sb.kpi.late, 'var(--red)']]
    : [['รอรับ', rb.kpi.slips, 'var(--amber)'], ['ค้างเกินกำหนด', rb.kpi.stale, 'var(--red)'],
       ...rb.kpi.byDest.slice(0, 2).map(([d, n]) => [d, n, 'var(--blue)'])];
  const hidden = isSend
    ? [sb.hiddenScope ? `${tr('ไม่นับใบนอกขอบเขตจอนี้')} ${sb.hiddenScope}` : null, sb.unknownAge ? `${sb.unknownAge} ${tr('ใบไม่รู้เวลาเรียก')}` : null]
    : [rb.hiddenScope ? `${tr('ไม่นับใบนอกขอบเขตจอนี้')} ${rb.hiddenScope}` : null, rb.hiddenDest ? `${tr('ไม่นับคลังอื่น')} ${rb.hiddenDest}` : null,
       rb.unknownAge ? `${rb.unknownAge} ${tr('ใบไม่รู้เวลาปิดใบ')}` : null];
  const more = b.cards.length - (step.page + 1) * STORE_TV_PER_PAGE;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: tv ? 16 : 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: fz(20, 44), fontWeight: 900, color: 'var(--text)' }}>
          {isSend ? tr('🏬 สโตร์ · ส่งของเข้าไลน์') : `${tr('📥 สโตร์ · รับของเข้าคลัง')}${dest ? ` · ${dest}` : ''}`}
        </div>
        <div style={{ fontSize: fz(13, 24), color: 'var(--text2)' }}>
          {isSend ? tr('ใบที่ไลน์เรียกของ — รอนานสุดขึ้นก่อน') : tr('ไลน์ปิดใบผลิตแล้ว — ค้างนานสุดขึ้นก่อน')}
        </div>
      </div>

      <StoreCallSiren variant="inline" size={tv ? 24 : undefined} />

      {err && <div role="alert" style={{ border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 'var(--r-md)', padding: '8px 14px', fontSize: fz(13, 24), fontWeight: 700 }}>
        ⚠ {tr('โหลดข้อมูลไม่สำเร็จ — ตัวเลขบนจอยังไม่ใช่ของจริง')} ({err})</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: tv ? 16 : 10 }}>
        {kpis.map(([l, v, c]) => (
          <div key={l} style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', borderLeft: `${tv ? 10 : 6}px solid ${c}`, padding: tv ? '14px 20px' : '8px 12px' }}>
            <div style={{ fontSize: fz(12.5, 24), fontWeight: 700, color: 'var(--text2)' }}>{l}</div>
            <div style={{ fontSize: fz(28, 72), fontWeight: 900, color: c, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
              {loaded ? fmt(v) : '…'} <span style={{ fontSize: fz(12, 26), color: 'var(--text2)', fontWeight: 700 }}>{tr('ใบ')}</span>
            </div>
          </div>
        ))}
      </div>

      {hidden.some(Boolean) && <div style={{ fontSize: fz(11.5, 20), color: 'var(--text2)' }}>{hidden.filter(Boolean).join(' · ')}</div>}

      {loaded && !b.cards.length && !err && (
        <div style={{ textAlign: 'center', padding: tv ? 48 : 28, fontSize: fz(15, 34), fontWeight: 800, color: 'var(--text2)' }}>
          ✅ {isSend ? tr('ไม่มีใบไลน์เรียกของค้าง') : tr('ไม่มีของรอรับเข้า')}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: tv ? 'repeat(4, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: tv ? 16 : 10, alignContent: 'start' }}>
        {cards.map(c => {
          const col = TONE[c.tone] || TONE.none;
          return (
            <div key={c.id} className={c.tone === 'bad' ? 'mo-card-alert' : undefined}
              style={{ background: 'var(--card)', borderRadius: 'var(--r-lg)', borderLeft: `${tv ? 12 : 6}px solid ${col}`, padding: tv ? '16px 20px' : '10px 12px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: tv ? 6 : 3, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                <div style={{ fontSize: fz(15, 30), fontWeight: 900, color: 'var(--text)', lineHeight: 1.2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.line || '—'}</div>
                <div style={{ fontSize: fz(15, 32), fontWeight: 900, color: c.tone === 'done' ? 'var(--text2)' : col, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{c.age == null ? '—' : ageText(c.age)}</div>
              </div>
              <div style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}><MatLabel mat={c.mat} name={c.name} size={fz(13, 24)} oneLine /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: fz(18, 38), fontWeight: 900, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(c.qty)} <span style={{ fontSize: fz(11.5, 22), color: 'var(--text2)', fontWeight: 700 }}>{c.uom || tr('ชิ้น')}{c.count > 1 ? ` · ${c.count} ${tr('ใบ')}` : ''}</span>
                </span>
                <span style={{ fontSize: fz(12, 22), fontWeight: 800, padding: tv ? '3px 14px' : '1px 8px', borderRadius: 999, background: 'var(--bg2)', border: `2px solid ${col}`, color: c.tone === 'none' ? 'var(--text2)' : col, whiteSpace: 'nowrap' }}>{tr(c.status)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: fz(12, 22), color: 'var(--text2)' }}>
        {more > 0 && <span style={{ color: 'var(--amber)', fontWeight: 800 }}>+ {tr('อีก')} {more} {tr('ใบ (หน้าถัดไป)')}</span>}
        <div style={{ flex: 1, height: tv ? 10 : 6, background: 'var(--card)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ width: `${leftPct}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
        <span style={{ whiteSpace: 'nowrap' }}>
          {isSend ? tr('ส่งของ') : tr('รับของ')} {tr('หน้า')} {step.page + 1}/{step.pages} · {tr('สลับเองทุก')} {STORE_TV_FLIP_SEC} {tr('วิ')}
          {isSend ? <> · {tr('เหลือง')} &gt; {CALL_WARN_MIN} · {tr('แดง')} &gt; {CALL_BAD_MIN} {tr('นาที')}</> : <> · {tr('แดง = ค้างเกินกำหนดของคลัง')}</>}
        </span>
      </div>
    </div>
  );
}
