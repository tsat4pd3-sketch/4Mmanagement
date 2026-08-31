/* ══════════════════════════════════════════════════════════════════════════
   📦 การ์ดฝั่งสโตร์บนจอ TV — "ไลน์ไหนรอของอยู่ ต้องไปส่งที่ไหนก่อน"

   ที่มา (user 2026-08-28): *"สโตร์ก็ดูสถานะว่ามีงานต้องไปส่งให้ไลน์ผลิตไหนที่รอของอยู่"*

   ⚠️⚠️ อ่านวิว **`v_store_abnormal` (DR) ที่เดียว** — เงื่อนไขตรวจทั้ง 5 เคสอยู่ในวิวนั้น
        `/store-monitor` กับ edge `store-daily-scan` อ่านตัวเดียวกัน
        **ห้าม copy เงื่อนไขมาเขียนซ้ำที่นี่** (กฎเหล็กของบอร์ดสโตร์ · drift แน่นอน)

   เคสที่จอนี้สนใจ (เรียงตามความเร่งด่วนของ "งานที่ต้องไปส่ง"):
     C รอบส่งเลยเวลา  → ไลน์รออยู่จริง ต้องไปเดี๋ยวนี้        (แดง)
     D รับไม่ครบ      → ไลน์บอกว่าของไม่ครบ ต้องตามส่งเพิ่ม   (ส้ม)
     A ต่ำกว่า Min    → พาร์ทจะขาด (ระดับพาร์ท ไม่ผูกไลน์)     (เหลือง · การ์ดแยก)
     E สั่งซื้อค้าง   → ของยังไม่เข้า (ระดับพาร์ท)             (เทา · นับรวมบอก)
     B เกิน Max       → ไม่ใช่ "งานที่ต้องไปส่ง" → ไม่ขึ้นจอนี้ (ดูที่ /store-monitor)

   ⚠️ โหลดไม่สำเร็จ = ต้องขึ้นแถบแดง **ห้ามขึ้นจอเขียว "ไม่มีไลน์รอของ"**
      (กฎเดิมของ StoreMonitor — จอที่ยืนยันสิ่งที่ไม่จริง แย่กว่าจอที่ว่าง)
   ══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { visibleInterval } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };

/* สีต่อเคส — C ด่วนสุด (ไลน์รออยู่แล้วจริง) · D รองลงมา
   ⚠️ "งานค้างของสโตร์" ไม่ใช่ alarm เครื่องหยุด → **ห้ามกระพริบ** (กฎ Andon: กระพริบเฉพาะแดงของเครื่อง) */
const CASE = {
  C: { color: '#ef4444', rank: 0, label: 'เลยเวลาส่ง' },
  D: { color: '#f59e0b', rank: 1, label: 'รับไม่ครบ' },
};

export default function StoreWaitCards({ inScope, navigate, big = 1, onLineWait }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    /* จอ TV เปิดค้างทั้งวัน → ดึงเฉพาะเคสที่จอนี้ใช้ (กรองฝั่ง server ตามกฎ egress)
       วิวคืนหลักสิบแถวหลังยุบเคส E รายพาร์ทแล้ว จึงไม่ต้องแบ่งหน้า แต่ตั้งเพดานกันไว้ */
    const { data, error } = await supabaseDR.from('v_store_abnormal')
      .select('code, title, line_name, mat_no, part_name, detail, sev')
      .in('code', ['A', 'C', 'D', 'E'])
      .order('sev', { ascending: false }).order('code').limit(400);
    if (error) { setErr(error.message || 'โหลดไม่สำเร็จ'); return; }
    setErr(null);
    setRows(data || []);
  }, []);

  useEffect(() => {
    load();
    const stop = visibleInterval(load, RATE.ANALYTIC);   // สต๊อก/รอบส่งไม่ได้เปลี่ยนทุกนาที
    return () => stop();
  }, [load]);

  /* ── ไลน์ที่รอของอยู่ (เคส C/D) ────────────────────────────────────────────
     รวมหลายรอบของไลน์เดียวเป็นแถวเดียว — จอ TV ต้องอ่าน "ไลน์ไหน" ไม่ใช่ไล่รายรอบ */
  const waiting = useMemo(() => {
    const m = {};
    rows.filter(r => CASE[r.code] && r.line_name && (!inScope || inScope(r.line_name))).forEach(r => {
      const c = CASE[r.code];
      const g = (m[r.line_name] = m[r.line_name] || { line: r.line_name, rank: 9, color: '#6b7280', items: [] });
      g.items.push({ code: r.code, what: r.part_name || '', detail: r.detail || '' });
      if (c.rank < g.rank) { g.rank = c.rank; g.color = c.color; }
    });
    return Object.values(m).sort((a, b) => a.rank - b.rank || a.line.localeCompare(b.line));
  }, [rows, inScope]);

  /* พาร์ทที่จะขาด (A) / สั่งซื้อค้าง (E) — ระดับพาร์ท ไม่ผูกไลน์ → การ์ดแยก ห้ามยัดปนกับ "ไลน์รอของ" */
  const shortMats = useMemo(() => rows.filter(r => r.code === 'A'), [rows]);
  const poPending = useMemo(() => rows.filter(r => r.code === 'E'), [rows]);

  /* ยกสถานะขึ้นให้ผังระบายสี — ไลน์ที่รอของจะได้เห็นบนแผนที่ ไม่ใช่แค่ในลิสต์
     ⚠️ ส่งเป็น object ใหม่ทุกครั้งที่ผลเปลี่ยนจริงเท่านั้น (deps = waiting) กัน render loop */
  useEffect(() => {
    if (!onLineWait) return;
    const m = {};
    waiting.forEach(w => { m[w.line] = { color: w.color, label: CASE[w.items[0]?.code]?.label || 'รอของ' }; });
    onLineWait(m);
  }, [waiting, onLineWait]);

  return (<>
    {err && (
      <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: 12.5 }}>
        ⚠ ดึงสถานะสโตร์ไม่สำเร็จ — จอนี้ยังไม่ใช่ของจริง ({err})
      </div>
    )}

    <div style={{ fontSize: 13 * big, fontWeight: 900 }}>📦 ไลน์ที่รอของอยู่</div>

    {!err && !waiting.length && (
      <div style={{ ...card, textAlign: 'center', padding: 22, fontSize: 13 * big, fontWeight: 800, color: '#22c55e' }}>
        ✅ ไม่มีไลน์ไหนรอของ
      </div>
    )}

    {waiting.map(w => (
      <div key={w.line} onClick={() => navigate?.('/heijunka')}
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
          <div key={i} style={{ fontSize: 10.5 * big, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {it.what ? `${it.what} · ` : ''}{it.detail}
          </div>
        ))}
        {w.items.length > 3 && (
          <div style={{ fontSize: 10 * big, color: 'var(--muted)' }}>+ อีก {w.items.length - 3} รายการ</div>
        )}
      </div>
    ))}

    {/* พาร์ทที่จะขาด — ยังไม่ถึงขั้น "ไลน์รออยู่" แต่สโตร์ต้องเตรียมก่อน */}
    <div style={{ ...card, borderColor: shortMats.length ? '#facc15' : 'var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 }}>
        <span style={{ fontSize: 12.5 * big, fontWeight: 900 }}>📉 พาร์ทที่จะขาด (ต่ำกว่า Min)</span>
        <span style={{ marginLeft: 'auto', fontSize: 11 * big, fontWeight: 800, color: shortMats.length ? '#facc15' : '#22c55e' }}>
          {shortMats.length}
        </span>
      </div>
      {!shortMats.length && <div style={{ fontSize: 11.5 * big, color: '#22c55e', fontWeight: 700 }}>✅ ทุกพาร์ทอยู่เหนือ Min</div>}
      {shortMats.slice(0, 6).map((r, i) => (
        <div key={`${r.mat_no}-${i}`} onClick={() => navigate?.('/line-stock')}
          style={{ cursor: 'pointer', display: 'flex', gap: 8, padding: '4px 0', borderTop: '1px solid var(--border)', fontSize: 10.5 * big }}>
          <b style={{ color: 'var(--text)', flexShrink: 0 }}>{r.mat_no}</b>
          <span style={{ color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.part_name || ''}
          </span>
        </div>
      ))}
      {shortMats.length > 6 && (
        <div onClick={() => navigate?.('/store-monitor')}
          style={{ cursor: 'pointer', fontSize: 10.5 * big, color: 'var(--muted)', paddingTop: 5, borderTop: '1px solid var(--border)' }}>
          + อีก {shortMats.length - 6} พาร์ท — ดูทั้งหมดที่เฝ้าระวังสต๊อก ›
        </div>
      )}
    </div>

    {/* ⚠️ นับรวมอย่างเดียว ห้ามโชว์รายใบ — ทริกเกอร์ออกใบสั่งซื้อทีละล็อต (เคยได้ 2,336 ใบ)
        กฎเหล็กบอร์ดสโตร์: คิวที่ระบบออกใบอัตโนมัติ ต้องรวมยอดรายพาร์ท */}
    {poPending.length > 0 && (
      <div onClick={() => navigate?.('/heijunka')} style={{ ...card, cursor: 'pointer', fontSize: 11.5 * big, color: 'var(--muted)' }}>
        🧾 สั่งซื้อค้าง (ยังไม่รับเข้า) <b style={{ color: 'var(--text)' }}>{poPending.length}</b> พาร์ท — ดูที่บอร์ดสโตร์ ›
      </div>
    )}
  </>);
}
