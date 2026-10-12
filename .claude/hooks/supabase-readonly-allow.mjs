#!/usr/bin/env node
// PermissionRequest hook — กด Allow ให้เองเฉพาะ Supabase MCP ที่ "อ่านอย่างเดียว"
// (คำสั่ง user 2026-10-12: ไม่อยากต้องใช้มือจับเมาส์ไล่กด Allow ทีละ session)
//
// กติกา fail-closed: ตัดสินไม่ได้ / แกะไม่ออก / มีอะไรน่าสงสัย = ไม่ตอบอะไร
// ⇒ prompt ขึ้นให้คนกดเหมือนเดิม (ไม่มีทาง deny เอง ไม่มีทาง allow ผิด)
//  - execute_sql: ผ่านเฉพาะ SELECT/WITH/SHOW/EXPLAIN (ไม่ ANALYZE) คำสั่งเดียว
//    ไม่มีคำเขียน และเรียกได้เฉพาะฟังก์ชันใน READ_FNS (ฟังก์ชันของโปรเจคเช่น fn_* อาจเขียน DB)
//  - เครื่องมือ list_* / get_* / search_docs / query_logs (ไม่มีตัวไหนเขียนข้อมูล)
//  - อย่างอื่นทั้งหมด (apply_migration, deploy_edge_function, *_branch ฯลฯ) = ให้คนกด

const READONLY_TOOL = /^mcp__Supabase__(list_\w+|get_\w+|search_docs|query_logs)$/;

const FIRST_KW = new Set(['select', 'with', 'show', 'explain', 'table', 'values']);

const WRITE_WORDS = new Set([
  'insert', 'update', 'delete', 'merge', 'upsert', 'drop', 'alter', 'create', 'truncate',
  'grant', 'revoke', 'copy', 'call', 'do', 'set', 'reset', 'vacuum', 'analyze', 'analyse',
  'cluster', 'reindex', 'comment', 'refresh', 'lock', 'listen', 'notify', 'unlisten',
  'prepare', 'execute', 'deallocate', 'discard', 'into', 'import', 'security', 'owner',
  'checkpoint', 'load', 'begin', 'commit', 'rollback', 'savepoint', 'release',
]);

// คำ SQL ที่ตามด้วย "(" ได้โดยไม่ใช่การเรียกฟังก์ชัน
const KW_PAREN = new Set([
  'as', 'in', 'exists', 'any', 'all', 'some', 'on', 'using', 'over', 'filter', 'within',
  'from', 'where', 'and', 'or', 'not', 'select', 'join', 'values', 'cast', 'when', 'then',
  'else', 'lateral', 'window', 'partition', 'like', 'ilike', 'is', 'between', 'array', 'row',
  'with', 'by', 'having', 'union', 'except', 'intersect', 'case', 'distinct', 'returning',
  'materialized', 'recursive', 'explain', 'interval', 'similar', 'to', 'escape', 'group',
  'order', 'limit', 'offset', 'tablesample', 'rows', 'range', 'groups', 'cube', 'rollup',
  'grouping', 'sets', 'nulls', 'first', 'last', 'asc', 'desc', 'only',
]);

const READ_FNS = new Set(`
count sum avg min max coalesce nullif greatest least now current_date current_timestamp
date_trunc date_part extract to_char to_date to_timestamp to_number age make_date make_interval
lower upper initcap length char_length trim btrim ltrim rtrim substring substr left right
replace split_part concat concat_ws string_agg array_agg json_agg jsonb_agg json_object_agg
jsonb_object_agg json_build_object jsonb_build_object json_build_array jsonb_build_array
row_to_json to_json to_jsonb json_array_elements jsonb_array_elements jsonb_array_elements_text
json_array_elements_text jsonb_each jsonb_each_text json_each jsonb_object_keys json_object_keys
json_array_length jsonb_array_length jsonb_typeof json_typeof jsonb_strip_nulls jsonb_pretty
round floor ceil ceiling abs trunc mod power sqrt sign exp ln log random
generate_series unnest array_length array_to_string string_to_array cardinality array_position
format lpad rpad reverse position strpos md5 encode decode regexp_replace regexp_match
regexp_matches regexp_split_to_array regexp_split_to_table starts_with translate repeat chr ascii
row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value nth_value
percentile_cont percentile_disc mode bool_or bool_and every stddev variance corr
timezone date time timestamp timestamptz numeric int integer bigint text varchar char boolean
float real decimal uuid jsonb json
pg_size_pretty pg_total_relation_size pg_relation_size pg_table_size pg_indexes_size
pg_database_size pg_get_functiondef pg_get_function_arguments pg_get_function_result
pg_get_viewdef pg_get_constraintdef pg_get_indexdef pg_get_triggerdef pg_get_expr
pg_get_userbyid pg_typeof obj_description col_description format_type current_setting
has_table_privilege has_column_privilege has_function_privilege has_schema_privilege
work_date_bangkok machine_key has_perm
`.split(/\s+/).filter(Boolean));

/** คืน true เมื่อมั่นใจว่า SQL นี้อ่านอย่างเดียว · ไม่แน่ใจ = false */
export function isReadOnlySql(sql) {
  if (typeof sql !== 'string' || !sql.trim() || sql.length > 20000) return false;
  if (/\$[A-Za-z_0-9]*\$/.test(sql)) return false;            // dollar-quote = DO/ฟังก์ชันซ่อนข้างใน
  let s = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')                          // คอมเมนต์ /* */
    .replace(/--[^\n]*/g, ' ')                                  // คอมเมนต์ --
    .replace(/'(?:[^']|'')*'/g, ' strlit ')                     // สตริง → strlit
    .replace(/"(?:[^"]|"")*"/g, ' qident ');                    // "ชื่อ" → qident (ไม่อยู่ใน READ_FNS)
  if (/['"]/.test(s)) return false;                             // quote ไม่ปิด = แกะไม่ออก
  s = s.toLowerCase().trim().replace(/;\s*$/, '');
  if (s.includes(';')) return false;                            // หลายคำสั่ง
  const words = s.match(/[a-z_][a-z0-9_$]*/g) || [];
  if (!FIRST_KW.has(words[0])) return false;
  if (words.some(w => WRITE_WORDS.has(w))) return false;
  if (/\bfor\s+(update|share|no\s+key|key)\b/.test(s)) return false;
  // ทุกการเรียกฟังก์ชันต้องอยู่ในรายการอ่านอย่างเดียว (ตัดชื่อ schema ออก)
  for (const m of s.matchAll(/([a-z_][a-z0-9_$]*)\s*\(/g)) {
    const name = m[1];
    if (KW_PAREN.has(name) || READ_FNS.has(name)) continue;
    // alias(col,...) หลัง from/join เช่น "as t(a,b)" — ไม่แน่ใจ ⇒ ไม่ผ่าน
    return false;
  }
  return true;
}

export function decide(input) {
  const tool = input?.tool_name || '';
  if (tool === 'mcp__Supabase__execute_sql') return isReadOnlySql(input?.tool_input?.query);
  return READONLY_TOOL.test(tool);
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (!decide(input)) return;                                   // เงียบ = ให้คนกดตามปกติ
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {});                                       // พังเมื่อไหร่ = prompt ขึ้นตามเดิม
}
