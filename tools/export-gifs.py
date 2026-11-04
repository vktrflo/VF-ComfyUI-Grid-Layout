"""Encode recordings/demos/*.mp4 into docs/media/*.gif for the README.

Usage: python tools/export-gifs.py [clip-prefix ...]

Every GIF is 600x392 at 9 fps with one palette for the whole clip. A clip over
the size target retries with fewer colors, which the README cares about less
than a small download.
"""
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
source = root / 'recordings' / 'demos'
target = root / 'docs' / 'media'
limit = 1_500_000
attempts = [(256, 'bayer:bayer_scale=4'), (128, 'bayer:bayer_scale=4'), (64, 'bayer:bayer_scale=3'), (48, 'none')]


def encode(clip, out, colors, dither):
    scale = 'fps=9,scale=600:392:flags=lanczos'
    with tempfile.TemporaryDirectory() as temp:
        palette = Path(temp) / 'palette.png'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(clip), '-vf',
                        f'{scale},palettegen=max_colors={colors}:stats_mode=diff', str(palette)], check=True)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(clip), '-i', str(palette),
                        '-lavfi', f'{scale}[x];[x][1:v]paletteuse=dither={dither}:diff_mode=rectangle',
                        '-loop', '0', str(out)], check=True)


only = sys.argv[1:]
for clip in sorted(source.glob('*.mp4')):
    if only and not any(clip.stem.startswith(item) for item in only):
        continue
    out = target / (clip.stem + '.gif')
    for colors, dither in attempts:
        encode(clip, out, colors, dither)
        if out.stat().st_size <= limit:
            break
        print(f'{out.name}  {out.stat().st_size / 1_000_000:.2f} MB at {colors} colors, retrying', flush=True)
    print(f'{out.name}  {out.stat().st_size / 1_000_000:.2f} MB', flush=True)
