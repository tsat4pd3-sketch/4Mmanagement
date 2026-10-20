/* 🗓️ แผนประสานงาน PM (`/pm?tab=coord` · `PmCoordination.jsx`) — สรุปงานของแผน 1 ใบ (20/10)
   pure · ใช้ทั้งคอลัมน์ตาราง · การเรียงแถว · แถวเตือน (งานเลยวันที่ยังไม่ติ๊ก) */

/* สรุปงานในแผน 1 ใบ (pure) — ช่วงวัน · งานถัดไปที่ยังไม่ติ๊ก · ค้างเลยวัน
   ใช้ทั้งคอลัมน์ตาราง + เรียงแถว + แถวเตือน · `today` = 'YYYY-MM-DD' */
export function planTaskSummary(tasks = [], today = '') {
  const dates = tasks.map(t => t.task_date).filter(Boolean).sort()
  const open = tasks.filter(t => !t.done && t.task_date).sort((a, b) => String(a.task_date).localeCompare(String(b.task_date)))
  return {
    from: dates[0] || null, to: dates[dates.length - 1] || null,
    next: open.find(t => t.task_date >= today) || null,
    overdue: open.filter(t => t.task_date < today).length,
    doneN: tasks.filter(t => t.done).length, total: tasks.length,
  }
}
