"""Cut actual recorded UI footage into an offline Mandarin showcase under 120 seconds.

Uses the full video and its recorded-frame timeline. Never launches a browser or
changes application data. Old narration and the old subtitle band are discarded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import wave
from pathlib import Path

FFMPEG = Path('C:/Users/123/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe')
FFPROBE = Path('C:/Users/123/AppData/Local/Microsoft/WinGet/Links/ffprobe.exe')
POWERSHELL = Path('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')

# Chapter-relative times point to captured operations, not the narration tail.
SCENES = [
    ('map_public', '从地图到公开资料', 9,
     '地图选定研究范围，筛选公开公告，保留项目代码与原文出处。',
     [('map', 11.2, 4.6), ('intelligence', 8.6, 4.4)]),
    ('rag_location', '直接提问，定位跨文本举措', 10,
     '直接提问，跳转到同版本原句，再对照不同文本中的同一举措。',
     [('floating_rag', 2.9, 5.5), ('cross_text', 6.8, 4.5)]),
    ('evidence', '资料、引文与审核事实', 8,
     '从资料拆分出可定位引文，保留对象、字段和审核状态的关系。',
     [('evidence_split', 3.3, 2.8), ('evidence_split', 8.8, 5.2)]),
    ('knowledge', '经验归并与因素政策', 9,
     '经验按举措归并；独立合成案例演示因素政策与知识分组。',
     [('experience_library', 4.1, 3), ('factor_policy', 6.4, 6)]),
    ('costs', '1277条补全工程记录', 10,
     '补全版一千二百七十七条工程记录，按金额阶段和地区筛选。',
     [('cost_library', 13.53, 4.57), ('cost_library', 18.1, 5.38)]),
    ('neural', '神经网络：合成与公告试验', 10,
     '合成示例验证预测流程；公告试验误差较大，仍需真实数据校准。',
     [('neural_demo', 2.72, 3.74), ('neural_demo', 6.46, 2.318), ('community_six_dimensions', 0, 2.15)]),
    ('operations', '拖动参数，观察运营变化', 11,
     '调整需求、开放场次与补贴，服务量和资金结余同步变化。',
     [('operations', 0, 10.966)]),
    ('six_dimensions', '六维现况与改造改善', 8,
     '完整模拟社区展示六维现况，切换拟改造方案，查看指标改善。',
     [('community_six_dimensions', 2.25, 6.09)]),
    ('budget_ledger', '情景预算与逐日台账', 9,
     '比较标准情景与年度预算，再用逐日模拟台账核对月末结果。',
     [('standard_scenarios', 3, 5.1), ('daily_ledger', 1.9, 3.9)]),
    ('versions', '版本变化与关键举措', 8,
     '版本对比列出关键举措、参数变化，以及服务与资金的差额。',
     [('versions', 0, 4.63)]),
    ('investigations', '调查任务与报表导出', 10,
     '把资料缺口转为调查任务，填写记录与定位，导出清单和报表。',
     [('investigations_output', 0, 9.493)]),
]


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run(args, log=None, cwd=None):
    result = subprocess.run([str(a) for a in args], cwd=cwd, capture_output=True,
                            encoding='utf-8', errors='replace')
    if log:
        log.write_text(result.stdout + result.stderr, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr[-2500:]}')
    return result.stdout


def srt_time(seconds):
    ms = round(seconds * 1000)
    return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'


def ass_time(seconds):
    cs = round(seconds * 100)
    return f'{cs//360000}:{cs//6000%60:02d}:{cs//100%60:02d}.{cs%100:02d}'


def subtitle_ass(title, narration, duration):
    return f'''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Microsoft YaHei,32,&H00D5EEE6,&H00D5EEE6,&H00163836,&H00163836,-1,0,0,0,100,100,0,0,1,0,0,7,80,80,0,1
Style: Speech,Microsoft YaHei,34,&H00FFFFFF,&H00FFFFFF,&H00163836,&H00163836,0,0,0,0,100,100,0,0,1,0,0,7,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,{ass_time(duration)},Title,,0,0,0,,{{\\pos(80,932)}}{title}
Dialogue: 0,0:00:00.00,{ass_time(duration)},Speech,,0,0,0,,{{\\pos(80,993)}}{narration}
'''


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('output/video/full-feature-20261014/rendered/老旧小区改造工作台_全功能演示.mp4'))
    parser.add_argument('--coverage', type=Path, default=Path('output/video/full-feature-20261014/rendered/章节覆盖与时间线.json'))
    parser.add_argument('--output', type=Path, default=Path('output/video/full-feature-20261014/short'))
    parser.add_argument('--render-only', help='Reuse existing clips except these comma-separated scene keys')
    args = parser.parse_args()
    source, coverage = args.source.resolve(), args.coverage.resolve()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    voices, clips, logs = out/'voice', out/'clips', out/'logs'
    for folder in (voices, clips, logs):
        folder.mkdir(exist_ok=True)
    meta = json.loads(coverage.read_text(encoding='utf-8-sig'))
    chapters = {c['key']: c for c in meta['chapters']}
    plan = {'utterances': [{'id': s[0], 'text': s[3]} for s in SCENES]}
    plan_file = out/'narration-plan.json'
    write_json(plan_file, plan)
    if not args.render_only:
        run([POWERSHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
             Path('scripts/synthesize-feature-narration.ps1').resolve(), '-PlanPath', plan_file,
             '-OutputDirectory', voices, '-Rate', '0'], logs/'speech.log')
    render_keys = set(args.render_only.split(',')) if args.render_only else None
    output_rows, subtitles = [], []
    cursor = 0.0
    for i, (key, title, duration, narration, selections) in enumerate(SCENES, 1):
        inputs, filters, intervals = [], [], []
        for j, (chapter_key, relative, length) in enumerate(selections):
            chapter = chapters[chapter_key]
            if relative < 0 or relative + length > chapter['edited_visual_seconds'] + .05:
                raise ValueError(f'{key}: selected interval extends beyond recorded footage')
            start = chapter['start_seconds'] + relative
            inputs += ['-ss', f'{start:.6f}', '-t', f'{length:.6f}', '-i', source]
            filters.append(f'[{j}:v]trim=duration={length:.6f},setpts=PTS-STARTPTS,crop=1920:920:0:0,fps=30,setsar=1[v{j}]')
            frame_ids = [f['source_sequence'] for f in chapter['frame_timeline']
                         if f['edited_start_seconds'] < relative + length
                         and f['edited_start_seconds'] + f['duration_seconds'] > relative]
            intervals.append({'chapter_key': chapter_key, 'chapter_relative_start_seconds': relative,
                              'source_video_start_seconds': start, 'source_video_end_seconds': start+length,
                              'duration_seconds': length, 'recorded_frame_sequences': frame_ids})
        wav = voices/(key+'.wav')
        with wave.open(str(wav), 'rb') as audio:
            speech_duration = audio.getnframes()/audio.getframerate()
        if speech_duration > duration-.2:
            raise ValueError(f'Narration exceeds allocated scene: {key}: {speech_duration:.2f}s')
        ass_file = clips/(key+'.ass')
        ass_file.write_text(subtitle_ass(f'{i:02d} · {title}', narration, duration), encoding='utf-8')
        # Retain real-time recorded operation; only freeze the final UI where narration needs reading time.
        filters.append(''.join(f'[v{j}]' for j in range(len(selections))) + f'concat=n={len(selections)}:v=1:a=0[sequence]')
        filters.append(f'[sequence]tpad=stop_mode=clone:stop_duration={duration},trim=duration={duration},pad=1920:1080:0:0:color=0x163836,ass={ass_file.name}[picture]')
        filters.append(f'[{len(selections)}:a]aresample=48000,apad,atrim=duration={duration},asetpts=PTS-STARTPTS[speech]')
        target = clips/(key+'.mp4')
        if render_keys is None or key in render_keys:
            run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'warning', *inputs, '-i', wav,
                 '-filter_complex', ';'.join(filters), '-map', '[picture]', '-map', '[speech]',
                 '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
                 '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', str(duration),
                 '-movflags', '+faststart', target], logs/(key+'.log'), cwd=clips)
        elif not target.is_file():
            raise FileNotFoundError(f'Cannot reuse missing clip: {target}')
        output_rows.append({'key': key, 'title': title, 'output_start_seconds': cursor,
                            'output_end_seconds': cursor+duration, 'duration_seconds': duration,
                            'narration': narration, 'speech_seconds': speech_duration,
                            'final_ui_reading_hold_seconds': max(0, duration-sum(s[2] for s in selections)),
                            'source_intervals': intervals})
        subtitles.append(f'{i}\n{srt_time(cursor)} --> {srt_time(cursor+duration)}\n{narration}\n')
        cursor += duration
        print(f'RENDERED {i:02d} {key} {duration}s', flush=True)
    if cursor > 115:
        raise ValueError('Short edit must stay below 115 seconds')
    concat_file = out/'short.ffconcat'
    concat_file.write_text('ffconcat version 1.0\n'+''.join(f"file '{(clips/(s[0]+'.mp4')).as_posix()}'\n" for s in SCENES), encoding='utf-8')
    chapter_file = out/'short.ffmetadata'
    chapter_file.write_text(';FFMETADATA1\ntitle=老旧小区改造工作台 · 两分钟内精华演示\n'+''.join(
        f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={round(r['output_start_seconds']*1000)}\nEND={round(r['output_end_seconds']*1000)}\ntitle={r['title']}\n" for r in output_rows), encoding='utf-8')
    final = out/'老旧小区改造工作台_2分钟内精华版.mp4'
    run([FFMPEG, '-y', '-hide_banner', '-loglevel', 'warning', '-f', 'concat', '-safe', '0',
         '-i', concat_file, '-i', chapter_file, '-map_metadata', '1', '-map_chapters', '1',
         '-c', 'copy', '-movflags', '+faststart', final], logs/'concatenate.log')
    (out/'老旧小区改造工作台_2分钟内精华版.srt').write_text('\n'.join(subtitles), encoding='utf-8')
    (out/'短版旁白.md').write_text('# 两分钟以内功能演示旁白\n\n'+ '\n\n'.join(
        f"{r['output_start_seconds']:.0f}–{r['output_end_seconds']:.0f}秒 · {r['title']}\n\n{r['narration']}" for r in output_rows)+'\n', encoding='utf-8')
    write_json(out/'短版选段.json', {'source_video': str(source), 'source_coverage': str(coverage),
               'video': str(final), 'network_used': False, 'old_audio_discarded': True,
               'source_crop': {'x':0,'y':0,'width':1920,'height':920}, 'scenes': output_rows,
               'planned_duration_seconds': cursor})
    probe = json.loads(run([FFPROBE, '-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', final]))
    seconds = float(probe['format']['duration'])
    video = next(s for s in probe['streams'] if s['codec_type']=='video')
    audio = next(s for s in probe['streams'] if s['codec_type']=='audio')
    if seconds > 120 or (video['width'],video['height']) != (1920,1080) or video['codec_name'] != 'h264' or audio['codec_name'] != 'aac':
        raise ValueError('Delivery format or duration does not meet request')
    run([FFMPEG, '-v', 'error', '-i', final, '-f', 'null', '-'], logs/'complete-decode.log')
    samples=[]
    for i, seconds_at in enumerate((5.0, 14.0, 68.0), 1):
        picture=out/f'preview-{i}.jpg'
        run([FFMPEG, '-y', '-v', 'error', '-ss', str(seconds_at), '-i', final, '-frames:v', '1', '-q:v', '2', picture])
        samples.append({'time_seconds':seconds_at, 'file':str(picture)})
    validation={'video':str(final),'duration_seconds':seconds,'size_bytes':final.stat().st_size,
                'video_codec':video['codec_name'],'audio_codec':audio['codec_name'],
                'width':video['width'],'height':video['height'],'chapters':len(probe.get('chapters',[])),
                'complete_decode':'passed','samples':samples,'network_used':False}
    write_json(out/'短版播放验证.json',validation)
    write_json(out/'verification.json', {'path':str(final), 'seconds':seconds,
               'bytes':final.stat().st_size,'sha256':hashlib.sha256(final.read_bytes()).hexdigest(),
               'passed':True,'checks':{'duration_under_120':seconds<=120,
               'format_h264_aac_1080p':True,'complete_decode':True,
               'visual_samples':samples}})
    print(json.dumps(validation,ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
