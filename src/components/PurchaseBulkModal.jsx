import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';

/* ═══ 🛒 สั่งซื้อ/รับเข้า "รวมยอดทั้งพาร์ท" — คิวจัดซื้อ ═══════════════════════════
   ที่มา: `fn_explode_child_demand` ออกใบ **1 ใบต่อ 1 ล็อต** (เพดาน 50 ใบ/การปิดออเดอร์)
   ⇒ คิวจริง 2,211 ใบ = แค่ ~25 พาร์ท · ตัวอย่าง 30045438 = **384 ใบ** ของพาร์ทเดียว
   เลื่อนสถานะทีละใบ = ใช้งานจริงไม่ได้ (กด 384 ครั้ง)

   ⚠️⚠️ กฎเหล็ก 3 ข้อของตัวนี้ (ห้ามลัด):

   1) **ต้องดึงใบจริงมาก่อนเสมอ ห้ามเดา qty จาก min/max ของวิว**
      `50031601` มีตั้งแต่ 100 ถึง 1,000 ชิ้น/ใบ — เดาแล้วโพสต์สต็อกผิดทันที

   2) **ปลายทางต้องยึด `dest_line` ของ "ใบจริงที่อัปเดตสำเร็จ" ไม่ใช่ที่การ์ดโชว์**
      วิว group ด้วย (mat_no, status) แล้วเอา `min(dest_line)` มาโชว์ — วัดจริง 2026-09-02:
      **8 จาก 25 กลุ่มมีหลายปลายทาง** (50031601 → 5 ไลน์ · 30045438 → 3 ไลน์)
      ยึดไลน์บนการ์ดโพสต์ทีเดียว = ของเข้าไลน์เดียวทั้งที่ใบกระจายไป 3-5 ไลน์

   3) **โพสต์สต็อกจากยอดที่อัปเดต "สำเร็จจริง" เท่านั้น**
      update ใช้ compare-and-swap (`.eq('status', prev)`) — ใบที่คนอื่นเลื่อนไปแล้ว/ยกเลิกแล้ว
      จะไม่ถูกแตะ · ถ้าเอายอดที่ "ตั้งใจจะเลื่อน" ไปโพสต์ = สต็อกเกินจริง

   📦 ledger: รับเข้าหลายใบ → **1 แถวต่อ 1 ปลายทาง** ไม่ใช่ 1 แถวต่อ 1 ใบ
      (384 ใบ = 384 แถว ทั้งที่ไม่มีคอลัมน์ผูกกลับใบเลย → แยกแถวไม่ได้ traceability เพิ่มเลย
       ตัวใบเองมี received_by/received_at เป็นหลักฐานอยู่แล้ว · note เขียนกำกับว่ารวมกี่ใบ)
   ═══════════════════════════════════════════════════════════════════════════════ */

const IN_CHUNK = 120;                       // กฎโปรเจค: .in() แบ่งก้อนละ 120 กัน URL ยาวเกิน
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function PurchaseBulkModal({ group, next, nextLabel, fullName, workDate, onClose, onDone }) {
  const [slips, setSlips]   = useState(null);   // null = ยังโหลด
  const [err, setErr]       = useState('');
  const [take, setTake]     = useState('');     // จำนวนใบที่จะเลื่อน (ว่าง = ทั้งหมด)
  const [busy, setBusy]     = useState(false);

  const mat = group?.mat_no;
  const prev = group?.status;

  /* ดึงใบจริงทั้งกลุ่ม (mat_no + status = คีย์เดียวกับวิว) เรียงเก่าสุดก่อน
     — เก่าก่อนคือลำดับที่ควรได้ของก่อน และตรงกับ first_id ที่ปุ่มทีละใบใช้ */
  const load = useCallback(async () => {
    if (!mat || !prev) return;
    setErr(''); setSlips(null);
    const rows = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabaseDR.from('purchase_requests')
        .select('id, qty, dest_line, supplier, part_name, work_date, status')
        .eq('mat_no', mat).eq('status', prev)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .range(from, from + 999);
      if (error) { setErr(error.message); setSlips([]); return; }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
    setSlips(rows);
  }, [mat, prev]);

  useEffect(() => { load(); }, [load]);

  const n = useMemo(() => {
    if (!slips) return 0;
    const want = take === '' ? slips.length : Math.floor(Number(take) || 0);
    return Math.max(0, Math.min(slips.length, want));
  }, [take, slips]);

  const picked = useMemo(() => (slips || []).slice(0, n), [slips, n]);

  /* แยกตามปลายทางจริง — ตัวเลขนี้คือสิ่งที่จะถูกโพสต์เข้าคลัง (ถ้าเป็นขั้นรับเข้า) */
  const byDest = useMemo(() => {
    const m = new Map();
    picked.forEach(s => {
      const k = s.dest_line || '';
      const cur = m.get(k) || { dest: k, slips: 0, qty: 0 };
      cur.slips += 1; cur.qty += Number(s.qty) || 0;
      m.set(k, cur);
    });
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  }, [picked]);

  const pickedQty = useMemo(() => picked.reduce((s, r) => s + (Number(r.qty) || 0), 0), [picked]);
  const noDest    = byDest.find(d => !d.dest);

  const run = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      const patch = { status: next };
      const now = new Date().toISOString();
      if (next === 'ordered')  { patch.ordered_by  = fullName || 'จัดซื้อ'; patch.ordered_at  = now; }
      if (next === 'received') { patch.received_by = fullName || 'สโตร์';   patch.received_at = now; }

      /* compare-and-swap แบบเป็นก้อน — เลื่อนได้เฉพาะใบที่ยังอยู่สถานะเดิมที่เราเห็นตอนกด
         คืน id + qty + dest_line ของ "ใบที่ขยับจริง" มาใช้โพสต์สต็อก (ห้ามใช้ยอดที่ตั้งใจ) */
      const done = [];
      const ids = picked.map(s => s.id);
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const part = ids.slice(i, i + IN_CHUNK);
        const { data, error } = await supabaseDR.from('purchase_requests')
          .update(patch).in('id', part).eq('status', prev)
          .select('id, qty, dest_line, part_name, work_date');
        if (error) throw error;
        done.push(...(data || []));
      }

      if (!done.length) {
        toast.error('ไม่มีใบไหนถูกเลื่อน — อาจถูกคนอื่นเลื่อน/ยกเลิกไปแล้ว');
        await onDone?.(); onClose?.(); return;
      }

      let stockErr = '';
      let posted = 0, skipped = 0;
      if (next === 'received') {
        /* 1 แถวต่อ 1 ปลายทาง — ยึด dest_line ของใบจริง ไม่ใช่ของการ์ด (กฎข้อ 2) */
        const g = new Map();
        done.forEach(r => {
          const k = r.dest_line || '';
          const cur = g.get(k) || { dest: k, qty: 0, slips: 0, name: r.part_name, wd: r.work_date };
          cur.qty += Number(r.qty) || 0; cur.slips += 1;
          g.set(k, cur);
        });
        const rows = [];
        g.forEach(v => {
          if (!v.dest) { skipped += v.slips; return; }   // ไม่รู้ปลายทาง = เติมสต็อกไม่ได้
          posted += v.slips;
          rows.push({
            line_name: v.dest, mat_no: mat, part_name: v.name || group.part_name, qty: v.qty,
            type: 'issue', work_date: v.wd || workDate,
            note: `รับของซื้อเข้าสโตร์ · รวม ${v.slips} ใบ${group.supplier ? ' · ' + group.supplier : ''}`,
            created_by: fullName || 'สโตร์',
          });
        });
        if (rows.length) {
          const { error } = await supabaseDR.from('line_stock_transactions').insert(rows);
          if (error) stockErr = error.message;
        }
      }

      /* รายงานผลตามจริง — สำเร็จไม่ครบ/สต็อกไม่ถูกเติม ห้ามขึ้น toast เขียวเฉยๆ */
      const short = done.length < picked.length;
      if (stockErr) {
        toast.error(`เลื่อนสถานะ ${done.length} ใบแล้ว แต่บันทึกรับเข้าคลังไม่สำเร็จ — ${stockErr} · ไปบันทึกเองที่ Line Stock`);
      } else if (next === 'received' && skipped > 0) {
        toast.error(`รับเข้า ${done.length} ใบแล้ว · ${skipped} ใบไม่ได้ระบุปลายทางสโตร์ สต็อกส่วนนั้นยังไม่ถูกเติม (เติมแล้ว ${posted} ใบ)`);
      } else if (short) {
        toast.error(`เลื่อนได้ ${done.length} จาก ${picked.length} ใบ — ที่เหลือถูกคนอื่นเลื่อน/ยกเลิกไปแล้ว`);
      } else {
        toast.success(next === 'ordered'
          ? `🛒 บันทึกสั่งซื้อ ${mat} · ${done.length} ใบ รวม ${fmt(done.reduce((s, r) => s + (Number(r.qty) || 0), 0))} ชิ้น`
          : `✅ รับเข้าสโตร์ ${mat} · ${done.length} ใบ รวม ${fmt(done.reduce((s, r) => s + (Number(r.qty) || 0), 0))} ชิ้น`);
      }
      await onDone?.();
      onClose?.();
    } catch (e) {
      toast.error(e.message || String(e));
    } finally { setBusy(false); }
  };

  const box = { background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 10, padding: '10px 12px' };

  return (
    /* ⚠️ ไม่ปิดจากการคลิกพื้นหลัง — กรอกจำนวนค้างแล้วเผลอแตะข้างนอกไม่ควรหาย */
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 14,
        width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: 18 }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>🛒 {nextLabel} — รวมยอดทั้งพาร์ท</span>
          <button onClick={onClose} disabled={busy}
            style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px', borderRadius: 7, cursor: busy ? 'not-allowed' : 'pointer',
              background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', fontFamily: 'var(--font-body)' }}>✕</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 12 }}>
          <b style={{ color: 'var(--text)' }}>{mat}</b> · {group.part_name || '—'}
          {group.supplier && <> · 🏢 {group.supplier}</>}
        </div>

        {slips === null && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>กำลังอ่านใบจริง…</div>}

        {err && (
          <div style={{ ...box, borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.07)', color: '#ef4444', fontSize: 12 }}>
            🔴 อ่านใบสั่งซื้อไม่สำเร็จ — {err}
          </div>
        )}

        {slips && !err && (slips.length === 0 ? (
          <div style={{ ...box, fontSize: 12.5, color: 'var(--muted)' }}>
            ไม่มีใบที่สถานะนี้แล้ว — อาจถูกเลื่อน/ยกเลิกไปก่อนหน้า
          </div>
        ) : (<>
          <div style={{ ...box, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>เลื่อนกี่ใบ</span>
              <input type="number" min={1} max={slips.length} value={take}
                onChange={e => setTake(e.target.value)} placeholder={String(slips.length)} disabled={busy}
                style={{ width: 110, padding: '5px 9px', fontSize: 13, borderRadius: 7,
                  background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border2)' }} />
              <button onClick={() => setTake('')} disabled={busy}
                style={{ fontSize: 11.5, fontWeight: 700, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
                  background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', fontFamily: 'var(--font-body)' }}>
                ทั้งหมด ({fmt(slips.length)})
              </button>
            </div>
            {/* ⭐ ยอดจริงจากใบที่จะเลื่อน ไม่ใช่ค่าประมาณจาก min/max */}
            <div style={{ fontSize: 13, marginTop: 8, color: 'var(--text)' }}>
              จะเลื่อน <b style={{ color: 'var(--accent)' }}>{fmt(n)}</b> ใบ · รวม{' '}
              <b style={{ color: 'var(--accent)' }}>{fmt(pickedQty)}</b> ชิ้น
              <span style={{ color: 'var(--muted)', fontSize: 11.5 }}> (นับจากใบจริง เรียงเก่าสุดก่อน)</span>
            </div>
            {n < slips.length && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                เหลือค้างในคิว {fmt(slips.length - n)} ใบ · {fmt(slips.reduce((s, r) => s + (Number(r.qty) || 0), 0) - pickedQty)} ชิ้น
              </div>
            )}
          </div>

          {/* ปลายทางจริง — กลุ่มนี้อาจกระจายหลายไลน์ทั้งที่การ์ดโชว์ไลน์เดียว */}
          <div style={{ ...box, marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>
              📍 ปลายทางของใบที่จะเลื่อน ({byDest.length} แห่ง)
              {next === 'received' && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> — สต็อกจะถูกเติมแยกตามนี้</span>}
            </div>
            {byDest.map(d => (
              <div key={d.dest || '_none'} style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '3px 0',
                color: d.dest ? 'var(--text)' : '#f59e0b' }}>
                <span style={{ flex: 1 }}>{d.dest || '⚠ ไม่ได้ระบุปลายทาง'}</span>
                <span style={{ color: 'var(--muted)' }}>{fmt(d.slips)} ใบ</span>
                <span style={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>{fmt(d.qty)} ชิ้น</span>
              </div>
            ))}
          </div>

          {noDest && next === 'received' && (
            <div style={{ ...box, borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.07)',
              fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
              ⚠️ <b style={{ color: '#f59e0b' }}>{fmt(noDest.slips)} ใบ ไม่ได้ระบุปลายทางสโตร์</b> — ใบจะถูกเลื่อนเป็นรับเข้า
              แต่ <b>สต็อกส่วนนั้น ({fmt(noDest.qty)} ชิ้น) จะไม่ถูกเติม</b> ต้องไปบันทึกรับเข้าเองที่ 📦 Line Stock
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} disabled={busy}
              style={{ fontSize: 12.5, fontWeight: 700, padding: '8px 14px', borderRadius: 8, cursor: busy ? 'not-allowed' : 'pointer',
                background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border2)', fontFamily: 'var(--font-body)' }}>ยกเลิก</button>
            <button onClick={run} disabled={busy || !n}
              style={{ fontSize: 12.5, fontWeight: 800, padding: '8px 16px', borderRadius: 8,
                cursor: busy || !n ? 'not-allowed' : 'pointer', opacity: busy || !n ? 0.6 : 1,
                background: 'var(--accent)', color: '#08130a', border: '1px solid var(--accent)', fontFamily: 'var(--font-body)' }}>
              {busy ? 'กำลังบันทึก…' : `${nextLabel} ${fmt(n)} ใบ`}
            </button>
          </div>
        </>))}
      </div>
    </div>
  );
}
