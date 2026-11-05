import json, sys, sherpa_onnx, soundfile as sf
import os
S=os.environ.get('OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '_video_build'))
os.makedirs(f'{S}/audio', exist_ok=True)
m=os.environ.get('TTS_MODEL', 'vits-mms-tha')
toks=set()
for l in open(f'{m}/tokens.txt', encoding='utf-8').read().split('\n'):
    if l: toks.add(' ' if l.startswith(' ') else l.split(' ')[0])
norm=lambda t: t.replace('ำ', 'ํา')
n=[norm(t) for t in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'workflow_narration.json')))]
bad={c for t in n for c in t if c not in toks}
print('unknown chars:', sorted(bad))
if bad and '--force' not in sys.argv: sys.exit(1)
tts=sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f"{m}/model.onnx", tokens=f"{m}/tokens.txt"), num_threads=4)))
tot=0
for i,t in enumerate(n,1):
    a=tts.generate(t, sid=0, speed=1.0); sf.write(f"{S}/audio/a{i:02d}.wav", a.samples, a.sample_rate)
    tot+=len(a.samples)/a.sample_rate
print('total', round(tot/60,2), 'min')
