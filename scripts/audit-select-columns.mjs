#!/usr/bin/env node
/* ── audit-select-columns — จับ "พิมพ์ชื่อคอลัมน์ผิดใน .select()" (2026-09-22) ─────────────
 *
 * ═══ ทำไมต้องมีเครื่องมือนี้ ═══════════════════════════════════════════════════════
 * 22/09 เจอ `downtime_logs.reason` ใน `ObeyaSqdcmBoard` — **ไม่มีคอลัมน์ชื่อนี้ในตาราง**
 * (ของจริงคือ `description`) คิวรีล้มทั้งก้อน ⇒ แผง "ทำไมถึงหลุดเป้า" กับครึ่งหนึ่งของ C
 * ว่างเปล่ามาตั้งแต่สร้างบอร์ด · วันเดียวกันเจออีกตัว `four_m_logs.created_by_name`
 * ใน `/dept-dashboard` ⇒ การ์ด "4M รออนุมัติ" ขึ้น 0 ทั้งที่ค้างจริง 16 ใบ
 *
 * 🔴 **ด่านที่มีอยู่จับคลาสนี้ไม่ได้เลยสักด่าน:**
 *   · `npm run build` / lint  — มันคือ "สตริง" ตัวหนึ่ง ไม่มีใครรู้ว่าผิด
 *   · เทส                     — ไม่ได้ต่อฐาน
 *   · `crashsweep`            — mock คืนทุกคอลัมน์เสมอ `d.reason` เลยได้ `undefined` เฉยๆ ไม่ throw
 *   · ตาคน                    — คิวรีล้มแล้วหน้าตาเหมือน "ยังไม่มีข้อมูล" เป๊ะ
 * ⇒ เห็นได้ทางเดียวคือ **เทียบกับ schema จริง** ซึ่งต้องต่อเน็ต ⇒ เอาเข้า build ไม่ได้
 *   (build ต้องรันได้ออฟไลน์) จึงทำเป็นสคริปต์ให้เรียกเป็นระยะแทน
 *
 * ═══ วิธีใช้ (AI session ที่มี Supabase MCP) ══════════════════════════════════════
 *   1) `node scripts/audit-select-columns.mjs --tables DR`    → ได้ลิสต์ชื่อตารางฝั่ง DR
 *      เอาไปใส่ใน SQL นี้ (รันบน project ที่ตรงกัน — DR = "Product DB" / MAIN = "MAIN"):
 *
 *        select string_agg(table_name||':'||cols, E'\n' order by table_name) from (
 *          select table_name, string_agg(column_name, ',' order by column_name) as cols
 *          from information_schema.columns
 *          where table_schema='public' and table_name in (<วางลิสต์ตรงนี้>)
 *          group by table_name) x;
 *
 *   2) เซฟผลเป็นไฟล์ (บรรทัดละ `ตาราง:คอลัมน์,คอลัมน์,...`)
 *   3) `node scripts/audit-select-columns.mjs --check <ไฟล์> --client supabaseDR`
 *      → ขึ้น 🔴 เฉพาะคอลัมน์ที่ไม่มีจริง พร้อม file:line
 *
 * ⚠️ **ตารางที่ไม่อยู่ใน dump จะถูกข้าม ไม่ใช่ถือว่าผ่าน** — เจตนา เพราะรีโปมีทั้ง table/view/RPC
 *    และบาง client ชี้คนละ project · ข้ามดีกว่าเตือนผิดจนคนเลิกเชื่อเครื่องมือ
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
/* ⚠️ ระหว่าง `.from()` กับ `.select()` มี **คอมเมนต์คั่นได้** (โปรเจคนี้เขียนคอมเมนต์เยอะมาก)
 *    เดิมอนุญาตแค่ whitespace ⇒ คิวรีที่มีคอมเมนต์คั่น **ถูกข้ามเงียบ** แล้วสคริปต์รายงาน
 *    "ไม่มีในฐาน 0 ตัว" ทั้งที่ยังมีบั๊กอยู่ — เครื่องมือตรวจที่โกหกแย่กว่าไม่มีเครื่องมือ
 *    (เจอตอนทดสอบสคริปต์นี้เอง 22/09: ใส่บั๊กกลับเข้าไปแล้วมันจับไม่ได้) */
const GAP = String.raw`(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*`;
const PAT = new RegExp(
  String.raw`(supabaseDR|supabase)${GAP}\.from\(${GAP}'([a-z0-9_]+)'${GAP}\)${GAP}\.select\(${GAP}(['"])([\s\S]*?)\3`, 'g');
/** นับ `.select(` ทั้งหมดในไฟล์ เอาไว้เทียบว่าสคริปต์ "มองเห็น" กี่ % (กัน blind spot เงียบ) */
const SELECT_ANY = /\.select\(\s*['"]/g;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** ตัด embedded relation ออกให้หมด — **ต้องวนจนนิ่ง** ไม่ใช่รอบเดียว
 *  `employees(id, name, employee_skills(skill_name))` ซ้อน 2 ชั้น: ตัดรอบเดียวได้แค่ชั้นใน
 *  แล้วคอลัมน์ของชั้นนอกรั่วออกมาเป็น false positive (เจอจริง 13 จุดตอนเขียนสคริปต์นี้) */
function flatten(cols) {
  let prev;
  do { prev = cols; cols = cols.replace(/\w+\s*(?:!\w+)?\([^()]*\)/g, ''); } while (prev !== cols);
  return cols;
}

let seenSelects = 0, matchedSelects = 0;
function extract() {
  const used = new Map();                 // `client|table` → Map(column → [file:line])
  for (const file of walk(SRC)) {
    const s = readFileSync(file, 'utf8');
    seenSelects += [...s.matchAll(SELECT_ANY)].length;
    for (const m of s.matchAll(PAT)) {
      matchedSelects++;
      const [, client, table, , cols] = m;
      const key = `${client}|${table}`;
      if (!used.has(key)) used.set(key, new Map());
      const line = s.slice(0, m.index).split('\n').length;
      for (let c of flatten(cols).split(',')) {
        c = c.trim().split(':')[0].trim();
        if (!/^[a-z0-9_]+$/.test(c)) continue;      // ข้าม `*`, `...spread`, alias แปลกๆ
        if (!used.get(key).has(c)) used.get(key).set(c, []);
        used.get(key).get(c).push(`${file}:${line}`);
      }
    }
  }
  return used;
}

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const used = extract();

if (arg('--tables')) {
  const client = arg('--tables') === 'DR' ? 'supabaseDR' : 'supabase';
  const tables = [...new Set([...used.keys()].filter(k => k.startsWith(client + '|')).map(k => k.split('|')[1]))].sort();
  console.log(tables.map(t => `'${t}'`).join(','));
  console.log(`\n// ${tables.length} ตาราง · client ${client}`);
  process.exit(0);
}

const dumpFile = arg('--check');
const client = arg('--client') || 'supabaseDR';
if (!dumpFile) {
  console.error('ใช้: --tables DR|MAIN  หรือ  --check <schema-dump> --client supabaseDR|supabase');
  process.exit(2);
}

const real = new Map();
for (const line of readFileSync(dumpFile, 'utf8').trim().split('\n')) {
  const i = line.indexOf(':');
  if (i < 0) continue;
  real.set(line.slice(0, i).trim(), new Set(line.slice(i + 1).split(',').map(x => x.trim())));
}

let checked = 0, bad = 0, skipped = 0;
for (const [key, cols] of [...used].sort()) {
  const [cl, table] = key.split('|');
  if (cl !== client) continue;
  if (!real.has(table)) { skipped++; continue; }
  for (const [c, at] of cols) {
    checked++;
    if (!real.get(table).has(c)) { bad++; console.log(`🔴 ${table}.${c}\n   ${at.join('\n   ')}`); }
  }
}
console.log(`\n${client}: ตรวจ ${checked} คอลัมน์ · ไม่มีในฐาน ${bad} ตัว · ข้าม ${skipped} ตาราง (ไม่อยู่ใน dump)`);
/* บอก coverage เสมอ — ถ้าตัวเลขนี้ต่ำ แปลว่าสคริปต์มองไม่เห็นคิวรีอีกเยอะ **ห้ามอ่านผล "0 ตัว" ว่าปลอดภัย** */
console.log(`   มองเห็น ${matchedSelects}/${seenSelects} จุดที่มี .select('...') ทั้งรีโป`
  + (matchedSelects < seenSelects ? `  ⚠️ อีก ${seenSelects - matchedSelects} จุดยังแกะไม่ได้ (เช่น เรียกผ่านตัวแปร/ห่อฟังก์ชัน) — ต้องตรวจมือ` : ''));
process.exit(bad ? 1 : 0);
