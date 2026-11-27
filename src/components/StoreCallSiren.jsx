/* ═══ 🔊📦 ไซเรน "ไลน์เรียกของ" ฝั่งสโตร์ (2026-10-24 · คำสั่ง user) ═══════════════════════

   user: *"เวลาเบิกของ สโตร์ ต้องได้ยินเสียงแจ้งเตือน เหมือนเวลา MTN ได้ยินเสียงเรียกช่าง"*

   ทำไมต้องมี (วัดจริง 24/10): ปุ่ม "➕ ขอเบิกพาร์ทนี้เลย" เปิดใช้ 21/10 → ไลน์ขอมา 8 ใบใน 3 วัน
   แต่ **ค้างที่คิวสโตร์ 29–72 ชม.** ⇒ ของขอแล้วไม่มีใครรู้ว่ามีใบเข้า (คิวสโตร์เป็นจอที่ต้อง "เปิดดู")
   ⇒ ลูปที่เพิ่งต่อติดก็ยังขาดตรงนี้ · ฝั่งช่างแก้ปัญหาเดียวกันด้วยไซเรนมาตั้งแต่ 07/2026

   ⚠️⚠️ กฎเหล็ก — ห้ามทำให้ "ง่ายขึ้น":
   1. **เครื่องเสียงมาจากของกลาง `utils/useSiren.js` ห้ามเขียนชุดที่ 2** (กฎ+เคสจริงอยู่หัวไฟล์นั้น)
      · ลายเสียงของสโตร์ = `SIREN_PATTERN_CALL` (โน้ตขึ้น) **ต่างจากของช่าง** (โน้ตตก) —
        ห้องที่นั่งรวมกันต้องแยกออกด้วยหูว่าเสียงนี้เรื่องอะไร
   2. 🔴 **ห้าม mount คู่กับ `<DowntimeSiren>` โดยไม่ส่ง `slot`** — แถบเตือนและชิป standby เป็น
      `position:fixed` ตำแหน่งเดียวกัน จะทับกันสนิท (เห็นอันเดียว · ของอีกอันหายไปเงียบๆ)
   3. 🔴 **"รับทราบ" หยุดเสียงเท่านั้น ไม่เปลี่ยนสถานะใบ** (`store_ack_at` · migration 20261025)
      ใบยังรอหยิบอยู่ในคิวเหมือนเดิม — ห้ามเอาช่องนี้ไปกรองใบออกจากคิวที่ไหน
   4. 🔴 **โหลดไม่สำเร็จ ≠ "ไม่มีใบ"** — ห้ามล้างลิสต์ทิ้ง (ล้างแล้วไซเรนดับ + แถบหาย = เงียบสนิท
      ทั้งที่มีใบรออยู่) ⇒ คงลิสต์เดิม + ขึ้นแถบบอกว่ากำลังอ่านไม่ได้
   5. 🔴 **ใบที่ "สโตร์สร้างเอง" (`store_forecast`) ไม่ต้องดัง** — สโตร์ไม่ต้องเตือนตัวเอง ·
      ค่าอื่น/ค่าว่างที่ไม่รู้จัก = **ดัง** (fail-open · เงียบเพราะข้อมูลไม่ครบ แย่กว่าดังเกิน)
   6. ยังไม่ apply migration (42703) = เลิกกรอง `store_ack_at` แล้วดังตามใบ `pending` ต่อไป
      **ห้ามให้ไซเรนล้มเพราะคอลัมน์ยังไม่มี**                                                      */

import { useNavigate } from 'react-router-dom';
import { storeOfMat } from '../utils/storeOps';
import { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import MatLabel from './MatLabel';
import { visibleInterval } from '../utils/usePolling';
import { RATE, LIVE } from '../utils/refreshRates';
import { coalesce, makeIdleGate } from '../utils/liveRefresh';
import { liveChannel } from '../utils/liveChannel';
import { checkWriteRows } from '../utils/dbWrite';
import { getActor } from '../utils/actorStamp';
import { reqSourceMeta } from '../utils/replenishGate';
import useIsMobile from '../utils/useIsMobile';
import useSiren, { SIREN_PATTERN_CALL } from '../utils/useSiren';

import { tr } from '../utils/i18n';
/* egress: จอแขวนเปิดค้างทั้งวัน ⇒ เลือกเฉพาะคอลัมน์ที่ใช้ (กฎเหล็ก DB ข้อ 11) */
const COLS = 'id, line_name, mat_no, part_name, request_qty, requested_at, requested_by, source, store_ack_at';
const COLS_NO_ACK = 'id, line_name, mat_no, part_name, requested_at, requested_by, request_qty, source';

const hhmm = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${tr("น.")}`;
};
/* 🔴 เพดานจำนวนแถบ — ใบเข้าพร้อมกันหลายใบ (สโตร์เปิดใบตามแผนทีเดียว 10+ ใบได้) แล้วแถบ
   `position:fixed` จะทับจอทั้งใบจนทำงานต่อไม่ได้ · เสียงดังรวมครั้งเดียวพออยู่แล้ว
   ⇒ โชว์ 3 ใบแรก (เก่าสุดก่อน — เรียง requested_at asc มาแล้ว) + บอกว่าเหลืออีกกี่ใบและไปดูที่ไหน */
const MAX_BARS = 3;

const agoMin = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null);

/**
 * @param {object} p
 * @param {number} [p.slot=0]  ช่องวางแถบ/ชิป (0 = บนสุด) — ต้องต่างกันเมื่อ mount คู่กับไซเรนอื่น
 * @param {'float'|'inline'} [p.variant='float']  19/11 (mockup รับของเข้าคลัง ที่ user เคาะ) — `inline` = แถบเดียว
 *        อยู่ในเนื้อหน้า **ไม่ลอยทับ** (Stock Management › ส่ง/รับของ) · เสียงยังดังเหมือนเดิมทุกแบบ
 * @param {boolean} [p.here=false]  inline บนแท็บ "ส่งของเข้าไลน์" เอง = มีปุ่มรับทราบ/ไปเตรียมงาน ·
 *        แท็บอื่น = ลิงก์ไปแท็บส่งของอย่างเดียว (งานของแท็บนั้น)
 */
/* `size` = ขนาดตัวอักษรของแถบ inline (จอทีวีสโตร์ส่ง 24 · ไม่ส่ง = 12.5 เดิม) */
export default function StoreCallSiren({ slot = 0, variant = 'float', here = false, size }) {
  /* 📱 มือถือโชว์ทีละใบ (05/11) — แถบขึ้นบรรทัดใหม่แล้วสูง ~270px/ใบ
     3 ใบ = 894px บนจอ 844px ⇒ ปุ่ม "รับทราบ" ของใบล่างสุดตกนอกจอ กดไม่ได้เลย
     (แถบเป็น `position: fixed` เลื่อนหน้าตามไม่ได้) · ที่เหลือไปอยู่บรรทัด "+ อีก N ใบ" ข้างล่าง
     🔴 จอคอม/จอ TV ยังได้ 3 ใบเท่าเดิม (ด่าน desktopdiff) */
  const isMobile = useIsMobile();
  const maxBars = isMobile ? 1 : MAX_BARS;
  const { role } = useContext(UserContext);
  /* 🔑 กด "รับทราบ" = เขียน `wip_replenish_requests` ซึ่ง RLS รัดด้วย has_perm ⇒ ต้องเช็คฝั่งจอด้วย
     คีย์ = `heijunka:operate` (คีย์เดียวกับการทำงานบนคิวสโตร์) · ไม่มีสิทธิ์ก็ยังต้อง**ปิดเสียงได้**
     แต่ปิดแบบ "เฉพาะจอนี้" ไม่เขียนฐาน — จอแขวนที่ล็อกอินเป็น display ห้ามดังค้างตลอดกาล
     (รีโหลดหน้าแล้วดังใหม่ = ถูกต้อง เพราะงานยังค้างจริง) */
  const canAck = can('heijunka', 'operate', role);
  /* 🔍 04/11 (user: "มีปุ่มกดจากแจ้งเตือนเข้าไปหาหน้าที่ต้องเตรียมงานเลยได้มั้ย")
     พาไปจอทำรายการ (/line-stock › 🏬 งานสโตร์ › ตู้ตามเลขพาร์ท) + กรองให้เหลือพาร์ทใบนี้ · state = ส่งต่อแม้อยู่หน้าเดิมแล้ว */
  const navigate = useNavigate();
  const goPrep = (a, { noAck = false } = {}) => {
    if (canAck && !noAck) ack(a);
    const st = storeOfMat(a.mat_no);   // ตู้ตามเลขพาร์ท (04/11 เลิกแท็บคิวเติม WIP)
    navigate(`/line-stock?tab=out&store=${st}`, { state: { storeFocus: { store: st, q: a.mat_no || '', at: Date.now() } } });
  };
  const [hushed, setHushed] = useState(() => new Set());   // id ที่ปิดเสียงเฉพาะจอนี้
  const [rows, setRows] = useState([]);
  const [loadErr, setLoadErr] = useState(false);
  const [noAckCol, setNoAckCol] = useState(false);   // ยังไม่ apply migration → เลิกกรอง ack
  const [, setTick] = useState(0);                    // นาฬิกา: ให้ "รอมาแล้ว N นาที" เดินเองไม่ยิง DB

  const fetchCalls = useCallback(async () => {
    const run = (cols, withAck) => {
      let q = supabase.from('wip_replenish_requests').select(cols).eq('status', 'pending');
      if (withAck) q = q.is('store_ack_at', null);
      return q.order('requested_at', { ascending: true, nullsFirst: false }).limit(200);
    };
    let { data, error } = await run(COLS, true);
    if (error?.code === '42703') {                    // กฎข้อ 6 — คอลัมน์ยังไม่มี ไม่ใช่ความผิดผู้ใช้
      setNoAckCol(true);
      ({ data, error } = await run(COLS_NO_ACK, false));
    }
    /* กฎข้อ 4 — อ่านไม่ได้ ห้ามล้างลิสต์ */
    if (error) { console.error('[StoreCallSiren] โหลดใบขอเบิกไม่สำเร็จ:', error); setLoadErr(true); return; }
    setLoadErr(false);
    setRows(data || []);
  }, []);

  useEffect(() => {
    fetchCalls();
    /* poll = กันเหนียวเผื่อ realtime หลุด · idleGate: รอบที่ไม่มีอะไรเปลี่ยน = ไม่มี network เลย */
    const g = makeIdleGate(LIVE.FLOOR);
    const stopPoll = visibleInterval(() => { if (g.shouldRun()) { g.loaded(); fetchCalls(); } }, RATE.BACKUP);
    const bump = coalesce(() => { g.loaded(); return fetchCalls(); }, LIVE.ALARM);
    const ch = liveChannel(supabase, 'store-call-siren')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wip_replenish_requests' }, () => { g.touch(); bump(); })
      .subscribe((st) => { if (st === 'SUBSCRIBED') g.touch(); });
    const clk = setInterval(() => setTick(t => t + 1), 60000);
    return () => { stopPoll(); bump.cancel(); supabase.removeChannel(ch); clearInterval(clk); };
  }, [fetchCalls]);

  /* กฎข้อ 5 — ใบของสโตร์เองไม่ดัง · ค่าที่ไม่รู้จักถือเป็นฝั่งไลน์ (ดัง) */
  const alerts = useMemo(
    () => rows.filter(r => reqSourceMeta(r.source).side === 'line' && (noAckCol || !r.store_ack_at) && !hushed.has(r.id)),
    [rows, noAckCol, hushed]);

  const { muted, unlockNow } = useSiren(alerts.length > 0, { pattern: SIREN_PATTERN_CALL });

  const ack = async (a) => {
    /* ไม่มีสิทธิ์ = ปิดเสียงเฉพาะจอนี้ ไม่เขียนฐาน (เช็คซ้ำในฟังก์ชันที่เขียนจริง ไม่พึ่งการซ่อนปุ่ม) */
    if (!canAck) { setHushed(prev => new Set(prev).add(a.id)); return; }
    setRows(prev => prev.filter(x => x.id !== a.id));   // เอาออกจากจอทันที (เสียงต้องหยุดเดี๋ยวนี้)
    if (noAckCol) return;                               // ไม่มีคอลัมน์ให้เขียน — เงียบรอบนี้เท่านั้น
    const who = getActor();
    /* นับแถว — แถบถูกถอดจากจอไปแล้วบรรทัดบน ถ้าเขียนไม่ติดเสียงจะกลับมาดังรอบหน้า
       โดยที่คนกดคิดว่ารับทราบแล้ว (กฎเขียน DB ข้อ 2) */
    checkWriteRows(await supabase.from('wip_replenish_requests')
      .update({ store_ack_at: new Date().toISOString(), store_ack_by_name: who.name || null, store_ack_by_uid: who.uid || null })
      .eq('id', a.id).select('id'), 'บันทึกรับทราบเสียงเตือนใบขอเบิก');
  };

  const inline = variant === 'inline';
  /* inline: ป้าย fixed ทุกตัวกลายเป็นของในเนื้อหน้า (ตำแหน่งทิ้ง · สี/ข้อความเดิม) */
  const fixed = (extra = {}) => (inline
    ? { position: 'static', alignSelf: 'flex-start', marginBottom: 10, ...Object.fromEntries(Object.entries(extra).filter(([k]) => !['top', 'bottom', 'left', 'right', 'transform'].includes(k))) }
    : { position: 'fixed', zIndex: 4000, ...extra });
  const chipBottom = `calc(${12 + slot * 46}px + var(--mnav-h, 0px))`;

  if (!alerts.length) {
    /* อ่านใบไม่ได้ ต้องขึ้นให้เห็น — "เงียบ" กับ "ไม่มีใบ" หน้าตาเหมือนกันจากข้างนอก */
    if (loadErr) return (
      <div style={fixed({ bottom: chipBottom, right: 12, display: 'flex', alignItems: 'center', gap: 7,
        background: 'rgba(28,10,10,0.95)', border: '1px solid rgba(239,68,68,0.6)', borderRadius: 'var(--r-md)',
        padding: '7px 11px', fontSize: 11.5, fontWeight: 800, color: 'var(--red)', boxShadow: 'var(--shadow-lg)' })}>
        ⚠️ {tr("อ่านใบขอเบิกจากไลน์ไม่ได้ — ยังบอกไม่ได้ว่ามีไลน์เรียกของหรือไม่")}
      </div>
    );
    if (!muted) return null;
    /* ชิปสถานะความพร้อม — ห้ามกระพริบ/ห้ามแดง (UI-CONVENTIONS §2) */
    return (
      <div onClick={unlockNow} title={tr('เบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ 1 ครั้ง — จอที่เปิดทิ้งไว้ต้องแตะทุกครั้งที่หน้าโหลดใหม่')}
        style={fixed({ bottom: chipBottom, right: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
          background: 'rgba(20,16,6,0.94)', border: '1px solid rgba(251,191,36,0.5)', borderRadius: 'var(--r-md)',
          padding: '7px 11px', fontSize: 11.5, fontWeight: 800, color: 'var(--amber)', boxShadow: 'var(--shadow-lg)' })}>
        {tr("เสียงเตือน \"ไลน์เรียกของ\" ยังไม่พร้อม — แตะที่นี่ 1 ครั้ง")}
      </div>
    );
  }

  if (inline) {
    const a = alerts[0];
    const wait = agoMin(a.requested_at);
    return (
      <div role="status" className="andon-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10,
        background: 'var(--card-surf)', border: '1px solid var(--border)', borderLeft: '4px solid var(--amber)', borderRadius: 'var(--r-md)',
        padding: size ? '10px 16px' : '8px 12px', fontSize: size || 12.5 }}>
        <span className="andon-bar-msg" style={{ flex: 1, minWidth: 0, color: 'var(--text)' }}>
          🔔 <b>{tr('ไลน์เรียกของ')} {alerts.length} {tr('ใบ')}</b> {tr('ยังไม่มีใครรับทราบ')}
          {here && <> · {tr('เก่าสุด')} <b>{a.line_name || tr('ไม่ระบุไลน์')}</b> · <MatLabel mat={a.mat_no} name={a.part_name} size={12} />
            {' · '}{tr('ขอ')} {Number(a.request_qty || 0).toLocaleString()} · {tr('รอ')} {wait != null ? `${wait.toLocaleString()} ${tr("นาที")}` : '—'}</>}
        </span>
        {muted && (
          <button type="button" onClick={unlockNow} style={{ background: 'none', border: 'none', fontSize: size || 12, fontWeight: 800, color: 'var(--amber)', cursor: 'pointer' }}>
            {tr('แตะเพื่อเปิดเสียง')}
          </button>
        )}
        {here ? (<>
          <button type="button" onClick={() => goPrep(a)} style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--r-md)',
            padding: '5px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{tr('ไปเตรียมงาน')}</button>
          <button type="button" onClick={() => ack(a)}
            title={canAck ? tr("หยุดเสียงเท่านั้น — ใบยังรอหยิบอยู่ในคิวสโตร์เหมือนเดิม") : tr("บัญชีนี้ไม่มีสิทธิ์บันทึกรับทราบ (heijunka:operate) — ปิดได้เฉพาะเสียงบนจอนี้")}
            style={{ background: 'var(--bg2-surf)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
              padding: '5px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
            {canAck ? tr('รับทราบ · หยุดเสียง') : tr('🔇 ปิดเสียงเฉพาะจอนี้')}
          </button>
        </>) : (
          /* แท็บอื่น = พาไปเฉยๆ ไม่ถือว่ารับทราบ (คนกดยังไม่ได้เห็นใบ) */
          <button type="button" onClick={() => goPrep(a, { noAck: true })} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: size || 12.5, fontWeight: 800, cursor: 'pointer' }}>
            {tr('ไปที่ ส่งของเข้าไลน์ →')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={fixed({ top: 12 + slot * 86, left: '50%', transform: 'translateX(-50%)',
      width: 'min(96vw, 620px)', display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' })}>
      {alerts.slice(0, maxBars).map(a => {
        const wait = agoMin(a.requested_at);
        return (
          /* 📱 `andon-bar` = ให้แถบขึ้นบรรทัดใหม่ได้บนมือถือ (index.css · media query เท่านั้น)
             ไม่มีคลาสนี้ = ข้อความถูกปุ่มบีบจนเหลือกว้าง 0 บนจอ 390px (มีด่าน) */
          <div key={a.id} className="dt-alarm-blink andon-bar" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(8,20,14,0.96)', border: '2px solid #22c55e', borderRadius: 'var(--r-lg)', padding: '10px 14px', boxShadow: 'var(--shadow-float)' }}>
            <span style={{ fontSize: 22 }}>📦</span>
            <div className="andon-bar-msg" style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#fff' }}>
                {tr("ไลน์เรียกของ")} — {a.line_name || tr("ไม่ระบุไลน์")}
              </div>
              {/* ชื่อชิ้นงานต้องผ่าน <MatLabel> — Part No. → Part Name → MAT SAP (ด่าน matOrderSweep) */}
              <MatLabel mat={a.mat_no} name={a.part_name} size={12.5} />
              <div style={{ fontSize: 12, color: '#c6efd8' }}>
                {tr("ขอ")} {Number(a.request_qty || 0).toLocaleString()} {tr("ชิ้น")}
                {' · '}{tr('แจ้ง')} {hhmm(a.requested_at)}{wait != null ? ` (${tr("รอมาแล้ว")} ${wait.toLocaleString()} ${tr("นาที")})` : ''}
                {a.requested_by ? ` · ${tr("โดย")} ${a.requested_by}` : ''}
                {' · '}{reqSourceMeta(a.source).short}
              </div>
            </div>
            {muted && (
              <span onClick={unlockNow} title={tr('เบราว์เซอร์บล็อกเสียงจนกว่าจะมีคนแตะจอ')}
                style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, color: 'var(--amber)', cursor: 'pointer' }}>
                {tr("แตะเพื่อเปิดเสียง")}
              </span>
            )}
            <button onClick={() => goPrep(a)} title={tr('ไปหน้าเตรียมงาน — Stock Management › 📤 ส่งของเข้าไลน์ › ตู้ตามเลขพาร์ท (กรองเฉพาะพาร์ทนี้)')}
              style={{ flexShrink: 0, background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 'var(--r-md)',
                padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
              {tr('ไปเตรียมงาน')}
            </button>
            <button onClick={() => ack(a)}
              title={canAck ? tr("หยุดเสียงเท่านั้น — ใบยังรอหยิบอยู่ในคิวสโตร์เหมือนเดิม")
                            : tr("บัญชีนี้ไม่มีสิทธิ์บันทึกรับทราบ (heijunka:operate) — ปิดได้เฉพาะเสียงบนจอนี้ รีโหลดแล้วดังใหม่")}
              style={{ flexShrink: 0, background: canAck ? '#22c55e' : 'var(--bg3)', color: canAck ? '#04140a' : 'var(--text2)',
                border: canAck ? 'none' : '1px solid var(--border2)', borderRadius: 'var(--r-md)',
                padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
              {canAck ? tr('รับทราบ · หยุดเสียง') : tr('🔇 ปิดเสียงเฉพาะจอนี้')}
            </button>
          </div>
        );
      })}
      {alerts.length > maxBars && (
        <div style={{ pointerEvents: 'auto', background: 'rgba(8,20,14,0.96)', border: '1px solid rgba(34,197,94,0.5)',
          borderRadius: 'var(--r-md)', padding: '7px 12px', fontSize: 11.5, fontWeight: 800, color: '#86efac', textAlign: 'center' }}>
          + {tr("อีก")} {alerts.length - maxBars} {tr("ใบที่ไลน์เรียกแล้วยังไม่มีใครรับทราบ — ทำรายการที่ Stock Management → 📤 ส่งของเข้าไลน์ (ตู้ตามเลขพาร์ท")})
        </div>
      )}
    </div>
  );
}
