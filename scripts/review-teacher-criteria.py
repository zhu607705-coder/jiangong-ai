#!/usr/bin/env python3
"""Prepare report-scoped collection tasks from the user's preserved criteria.

This is a local read-only review helper. It does not evaluate legal compliance,
approve source records, generate missing values, or mutate the source workbook.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data/imports/teacher-criteria-20261012.json"


def collection_suggestion(field: dict[str, Any]) -> str:
    text = " ".join(str(field.get(key) or "") for key in ("field_name", "format_unit", "source_stage"))
    if any(word in text for word in ("表决", "赞成票")):
        return "向业委会或实施主体核对对应范围的权利人、人数、面积及正式表决台账。"
    if any(word in text for word in ("审查", "补助", "征收", "权利", "产权")):
        return "向项目实施主体及主管部门取得对应证明、文号、适用范围与时间记录。"
    if any(word in text for word in ("图纸", "设计", "坡度", "净宽", "高差", "消防", "疏散")):
        return "由设计或专业人员提供图纸、现场测量或专项核查记录，注明位置和计量口径。"
    if any(word in text for word in ("GIS", "空间", "点位", "位置", "路网", "路径", "坐标")):
        return "由规划或现场调研人员提供线位、点位或测绘资料，注明范围、坐标与采集日期。"
    if any(word in text for word in ("人口", "儿童", "老年", "容量", "服务能力")):
        return "向社区及设施运营方核对同范围人口、实际服务容量和共享条件。"
    return "向现场调研或责任单位人工核对该字段，保留单位、对象范围、时点和资料来源。"


def build_review(
    criteria: dict[str, Any],
    needed_rules: list[str] | None = None,
    needed_fields: list[str] | None = None,
    manual_fills: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized = criteria["normalized"]
    rules = normalized["selected_rules"]
    fields = normalized["noncore_default_fields"]
    core = normalized["core_data_fields"]
    rule_ids = {row["rule_id"] for row in rules}
    field_ids = {row["field_id"] for row in fields}
    requested_rules = set(needed_rules or [])
    requested_fields = set(needed_fields or [])
    manual_fills = manual_fills or {}
    if requested_rules - rule_ids or requested_fields - field_ids:
        raise ValueError("Unknown requested rule or field ID")
    for field in fields:
        if requested_rules.intersection(field["rule_ids"]):
            requested_fields.add(field["field_id"])
    if set(manual_fills) - requested_fields:
        raise ValueError("Manual fills must belong to requested noncore fields")
    for patch in manual_fills.values():
        if not isinstance(patch, dict) or not patch.get("source_label"):
            raise ValueError("Each manual fill needs a source_label")

    relevant_rules = requested_rules | {
        rid for field in fields if field["field_id"] in requested_fields for rid in field["rule_ids"]
    }
    tasks = []
    field_states = []
    for field in fields:
        fid = field["field_id"]
        requested = fid in requested_fields
        patch = manual_fills.get(fid)
        supplied = patch is not None and patch.get("value") is not None
        status = "supplied_pending_review" if supplied else ("awaiting_manual_fill" if requested else "default_missing")
        state = {
            "field_id": fid,
            "field_ref": field["namespace_id"],
            "requested": requested,
            "state": status,
            "original_value": field["current_real_value"],
            "source_locator": copy.deepcopy(field["provenance"]),
            "rule_refs": field["rule_refs"][:],
            "blocks_unrequested_rules": False,
        }
        field_states.append(state)
        if not requested:
            continue
        task = {
            "task_id": "collect." + fid,
            "field_id": fid,
            "field_ref": field["namespace_id"],
            "field_name": field["field_name"],
            "unit": field["format_unit"],
            "state": status,
            "source_locator": copy.deepcopy(field["provenance"]),
            "related_rule_refs": field["rule_refs"][:],
            "report_rule_refs": ["rule." + rid for rid in field["rule_ids"] if rid in relevant_rules],
            "core_reference_refs": field["core_reference_refs"][:],
            "collection_suggestion": collection_suggestion(field),
            "reason": "当前报告请求该规则或字段，需补充对应参数后重评相关判断。",
            "recalculate_targets": ["rule." + rid for rid in field["rule_ids"] if rid in relevant_rules],
            "auto_fill": False,
            "production_approved": False,
        }
        if supplied:
            task["manual_submission"] = copy.deepcopy(patch)
        tasks.append(task)

    rule_states = []
    for rule in rules:
        rid = rule["rule_id"]
        related_tasks = [task for task in tasks if "rule." + rid in task["related_rule_refs"]]
        state = "not_requested"
        if rid in relevant_rules:
            state = "needs_key_material" if any(task["state"] == "awaiting_manual_fill" for task in related_tasks) else "pending_manual_review"
        rule_states.append({"rule_id": rid, "rule_ref": rule["namespace_id"], "state": state, "task_ids": [task["task_id"] for task in related_tasks]})

    simulated = [copy.deepcopy(row) for row in core if row["source_class"] == "source_ai_demo"]
    restrictions = []
    for row in core:
        if row["use_level"] != "限制性":
            continue
        restrictions.append({
            "field_ref": row["namespace_id"],
            "field_name": row["field_name"],
            "source_value": row["source_value"],
            "source_missing_handling": row["source_missing_handling"],
            "source_locator": copy.deepcopy(row["provenance"]),
            "related_requested_rule_refs": [ref for ref in row["rule_reference_refs"] if ref.removeprefix("rule.") in relevant_rules],
            "review_required": True,
            "blocks_unrequested_rules": False,
        })

    return {
        "schema_version": "teacher-criteria-review.v1",
        "selected_rules": copy.deepcopy(rules),
        "noncore_field_states": field_states,
        "requested_rule_refs": ["rule." + rid for rid in sorted(relevant_rules)],
        "collection_tasks": tasks,
        "rule_states": rule_states,
        "core_restrictions": restrictions,
        "source_ai_demo_records": simulated,
        "compliance_inputs_from_simulation": [],
        "manual_submissions_are_approvals": False,
        "original_workbook_mutated": False,
        "summary": {
            "retained_rules": len(rules),
            "noncore_fields": len(fields),
            "default_missing_fields": sum(row["state"] == "default_missing" for row in field_states),
            "requested_fields": len(tasks),
            "awaiting_manual_fill": sum(task["state"] == "awaiting_manual_fill" for task in tasks),
            "supplied_pending_review": sum(task["state"] == "supplied_pending_review" for task in tasks),
            "core_restrictions": len(restrictions),
            "source_ai_demo_fields": len(simulated),
        },
    }


def comma_ids(text: str) -> list[str]:
    return [value.strip() for value in text.split(",") if value.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--needed-rules", default="", help="Report-used rule IDs, e.g. R007,R014")
    parser.add_argument("--needed-fields", default="", help="Individual required field IDs, e.g. X013")
    parser.add_argument("--manual-values", type=Path, help="JSON field ID -> {value, source_label}; treated as pending manual review")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    source_bytes = args.input.read_bytes()
    criteria = json.loads(source_bytes.decode("utf-8"))
    if args.output is not None:
        protected = {args.input.resolve()} | {Path(row["path"]).resolve() for row in criteria["workbooks"]}
        if args.manual_values is not None:
            protected.add(args.manual_values.resolve())
        if args.output.resolve() in protected or args.output.suffix.lower() != ".json":
            parser.error("Output must be a separate JSON file, never a source workbook or input file")
    manual = json.loads(args.manual_values.read_text(encoding="utf-8")) if args.manual_values else {}
    try:
        result = build_review(criteria, comma_ids(args.needed_rules), comma_ids(args.needed_fields), manual)
    except ValueError as error:
        parser.error(str(error))
    result["criteria_source"] = {"path": str(args.input.resolve()), "sha256": hashlib.sha256(source_bytes).hexdigest()}
    content = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8")
    else:
        print(content, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
