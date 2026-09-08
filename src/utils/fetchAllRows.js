/* fetchAllRows — ดึงทั้งตาราง master แบบ "แบ่งหน้า" ให้ครบเสมอ (2026-09-07)

   กับดัก 1000 แถวของ PostgREST: `select()` เปล่าได้แค่ 1000 แถวแรก ของที่เกินหายจากลิสต์เงียบๆ
   (UI-CONVENTIONS §5.1.1 · CLAUDE.md กฎเหล็ก DB ข้อ 5) · ตัวนี้เดิมอยู่ใน MtnRepair.jsx —
   ย้ายมาเป็น util กลางให้ picker ทุกตัวใช้ร่วม ห้ามก๊อปไปเขียนซ้ำในหน้า

   ⚠️ `shape` ต้องใส่ `.order()` คงที่เสมอ (range ที่ไม่มีลำดับ = แถวหลุด/ซ้ำระหว่างหน้า)
   คืน { data, error } — ผู้เรียกต้องอ่าน error เอง (supabase-js ไม่ throw) */
export async function fetchAllRows(client, table, cols, shape = q => q, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await shape(client.from(table).select(cols)).range(from, from + page - 1);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return { data: out, error: null };
}
export default fetchAllRows;
