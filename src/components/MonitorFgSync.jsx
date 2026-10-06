import { useState, useCallback, useEffect } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import { fetchAllPages } from '../utils/fetchByIds';
import { DEMAND_SKIP_STATUS } from '../utils/monitorSystem';
import { ROW_PRESETS, BOARD_DEFAULTS, boardKeyOfSheet, partRowKey, dedupeByKey } from '../utils/monitorBoards';
import { getWorkDate } from '../utils/workDate';

/* ══ 📦 MonitorFgSync — สร้าง/อัพเดทบอร์ด "FG ทุกตัว" จากออเดอร์ลูกค้า (2026-10-06) ═══════
   คำขอ user: *"อยากไห้มอนิเตอร์ได้ทุก product FG ก็ได้ด้วยที่อัพจาก 862 830"*

   ต่างจาก `MonitorImport` ตรงที่**ไม่มีไฟล์** — พาร์ทมาจาก `customer_shipping_orders`
   (EDI 862 Shipping Schedule / 830 Planning Schedule ที่ทีมวางแผนนำเข้าทุกวัน)
   ⇒ FG ตัวไหนลูกค้าสั่งจริง ตัวนั้นได้ขึ้นบอร์ดเอง ไม่ต้องรอใครพิมพ์เข้าไฟล์ Excel

   🔴 กติกาที่ยกมาจากตัวนำเข้า Excel (เหตุผลเดียวกัน):
   1. **ดูก่อนเขียนเสมอ** — ขึ้นสรุปว่าจะสร้างบอร์ดไหน เพิ่มพาร์ทกี่ตัว ต้องกดยืนยันอีกที
   2. **รันซ้ำ = อัพเดทของเดิม ไม่สร้างซ้ำ** (คีย์บอร์ดมาจากชื่อลูกค้า)
   3. **เพิ่มอย่างเดียว ไม่ลบ** — ลูกค้าหยุดสั่งพาร์ทหนึ่งชั่วคราว ไม่ได้แปลว่าเลิกทำ
      พาร์ทที่หายจากออเดอร์จึง**คงอยู่บนบอร์ด** ให้คนตัดสินใจปิดเอง
   4. **ไม่แตะตารางออเดอร์เลย** — อ่านอย่างเดียว ⇒ สร้างผิดก็ลบบอร์ดทิ้งได้ ไม่กระทบยอดลูกค้า

   ⚠️ ไม่ยัดยอดลงช่อง — ยอดลูกค้าสั่ง/ผลิตเข้า เป็นแถว `system` ที่ `Monitoring.jsx` อ่านสด
      เก็บเป็นช่องด้วย = มี 2 แหล่งความจริง แล้ววันที่ลูกค้าแก้ยอด บอร์ดถือของเก่า
   ═══════════════════════════════════════════════════════════════════════════════════════ */

const CHUNK = 400;
const FS = 12;
const fmt = (n) => Number(n || 0).toLocaleString();
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 };

/** ย้อนหลังกี่วันถึงนับว่า "ลูกค้ายังสั่งอยู่" — 90 วันครอบ 1 ไตรมาส (พาร์ทตามฤดูไม่หลุด) */
const BACK_DAYS = 90;

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00+07:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export default function MonitorFgSync({ onClose, fullName, onSynced }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');

  const scan = useCallback(async () => {
    setBusy(true); setErr(''); setPreview(null);
    const today = getWorkDate();
    const from = addDays(today, -BACK_DAYS);
    const [ordR, bR] = await Promise.all([
      fetchAllPages(() => supabaseDR.from('customer_shipping_orders')
        .select('customer, mat_no, part_name, customer_part_no, status, due_date')
        .gte('due_date', from), { orderBy: ['customer', 'mat_no'] }),
      fetchAllPages(() => supabaseDR.from('monitor_boards')
        .select('id, board_key, customer, kind').eq('kind', 'fg'), { orderBy: ['board_key'] }),
    ]);
    if (ordR.error) { setErr(`อ่านออเดอร์ลูกค้าไม่สำเร็จ: ${ordR.error}`); setBusy(false); return; }
    if (bR.error) { setErr(`อ่านบอร์ดเดิมไม่สำเร็จ: ${bR.error}`); setBusy(false); return; }

    const boardOf = new Map((bR.rows || []).map(b => [String(b.customer || '').trim(), b]));
    /* พาร์ทที่อยู่บนบอร์ด FG เดิมแล้ว — ต้องรู้ก่อน ไม่งั้นนับ "เพิ่มใหม่" เกินจริง */
    const ids = (bR.rows || []).map(b => b.id);
    let have = new Set();
    if (ids.length) {
      const pR = await fetchAllPages(() => supabaseDR.from('monitor_board_parts')
        .select('board_id, mat_no').in('board_id', ids), { orderBy: ['board_id'] });
      if (pR.error) { setErr(`อ่านพาร์ทบนบอร์ดเดิมไม่สำเร็จ: ${pR.error}`); setBusy(false); return; }
      have = new Set((pR.rows || []).map(r => `${r.board_id}|${String(r.mat_no || '').trim()}`));
    }

    const byCust = new Map();
    let noCustomer = 0;
    let noMat = 0;
    for (const r of ordR.rows || []) {
      if (DEMAND_SKIP_STATUS.includes(String(r.status || ''))) continue;
      const mat = String(r.mat_no || '').trim();
      if (!mat) { noMat++; continue; }
      const cust = String(r.customer || '').trim();
      /* 🔴 ออเดอร์ที่ไม่ระบุลูกค้า ผูกบอร์ดไม่ได้ (บอร์ด FG = 1 ลูกค้า) — ต้องเขียนบนจอ ห้ามทิ้งเงียบ */
      if (!cust) { noCustomer++; continue; }
      if (!byCust.has(cust)) byCust.set(cust, new Map());
      const m = byCust.get(cust);
      if (!m.has(mat)) {
        m.set(mat, {
          mat_no: mat,
          part_no: String(r.customer_part_no || '').trim() || null,
          part_name: String(r.part_name || '').trim() || null,
          rows: 0,
        });
      }
      m.get(mat).rows++;
    }

    const groups = [...byCust.entries()]
      .map(([customer, m]) => {
        const b = boardOf.get(customer) || null;
        const mats = [...m.values()].sort((x, y) => y.rows - x.rows);
        const fresh = b ? mats.filter(x => !have.has(`${b.id}|${x.mat_no}`)) : mats;
        return { customer, board: b, mats, fresh, orderRows: mats.reduce((s, x) => s + x.rows, 0) };
      })
      .sort((a, b2) => b2.fresh.length - a.fresh.length || b2.orderRows - a.orderRows);

    setPreview({ groups, from, today, noCustomer, noMat });
    setBusy(false);
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const apply = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    let boardsN = 0;
    let partsN = 0;
    try {
      for (const g of preview.groups) {
        if (!g.mats.length) continue;
        const def = BOARD_DEFAULTS.fg;
        const bRes = await supabaseDR.from('monitor_boards').upsert({
          board_key: boardKeyOfSheet('fg', g.customer),
          name: g.customer,
          kind: 'fg',
          customer: g.customer,
          line_name: null,
          period_kind: def.period_kind,
          period_count: def.period_count,
          /* เริ่มที่ "วันนี้" ทุกครั้งที่ซิงก์ — บอร์ดมองไปข้างหน้า 33 วัน
             (ช่องที่กรอกไว้ผูกกับ "วันที่จริง" ไม่ใช่ลำดับคอลัมน์ ⇒ เลื่อนกรอบแล้วค่าไม่หลุด) */
          start_date: preview.today,
          rows: ROW_PRESETS.fg,
          sl_row: def.sl_row,
          sl_includes_seed: def.sl_includes_seed,
          is_active: true,
          updated_by_name: fullName || null,
        }, { onConflict: 'board_key' }).select('id').single();
        if (!checkWrite(bRes, `บอร์ด FG ของ ${g.customer}`)) { setBusy(false); return; }
        const boardId = bRes.data?.id;
        if (!boardId) { toast.error(`สร้างบอร์ด ${g.customer} ไม่สำเร็จ — ไม่มีสิทธิ์เขียน`); setBusy(false); return; }
        boardsN++;

        const rowsRaw = g.mats.map(x => ({
          board_id: boardId,
          mat_no: x.mat_no,
          part_no: x.part_no,
          part_name: x.part_name,
          row_key: partRowKey(x.mat_no, x.part_no),
          is_active: true,
          updated_by_name: fullName || null,
        }));
        /* ลูกค้าเดียวกันอาจส่งเลขพาร์ทของตัวเองมาไม่ตรงกันระหว่างใบ ⇒ กันคีย์ซ้ำในก้อนเดียว */
        const d = dedupeByKey(rowsRaw, (r) => r.row_key);
        const rows = d.rows.map((r, i) => ({ ...r, sort_order: i }));
        for (let i = 0; i < rows.length; i += CHUNK) {
          const res = await supabaseDR.from('monitor_board_parts')
            .upsert(rows.slice(i, i + CHUNK), { onConflict: 'board_id,row_key' });
          if (!checkWrite(res, `พาร์ท FG ของ ${g.customer}`)) { setBusy(false); return; }
        }
        partsN += rows.length;
      }
      toast.success(`ซิงก์แล้ว — ${boardsN} บอร์ด · ${fmt(partsN)} พาร์ท`);
      onSynced?.();
      onClose?.();
    } catch (e) {
      toast.error(`ซิงก์ไม่สำเร็จ: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [preview, fullName, onSynced, onClose]);

  const totFresh = preview ? preview.groups.reduce((s, g) => s + g.fresh.length, 0) : 0;
  const totMats = preview ? preview.groups.reduce((s, g) => s + g.mats.length, 0) : 0;

  return (
    /* ⚠️ ไม่ปิดจากการคลิกพื้นหลัง (UI-CONVENTIONS §5) — ปิดด้วยปุ่มเท่านั้น */
    <div className="overlay">
      <div className="modal" style={{ maxWidth: 760, width: 'min(96vw, 760px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font-display)' }}>
            📦 สร้างบอร์ด FG จากออเดอร์ลูกค้า (EDI 862/830)
          </h3>
          <button type="button" onClick={onClose} aria-label="ปิด"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {err ? <div style={{ ...card, borderColor: '#ef4444', color: '#ef4444', fontSize: FS + 1 }}>🔴 {err}</div> : null}

        {busy && !preview ? (
          <div style={{ ...card, fontSize: FS + 1, color: 'var(--muted)' }}>กำลังอ่านออเดอร์ลูกค้า…</div>
        ) : null}

        {preview ? (
          <>
            <div style={{ ...card, fontSize: FS + 0.5, lineHeight: 1.8, marginBottom: 10 }}>
              อ่านออเดอร์ที่มีวันส่งตั้งแต่ <b>{preview.from}</b> ถึงปัจจุบันขึ้นไป ({BACK_DAYS} วันย้อนหลัง)
              — เจอ FG <b>{fmt(totMats)}</b> พาร์ท / <b>{preview.groups.length}</b> ลูกค้า
              {' · '}จะเพิ่มขึ้นบอร์ดใหม่ <b style={{ color: 'var(--accent)' }}>{fmt(totFresh)}</b> พาร์ท
              <div style={{ color: 'var(--muted)', fontSize: FS }}>
                เพิ่มอย่างเดียว ไม่ลบของเดิม · ยอดลูกค้าสั่ง/ผลิตเข้า ระบบอ่านสดทุกครั้ง ไม่ได้ก๊อปมาเก็บ
              </div>
              {(preview.noCustomer || preview.noMat) ? (
                <div style={{ color: 'var(--accent2)', marginTop: 4 }}>
                  ⚠️ ข้ามไป
                  {preview.noCustomer ? ` ${fmt(preview.noCustomer)} แถวที่ไม่ระบุลูกค้า (ผูกบอร์ดไม่ได้)` : ''}
                  {preview.noCustomer && preview.noMat ? ' ·' : ''}
                  {preview.noMat ? ` ${fmt(preview.noMat)} แถวที่ไม่มีเลข MAT` : ''}
                </div>
              ) : null}
            </div>

            <div style={{ maxHeight: '46vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {preview.groups.map(g => (
                <div key={g.customer} style={{ ...card, padding: '9px 12px', fontSize: FS + 0.5 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <b>{g.customer}</b>
                    <span style={{ color: 'var(--muted)' }}>{fmt(g.mats.length)} พาร์ท · ออเดอร์ {fmt(g.orderRows)} แถว</span>
                    <span style={{ marginLeft: 'auto', fontWeight: 800, color: g.fresh.length ? 'var(--accent)' : 'var(--muted)' }}>
                      {g.board ? (g.fresh.length ? `+${fmt(g.fresh.length)} พาร์ทใหม่` : 'ครบแล้ว') : '🆕 บอร์ดใหม่'}
                    </span>
                  </div>
                  {g.fresh.length ? (
                    <div style={{ color: 'var(--muted)', fontSize: FS, marginTop: 2 }}>
                      {g.fresh.slice(0, 8).map(x => x.mat_no).join(' · ')}
                      {g.fresh.length > 8 ? ` … อีก ${g.fresh.length - 8}` : ''}
                    </div>
                  ) : null}
                </div>
              ))}
              {!preview.groups.length ? (
                <div style={{ ...card, fontSize: FS + 1, color: 'var(--muted)' }}>
                  ไม่พบออเดอร์ลูกค้าในช่วงนี้ — นำเข้าไฟล์ 862/830 ที่หน้า Customer Demand ก่อน
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" onClick={onClose} disabled={busy}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer' }}>
                ยกเลิก
              </button>
              <button type="button" onClick={apply} disabled={busy || !preview.groups.length}
                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', fontWeight: 800, fontSize: 13,
                  background: busy || !preview.groups.length ? 'var(--bg3)' : 'var(--accent)',
                  color: busy || !preview.groups.length ? 'var(--muted)' : 'var(--accent-ink)',
                  cursor: busy || !preview.groups.length ? 'default' : 'pointer' }}>
                {busy ? 'กำลังซิงก์…' : '📦 สร้าง/อัพเดทบอร์ด'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
