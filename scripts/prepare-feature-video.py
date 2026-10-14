"""Select completed recorded takes, order chapters, and collect browser exports."""
import json
import shutil
from pathlib import Path

root = Path(__file__).resolve().parents[1]
output = root / "output/video/full-feature-20261014"
capture = json.loads((output / "capture.json").read_text(encoding="utf-8"))
scenes = json.loads((root / "data/templates/full-feature-video-scenes.json").read_text(encoding="utf-8"))
original_chapters = capture["chapters"]
valid_takes = [chapter for chapter in original_chapters if chapter.get("valid") is True and chapter.get("end_ms")]
segments = []
for original in capture["segments"]:
    segment = dict(original)
    selected = [take for take in valid_takes if take["start_ms"] <= segment["start_ms"] < take["end_ms"]]
    if selected:
        # Legacy recorder retained its first key in a closure; take timestamps are authoritative.
        segment["recorded_chapter_key"] = segment["chapter_key"]
        segment["chapter_key"] = selected[-1]["key"]
    else:
        segment["valid"] = False
        segment["omission_reason"] = "take_not_selected"
    if segment.get("valid", True):
        # Include the terminal screenshot when its timestamp equals the capture end.
        final_frame = capture["frames"][segment["last_frame"]]
        segment["end_ms"] = max(segment["end_ms"], final_frame["wall_ms"] + 1)
    segments.append(segment)
chapters = []
for order, scene in enumerate(scenes):
    takes = [take for take in valid_takes if take["key"] == scene["key"]]
    windows = [segment for segment in segments if segment["chapter_key"] == scene["key"] and segment.get("valid", True)]
    if not takes or not windows:
        raise ValueError(f"Missing completed footage: {scene['key']}")
    chapters.append({**takes[-1], "order": order, "start_ms": min(segment["start_ms"] for segment in windows),
                     "end_ms": max(segment["end_ms"] for segment in windows) + 1, "selected_takes": len(takes)})
capture.update(chapters=chapters, segments=segments, original_takes=original_chapters)
capture["database_import"] = json.loads((root / "data/imports/renewal-database-20261014/manifest.json").read_text(encoding="utf-8"))
exports = output / "exports"
exports.mkdir(exist_ok=True)
for index, download in enumerate(capture.get("downloads", [])):
    if download.get("file"):
        source = Path(download["file"])
        if source.is_file():
            destination = exports / f"{index + 1:02d}-{source.name}"
            shutil.copy2(source, destination)
            download["collected_file"] = str(destination)
(output / "capture-edited.json").write_text(json.dumps(capture, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Prepared {len(chapters)} chapters, {sum(segment.get('valid', True) for segment in segments)} recorded segments")
