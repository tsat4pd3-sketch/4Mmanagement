#!/usr/bin/env bash
# ทำวิดีโอพากย์ไทยจากเด็ค workflow (2026-11-05) — ไม่ต้องใช้เน็ตยกเว้นตอนโหลดโมเดลครั้งแรก
#   ต้องมี: python3 + python-pptx · LibreOffice (soffice) · pdftoppm · ffmpeg
#   เสียง: MMS-TTS ภาษาไทย (offline · sherpa-onnx) — pip install sherpa-onnx soundfile
#          โมเดล: https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-mms-tha.tar.bz2
#   ฟอนต์: เครื่องที่ไม่มี Tahoma ให้ alias Tahoma → ฟอนต์ไทย (เช่น Loma) ใน fontconfig ก่อน ไม่งั้นตัวไทยในภาพเพี้ยน
# ใช้:  TTS_MODEL=/path/vits-mms-tha ./render_workflow_video.sh   → _video_build/ESM_Workflow_Roadshow_TH.mp4
set -euo pipefail
cd "$(dirname "$0")"; OUT="${OUT:-$PWD/_video_build}"; mkdir -p "$OUT"/{audio,frames,seg}
python3 build_workflow_video.py
OUT="$OUT" python3 workflow_tts_synth.py
cp ../TSAT_ESM_Workflow_Roadshow_2026-11-05.pptx "$OUT/frames/deck.pptx"
(cd "$OUT/frames" && soffice --headless --convert-to pdf deck.pptx >/dev/null && pdftoppm -r 144 -png deck.pdf f)
n=$(ls "$OUT"/frames/f-*.png | wc -l); : > "$OUT/seg/list.txt"
for i in $(seq -w 1 "$n"); do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/audio/a$i.wav")
  T=$(python3 -c "print(round($d+2.0,2))")   # หน่วงหน้า 0.8 วิ + เว้นท้าย 1.2 วิ · เสียง 0.9× (SPEED)
  ffmpeg -y -loglevel error -loop 1 -framerate 30 -i "$OUT/frames/f-$i.png" -i "$OUT/audio/a$i.wav" \
    -filter_complex "[1:a]adelay=800|800,apad,aresample=44100[a];[0:v]scale=1920:1080,format=yuv420p[v]" \
    -map "[v]" -map "[a]" -t "$T" -c:v libx264 -preset veryfast -tune stillimage -crf 24 -c:a aac -b:a 128k -ac 1 "$OUT/seg/s$i.mp4"
  echo "file '$OUT/seg/s$i.mp4'" >> "$OUT/seg/list.txt"
done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$OUT/seg/list.txt" -c copy "$OUT/raw.mp4"
ffmpeg -y -loglevel error -i "$OUT/raw.mp4" -c:v copy -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 128k "$OUT/ESM_Workflow_Roadshow_TH.mp4"
echo "done → $OUT/ESM_Workflow_Roadshow_TH.mp4"
