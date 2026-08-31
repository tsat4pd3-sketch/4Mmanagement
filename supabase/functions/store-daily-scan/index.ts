// Store abnormality scan — แจ้งเตือนฝั่ง Store/Logistic  (DR project · pg_cron)
//
// ที่มา (audit 2026-08-21): notification_rules ทั้งระบบ 30 event — ซ่อมบำรุง 14 · ผลิต 6
// แต่ logistic มีแค่ 4 และ **ทั้ง 4 เป็นเรื่องส่งลูกค้าล้วน**
// ฝั่ง Store (สต๊อกต่ำกว่า Min / ล้น / ใบสั่งซื้อค้าง / รอบส่งภายในเลยเวลา) **ไม่เคยมีใครถูกแจ้งเลย**
// หน้า /store-monitor ตรวจเจอครบ แต่ต้องเปิดหน้าดูเอง → คนไม่เปิด = ไม่มีใครรู้
//
// ⚠️ เงื่อนไขตรวจอยู่ในวิว `v_store_abnormal` ที่เดียว (หน้า /store-monitor อ่านตัวเดียวกัน)
//    ห้าม copy เงื่อนไขมาเขียนซ้ำในไฟล์นี้ — จะ drift ทันทีที่ใครแก้ฝั่งใดฝั่งหนึ่ง
//
// ส่งเข้า send-notification ฝั่ง Main (เจ้าของ bot token + การเลือกห้อง + สวิตช์เปิด/ปิด)
// เปิด/ปิด/เลือกห้อง/แก้ข้อความ/เลือก role ที่เข้ากระดิ่งในแอป → /notification-config
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// ⚠️ แยกไฟล์จาก send-notification (กันไฟล์ 47KB พัง) แต่ route ผ่าน notification_rules ชุดเดียวกัน
//    precedent เดียวกับ send-mtn-notification
const NOTIFY_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-store-notification';
const NOTIFY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aGRmcXdmd29maXZvanRzaXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODA5NjYsImV4cCI6MjA5MjQ1Njk2Nn0.mGrLjRFmtNtpyAu3aBduKqixyb3AjQDCid06qpBzrxw';

const pad = (n: number) => String(n).padStart(2, '0');
function workDateBangkok() {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date())) p[x.type] = x.value;
  let h = +p.hour; if (h === 24) h = 0;
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  if (h < 8) d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// จัดกลุ่มตามเคส (A..E) แล้วส่งข้อความเดียว — ไม่ยิงทีละรายการ
// (บทเรียนจาก shipping_phase_alert ที่ยิง 592 ครั้งใน 4 วันจนไม่มีใครอ่าน)
const CODE_ORDER = ['C', 'D', 'A', 'E', 'B'];

Deno.serve(async () => {
  try {
    const workDate = workDateBangkok();

    /* 🔴 กับดักเพดาน 1000 แถว (แก้ 2026-08-26 · user เห็นแจ้งเตือน "พบ 1000 รายการ" เป๊ะๆ):
       เดิม `.select('*')` เฉยๆ → PostgREST ตัดที่ 1000 แถว → `rows.length` = 1000 พอดี
       ⇒ **ตัวเลขบนแจ้งเตือนเป็นเลขปลอม** (ของจริงอาจ 1,200 หรือ 5,000 ก็ได้) และแถวที่เกิน
         ถูกตัดทิ้งเงียบ = เคสรุนแรงอาจหลุดออกจากลิสต์ไปเลย
       กติกา: **จำนวนที่โชว์ต้องมาจาก head-count (ไม่ดึงแถว = ไม่ติดเพดาน) เสมอ**
              ส่วนตัวแถวค่อยดึงแบบแบ่งหน้า และถ้าดึงไม่ครบต้องบอกตรงๆ ห้ามเงียบ */
    const { count: exactTotal, error: cntErr } = await db.from('v_store_abnormal')
      .select('*', { count: 'exact', head: true });
    if (cntErr) throw cntErr;
    if (!exactTotal) return new Response(JSON.stringify({ ok: true, findings: 0 }), { status: 200 });

    const PAGE = 1000, MAX_PAGES = 12;   // เพดาน 12,000 แถว — พอสำหรับงานรายวัน ไม่ระเบิด egress
    const rows: Record<string, unknown>[] = [];
    let page = 0;
    for (; page < MAX_PAGES; page++) {
      // ⚠️ `.range()` ต้องคู่กับ `.order()` ที่คงที่ — ไม่งั้นแถวหลุด/ซ้ำระหว่างหน้า
      //    เรียงรุนแรงก่อน เผื่อชนเพดาน จะได้ตัดตัวเบาทิ้ง ไม่ใช่ตัดตัวหนัก
      const { data, error } = await db.from('v_store_abnormal').select('*')
        .order('sev', { ascending: false }).order('code').order('mat_no')
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    const truncated = rows.length < exactTotal;
    if (!rows.length) return new Response(JSON.stringify({ ok: true, findings: 0 }), { status: 200 });

    const byCode = new Map<string, { code: string; title: string; kind: string; items: Record<string, unknown>[] }>();
    for (const r of rows) {
      const k = String(r.code);
      if (!byCode.has(k)) byCode.set(k, { code: k, title: String(r.title), kind: String(r.kind), items: [] });
      byCode.get(k)!.items.push(r);
    }
    const groups = [...byCode.values()]
      .sort((a, b) => CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code))
      .map((g) => ({
        code: g.code, title: g.title, kind: g.kind, count: g.items.length,
        // เรียงรุนแรงก่อน แล้วตัดที่ 8 รายการ — ตัวเต็มดูที่หน้า /store-monitor
        items: g.items
          .sort((a, b) => Number(b.sev) - Number(a.sev))
          .slice(0, 8)
          .map((r) => ({ line: r.line_name, mat: r.mat_no, part: r.part_name, detail: r.detail })),
      }));

    const shortage = rows.filter((r) => r.kind === 'shortage').length;
    const over = rows.filter((r) => r.kind === 'over').length;

    /* ⚠️ ส่งไม่สำเร็จต้องรายงาน ห้าม `.catch(() => {})` แล้วตอบ ok:true (แก้ 2026-08-26)
       เดิมกลืน error ทิ้ง → Telegram ล่ม / rule ถูกปิด / send-store-notification พัง
       = สรุปสโตร์รายวันหายไปเฉยๆ โดยไม่มีใครรู้ (cron log ก็ขึ้น succeeded)
       ตัวนี้เป็นสรุปรายวัน ไม่มีตาราง dedup ให้ถอน → รอบหน้าพรุ่งนี้แจ้งใหม่เองอยู่แล้ว
       จึงแค่ต้อง "ดังพอให้เห็นใน cron log + response" ไม่ต้อง retry */
    let notifyErr: string | null = null;
    try {
      const res = await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NOTIFY_KEY}`, apikey: NOTIFY_KEY },
        // total = ของจริงจาก head-count · sampled/truncated = บอกว่าลิสต์ข้างล่างครบไหม
        body: JSON.stringify({ event: 'store_abnormal', alert: { work_date: workDate, total: exactTotal, sampled: rows.length, truncated, shortage, over, groups } }),
      });
      if (!res.ok) notifyErr = `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`;
    } catch (e) {
      notifyErr = String(e);
    }
    if (notifyErr) {
      console.error('[store-daily-scan] notify failed:', notifyErr);
      return new Response(JSON.stringify({
        ok: false, notify_error: notifyErr,
        findings: exactTotal, sampled: rows.length, truncated, shortage, over,
      }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true, findings: exactTotal, sampled: rows.length, truncated, shortage, over }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
