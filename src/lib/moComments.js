/* ── moComments — คอมเมนต์ใต้ใบ MO ไปโผล่บน "ใบพิมพ์ + Excel" ด้วย (2026-10-07) ─────────
 *
 * ที่มา (คอมเมนต์ทีม MTN ข้อ 1 · 06/10):
 *   *"ถ้าให้สามารถแก้ไขรายละเอียด MO ได้จะดีมาก — เปิดเอกสารมาบางครั้งรายละเอียด
 *     ไม่ตรงสาเหตุที่เกิดขึ้นจริง เพื่อให้เอกสารที่ถูกบันทึกไว้ถูกต้อง"*
 *   user ตัดสิน 07/10: **ไม่แก้ทับของผู้แจ้ง — เอาคอมเมนต์ไปต่อท้ายในช่องแรกของใบ MO**
 *   *"อยากไห้ เอาเป็น เหมือน comment ไปโชว์ในช่องแรกด้วยในใบ MO ตอน export
 *     ต่อจากที่ผู้แจ้งแจ้งมา"*
 *
 * ── 🔴 ทำไมไม่เปิดให้ "แก้ไข" ช่อง report_note ตรงๆ ──
 *   ช่องนั้น = **บันทึก ณ วันที่แจ้ง** · แก้ทับ = พิสูจน์ไม่ได้ว่าเดิมเขียนว่าอะไร
 *   ขัดกฎของระบบเอง: "ฟอร์มที่ยื่นออกไปแล้ว = บันทึก ไม่ใช่ใบที่ generate ใหม่"
 *   (CLAUDE.md §ใบรายงานปัญหาการผลิต · `docs/modules/production-problem-report-bins.md`)
 *   ⇒ ของจริงที่เกิดขึ้นทีหลัง ไปอยู่ "ท้ายช่อง" โดยมีชื่อ+เวลากำกับ ของเดิมยังอ่านได้ครบ
 *
 * ── 🔴 ห้ามสร้างตารางคอมเมนต์ใหม่ ──
 *   ใบ MO **มีคอมเมนต์อยู่แล้ว** — `<EventComments refKind="mtn_order">` เขียนลง
 *   `event_comments` ฝั่ง DR (74 คอมเมนต์ · 49 ใบ ณ 07/10) · จอคุยกันที่นั่นมาตั้งแต่ 07/2026
 *   ตารางที่ 2 = ใบเดียวมีคอมเมนต์ 2 กอง คนละที่ = ใบพิมพ์ไม่ตรงกับจอ
 *   ⇒ ไฟล์นี้ **อ่านของเดิม** ไม่มีที่เก็บใหม่ · เพิ่ม/แก้คอมเมนต์ยังทำที่ `EventComments` ที่เดียว
 *
 * ── ใครใช้ ──
 *   `printMoReport` / `printMoReportMtn` (MtnRepair.jsx) · `exportMoExcel` (mtnMoExportExcel.js)
 *   🔴 **รูปแบบบรรทัดอยู่ที่ `moCommentLines()` ที่เดียว ห้ามประกอบข้อความเองในหน้า/ในใบ**
 *      (ใบพิมพ์ 2 ฟอร์ม + Excel ต้องอ่านได้ว่า "ใครพูด เมื่อไหร่" เหมือนกันทุกทาง)
 */

import { supabaseDR } from '../supabaseClient';
import { fetchByIds } from '../utils/fetchByIds';

/** คอลัมน์ที่ใบพิมพ์/Excel ใช้ — ไม่เอา `mentions` (jsonb ก้อนใหญ่ ใบไม่ได้ใช้ · กฎ egress ข้อ 11) */
const COLS = 'id, ref_id, author_name, body, created_at';

/** เพดานคอมเมนต์ต่อใบบนใบพิมพ์ — เกินนี้เขียนบนใบว่าตัดไปกี่อัน ห้ามตัดเงียบ */
export const PRINT_MAX = 12;

const tidy = (s) => String(s ?? '').replace(/\s+$/g, '').trim();

/** เวลาไทยสั้น d/m/yy HH:MM — ใบ MO ทั้ง 2 ฟอร์มใช้ พ.ศ. 2 หลักเหมือนกัน */
export function commentWhen(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = {};
  p.forEach(x => { g[x.type] = x.value; });
  return `${+g.day}/${+g.month}/${(+g.year + 543) % 100} ${g.hour === '24' ? '00' : g.hour}:${g.minute}`;
}

/**
 * แปลงคอมเมนต์ดิบ → บรรทัดพร้อมพิมพ์ (เรียงเก่า→ใหม่ ตามลำดับที่คุยกันจริง)
 * 🔴 คอมเมนต์ที่ **ไม่มีข้อความ** ทิ้ง · ที่ **ไม่รู้ว่าใครพูด** ไม่ทิ้ง แต่เขียนว่า "ไม่ระบุชื่อ"
 *    (ทิ้ง = ใบขาดเนื้อหาที่มีคนเขียนไว้จริง · เดาชื่อ = โกหกบนเอกสารที่เก็บตามอายุเอกสาร)
 * @returns {{ lines: {when:string, who:string, body:string}[], total:number, hidden:number }}
 */
export function moCommentLines(list, max = PRINT_MAX) {
  const all = (list || [])
    .filter(c => tidy(c?.body))
    .slice()
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const keep = max > 0 && all.length > max ? all.slice(all.length - max) : all;
  return {
    lines: keep.map(c => ({
      when: commentWhen(c.created_at),
      who: tidy(c.author_name) || 'ไม่ระบุชื่อ',
      body: tidy(c.body),
    })),
    total: all.length,
    hidden: all.length - keep.length,
  };
}

/** ข้อความบรรทัดเดียวต่อคอมเมนต์ — ใช้ใน Excel (1 เซลล์หลายบรรทัด) */
export function moCommentText(list, max = 0) {
  const { lines, hidden } = moCommentLines(list, max);
  const body = lines.map(l => `[${l.when} · ${l.who}] ${l.body}`).join('\n');
  return hidden > 0 ? `(เก่ากว่านี้อีก ${hidden} คอมเมนต์)\n${body}` : body;
}

/**
 * โหลดคอมเมนต์ของใบเดียว — ใช้ตอนเปิดใบ/กดพิมพ์
 * 🔴 คืน `{ rows, error }` ห้ามกลืน — ใบพิมพ์ที่ "โหลดคอมเมนต์ไม่สำเร็จ" ต้องเขียนบนใบ
 *    ไม่ใช่พิมพ์ออกมาเหมือนใบที่ไม่มีคอมเมนต์เลย (กฎความซื่อสัตย์ของจอ)
 */
export async function loadMoComments(orderId) {
  if (!orderId) return { rows: [], error: null };
  const { data, error } = await supabaseDR.from('event_comments').select(COLS)
    .eq('ref_kind', 'mtn_order').eq('ref_id', String(orderId))
    .order('created_at', { ascending: true }).limit(200);
  return { rows: data || [], error: error ? error.message : null };
}

/**
 * โหลดคอมเมนต์หลายใบพร้อมกัน — ใช้ตอน export Excel รายเดือน
 * ⚠️ `ref_id` เป็น **text** (ตารางนี้เก็บ id ของได้ทุกชนิดเหตุการณ์) ⇒ ส่ง id เป็นสตริงเสมอ
 * ⚠️ `.in()` ยาวเกินเพดาน URL = คืนค่าว่างเงียบ (กฎเหล็กข้อ 5) ⇒ ผ่าน `fetchByIds` เท่านั้น
 * @returns {Promise<{ byOrder: Record<string, any[]>, error: string|null, failed: number }>}
 */
export async function loadMoCommentsFor(orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { byOrder: {}, error: null, failed: 0 };
  const { rows, error, failed, truncated } = await fetchByIds(
    ids,
    (chunk) => supabaseDR.from('event_comments').select(COLS)
      .eq('ref_kind', 'mtn_order').in('ref_id', chunk),
  );
  const byOrder = {};
  (rows || []).forEach(r => {
    const k = String(r.ref_id);
    (byOrder[k] || (byOrder[k] = [])).push(r);
  });
  return {
    byOrder,
    error: error || (truncated ? 'คอมเมนต์เยอะเกินเพดาน — โหลดได้ไม่ครบ' : null),
    failed: failed || 0,
  };
}
