import json, subprocess, pathlib, textwrap
out=pathlib.Path('recordings');(out/'text').mkdir(exist_ok=True)
clips=json.loads((out/'clips.json').read_text()) if (out/'clips.json').exists() else []
for clip in clips:
 raw=clip['path'];duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',raw],text=True).strip());start=max(0,duration-clip['seconds'])
 name=clip['name']
 for kind,text in [('title',clip['title']),('caption','\n'.join(textwrap.wrap(clip['subtitle'],38)))]: (out/'text'/f'{name}-{kind}.txt').write_text(text,encoding='utf-8')
 title=f'recordings/text/{name}-title.txt';caption=f'recordings/text/{name}-caption.txt'
 filters=f"fps=30,pad=1080:1920:0:410:color=0x101820,drawbox=x=60:y=345:w=960:h=3:color=0x54e3b5:t=fill,drawbox=x=60:y=1320:w=960:h=3:color=0x54e3b5:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='VECTORFLOW / COMFYUI':fontcolor=0x54e3b5:fontsize=32:x=60:y=100,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':textfile='{title}':fontcolor=white:fontsize=56:x=60:y=200,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile='{caption}':fontcolor=white:fontsize=43:line_spacing=18:x=60:y=1430,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='Layout Templates':fontcolor=0x8297a5:fontsize=30:x=60:y=1770"
 # Render each line separately to keep font metrics from creating oversized gaps.
 filters=','.join(part for part in filters.split(',') if "textfile=" not in part)
 for kind,lines,size,top,step in [('title',textwrap.wrap(clip['title'],26),52,200,64),('caption',textwrap.wrap(clip['subtitle'],38),43,1430,60)]:
  for index,line in enumerate(lines):
   linefile=out/'text'/f'{name}-{kind}-{index}.txt'
   linefile.write_text(line,encoding='utf-8')
   filters+=f",drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':textfile='{linefile.as_posix()}':fontcolor=white:fontsize={size}:x=60:y={top+index*step}"
 subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',str(start),'-i',raw,'-t',str(clip['seconds']),'-vf',filters,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(out/f'{name}.mp4')],check=True)
 subprocess.run(['ffmpeg','-y','-loglevel','error','-ss','3','-i',str(out/f'{name}.mp4'),'-frames:v','1',str(out/f'{name}-vertical.png')],check=True)
 print('Exported',name,flush=True)
