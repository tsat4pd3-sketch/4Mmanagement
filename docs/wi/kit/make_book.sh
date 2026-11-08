#!/bin/bash
# สร้างคู่มือ WI 1 เล่มจากศูนย์: เตรียม mock → เปิด vite โหมดทดสอบ → ถ่ายจอ → สร้าง pptx → ปิด vite
# ใช้: docs/wi/kit/make_book.sh <book: ps|prod|wh|mtn|qa|eng> <OUTDIR> [PORT] [id1,id2 (ถ่ายเฉพาะบางภาพ)]
set -u
BOOK=$1; OUT=$2; PORT=${3:-5230}; ONLY=${4:-}
REPO=$(cd "$(dirname "$0")/../../.." && pwd); KIT=$REPO/docs/wi/kit; B=$REPO/docs/wi/books/$BOOK
mkdir -p "$OUT/shots"
# 0) dependency ให้ตรง package.json ของ main ปัจจุบัน (main เพิ่ม package = vite resolve ไม่ได้ = จอว่าง)
(cd "$REPO" && npm ls --depth=0 >/dev/null 2>&1 || npm install --no-audit --no-fund >/dev/null 2>&1) || { echo "❌ npm install ไม่ผ่าน"; exit 3; }
# 1) mock = audit/mockSupabase.js ปัจจุบัน + patch ของเล่ม (patch ไม่ลง = หยุด ให้คนแก้ patch — ห้ามถ่ายด้วย mock ผิด)
cp "$REPO/audit/mockSupabase.js" "$OUT/mock.js"
(cd "$OUT" && patch -s -p1 --fuzz=3 --no-backup-if-mismatch < "$B/mock.patch") || { echo "❌ mock.patch ของ $BOOK ลงไม่ได้กับ audit/mockSupabase.js ปัจจุบัน — แก้ patch ก่อน"; exit 2; }
# 2) vite config ของเล่มนี้ (cacheDir แยก — vite หลายตัวใช้ cache ร่วมกัน = 504 Outdated Optimize Dep)
cat > "$OUT/vite.config.mjs" <<CFG
import { defineConfig } from '$REPO/node_modules/vite/dist/node/index.js'
import react from '$REPO/node_modules/@vitejs/plugin-react/dist/index.js'
const MOCK = '$OUT/mock.js'
export default defineConfig({
  root: '$REPO', cacheDir: '$OUT/.vitecache',
  plugins: [react()],
  resolve: { alias: [
    { find: /(^|\/)\.\.\/supabaseClient\$/, replacement: MOCK },
    { find: /^\.\.\/\.\.\/supabaseClient\$/, replacement: MOCK },
    { find: /^\.\/supabaseClient\$/, replacement: MOCK },
  ]},
  server: { port: $PORT, strictPort: true, fs: { allow: ['$REPO', '$OUT'] } },
})
CFG
cd "$REPO"; node node_modules/vite/bin/vite.js --config "$OUT/vite.config.mjs" > "$OUT/vite.log" 2>&1 & VPID=$!
trap 'kill $VPID 2>/dev/null' EXIT          # ⚠️ ปิดด้วย PID เท่านั้น — ห้าม pkill -f (ฆ่า shell ตัวเอง)
for i in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$PORT/audit/index.html" && break; sleep 1; done
# 3) ถ่ายจอ (เล่มที่มี shoot.mjs ของตัวเองใช้ตัวนั้น)
SHOOT="$KIT/shoot.mjs"; [ -f "$B/shoot.mjs" ] && SHOOT="$B/shoot.mjs"
PORT=$PORT node "$SHOOT" "$OUT/shots" "$B/spec.json" $ONLY | tee "$OUT/shoot.log"
grep -q CRASH "$OUT/shoot.log" && echo "⚠️ มีหน้าพังระหว่างถ่าย — ดู shoot.log (504 Outdated Optimize Dep = รันซ้ำ ไม่ใช่บั๊กโปรแกรม)"
# 4) สร้าง pptx
NAME=$(python3 -c "import json;print(json.load(open('$REPO/docs/wi/books.json'))['$BOOK']['file'])")
python3 "$KIT/wi_build.py" "$B/content.py" "$OUT/shots" "$OUT/$NAME"
