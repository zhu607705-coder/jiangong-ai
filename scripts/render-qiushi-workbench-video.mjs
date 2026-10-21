import fs from 'node:fs';import path from 'node:path';import {spawnSync}from'node:child_process';
const dir=path.resolve('output/playwright/qiushi-demo'),meta=JSON.parse(fs.readFileSync(path.join(dir,'recording.json'),'utf8'));const total=meta.target_seconds;
const args=['-y','-hide_banner','-ss',String(meta.trim_start_seconds),'-i',meta.raw_video];const filters=[];
for(let i=0;i<meta.timeline.length;i++){
 const wav=path.resolve('data/local/qiushi-recording',`voice-${String(i).padStart(2,'0')}.wav`);
 const duration=Number(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',wav],{encoding:'utf8'}).stdout.trim());
 const scene=meta.timeline[i],next=meta.timeline[i+1]?.start??total,available=Math.min(scene.seconds,next-scene.start)-.5,rate=Math.max(1,duration/available);args.push('-i',wav);
 filters.push(`[${i+1}:a]atempo=${rate.toFixed(4)},adelay=${Math.round((scene.start+.25)*1000)}:all=1[a${i}]`);
}
filters.push(meta.timeline.map((_,i)=>`[a${i}]`).join('')+`amix=inputs=${meta.timeline.length}:duration=longest:normalize=0,apad,atrim=duration=${total},loudnorm=I=-18:TP=-1.5:LRA=7[voice]`);
args.push('-filter_complex',filters.join(';'),'-map','0:v:0','-map','[voice]','-vf','scale=1920:1080:flags=lanczos,fps=30','-c:v','libx264','-preset','medium','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-ar','48000','-t',String(total),'-movflags','+faststart',path.join(dir,'求是村_工作台演示_约2分钟.mp4'));
const process=spawnSync('ffmpeg',args,{encoding:'utf8',maxBuffer:8*1024*1024});fs.writeFileSync(path.join(dir,'render.log'),process.stderr);if(process.status!==0)throw Error(process.stderr.slice(-1500));
function timestamp(s){const m=Math.round(s*1000),hour=Math.floor(m/3600000),min=Math.floor(m/60000)%60,sec=Math.floor(m/1000)%60,ms=m%1000;return `${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`}
const srt=meta.timeline.map((c,i)=>`${i+1}\n${timestamp(c.start+.25)} --> ${timestamp(Math.min(total,meta.timeline[i+1]?.start??total,c.start+c.seconds)-.1)}\n${c.text}\n`).join('\n');fs.writeFileSync(path.join(dir,'求是村_工作台演示.srt'),srt);
fs.writeFileSync(path.join(dir,'解说与章节.md'),'# 求是村工作台演示\n\n约2分03秒，真实页面操作。方案试算只使用操作假设，未批准案例/因素政策/技能，未新增模型调用。\n\n'+meta.timeline.map(c=>`- ${Math.round(c.start)}秒｜${c.title}\n  ${c.text}`).join('\n'));
console.log('RENDERED',total,'seconds');