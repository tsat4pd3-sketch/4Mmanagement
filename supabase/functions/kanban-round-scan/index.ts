// ⏰ kanban-round-scan — แจ้งสโตร์ตอน "รอบจัดส่งตัดยอดแล้ว ไปเตรียมของ"  (DR project · pg_cron ทุก 10 นาที)
//
// ที่มา (user 2026-08-26): หลัง seed รอบ 3 รอบ/วัน แล้วถามว่า "ผลิตสแกนเปิดออเดอร์ → แตก BOM
//   → สะสมเข้ารอบ → แจ้งสโตร์ ใช่มั้ย" — ตอนนั้น 3 ขั้นแรกจริง แต่ **ขั้นแจ้งไม่มีเลย**
//   notification_rules หมวด logistic มี 8 เรื่อง ไม่มีเรื่องรอบจัดส่งเข้าไลน์สักเรื่อง
//   ⇒ สโตร์ต้องเปิดหน้า /heijunka ดูเอง · ไม่เปิด = ไม่มีใครรู้ว่าถึงเวลาจัดของ
//
// ⚠️ เงื่อนไข "รอบไหนถึงเวลาแจ้ง" อยู่ในวิว `v_kanban_round_due` ที่เดียว
//    (หน้าต่างตัดยอด · กรอบวันงาน 08:00→08:00 · กันแจ้งซ้ำ) — ห้าม copy มาเขียนซ้ำในไฟล์นี้
//
// ⚠️⚠️ ตัวเลขที่แจ้งเป็น **gross (ยังไม่หักของที่มีในไลน์)** โดยตั้งใจ
//    การหักสต็อกแบบ FIFO ข้ามรอบ (gross → net → จำนวนการ์ด) อยู่ใน `view` memo ของ HeijunkaKanban
//    ถ้า copy สูตรนั้นมาไว้ที่นี่ = มี 2 ก๊อปที่ drift กันแน่นอน แล้วสโตร์จะได้ตัวเลขที่ขัดกับหน้าจอ
//    **ตัวเลขผิดแย่กว่าไม่มีตัวเลข** → แจ้งเฉพาะสิ่งที่คำนวณถูกแน่ (ใบผลิต/พาร์ท/ยอดรวม)
//    แล้วชี้ให้ไปดูรายการหยิบจริงที่ Store Time Chart
//
// ⚠️ ส่งข้อความเดียวต่อรอบการสแกน ไม่ยิงทีละรอบจัดส่ง — cutoff ของทุกไลน์ตรงกัน (08:30/12:00/15:00)
//    ยิงทีละรอบ = 10 ข้อความพร้อมกัน (บทเรียนจาก shipping_phase_alert 592 ครั้งใน 4 วันจนไม่มีใครอ่าน)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Main project — เจ้าของ production_lines (ผังไลน์แม่-ลูก) + ตัวส่งแจ้งเตือน
const MAIN_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co';
const MAIN_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aGRmcXdmd29maXZvanRzaXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODA5NjYsImV4cCI6MjA5MjQ1Njk2Nn0.mGrLjRFmtNtpyAu3aBduKqixyb3AjQDCid06qpBzrxw';
const NOTIFY_URL = `${MAIN_URL}/functions/v1/send-event-notification`;

const num = (v: unknown) => Number(v) || 0;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const hhmm = (t: unknown) => String(t ?? '').slice(0, 5) || '—';

type Row = Record<string, any>;

/** ดึงแบบแบ่งหน้า — วันที่ผลิตหนักๆ ใบผลิตทะลุ 1000 แถวได้ ตัดเงียบไม่ได้ */
async function page(build: (from: number, to: number) => any, cap = 5000): Promise<Row[]> {
  const SIZE = 1000, out: Row[] = [];
  for (let from = 0; from < cap; from += SIZE) {
    const { data, error } = await build(from, from + SIZE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < SIZE) break;
  }
  return out;
}

Deno.serve(async () => {
  try {
    const { data: due, error: dueErr } = await db.from('v_kanban_round_due').select('*');
    if (dueErr) throw dueErr;
    if (!due?.length) return json({ ok: true, due: 0 });

    const workDate: string = due[0].work_date;

    // ── ผังไลน์แม่-ลูก อยู่ Main (join ข้าม project ในวิวไม่ได้ จึงมารวมที่นี่) ──
    // รอบจัดส่ง seed ไว้ที่ "ไลน์บนสุด" แต่กะเปิดที่ไลน์ลูก → ต้อง map ลูก→แม่ก่อนจับคู่
    //
    // ⚠️⚠️ อ่านผ่าน RPC `line_parent_map()` (SECURITY DEFINER เปิดให้ anon) ไม่ใช่อ่านตารางตรง
    //    ตารางฝั่ง Main เป็น RLS ของ authenticated → anon อ่านได้ `[]` **โดยไม่มี error**
    //    ปล่อยผ่าน = groupOf() ตกเป็น identity → ใบผลิตบนไลน์ลูกไม่มีวันจับคู่รอบบนไลน์แม่
    //    → รายงาน "0 พาร์ท" ทุกวันเงียบๆ (เกิดจริง 27/08 08:30 — 32 ใบในหน้าต่าง แต่จับได้ 0)
    const main = createClient(MAIN_URL, MAIN_ANON);
    let lines: Row[] | null = null;
    const { data: rpcLines, error: rpcErr } = await main.rpc('line_parent_map');
    if (rpcErr) console.warn('kanban-round-scan: line_parent_map() ใช้ไม่ได้ —', rpcErr.message);
    if (rpcLines?.length) lines = rpcLines;
    if (!lines) {   // ยังไม่ apply migration → ลองอ่านตารางตรง (เผื่อ RLS เปิดให้ anon อยู่แล้ว)
      const { data, error } = await main.from('production_lines').select('name, parent_line_name');
      if (error) console.warn('kanban-round-scan: อ่าน production_lines ตรงไม่ได้ —', error.message);
      if (data?.length) lines = data;
    }
    // ผังไลน์ว่าง = "อ่านไม่ได้" ไม่ใช่ "ไม่มีไลน์" — โรงงานมีไลน์อยู่แล้วเสมอ
    // throw เพื่อให้ตกไป catch → คืน 500 → **ไม่ mark** → cron รอบหน้าลองใหม่เองเมื่อแก้แล้ว
    if (!lines?.length) {
      throw new Error(
        'อ่านผังไลน์จาก Main ไม่ได้ (ทั้ง RPC line_parent_map() และตาราง production_lines คืนค่าว่าง) — ' +
        'ยังไม่ได้ apply migration 20260827_line_parent_map_rpc.sql?',
      );
    }
    const parentOf = new Map<string, string>();
    lines.forEach((l: Row) => parentOf.set(l.name, l.parent_line_name || l.name));
    const groupOf = (n: string) => parentOf.get(n) || n;

    // ── กะ + ใบผลิตของวันงานนี้ ──
    const sess = await page((f, t) => db.from('production_sessions')
      .select('id, line_name, shift').eq('work_date', workDate).order('id').range(f, t));
    if (!sess.length) return await markAll(due, {}, 'ไม่มีกะเปิดในวันงานนี้');

    const sessById = new Map<string, Row>(sess.map((s) => [s.id, s]));
    const orders = await page((f, t) => db.from('prod_orders')
      .select('session_id, mat_no, qty, status, opened_at')
      .in('session_id', sess.map((s) => s.id)).order('session_id').range(f, t));

    // ── BOM: mat ของ FG → พาร์ทลูก (ใช้ชุดเดียวกับที่หน้าเว็บใช้) ──
    const fgMats = [...new Set(orders.map((o) => o.mat_no).filter(Boolean))];
    const prodByMat = new Map<string, string>();
    if (fgMats.length) {
      const prods = await page((f, t) => db.from('dr_products')
        .select('id, mat_no').in('mat_no', fgMats).order('id').range(f, t));
      prods.forEach((p) => { if (p.mat_no) prodByMat.set(p.mat_no, p.id); });
    }
    const bomByProduct = new Map<string, Row[]>();
    const pids = [...new Set([...prodByMat.values()])];
    if (pids.length) {
      const boms = await page((f, t) => db.from('bom_items')
        .select('product_id, mat_no, qty_per_unit').in('product_id', pids).eq('is_active', true).order('product_id').range(f, t));
      boms.forEach((b) => {
        const arr = bomByProduct.get(b.product_id) ?? [];
        arr.push(b); bomByProduct.set(b.product_id, arr);
      });
    }

    // ── รวมยอดต่อรอบ ──
    const dayStartMs = new Date(due[0].win_start_ts).getTime();   // รอบแรกเริ่มที่ต้นวันงานเสมอ
    // ⚠️ ตัวนับว่า "ใบถูกข้ามเพราะอะไร" — จับคู่ไม่ได้ต้องบอกได้ว่าพลาดตรงไหน ห้ามคืน 0 เฉยๆ
    const skip = { cancelled: 0, shift: 0, group: 0, noOpened: 0, window: 0 };
    const stats: Record<string, { orders: number; parts: number; gross: number }> = {};
    for (const r of due) {
      const winStart = new Date(r.win_start_ts).getTime();
      const winEnd = new Date(r.win_end_ts).getTime();
      const mats = new Map<string, number>();
      let nOrders = 0;
      for (const o of orders) {
        if (o.status === 'cancelled' || !num(o.qty)) { skip.cancelled++; continue; }
        const s = sessById.get(o.session_id);
        if (!s || s.shift !== r.shift) { skip.shift++; continue; }
        if (groupOf(s.line_name) !== r.line_name) { skip.group++; continue; }
        if (!o.opened_at) { skip.noOpened++; continue; }   // ไม่มีเวลาสแกน = เกลี่ยทุกรอบฝั่งหน้าเว็บ — ที่นี่ไม่นับ กันบอกเกินจริง
        // ใบที่เปิดก่อนต้นวันงาน (ยกยอดข้ามวัน) นับเป็นต้นวันงาน — ตรงกับ roundIdForOrder ฝั่งหน้าเว็บ
        const t = Math.max(new Date(o.opened_at).getTime(), dayStartMs);
        if (!(t >= winStart && t < winEnd)) { skip.window++; continue; }
        nOrders++;
        const pid = prodByMat.get(o.mat_no);
        for (const b of bomByProduct.get(pid ?? '') ?? []) {
          mats.set(b.mat_no, (mats.get(b.mat_no) ?? 0) + num(o.qty) * num(b.qty_per_unit));
        }
      }
      let gross = 0; mats.forEach((v) => { gross += v; });
      stats[r.round_id] = { orders: nOrders, parts: mats.size, gross };
    }

    // ── ข้อความเดียวรวมทุกรอบที่เพิ่งตัดยอด ──
    const hot = due.filter((r) => stats[r.round_id].parts > 0);
    if (!hot.length) {
      // ⚠️ "ไม่มีของต้องเตรียม" กับ "จับคู่ไม่ติด" หน้าตาเหมือนกันจากข้างนอก — ต้องบอกให้แยกออก
      console.log('kanban-round-scan: ไม่มีพาร์ทต้องเตรียม', JSON.stringify({
        rounds: due.length, sessions: sess.length, orders: orders.length, skip,
        roundLines: [...new Set(due.map((r) => r.line_name))],
        sessionLines: [...new Set(sess.map((s) => `${s.line_name}→${groupOf(s.line_name)}`))],
      }));
      return await markAll(due, stats, 'ไม่มีพาร์ทต้องเตรียม', false, skip);
    }

    hot.sort((a, b) => String(a.line_name).localeCompare(String(b.line_name)));
    const lines_: string[] = [];
    let totParts = 0, totOrders = 0;
    for (const r of hot) {
      const st = stats[r.round_id];
      totParts += st.parts; totOrders += st.orders;
      lines_.push(
        `🏭 <b>${r.line_name}</b> · รอบ ${r.round_no} ${r.shift === 'night' ? '🌙' : '☀️'}` +
        ` — ส่งถึงไลน์ <b>${hhmm(r.delivery_time)}</b>`,
      );
      lines_.push(`   ⏰ ตัดยอด ${hhmm(r.cutoff_time)} · 📦 ${st.parts} พาร์ท · ใบผลิต ${st.orders} ใบ · รวม ${fmt(st.gross)} ชิ้น`);
    }
    lines_.push('');
    lines_.push(`รวม ${hot.length} รอบ · ${totParts} พาร์ท · ใบผลิต ${totOrders} ใบ`);
    // ⚠️ ต้องเขียนกำกับเสมอ: ยอดนี้ยังไม่หักของที่มีในไลน์ ห้ามให้เข้าใจว่าเป็นจำนวนที่ต้องหยิบจริง
    lines_.push('ℹ️ ยอดข้างบนเป็น <b>ความต้องการรวม ยังไม่หักของที่มีอยู่ในไลน์</b>');
    lines_.push('👉 รายการหยิบจริง (หักสต็อกแล้ว + จำนวนการ์ด) ดูที่ 🎴 Heijunka → 🕐 Store Time Chart');

    let sent = false, sendErr: string | null = null;
    try {
      const res = await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: MAIN_ANON },
        body: JSON.stringify({
          event: 'kanban_round_cutoff',
          title: `⏰ ตัดยอดรอบจัดส่ง ${hhmm(hot[0].cutoff_time)} — เตรียมของเข้าไลน์`,
          lines: lines_,
          // ไลน์เดียว = ส่งชื่อไปให้ resolve ส่วนงาน · หลายไลน์ = ไม่ส่ง (แจ้งตาม role ทั้งหมด ไม่เงียบ)
          line_name: hot.length === 1 ? hot[0].line_name : undefined,
          ref_table: 'kanban_delivery_rounds',
          ref_id: hot.length === 1 ? hot[0].round_id : undefined,
          type: 'info',
        }),
      });
      sent = res.ok;
      if (!res.ok) sendErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      sendErr = String((e as Error)?.message ?? e);
    }

    // ⚠️ ส่งไม่สำเร็จ = **ไม่ mark** ให้ cron รอบถัดไปลองใหม่ (ยังอยู่ในหน้าต่าง 90 นาที)
    if (!sent) {
      console.error('kanban-round-scan: ส่งแจ้งเตือนไม่สำเร็จ —', sendErr);
      return json({ ok: false, due: due.length, sent: 0, error: sendErr }, 500);
    }
    await markAll(due, stats, null, true);
    return json({ ok: true, due: due.length, notified: hot.length, parts: totParts, orders: totOrders });
  } catch (e) {
    console.error('kanban-round-scan:', e);
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

/**
 * บันทึกผลการตรวจรอบนี้
 *
 * ⚠️ แถว `notified=false` เป็น **บันทึกว่า "ตรวจแล้ว ณ เวลานี้" ไม่ใช่การปิดรอบ**
 *    วิว `v_kanban_round_due` กันแจ้งซ้ำด้วย `notified = true` เท่านั้น → รอบที่ยังไม่ได้แจ้ง
 *    กลับมาถูกตรวจใหม่ทุก 10 นาทีจนหมดหน้าต่าง 90 นาที
 *    เดิมวิวตัดทุกแถวที่มีอยู่ ⇒ ตรวจพลาดรอบเดียว (เช่นผังไลน์อ่านไม่ได้) = **รอบนั้นเงียบถาวรทั้งวัน**
 *    แม้จะแก้ปัญหาได้ภายใน 5 นาที · ค่าที่จ่ายคือคิวรีซ้ำ ≤9 รอบ/วัน ซึ่งถูกกว่าการแจ้งเตือนที่หายไป
 */
async function markAll(
  due: Row[], stats: Record<string, any>, _why: string | null,
  notified = false, diag?: Record<string, number>,
) {
  const now = new Date().toISOString();
  const rows = due.map((r) => ({
    work_date: r.work_date, round_id: r.round_id,
    alerted_at: now,   // แจ้งแล้ว = เวลาส่ง · ยังไม่แจ้ง = เวลาที่ตรวจล่าสุด
    orders: stats[r.round_id]?.orders ?? 0,
    parts: stats[r.round_id]?.parts ?? 0,
    gross_qty: stats[r.round_id]?.gross ?? 0,
    notified: notified && (stats[r.round_id]?.parts ?? 0) > 0,
  }));
  const { error } = await db.from('kanban_round_alerts').upsert(rows, { onConflict: 'work_date,round_id' });
  if (error) console.error('kanban-round-scan: mark ไม่สำเร็จ —', error.message);
  return json({ ok: true, due: due.length, notified: rows.filter((r) => r.notified).length, note: _why, skip: diag });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
