// System 1 — scheduled scan for the Daily PM "orange" alarm (didn't finish the
// check in time). Runs on the Product DB project via pg_cron. Green/red are
// event-driven from the app; only orange needs a timer, so only orange lives here.
//
// For the current line×shift: if the first order was confirmed more than
// WINDOW_MIN ago and the line still hasn't checked every registered item, POST
// an 'orange' pm_daily to the MAIN send-notification function (which owns the
// bot token + room routing). Deduped via pm_daily_alerts so it fires once.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const NOTIFY_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification';
const NOTIFY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aGRmcXdmd29maXZvanRzaXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODA5NjYsImV4cCI6MjA5MjQ1Njk2Nn0.mGrLjRFmtNtpyAu3aBduKqixyb3AjQDCid06qpBzrxw';
const WINDOW_MIN = 60;

// Current shift + the exact UTC instant it began (Asia/Bangkok wall clock).
function shiftInfo() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  let y = +p.year, mo = +p.month, d = +p.day, h = +p.hour;
  const mi = +p.minute;
  if (h === 24) h = 0;
  const totalMin = h * 60 + mi;
  const isDay = totalMin >= 480 && totalMin < 1200;   // 08:00–19:59
  let wy = y, wm = mo, wd = d;
  if (h < 8) { const prev = new Date(Date.UTC(y, mo - 1, d)); prev.setUTCDate(prev.getUTCDate() - 1); wy = prev.getUTCFullYear(); wm = prev.getUTCMonth() + 1; wd = prev.getUTCDate(); }
  const pad = (n: number) => String(n).padStart(2, '0');
  const shiftHour = isDay ? 8 : 20;
  return {
    shift: isDay ? 'day' : 'night',
    workDateStr: `${wy}-${pad(wm)}-${pad(wd)}`,
    shiftStartUtc: new Date(Date.UTC(wy, wm - 1, wd, shiftHour - 7, 0, 0)),   // Bangkok → UTC
    label: isDay ? '☀️ กะเช้า' : '🌙 กะดึก',
  };
}

async function notify(pm: unknown) {
  await fetch(NOTIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NOTIFY_KEY}`, 'apikey': NOTIFY_KEY },
    body: JSON.stringify({ event: 'pm_daily', pm }),
  });
}

Deno.serve(async () => {
  try {
    const si = shiftInfo();
    const startISO = si.shiftStartUtc.toISOString();

    const { data: targets } = await db.from('pm_daily_line_targets').select('line_name, jig_id, shift').eq('is_active', true);
    const active = (targets ?? []).filter(t => !t.shift || t.shift === si.shift);
    if (!active.length) return new Response(JSON.stringify({ ok: true, lines: 0 }), { headers: { 'Content-Type': 'application/json' } });

    const byLine: Record<string, string[]> = {};
    for (const t of active) (byLine[t.line_name] ||= []).push(t.jig_id);
    const allJigIds = [...new Set(active.map(t => t.jig_id))];

    const [{ data: jigRows }, { data: prodCls }, { data: alerts }] = await Promise.all([
      db.from('jigs').select('id, name, machine_no').in('id', allJigIds),
      db.from('checklists').select('id').eq('module', 'mtn').eq('department', 'production'),
      db.from('pm_daily_alerts').select('line_name').eq('work_date', si.workDateStr).eq('shift', si.shift).eq('color', 'orange'),
    ]);
    const jigById: Record<string, { name?: string; machine_no?: string }> = Object.fromEntries((jigRows ?? []).map(j => [j.id, j]));
    const prodIds = new Set((prodCls ?? []).map(c => c.id));
    const alerted = new Set((alerts ?? []).map(a => a.line_name));

    const { data: insp } = await db.from('inspections').select('jig_id, checklist_id, inspected_at').in('jig_id', allJigIds).gte('inspected_at', startISO);
    const checked = new Set<string>();
    for (const i of insp ?? []) if (prodIds.has(i.checklist_id)) checked.add(i.jig_id);

    const lines = Object.keys(byLine);
    /* ⚠️ ห้ามกรอง `.in('line_name', lines)` — อุปกรณ์ลงทะเบียน AM ไว้ที่ **ไลน์แม่** (HYDROFORM)
       แต่กะเปิดที่ **ไลน์ลูก** (HDF1/HDF2) → กรองด้วยชื่อไลน์ที่ลงทะเบียน = ตัดกะจริงทิ้งหมด
       ดึงกะของกะนี้ทั้งหมด (หลักสิบแถว) แล้วค่อยจับคู่ตามครอบครัวไลน์ด้านล่าง */
    const { data: sessions } = await db.from('production_sessions').select('id, line_name').eq('work_date', si.workDateStr).eq('shift', si.shift);
    const sessLine: Record<string, string> = {};
    (sessions ?? []).forEach(s => { sessLine[s.id] = s.line_name; });
    const firstOrder: Record<string, string> = {};
    if (sessions && sessions.length) {
      /* ⚠️ "เริ่มผลิต" = `opened_at` (เปิดใบ) ไม่ใช่ `confirmed_at` (ปิดใบ = ผลิตเสร็จ)
         ต้องตรงกับหน้า /daily-checker?tab=pm ไม่งั้นจอกับตัวเตือนตัดสินคนละเวลา
         (แก้ 2026-08-24 — เดิมนาฬิกาเริ่มนับตอนใบแรกจบ ใบที่กินหลายชั่วโมงเลยไม่เคยถูกเตือน) */
      const { data: orders } = await db.from('prod_orders').select('session_id, opened_at, confirmed_at').in('session_id', sessions.map(s => s.id));
      for (const o of orders ?? []) {
        const ln = sessLine[o.session_id];
        const at = o.opened_at || o.confirmed_at;
        if (!ln || !at) continue;
        if (!firstOrder[ln] || at < firstOrder[ln]) firstOrder[ln] = at;
      }
    }

    /* ครอบครัวไลน์ (ตัวเอง + แม่ + ลูก) — `production_lines` อยู่ Main คนละ project กับ scan ตัวนี้
       จึงอ่านผ่าน REST ด้วย anon key เดียวกับที่ใช้ POST แจ้งเตือน
       ⚠️ อ่านไม่ได้ = ถอยไปเทียบชื่อตรงตัว (พฤติกรรมเดิม ไม่แย่ลง) **แต่ต้องรายงานออกมาใน response**
          ไม่งั้นการ์ดไลน์แม่จะไม่มีวันเตือนโดยไม่มีใครรู้ว่าทำไม */
    let hierarchy: 'ok' | 'unavailable' = 'unavailable';
    const famOf: Record<string, string[]> = {};
    try {
      const res = await fetch(`${NOTIFY_URL.replace('/functions/v1/send-notification', '')}/rest/v1/production_lines?select=name,parent_line_name`,
        { headers: { apikey: NOTIFY_KEY, Authorization: `Bearer ${NOTIFY_KEY}` } });
      if (res.ok) {
        const rows = await res.json() as { name: string; parent_line_name: string | null }[];
        if (Array.isArray(rows) && rows.length) {
          hierarchy = 'ok';
          const childrenOf: Record<string, string[]> = {};
          const parentOf: Record<string, string | null> = {};
          for (const r of rows) {
            parentOf[r.name] = r.parent_line_name;
            if (r.parent_line_name) (childrenOf[r.parent_line_name] ||= []).push(r.name);
          }
          for (const l of lines) {
            const fam = new Set<string>([l, ...(childrenOf[l] ?? [])]);
            if (parentOf[l]) fam.add(parentOf[l] as string);
            famOf[l] = [...fam];
          }
        }
      }
    } catch { /* เครือข่ายสะดุด → ถอยไปเทียบชื่อตรงตัว (รายงานผ่าน hierarchy) */ }

    // เวลาเริ่มผลิตของไลน์ที่ลงทะเบียน = เวลาเร็วสุดในครอบครัวไลน์นั้น
    const startedFor = (line: string): string | undefined => {
      let best: string | undefined;
      for (const n of (famOf[line] ?? [line])) {
        const at = firstOrder[n];
        if (at && (!best || at < best)) best = at;
      }
      return best;
    };

    const now = Date.now();
    let sent = 0;
    for (const line of lines) {
      if (alerted.has(line)) continue;
      const fo = startedFor(line);
      if (!fo) continue;                                            // not producing yet
      if (now - new Date(fo).getTime() <= WINDOW_MIN * 60000) continue;  // still in the grace window
      const jigIds = byLine[line];
      const missing = jigIds.filter(id => !checked.has(id));
      if (missing.length === 0) continue;                           // complete
      await notify({
        color: 'orange', line_name: line, shift_label: si.label, work_date: si.workDateStr,
        checked: jigIds.length - missing.length, total: jigIds.length,
        missing: missing.map(id => { const j = jigById[id]; return j?.machine_no ? `${j.machine_no}·${j.name}` : (j?.name ?? id); }),
      });
      await db.from('pm_daily_alerts').insert({ line_name: line, work_date: si.workDateStr, shift: si.shift, color: 'orange' });
      sent++;
    }
    // hierarchy = 'unavailable' → ไลน์แม่ที่กะเปิดอยู่ที่ไลน์ลูก จะไม่ถูกเตือน (ต้องเห็น ห้ามเงียบ)
    return new Response(JSON.stringify({ ok: true, lines: lines.length, sent, hierarchy, shift: si.shift, work_date: si.workDateStr }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
