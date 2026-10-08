"""Export undecorated demo footage, trimming browser startup and setup."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1] / 'recordings'
out = root / 'mouse-tracking'
out.mkdir(exist_ok=True)
for clip in json.loads((root / 'clips.json').read_text(encoding='utf-8')):
    duration = float(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', clip['path']], text=True).strip())
    target = out / (clip['name'] + '.mp4')
    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error', '-ss',
        str(max(0, duration - clip['seconds'])), '-i', clip['path'],
        '-t', str(clip['seconds']), '-an', '-c:v', 'libx264',
        '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', str(target)], check=True)
    print('Exported', target.name, flush=True)
