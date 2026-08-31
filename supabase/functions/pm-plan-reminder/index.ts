// System 3 — Maintenance Planned PM staged reminders.
// Runs on the Product DB project via pg_cron (once a day). For every active
// pm_plan with a materialized next_due_date, work out how many days remain and,
// when it crosses a stage boundary (30 / 14 / 3 วัน ก่อนถึง, หรือเกินกำหนด), POST a
// 'pm_plan_reminder' to the MAIN send-notification function (which owns the bot
// token + room routing). Deduped via pm_plan_reminders so each stage fires once
// per due cycle; a new cycle (after the PM is done → next_due_date rolls) is fresh.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const NOTIFY_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification';
const NOTIFY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aGRmcXdmd29maXZvanRzaXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODA5NjYsImV4cCI6MjA5MjQ1Njk2Nn0.mGrLjRFmtNtpyAu3aBduKqixyb3AjQDCid06qpBzrxw';

// Today's calendar date in Asia/Bangkok (YYYY-MM-DD).
function bangkokToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts; // en-CA → YYYY-MM-DD
}
// Whole-day difference dueDate - today (both 'YYYY-MM-DD'), calendar days.
function daysBetween(today: string, due: string): number {
  const [ty, tm, td] = today.split('-').map(Number);
  const [dy, dm, dd] = due.split('-').map(Number);
  const a = Date.UTC(ty, tm - 1, td);
  const b = Date.UTC(dy, dm - 1, dd);
  return Math.round((b - a) / 86400000);
}
// Map remaining days → the single stage bucket that applies (or null).
//
// ⚠️ กฎเหล็ก (feedback หน้างาน 2026-08-25: "มีเครื่องที่เลยเวลา ... ก็ไม่มีอะไรแจ้งเตือน"):
//    **เกินกำหนดต้องเตือนซ้ำเป็นระยะ ห้ามเตือนครั้งเดียวแล้วเงียบตลอดกาล**
//    ของเดิม stage = 'overdue' ตัวเดียว → dedup (plan|due|stage) ทำให้ยิงครั้งเดียวตอนเลยกำหนดวันแรก
//    แล้วเงียบสนิท แม้จะค้างต่ออีกเป็นเดือน (เจอจริง: แผนครบ 23 ก.ค. ยังไม่ทำถึง 25 ส.ค. = เงียบ 33 วัน)
//    → แตก stage เป็นรายสัปดาห์ `overdue` → `overdue_w1` → `overdue_w2` … = เตือนซ้ำสัปดาห์ละครั้ง
//    (ไม่ใช่รายวัน — จะกลายเป็นสแปมแล้วคนเลิกอ่านทั้งห้อง · กฎ notification fatigue ใน CLAUDE.md)
//    ไม่ต้อง migration: คอลัมน์ `stage` เป็น text อยู่แล้ว
function stageFor(days: number): { stage: string; label: string } | null {
  if (days < 0) {
    const over = Math.abs(days);
    const wk = Math.floor(over / 7);   // 0 = สัปดาห์แรก · 1 = ครบ 1 สัปดาห์ · …
    return {
      stage: wk === 0 ? 'overdue' : `overdue_w${wk}`,
      label: wk === 0
        ? '🔴 เกินกำหนด PM แล้ว'
        : `🔴 ยังไม่ได้ทำ PM — เกินกำหนดมาแล้ว ${over} วัน`,
    };
  }
  if (days <= 3) return { stage: 'd3',  label: '⚠️ PM ใกล้ถึงกำหนด (ไม่เกิน 3 วัน)' };
  if (days <= 14) return { stage: 'd14', label: '⏳ PM อีก 2 สัปดาห์ — เตรียม stock / จัด shutdown' };
  if (days <= 30) return { stage: 'd30', label: '🗓️ PM อีก 1 เดือน — เริ่มวางแผน' };
  return null;
}

async function notify(pm: unknown) {
  await fetch(NOTIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NOTIFY_KEY}`, 'apikey': NOTIFY_KEY },
    body: JSON.stringify({ event: 'pm_plan_reminder', pm }),
  });
}

Deno.serve(async () => {
  try {
    const today = bangkokToday();

    const { data: plans } = await db.from('pm_plans')
      .select('id, checklist_id, next_due_date, next_due_reason, interval_days, deferred_to, deferred_at, last_done_at')
      .eq('is_active', true).not('next_due_date', 'is', null);
    if (!plans || !plans.length) return new Response(JSON.stringify({ ok: true, plans: 0 }), { headers: { 'Content-Type': 'application/json' } });

    const clIds = [...new Set(plans.map(p => p.checklist_id))];
    const { data: cls } = await db.from('checklists').select('id, name, frequency, equipment_id').in('id', clIds);
    const clById = Object.fromEntries((cls ?? []).map(c => [c.id, c]));
    const eqIds = [...new Set((cls ?? []).map(c => c.equipment_id).filter(Boolean))];
    const { data: jigs } = eqIds.length ? await db.from('jigs').select('id, name, machine_no, line_name, part_name').in('id', eqIds) : { data: [] };
    const jigById = Object.fromEntries((jigs ?? []).map(j => [j.id, j]));

    // Existing reminders for the current due cycles → dedup set "planId|dueDate|stage".
    const { data: sentRows } = await db.from('pm_plan_reminders')
      .select('plan_id, due_date, stage').in('plan_id', plans.map(p => p.id));
    const sent = new Set((sentRows ?? []).map(r => `${r.plan_id}|${r.due_date}|${r.stage}`));

    let fired = 0;
    for (const p of plans) {
      // เลื่อนแผน PM แบบตกลงแล้ว (ยังไม่ถูกทำหลังเลื่อน) → เตือนโดยนับถอยหลังไปวันที่เลื่อน แทนวันเดิม
      const deferActive = p.deferred_to && (!p.last_done_at || (p.deferred_at && new Date(p.last_done_at) < new Date(p.deferred_at)));
      const due = String(deferActive ? p.deferred_to : p.next_due_date);
      const days = daysBetween(today, due);
      const bucket = stageFor(days);
      if (!bucket) continue;
      const key = `${p.id}|${due}|${bucket.stage}`;
      if (sent.has(key)) continue;

      const cl = clById[p.checklist_id];
      const jig = cl ? jigById[cl.equipment_id] : null;
      await notify({
        stage: bucket.stage, stage_label: bucket.label, days,
        due_date: due, reason: p.next_due_reason ?? 'time',
        checklist_name: cl?.name ?? '', frequency: cl?.frequency ?? '',
        jig_name: jig?.name ?? '', machine_no: jig?.machine_no ?? '',
        line_name: jig?.line_name ?? '', part_name: jig?.part_name ?? '',
      });
      await db.from('pm_plan_reminders').insert({ plan_id: p.id, due_date: due, stage: bucket.stage });
      fired++;
    }
    return new Response(JSON.stringify({ ok: true, plans: plans.length, fired }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
