"""Assemble captured browser JPEGs and local Mandarin narration; never operates a browser.

Usage: python scripts/assemble-feature-video.py --manifest capture.json --output output/video/demo
Only exactly repeated image bytes can shorten a wait. Distinct captured frames retain their
wall-clock order and duration. Invalid takes remain in the source manifest and are omitted.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import wave
from pathlib import Path

FFMPEG = Path("C:/Users/123/AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe")
FFPROBE = Path("C:/Users/123/AppData/Local/Microsoft/WinGet/Links/ffprobe.exe")
POWERSHELL = Path("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
WIDTH, HEIGHT, PICTURE_HEIGHT, FPS = 1920, 1080, 920, 30


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run(args, log: Path | None = None, cwd: Path | None = None):
    result = subprocess.run([str(arg) for arg in args], cwd=cwd, capture_output=True,
                            encoding="utf-8", errors="replace", check=False)
    if log:
        log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}): {args[0]}\n{result.stderr[-3500:]}")
    return result


def ffconcat_path(path: Path):
    return str(path.resolve()).replace("\\", "/").replace("'", "'\\''")


def normalized_frame(frame_run, directory: Path):
    """Keep changing capture dimensions from resetting FFmpeg's filter timestamps."""
    from PIL import Image, ImageOps
    directory.mkdir(exist_ok=True)
    destination = directory / f"{frame_run['sha256']}.jpg"
    if not destination.exists():
        with Image.open(frame_run["file"]) as source:
            picture = ImageOps.contain(source.convert("RGB"), (WIDTH, PICTURE_HEIGHT), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (WIDTH, PICTURE_HEIGHT), "#f2f6f3")
            canvas.paste(picture, ((WIDTH-picture.width)//2, (PICTURE_HEIGHT-picture.height)//2))
            canvas.save(destination, quality=95, subsampling=0)
    return destination


def srt_time(seconds: float):
    total = round(seconds * 1000)
    return f"{total // 3600000:02d}:{total // 60000 % 60:02d}:{total // 1000 % 60:02d},{total % 1000:03d}"


def ass_time(seconds: float):
    total = round(seconds * 100)
    return f"{total // 360000:01d}:{total // 6000 % 60:02d}:{total // 100 % 60:02d}.{total % 100:02d}"


def ass_text(text: str):
    return text.replace("\\", "\\\\").replace("{", r"\{").replace("}", r"\}").replace("\n", r"\N")


def meta_text(text: str):
    return text.replace("\\", "\\\\").replace("=", r"\=").replace(";", r"\;").replace("#", r"\#").replace("\n", " ")


def wave_info(path: Path):
    with wave.open(str(path), "rb") as audio:
        return {"channels": audio.getnchannels(), "sample_width": audio.getsampwidth(),
                "rate": audio.getframerate(), "frames": audio.getnframes(),
                "duration": audio.getnframes() / audio.getframerate()}


def frame_runs(frames, chapter, max_static_wait: float):
    start, end = float(chapter["start_ms"]), float(chapter["end_ms"])
    if not math.isfinite(start + end) or end <= start:
        raise ValueError(f"Invalid chapter interval: {chapter.get('key')}")
    selected = [frame for frame in frames if start <= float(frame["wall_ms"]) < end]
    if not selected:
        raise ValueError(f"No captured frames cover chapter {chapter.get('key')}")
    selected.sort(key=lambda item: (float(item["wall_ms"]), int(item.get("sequence") or 0)))
    runs = []
    from PIL import Image
    for index, frame in enumerate(selected):
        file = Path(frame["file"]).resolve()
        if not file.is_file():
            raise FileNotFoundError(file)
        with Image.open(file) as picture:
            size = picture.size
        next_ms = float(selected[index + 1]["wall_ms"]) if index + 1 < len(selected) else end
        source_start = max(start, float(frame["wall_ms"])) if index else start
        duration = max(0, (min(next_ms, end) - source_start) / 1000)
        if duration == 0:
            continue
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        if runs and runs[-1]["sha256"] == digest:
            runs[-1]["source_end_ms"] = min(next_ms, end)
            runs[-1]["source_duration_seconds"] += duration
            runs[-1]["source_frame_count"] += 1
            runs[-1]["last_manifest_frame_index"] = frame.get("manifest_index")
        else:
            runs.append({"file": str(file), "sha256": digest, "source_frame_wall_ms": frame["wall_ms"], "source_sequence": frame.get("sequence"),
                         "first_manifest_frame_index": frame.get("manifest_index"), "last_manifest_frame_index": frame.get("manifest_index"), "resolution": {"width": size[0], "height": size[1]},
                         "source_start_ms": source_start, "source_end_ms": min(next_ms, end),
                         "source_duration_seconds": duration, "source_frame_count": 1})
    offset = 0.0
    for run in runs:
        # A single sparse screenshot is not proof that the unseen interval was static.
        edited = min(run["source_duration_seconds"], max_static_wait) if run["source_frame_count"] > 1 else run["source_duration_seconds"]
        run["edited_start_seconds"] = offset
        run["duration_seconds"] = edited
        run["compressed_wait_seconds"] = run["source_duration_seconds"] - edited
        offset += edited
    return runs, len(selected), offset


def chapter_runs(frames, chapter, segments, max_static_wait):
    if not segments:
        runs, count, duration = frame_runs(frames, chapter, max_static_wait)
        return runs, count, duration, [], (float(chapter["end_ms"]) - float(chapter["start_ms"])) / 1000
    windows = sorted([segment for segment in segments if segment.get("chapter_key") == chapter["key"]
                      and segment.get("valid", True) is not False
                      and float(segment["end_ms"]) > float(chapter["start_ms"])
                      and float(segment["start_ms"]) < float(chapter["end_ms"])], key=lambda segment: float(segment["start_ms"]))
    if not windows:
        raise ValueError(f"No recorded segments cover valid chapter {chapter['key']}")
    runs, count, duration, captured_seconds, recorded_segments = [], 0, 0.0, 0.0, []
    previous_end = None
    for segment in windows:
        start = max(float(segment["start_ms"]), float(chapter["start_ms"]))
        end = min(float(segment["end_ms"]), float(chapter["end_ms"]))
        if previous_end is not None and start < previous_end:
            raise ValueError(f"Recorded segments overlap in chapter {chapter['key']}")
        previous_end = end
        # first_frame/last_frame are indices into capture.frames, not protocol event sequence numbers.
        selected = [frame for frame in frames if (segment.get("first_frame") is None or int(frame["manifest_index"]) >= int(segment["first_frame"]))
                    and (segment.get("last_frame") is None or int(frame["manifest_index"]) <= int(segment["last_frame"]))]
        partial, partial_count, partial_duration = frame_runs(selected, {**chapter, "start_ms": start, "end_ms": end}, max_static_wait)
        for item in partial:
            item["edited_start_seconds"] += duration
            item["segment_index"] = segment.get("index")
        recorded_segments.append({**segment, "used_start_ms": start, "used_end_ms": end, "source_duration_seconds": (end-start)/1000,
                                  "edited_start_seconds": duration, "edited_end_seconds": duration + partial_duration})
        runs.extend(partial); count += partial_count; duration += partial_duration; captured_seconds += (end-start)/1000
    return runs, count, duration, recorded_segments, captured_seconds


def source_to_edited(wall_ms, runs, chapter_offset):
    for run in runs:
        if run["source_start_ms"] <= wall_ms <= run["source_end_ms"]:
            relative = (wall_ms - run["source_start_ms"]) / max(1, run["source_end_ms"] - run["source_start_ms"])
            return chapter_offset + run["edited_start_seconds"] + relative * run["duration_seconds"]
    return None


def action_markers(actions, runs, duration):
    filters, markers = [], []
    for action in actions:
        rect = action.get("rect")
        wall_ms = float(action["wall_ms"])
        run = next((run for run in runs if run["source_start_ms"] <= wall_ms <= run["source_end_ms"]), None)
        if not isinstance(rect, dict) or not run:
            continue
        try:
            x, y, width, height = [float(rect[key]) for key in ("x", "y", "width", "height")]
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(value) for value in (x, y, width, height)) or width <= 0 or height <= 0:
            continue
        source_width, source_height = run["resolution"]["width"], run["resolution"]["height"]
        scale = min(WIDTH / source_width, PICTURE_HEIGHT / source_height)
        mapped_x = (WIDTH - source_width * scale) / 2 + x * scale
        mapped_y = (PICTURE_HEIGHT - source_height * scale) / 2 + y * scale
        mapped_width, mapped_height = width * scale, height * scale
        time = source_to_edited(wall_ms, runs, 0)
        end = min(duration, time + 0.65)
        filters.append(f"drawbox=x={mapped_x:.2f}:y={mapped_y:.2f}:w={mapped_width:.2f}:h={mapped_height:.2f}:color=0xe0ab5b@0.95:t=3:enable='between(t,{time:.6f},{end:.6f})'")
        markers.append({"label": action.get("label"), "source_wall_ms": wall_ms, "chapter_start_seconds": time, "chapter_end_seconds": end,
                        "recorded_rect": rect, "video_rect": {"x": mapped_x, "y": mapped_y, "width": mapped_width, "height": mapped_height}})
    return filters, markers


def write_ass(path: Path, chapter, duration: float, utterances):
    # All annotations occupy the dedicated 160px lower band, never the recorded UI.
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Microsoft YaHei,34,&H00FFFFFF,&H00FFFFFF,&H00163836,&H00163836,-1,0,0,0,100,100,0,0,1,0,0,7,80,80,0,1
Style: Subtitle,Microsoft YaHei,26,&H00D5EEE6,&H00D5EEE6,&H00163836,&H00163836,0,0,0,0,100,100,0,0,1,0,0,7,80,80,0,1
Style: Narration,Microsoft YaHei,30,&H00FFFFFF,&H00FFFFFF,&H00163836,&H00163836,0,0,0,0,100,100,0,0,1,0,0,2,80,80,14,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header,
             f"Dialogue: 0,0:00:00.00,{ass_time(duration)},Title,,0,0,0,,{{\\pos(80,926)}}{ass_text(chapter['title'])}",
             f"Dialogue: 0,0:00:00.00,{ass_time(duration)},Subtitle,,0,0,0,,{{\\pos(80,972)}}{ass_text(chapter.get('subtitle', ''))}"]
    for utterance in utterances:
        lines.append(f"Dialogue: 1,{ass_time(utterance['chapter_start_seconds'])},{ass_time(utterance['chapter_end_seconds'])},Narration,,0,0,0,,{ass_text(utterance['text'])}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def mix_narration(path: Path, utterances, target_seconds):
    profile = wave_info(Path(utterances[0]["wav"]))
    rate, channels, width = profile["rate"], profile["channels"], profile["sample_width"]
    total_frames = round(target_seconds * rate)
    cursor = 0
    with wave.open(str(path), "wb") as output:
        output.setnchannels(channels); output.setsampwidth(width); output.setframerate(rate)
        for utterance in utterances:
            start = round(utterance["chapter_start_seconds"] * rate)
            output.writeframes(b"\0" * max(0, start - cursor) * channels * width)
            with wave.open(utterance["wav"], "rb") as source:
                if (source.getframerate(), source.getnchannels(), source.getsampwidth()) != (rate, channels, width):
                    raise ValueError("Local narrator produced inconsistent WAV formats")
                output.writeframes(source.readframes(source.getnframes()))
                cursor = start + source.getnframes()
        output.writeframes(b"\0" * max(0, total_frames - cursor) * channels * width)


def make_contact_sheet(output_dir: Path, samples, coverage):
    from PIL import Image, ImageDraw, ImageFont
    columns, cell_width, cell_height = 2, 640, 420
    sheet = Image.new("RGB", (columns * cell_width, len(coverage["chapters"]) * cell_height), "#edf4f0")
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
    for index, sample in enumerate(samples):
        image = Image.open(sample["file"]).convert("RGB")
        image.thumbnail((cell_width, 360))
        x, y = index % columns * cell_width, index // columns * cell_height
        sheet.paste(image, (x + (cell_width - image.width) // 2, y))
        ImageDraw.Draw(sheet).text((x + 12, y + 365), f"{sample['title']} · {sample['time_seconds']:.2f}s", fill="#24483e", font=font)
    target = output_dir / "章节抽帧核验.jpg"
    sheet.save(target, quality=94)
    return target


def assemble(options):
    manifest_path = Path(options.manifest).resolve()
    manifest = read_json(manifest_path)
    output_path = Path(options.output).resolve()
    output_dir = output_path.parent if output_path.suffix.lower() == ".mp4" else output_path
    video = output_path if output_path.suffix.lower() == ".mp4" else output_dir / "老旧小区改造工作台_全功能演示.mp4"
    output_dir.mkdir(parents=True, exist_ok=True)
    work = output_dir / "assembly"
    work.mkdir(exist_ok=True)
    frames = sorted([{**frame, "manifest_index": index} for index, frame in enumerate(manifest.get("frames", []))],
                    key=lambda frame: (float(frame["wall_ms"]), int(frame.get("sequence") or 0)))
    chapters = sorted([chapter for chapter in manifest.get("chapters", []) if chapter.get("valid") is True], key=lambda chapter: (chapter.get("order", float(chapter["start_ms"])), float(chapter["start_ms"])))
    if not frames or not chapters:
        raise ValueError("The manifest needs captured frames and at least one valid chapter")
    source_order = sorted(chapters, key=lambda chapter: float(chapter["start_ms"]))
    for previous, current in zip(source_order, source_order[1:]):
        if float(previous["end_ms"]) > float(current["start_ms"]):
            raise ValueError("Valid chapter intervals overlap; resolve take boundaries in the manifest")
    print(f"PREPARE {len(chapters)} chapters, {len(frames)} captured frames", flush=True)
    plan = {"voice": options.voice, "utterances": []}
    for chapter_index, chapter in enumerate(chapters):
        texts = chapter.get("narration") or [chapter.get("subtitle") or chapter["title"]]
        for sentence_index, text in enumerate(texts):
            if not isinstance(text, str) or not text.strip():
                raise ValueError("Narration must be nonempty plain-text sentences")
            plan["utterances"].append({"id": f"chapter-{chapter_index:02d}-sentence-{sentence_index:02d}", "text": text, "chapter_index": chapter_index})
    plan_path, voice_dir = work / "narration-plan.json", work / "voice"
    write_json(plan_path, plan)
    synthesizer = Path(__file__).with_name("synthesize-feature-narration.ps1").resolve()
    run([options.powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", synthesizer,
         "-PlanPath", plan_path, "-OutputDirectory", voice_dir, "-Voice", options.voice, "-Rate", str(options.voice_rate)], work / "synthesis.log")
    coverage = {"schema_version": "haizhizi-feature-video/1.0", "source_manifest": str(manifest_path),
                "source_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                "source_url": manifest.get("source_url"), "source_revision": manifest.get("source_revision"),
                "source_resolution": manifest.get("resolution"), "output_resolution": {"width": WIDTH, "height": HEIGHT},
                "voice": options.voice, "voice_rate": options.voice_rate, "network_used": False,
                "static_wait_policy": "Only consecutive identical JPEG bytes shorten a wait, capped at 2 seconds; distinct visual frames retain source duration.",
                "video": str(video), "chapters": [], "omitted_chapters": [chapter for chapter in manifest.get("chapters", []) if chapter.get("valid") is not True],
                "omitted_segments": [{**segment, "omission_reason": "failed_segment"} for segment in manifest.get("segments", []) if segment.get("valid", True) is False],
                "omission_counts": {"failed_chapter": sum(chapter.get("valid") is not True for chapter in manifest.get("chapters", [])),
                                    "failed_segment": sum(segment.get("valid", True) is False for segment in manifest.get("segments", []))}}
    offset, clips = 0.0, []
    for index, chapter in enumerate(chapters):
        print(f"ASSEMBLE {index + 1}/{len(chapters)} {chapter['title']}", flush=True)
        chapter_dir = work / f"chapter-{index:02d}"
        chapter_dir.mkdir(exist_ok=True)
        runs, frame_count, edited_duration, recorded_segments, captured_seconds = chapter_runs(frames, chapter, manifest.get("segments", []), options.max_static_wait)
        utterances, voice_offset = [], 0.75
        for item in plan["utterances"]:
            if item["chapter_index"] != index:
                continue
            wav = voice_dir / f"{item['id']}.wav"
            duration = wave_info(wav)["duration"]
            utterances.append({"text": item["text"], "wav": str(wav), "duration_seconds": duration,
                               "chapter_start_seconds": voice_offset, "chapter_end_seconds": voice_offset + duration,
                               "start_seconds": offset + voice_offset, "end_seconds": offset + voice_offset + duration})
            voice_offset += duration + 0.4
        narration_end = utterances[-1]["chapter_end_seconds"]
        duration = math.ceil(max(edited_duration, narration_end + 3) * FPS) / FPS
        tail_hold = duration - edited_duration
        concat_lines = ["ffconcat version 1.0"]
        for run_index, frame_run in enumerate(runs):
            held_duration = frame_run["duration_seconds"] + (tail_hold if run_index == len(runs) - 1 else 0)
            image_path = normalized_frame(frame_run, work / "normalized")
            concat_lines += [f"file '{ffconcat_path(image_path)}'", f"duration {held_duration:.9f}"]
        concat_lines.append(f"file '{ffconcat_path(image_path)}'")
        (chapter_dir / "frames.ffconcat").write_text("\n".join(concat_lines) + "\n", encoding="utf-8")
        mix_narration(chapter_dir / "narration.wav", utterances, duration)
        write_ass(chapter_dir / "captions.ass", chapter, duration, utterances)
        clip = chapter_dir / "clip.mp4"
        actions = [{**action, "video_seconds": source_to_edited(float(action["wall_ms"]), runs, offset)} for action in manifest.get("actions", [])
                   if float(chapter["start_ms"]) <= float(action["wall_ms"]) <= float(chapter["end_ms"])]
        overlays, markers = action_markers(actions, runs, duration) if not options.no_action_markers else ([], [])
        picture_filter = f"scale={WIDTH}:{PICTURE_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos:in_range=full:out_range=limited:out_color_matrix=bt709,pad={WIDTH}:{PICTURE_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0xf2f6f3,pad={WIDTH}:{HEIGHT}:0:0:color=0x163836"
        visual_filter = ",".join([picture_filter, *overlays, "ass=filename='captions.ass'", f"fps={FPS}", "setsar=1", "format=yuv420p"])
        run([options.ffmpeg, "-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", "frames.ffconcat", "-i", "narration.wav",
             "-map", "0:v:0", "-map", "1:a:0", "-vf", visual_filter, "-af", "loudnorm=I=-18:TP=-2:LRA=7",
             "-c:v", "libx264", "-preset", options.preset, "-crf", "20", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
             "-t", f"{duration:.9f}", "-video_track_timescale", "90000", "-movflags", "+faststart", clip], chapter_dir / "encode.log", chapter_dir)
        clips.append(clip)
        coverage["chapters"].append({"key": chapter["key"], "title": chapter["title"], "subtitle": chapter.get("subtitle", ""),
                                     "source_start_ms": chapter["start_ms"], "source_end_ms": chapter["end_ms"], "captured_frames": frame_count,
                                     "recorded_segments": recorded_segments, "source_capture_seconds": captured_seconds,
                                     "recording_gap_removed_seconds": max(0, (float(chapter["end_ms"])-float(chapter["start_ms"]))/1000-captured_seconds),
                                     "start_seconds": offset, "end_seconds": offset + duration, "duration_seconds": duration,
                                     "edited_visual_seconds": edited_duration, "tail_hold_seconds": tail_hold,
                                     "compressed_wait_seconds": sum(item["compressed_wait_seconds"] for item in runs),
                                     "narration": utterances, "frame_timeline": runs, "actions": [action for action in actions if action["video_seconds"] is not None],
                                     "action_markers": markers,
                                     "uncaptured_actions": [action for action in actions if action["video_seconds"] is None]})
        offset += duration
    coverage["duration_seconds"] = offset
    (work / "clips.ffconcat").write_text("ffconcat version 1.0\n" + "\n".join(f"file '{ffconcat_path(clip)}'" for clip in clips) + "\n", encoding="utf-8")
    srt_path, metadata_path = output_dir / "中文解说字幕.srt", output_dir / "章节.ffmetadata"
    all_utterances = [utterance for chapter in coverage["chapters"] for utterance in chapter["narration"]]
    srt_path.write_text("\n\n".join(f"{index + 1}\n{srt_time(item['start_seconds'])} --> {srt_time(item['end_seconds'])}\n{item['text']}" for index, item in enumerate(all_utterances)) + "\n", encoding="utf-8")
    metadata_path.write_text(";FFMETADATA1\ntitle=老旧小区改造工作台全功能演示\n" + "".join(f"\n[CHAPTER]\nTIMEBASE=1/1000\nSTART={round(chapter['start_seconds']*1000)}\nEND={round(chapter['end_seconds']*1000)}\ntitle={meta_text(chapter['title'])}\n" for chapter in coverage["chapters"]), encoding="utf-8")
    run([options.ffmpeg, "-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", work / "clips.ffconcat", "-f", "ffmetadata", "-i", metadata_path, "-i", srt_path,
         "-map", "0:v:0", "-map", "0:a:0", "-map", "2:s:0", "-map_metadata", "1", "-map_chapters", "1", "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
         "-metadata:s:s:0", "language=zho", "-metadata:s:s:0", "title=中文解说字幕", "-disposition:s:0", "0", "-movflags", "+faststart", video], work / "mux.log")
    write_json(output_dir / "章节覆盖与时间线.json", coverage)
    markdown = ["# 老旧小区改造工作台全功能演示", f"原始页面：{coverage['source_url']}", f"源版本：{coverage['source_revision']}", f"成片时长：{offset:.2f}秒；本机中文配音：{options.voice}。\n\n连续重复静帧等待最多保留{options.max_static_wait:g}秒，其他录屏帧保留操作时长，配音不足的停留补在章节末尾。"]
    for chapter in coverage["chapters"]:
        markdown.extend([f"## {chapter['title']} · {srt_time(chapter['start_seconds'])}—{srt_time(chapter['end_seconds'])}", chapter["subtitle"], *[f"- {utterance['text']}" for utterance in chapter["narration"]]])
    if coverage["omitted_chapters"]:
        markdown += ["## 保留在原始记录、未纳入成片的录制", *[f"- {chapter.get('title', chapter.get('key', '未命名'))}" for chapter in coverage["omitted_chapters"]]]
    if coverage["omitted_segments"]:
        markdown += ["## 未纳入成片的失败操作片段", *[f"- {segment.get('chapter_key')} · 片段 {segment.get('index')} · failed_segment" for segment in coverage["omitted_segments"]]]
    (output_dir / "解说与章节.md").write_text("\n\n".join(markdown) + "\n", encoding="utf-8")
    validate(options, video, coverage, output_dir)
    print(f"RENDERED {video}\nDURATION {offset:.2f} seconds", flush=True)


def validate(options, video: Path, coverage, output_dir: Path):
    print("VERIFY probe, full decode, chapter sample frames", flush=True)
    probe = json.loads(run([options.ffprobe, "-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", video]).stdout)
    videos = [stream for stream in probe["streams"] if stream["codec_type"] == "video"]
    audio = [stream for stream in probe["streams"] if stream["codec_type"] == "audio"]
    actual_duration = float(probe["format"]["duration"])
    checks = {"video_h264": bool(videos) and videos[0]["codec_name"] == "h264",
              "resolution_1920x1080": bool(videos) and (videos[0]["width"], videos[0]["height"]) == (WIDTH, HEIGHT),
              "video_yuv420p": bool(videos) and videos[0]["pix_fmt"] == "yuv420p",
              "video_30fps": bool(videos) and videos[0]["r_frame_rate"] == "30/1",
              "aac_48khz": bool(audio) and audio[0]["codec_name"] == "aac" and audio[0]["sample_rate"] == "48000",
              "chapter_count": len(probe.get("chapters", [])) == len(coverage["chapters"]),
              "chapter_titles": [chapter.get("tags", {}).get("title") for chapter in probe.get("chapters", [])] == [chapter["title"] for chapter in coverage["chapters"]],
              "chapter_intervals": len(probe.get("chapters", [])) == len(coverage["chapters"]) and all(abs(float(actual["start_time"])-expected["start_seconds"]) < .05 and abs(float(actual["end_time"])-expected["end_seconds"]) < .05 for actual, expected in zip(probe.get("chapters", []), coverage["chapters"])),
              "duration_matches": abs(actual_duration - coverage["duration_seconds"]) < 0.3}
    failed_ranges = [(int(segment["first_frame"]), int(segment["last_frame"])) for segment in coverage["omitted_segments"]
                     if segment.get("first_frame") is not None and segment.get("last_frame") is not None]
    checks["failed_segments_excluded"] = all(not any(first <= run["last_manifest_frame_index"] and last >= run["first_manifest_frame_index"] for first, last in failed_ranges)
                                             for chapter in coverage["chapters"] for run in chapter["frame_timeline"])
    run([options.ffmpeg, "-v", "error", "-i", video, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "NUL"], output_dir / "完整解码核验.log")
    checks["full_decode"] = True
    audio_probe = run([options.ffmpeg, "-hide_banner", "-i", video, "-map", "0:a:0", "-af", "astats=metadata=1:reset=0", "-f", "null", "NUL"], output_dir / "音频电平核验.log")
    import re
    peaks = [float(match) for match in re.findall(r"Peak level dB:\s*(-?\d+(?:\.\d+)?)", audio_probe.stderr)]
    checks["audio_non_silent_and_not_clipped"] = bool(peaks) and max(peaks) < -0.05 and max(peaks) > -60
    samples, sample_dir = [], output_dir / "章节抽帧"
    sample_dir.mkdir(exist_ok=True)
    for index, chapter in enumerate(coverage["chapters"]):
        for part, relative in enumerate((min(1.0, chapter["duration_seconds"] / 4), min(chapter["edited_visual_seconds"] - 0.1, chapter["duration_seconds"] - 1))):
            time = chapter["start_seconds"] + max(0.05, relative)
            frame = sample_dir / f"chapter-{index:02d}-{part + 1}.jpg"
            run([options.ffmpeg, "-v", "error", "-ss", f"{time:.6f}", "-i", video, "-frames:v", "1", "-q:v", "2", "-y", frame])
            samples.append({"file": str(frame), "title": chapter["title"], "time_seconds": time})
    contact = make_contact_sheet(output_dir, samples, coverage)
    report = {"schema_version": "haizhizi-feature-video-verification/1.0", "video": str(video), "video_sha256": hashlib.sha256(video.read_bytes()).hexdigest(),
              "duration_seconds": actual_duration, "checks": checks, "passed": all(checks.values()), "peak_dbfs": max(peaks) if peaks else None,
              "probe": probe, "samples": samples, "contact_sheet": str(contact), "visual_review": "pending_human_or_agent_image_review", "speech_pronunciation_review": "pending_listening"}
    write_json(output_dir / "视频验证.json", report)
    if not report["passed"]:
        raise RuntimeError(f"Final video verification failed: {checks}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output", required=True, help="Output directory or final .mp4 filename")
    parser.add_argument("--ffmpeg", default=str(FFMPEG))
    parser.add_argument("--ffprobe", default=str(FFPROBE))
    parser.add_argument("--powershell", default=str(POWERSHELL))
    parser.add_argument("--voice", default="Microsoft Huihui Desktop")
    parser.add_argument("--voice-rate", type=int, choices=range(-10, 11), default=0)
    parser.add_argument("--max-static-wait", type=float, default=2.0)
    parser.add_argument("--preset", default="medium", choices=("ultrafast", "veryfast", "fast", "medium", "slow"))
    parser.add_argument("--no-action-markers", action="store_true", help="Disable brief outlines at recorded action rectangles")
    options = parser.parse_args()
    if not 0.1 <= options.max_static_wait <= 2:
        parser.error("--max-static-wait must be between 0.1 and 2 seconds")
    assemble(options)


if __name__ == "__main__":
    main()
