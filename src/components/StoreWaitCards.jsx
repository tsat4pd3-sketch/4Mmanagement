/* ══════════════════════════════════════════════════════════════════════════
   📦 คอลัมน์ฝั่งสโตร์บนจอ TV — "ไลน์ไหนเรียกอะไร ต้องเอาอะไรไปส่ง"

   ที่มา (user 2026-08-28): *"สโตร์ก็ดูสถานะว่ามีงานต้องไปส่งให้ไลน์ผลิตไหนที่รอของอยู่"*
   รอบ 2 (user 2026-10-12): *"จอของแต่ละส่วนงานก็ควรจะแสดงผลของเรื่องที่เกี่ยวกับส่วนงานนั้นๆ
     เช่นสโตร์ ต้องแจ้งเตือนเมื่อมีความต้องการงานจากไลน์ผลิต บอกว่า ไลน์ไหน ต้องการอะไร
     โชว์การ์ดชิ้นงาน บอก รูป รหัส ชื่อ matsap จำนวน"*

   ลำดับบนคอลัมน์ (บนสุด = สำคัญสุด · จอ TV ไม่มีใครเลื่อน):
     ① 🔔 ไลน์เรียกของ — การ์ดชิ้นงาน `<PartCard>` (รูป · Part No · ชื่อ · MAT SAP · จำนวน · ไลน์ปลายทาง)
        แหล่ง = คิวเดียวกับบอร์ดสโตร์ `/heijunka` (`wip_replenish_requests` Main + `raw_withdrawal_requests` DR)
        กฎคัด/เรียง → `src/utils/storeTvDemand.js` **ห้ามเขียนเงื่อนไขซ้ำในหน้า**
     ② 🚚 รอบส่งคัมบัง — เคส C เลยเวลา (แดง) · D รับไม่ครบ (ส้ม) จาก `v_store_abnormal`
     ③ 📉 พาร์ทจะขาด (A) — **เฉพาะส่วนงานของจอ** + บอกยอดที่ผูกไลน์ไม่ได้ (ห้ามทิ้งเงียบ)
     ④ 🧾 สั่งซื้อค้าง (E) — นับรวมรายพาร์ท ห้ามโชว์รายใบ (ทริกเกอร์ออกใบทีละล็อต เคยได้ 2,336 ใบ)
     B เกิน Max ไม่ขึ้นจอนี้ (ไม่ใช่ "งานที่ต้องไปส่ง")

   ⚠️⚠️ เคส A–E อ่านวิว **`v_store_abnormal` (DR) ที่เดียว** — `/store-monitor` กับ edge `store-daily-scan`
        อ่านตัวเดียวกัน **ห้าม copy เงื่อนไขมาเขียนซ้ำที่นี่** (กฎเหล็กของบอร์ดสโตร์ · drift แน่นอน)
   ⚠️ โหลดไม่สำเร็จ = แถบแดง **ห้ามขึ้นจอเขียว "ไม่มีไลน์รอของ"** (จอที่ยืนยันสิ่งที่ไม่จริง แย่กว่าจอว่าง)
   ⚠️ อ่านอย่างเดียว — การ์ดกดแล้วพาไปบอร์ดสโตร์ที่ลงมือจริง ไม่มีปุ่มเขียนข้อมูล (จอ kiosk · kioskRoutes.js)
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import PartCard, { partCardGrid } from './PartCard';
import MatLabel from './MatLabel';
import { supabase, supabaseDR } from '../supabaseClient';
import { RATE } from '../utils/refreshRates';
import { useLiveBoard } from '../utils/useLiveBoard';
import { usePolling } from '../utils/usePolling';
import { fetchByIds } from '../utils/fetchByIds';
import usePartImages from '../utils/usePartImages';
import {
  REQ_STATUS, buildRequestCards, requestLinesOf, matLinesOf, scopeShortMats, waitText,
} from '../utils/storeTvDemand';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const fmtQty = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '–' : Number(v).toLocaleString('th-TH'));

/* สีต่อเคสรอบส่ง — C ด่วนสุด (ไลน์รออยู่แล้วจริง) · D รองลงมา
   ⚠️ "งานค้างของสโตร์" ไม่ใช่ alarm เครื่องหยุด → **ห้ามกระพริบ** (กฎ Andon: กระพริบเฉพาะแดงของเครื่อง) */
const CASE = {
  C: { color: '#ef4444', rank: 0, label: 'เลยเวลาส่ง' },
  D: { color: '#f59e0b', rank: 1, label: 'รับไม่ครบ' },
};
/** สีบนผังของไลน์ที่ "เรียกของ" (ไม่มีรอบส่งค้าง) — ม่วง แยกจากเขียว/เหลือง/แดงของสถานะเครื่อง */
export const REQ_MAP_COLOR = '#a855f7';

/**
 * 🪝 โหลด + คัดข้อมูลของคอลัมน์สโตร์ — ยกขึ้นมาเป็น hook เพื่อให้บอร์ดแม่ใช้ตัวเลขเดียวกัน
 *    ทั้ง **พาดหัวบนสุด · สีบนผัง · การ์ดในคอลัมน์** (เดิมผังรู้แค่เคส C/D พาดหัวไม่รู้อะไรเลย)
 * @param {{ enabled:boolean, inScope:(l:string)=>boolean, scoped:boolean, knownLines:Set<string> }} p
 *        scoped = จอนี้กรองส่วนงาน/บัญชีมีขอบเขต (false = เห็นทุกไลน์ → ไม่ต้องคัดพาร์ทจะขาด)
 */
export function useStoreTv({ enabled, inScope, scoped, knownLines }) {
  const [abn, setAbn] = useState([]);
  const [wip, setWip] = useState([]);
  const [raw, setRaw] = useState([]);
  const [lotById, setLotById] = useState({});
  const [matRows, setMatRows] = useState([]);
  const [err, setErr] = useState(null);       // เคส A–E (วิว)
  const [reqErr, setReqErr] = useState(null); // คิวคำขอจากไลน์
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    /* จอ TV เปิดค้างทั้งวัน → เลือกคอลัมน์ที่ใช้ + กรองสถานะฝั่ง server (กฎ egress ข้อ 11) */
    const [abnRes, wipRes, rawRes] = await Promise.all([
      supabaseDR.from('v_store_abnormal')
        .select('code, title, line_name, mat_no, part_name, detail, sev, qty_on_hand, min_qty')
        .in('code', ['A', 'C', 'D', 'E'])
        .order('sev', { ascending: false }).order('code').limit(1000),
      /* 🔴 `suggested`/`hold` สโตร์ต้องมองไม่เห็น (ยังไม่ใช่คำสั่ง) · `delivered` = รอไลน์เซ็นรับ ไม่ใช่งานสโตร์ */
      supabase.from('wip_replenish_requests')
        .select('id, status, line_name, mat_no, part_name, request_qty, requested_at, picked_at, picked_qty, source')
        .in('status', ['pending', 'preparing'])
        .order('requested_at', { ascending: true }).limit(500),
      supabaseDR.from('raw_withdrawal_requests')
        .select('id, status, raw_mat_no, part_name, qty, lot_request_id, created_at')
        .eq('status', 'pending').order('created_at', { ascending: true }).limit(500),
    ]);
    setNowMs(Date.now());
    setLoaded(true);

    if (abnRes.error) setErr(abnRes.error.message || 'โหลดไม่สำเร็จ');
    else { setErr(null); setAbn(abnRes.data || []); }

    const reqErrs = [];
    if (wipRes.error) reqErrs.push(`คำขอเติมเข้าไลน์: ${wipRes.error.message}`);
    else setWip(wipRes.data || []);
    if (rawRes.error) reqErrs.push(`ใบเบิกวัตถุดิบ: ${rawRes.error.message}`);
    else {
      const rows = rawRes.data || [];
      setRaw(rows);
      const ids = rows.map(r => r.lot_request_id).filter(Boolean);
      if (ids.length) {
        const { rows: lots, error } = await fetchByIds(ids,
          (part) => supabaseDR.from('child_lot_requests').select('id, source_line, child_mat_no').in('id', part));
        if (error) reqErrs.push(`ไลน์ของใบเบิกวัตถุดิบ: ${error}`);
        const m = {}; (lots || []).forEach(l => { m[l.id] = l; });
        setLotById(m);
      } else setLotById({});
    }
    setReqErr(reqErrs.length ? reqErrs.join(' · ') : null);

    /* พาร์ทต่ำกว่า Min → ไลน์ไหนถือ/ใช้พาร์ทนั้น (แถวสต็อก + ทะเบียน min/max ต่อไลน์) เพื่อคัดตามส่วนงาน */
    const aMats = [...new Set((abnRes.data || []).filter(r => r.code === 'A').map(r => r.mat_no).filter(Boolean))];
    if (aMats.length) {
      const [st, lv] = await Promise.all([
        fetchByIds(aMats, (part) => supabaseDR.from('line_stock_summary').select('mat_no, line_name').in('mat_no', part), { orderBy: 'mat_no' }),
        fetchByIds(aMats, (part) => supabaseDR.from('line_part_levels').select('mat_no, line_name').eq('is_active', true).in('mat_no', part), { orderBy: 'mat_no' }),
      ]);
      if (st.error || lv.error) setErr(`ผูกพาร์ทจะขาดเข้าไลน์ไม่ได้: ${st.error || lv.error}`);
      setMatRows([...(st.rows || []), ...(lv.rows || [])]);
    } else setMatRows([]);
  }, []);

  /* 🔴 3 ช่องทางรีเฟรช (12/10 · เดิมฟังแค่ `line_stock_transactions` ⇒ ไลน์เรียกของ/รอบเลยเวลาขึ้นช้าได้ถึง 2 ชม.)
     ① คำขอจากไลน์ (Main) realtime — "ไลน์เรียก" ต้องขึ้นจอภายในไม่กี่วินาที คือหน้าที่หลักของจอนี้
     ② สต็อก (DR) realtime — ยอดต่ำกว่า Min ขยับตามการตัดจ่าย
     ③ poll **ไม่ผ่าน idle gate** ทุก 15 นาที — เคส C "รอบส่งเลยเวลา" เกิดจาก**นาฬิกาเดิน** ไม่มีแถวไหนเปลี่ยน
        (`kanban_deliveries`/`raw_withdrawal_requests` ไม่อยู่ใน publication) ⇒ gate ของ useLiveBoard จะข้ามรอบตลอด
        ข้อยกเว้นกฎเหล็ก DB ข้อ 8 ที่ตั้งใจ: ข้อมูลที่ขึ้นกับเวลา "ไม่มีอะไรเปลี่ยน" ไม่มีจริง */
  useLiveBoard(load, { tables: ['wip_replenish_requests'], client: supabase, topic: 'tv-store-requests', rate: RATE.ANALYTIC, enabled });
  useLiveBoard(load, { tables: ['line_stock_transactions'], topic: 'tv-store-stock', rate: RATE.ANALYTIC, enabled });
  usePolling(load, RATE.BOARD, { enabled, immediate: false });
  // นาฬิกา "รอมากี่นาที" เดินเองทุกนาที (ไม่ยิง DB)
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(t);
  }, [enabled]);

  const req = useMemo(() => buildRequestCards({ wip, raw, lotById, inScope, nowMs }), [wip, raw, lotById, inScope, nowMs]);
  const reqLines = useMemo(() => requestLinesOf(req.cards), [req.cards]);

  /* รอบส่งคัมบังค้าง (C/D) — รวมหลายรอบของไลน์เดียวเป็นแถวเดียว (จอ TV อ่าน "ไลน์ไหน" ไม่ใช่ไล่รายรอบ) */
  const waiting = useMemo(() => {
    const m = {};
    abn.filter(r => CASE[r.code] && r.line_name && (!inScope || inScope(r.line_name))).forEach(r => {
      const c = CASE[r.code];
      const g = (m[r.line_name] = m[r.line_name] || { line: r.line_name, rank: 9, color: '#6b7280', items: [] });
      g.items.push({ code: r.code, what: r.part_name || '', detail: r.detail || '' });
      if (c.rank < g.rank) { g.rank = c.rank; g.color = c.color; }
    });
    return Object.values(m).sort((a, b) => a.rank - b.rank || a.line.localeCompare(b.line));
  }, [abn, inScope]);

  const matLines = useMemo(() => matLinesOf(matRows), [matRows]);
  const short = useMemo(
    () => scopeShortMats(abn.filter(r => r.code === 'A'), matLines, scoped ? inScope : null, knownLines),
    [abn, matLines, scoped, inScope, knownLines]);
  /* E มีไลน์ปลายทาง (`dest_line`) ⇒ กรองส่วนงานได้ตรงๆ · ไม่มีปลายทาง = นับไว้ทุกจอ (ห้ามหาย) */
  const poPending = useMemo(() => abn.filter(r => r.code === 'E' && (!r.line_name || !inScope || inScope(r.line_name))), [abn, inScope]);

  /* สีบนผังต่อไลน์ — รอบส่งค้าง (C/D) ชนะ "เรียกของ" (ไลน์รออยู่แล้วจริง) · เครื่องหยุดชนะทั้งคู่ (ตัดสินที่บอร์ดแม่) */
  const lineMap = useMemo(() => {
    const m = {};
    Object.values(reqLines).forEach(g => { m[g.line] = { color: REQ_MAP_COLOR, label: `เรียกของ ${g.n}` }; });
    waiting.forEach(w => { m[w.line] = { color: w.color, label: CASE[w.items[0]?.code]?.label || 'รอของ' }; });
    return m;
  }, [reqLines, waiting]);

  return { loaded, err, reqErr, req, reqLines, waiting, short, poPending, lineMap };
}

/** การ์ดคำขอ 1 ใบ = `<PartCard>` มาตรฐาน (UI §6.23) — ห้ามวาดหน้าตาการ์ดเองที่นี่ */
function RequestCard({ c, img, onClick }) {
  const st = REQ_STATUS[c.status];
  const wt = waitText(c.waitMin);
  return (
    <PartCard
      code={c.mat} name={c.name} img={img}
      status={{ label: st.label, color: st.color }}
      metric={{ label: c.kind === 'raw' ? 'วัตถุดิบที่ต้องจ่าย' : 'จำนวนที่ต้องส่ง', value: fmtQty(c.qty) }}
      aside={{ label: 'ส่งไปไลน์', value: c.line || '⚠ ไม่ระบุไลน์' }}
      /* รอนานเกินชั่วโมงแรก = รีบจริง (alert สงวนไว้ใช้เฉพาะเคสนี้ · กฎ PartCard ข้อ 5) */
      alert={c.status === 'pending' && c.waitMin != null && c.waitMin >= 60}
      rows={[
        { k: c.status === 'pending' ? 'รอมาแล้ว' : 'ไลน์เรียกเมื่อ', v: wt ? `${wt}` : 'ไม่ทราบเวลา' },
        { k: 'ที่มา', v: c.kind === 'raw' ? '🧱 ไลน์ child ขอวัตถุดิบ' : c.source === 'store' ? '🏬 สโตร์ส่งตามแผนผลิต' : '📦 ไลน์ขอเบิก' },
        { k: 'ใช้ทำ', v: c.useFor || null },
        { k: 'หยิบแล้ว', v: c.pickedQty != null ? fmtQty(c.pickedQty) : null },
        { k: '⚠️ เลข MAT', v: c.fgWarn ? 'เป็น FG (1xxx) — สโตร์ตัดจ่ายไม่ได้ ถามไลน์ว่าต้องการเลข 2xxx/3xxx/5xxx ตัวไหน' : null },
      ]}
      onClick={onClick} />
  );
}

/** แสดงการ์ดคำขอได้กี่ใบก่อนพับเป็น "+ อีก N" — จอ TV ไม่มีใครเลื่อน แต่ต้องบอกยอดที่ซ่อนเสมอ */
const REQ_SHOW = 6;
const SHORT_SHOW = 8;

export default function StoreWaitCards({ data, navigate, big = 1 }) {
  const imgOf = usePartImages();
  const { loaded, err, reqErr, req, reqLines, waiting, short, poPending } = data;
  const nLines = Object.keys(reqLines).length;
  const goQueue = () => navigate?.('/heijunka');

  return (<>
    {/* ══ ① ไลน์เรียกของ ══ */}
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13 * big, fontWeight: 900 }}>🔔 ไลน์เรียกของ</span>
      {req.cards.length > 0 && (
        <span style={{ fontSize: 11 * big, fontWeight: 800, color: REQ_STATUS.pending.color }}>
          {req.cards.length} รายการ · {nLines} ไลน์
        </span>
      )}
    </div>
    {reqErr && (
      <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: 12.5 }}>
        ⚠ ดึงคำขอจากไลน์ไม่สำเร็จ — รายการด้านล่างอาจไม่ครบ ({reqErr})
      </div>
    )}
    {loaded && !reqErr && !req.cards.length && (
      <div style={{ ...card, textAlign: 'center', padding: 18, fontSize: 13 * big, fontWeight: 800, color: '#22c55e' }}>
        ✅ ไม่มีไลน์ไหนเรียกของ
      </div>
    )}
    {!loaded && <div style={{ ...card, color: 'var(--muted)', fontSize: 12.5 }}>กำลังโหลดคำขอจากไลน์…</div>}
    {req.cards.length > 0 && (
      <div style={partCardGrid()}>
        {req.cards.slice(0, REQ_SHOW).map(c => (
          <RequestCard key={c.key} c={c} img={imgOf(c.mat)} onClick={goQueue} />
        ))}
      </div>
    )}
    {req.cards.length > REQ_SHOW && (
      <div onClick={goQueue} style={{ ...card, cursor: 'pointer', fontSize: 12 * big, fontWeight: 800, color: 'var(--text2)', padding: 10 }}>
        + อีก {req.cards.length - REQ_SHOW} รายการ — ดูทั้งหมดที่บอร์ดสโตร์ ›
      </div>
    )}
    {req.noLine > 0 && (
      <div style={{ fontSize: 11, color: '#f59e0b' }}>
        ⚠ {req.noLine} ใบไม่ระบุไลน์ — ขึ้นทุกจอสโตร์ (ไปแก้ใบที่บอร์ดสโตร์)
      </div>
    )}

    {/* ══ ② รอบส่งคัมบังค้าง ══ */}
    {err && (
      <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: 12.5 }}>
        ⚠ ดึงสถานะสโตร์ไม่สำเร็จ — รอบส่ง/พาร์ทจะขาดยังไม่ใช่ของจริง ({err})
      </div>
    )}
    {waiting.length > 0 && <div style={{ fontSize: 12.5 * big, fontWeight: 900 }}>🚚 รอบส่งคัมบังค้าง</div>}
    {waiting.map(w => (
      <div key={w.line} onClick={goQueue}
        style={{
          ...card, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3,
          borderColor: w.color, borderLeft: `7px solid ${w.color}`,
          background: w.rank === 0 ? 'rgba(239,68,68,0.10)' : 'var(--card)',
        }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 14 * big, fontWeight: 900, color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {w.line}
          </span>
          <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 12 * big, fontWeight: 900, color: w.color, whiteSpace: 'nowrap' }}>
            {CASE[w.items[0].code].label}
          </span>
        </div>
        {w.items.slice(0, 3).map((it, i) => (
          <div key={i} style={{ fontSize: 11 * big, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {it.what ? `${it.what} · ` : ''}{it.detail}
          </div>
        ))}
        {w.items.length > 3 && (
          <div style={{ fontSize: 11 * big, color: 'var(--muted)' }}>+ อีก {w.items.length - 3} รายการ</div>
        )}
      </div>
    ))}

    {/* ══ ③ พาร์ทที่จะขาด — แถวเดียวต่อพาร์ท: รหัส/ชื่อ · เหลือ / Min ══ */}
    <div style={{ ...card, borderColor: short.rows.length ? '#facc15' : 'var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 12.5 * big, fontWeight: 900 }}>📉 พาร์ทที่จะขาด (ต่ำกว่า Min)</span>
        <span style={{ marginLeft: 'auto', fontSize: 12 * big, fontWeight: 900, color: short.rows.length ? '#facc15' : '#22c55e' }}>
          {short.rows.length}
        </span>
      </div>
      {!err && !short.rows.length && <div style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>✅ ทุกพาร์ทของส่วนงานนี้อยู่เหนือ Min</div>}
      {short.rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--muted)', fontWeight: 700, padding: '0 0 3px' }}>
          <span style={{ flex: 1 }}>พาร์ท</span><span style={{ width: 120, textAlign: 'right' }}>เหลือ / Min</span>
        </div>
      )}
      {short.rows.slice(0, SHORT_SHOW).map((r, i) => {
        const out = Number(r.qty_on_hand) <= 0;
        return (
          <div key={`${r.mat_no}-${i}`} onClick={() => navigate?.('/line-stock')}
            style={{ cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--border)' }}>
            {/* ครบ 3 ค่าผ่านของกลาง — รหัสไม่ถูกตัด ชื่อตัดได้ตัวเดียว */}
            <MatLabel mat={r.mat_no} name={r.part_name} size={12} style={{ minWidth: 0, flex: 1 }} />
            <span style={{ width: 120, flexShrink: 0, textAlign: 'right', fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: out ? '#ef4444' : '#facc15' }}>
              {out ? 'หมด' : fmtQty(r.qty_on_hand)}
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}> / {fmtQty(r.min_qty)}</span>
            </span>
          </div>
        );
      })}
      {short.rows.length > SHORT_SHOW && (
        <div onClick={() => navigate?.('/store-monitor')}
          style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--muted)', paddingTop: 5, borderTop: '1px solid var(--border)' }}>
          + อีก {short.rows.length - SHORT_SHOW} พาร์ท — ดูทั้งหมดที่เฝ้าระวังสต๊อก ›
        </div>
      )}
      {short.unbound > 0 && (
        <div onClick={() => navigate?.('/store-monitor')}
          style={{ cursor: 'pointer', fontSize: 11, color: 'var(--muted)', paddingTop: 5, borderTop: '1px solid var(--border)' }}>
          ℹ อีก {short.unbound} พาร์ททั้งโรงงานที่ต่ำกว่า Min แต่ชี้ส่วนงานไม่ได้ (มีของแค่ที่ STORE/คลัง FG) — ดูที่เฝ้าระวังสต๊อก ›
        </div>
      )}
    </div>

    {/* ══ ④ สั่งซื้อค้าง — นับรวมอย่างเดียว ห้ามโชว์รายใบ ══ */}
    {poPending.length > 0 && (
      <div onClick={goQueue} style={{ ...card, cursor: 'pointer', fontSize: 11.5 * big, color: 'var(--muted)' }}>
        🧾 สั่งซื้อค้าง (ยังไม่รับเข้า) <b style={{ color: 'var(--text)' }}>{poPending.length}</b> พาร์ท — ดูที่บอร์ดสโตร์ ›
      </div>
    )}
  </>);
}
