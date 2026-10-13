"""Replay the report's illustrative calculations with the production evaluator.

Inputs are labelled demonstrations. They are not observations or fitted ranges.
Run from the repository root with the project's prepared Python interpreter.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.capabilities.community_operations import evaluate_operations


def value(number, unit):
    return {"value": number, "unit": unit, "status": "assumption", "source_kind": "demo",
            "source": "技术报告人工演示参数；检验计算机制，未作为实际运营数据", "as_of": "2026-10-13"}


def missing(unit):
    return {"value": None, "unit": unit, "status": "missing", "source_kind": "missing",
            "source": "改变需求后另行调查去重使用人数", "as_of": "2026-10-13"}


def base_input():
    cash = {"fixed_cost": 10000, "other_earned_income": 1000, "government_purchase": 2000,
            "operating_subsidy": 6000, "other_support": 0, "government_direct_cost": 0}
    return {"name": "科学方法演示基准", "facility_id": "METHOD-DEMO", "facility_name": "演示社区中心",
            "period": "2026-11", "scope_note": "单一独立服务；月度需求可匹配已登记场次；当月服务当月收付。",
            "target_population": value(1000, "person"), "unique_users": value(120, "person"), "cost_scope_complete": True,
            "services": [{"id": "activity", "name": "活动服务", "resource_id": "room-1", "schedule_note": "每月26场、每场20人次；各场需求可匹配的演示假设",
                          "capacity_per_slot": value(20, "visit/slot"), "available_slots": value(26, "slot/month"),
                          "demand_visits": value(400, "visit/month"), "paid_share": value(0.4, "ratio"),
                          "fee_per_visit": value(10, "yuan/visit"), "variable_cost_per_visit": value(2, "yuan/visit")}],
            "cash_items": [{"economic_item_id": key, "description": key, "kind": key, "amount": value(number, "yuan/month")} for key, number in cash.items()]}


def main():
    baseline = base_input()
    nominal = evaluate_operations(baseline).model_dump(mode="json")
    stress = deepcopy(baseline)
    stress["analysis_bounds"] = [
        {"id": "demand", "target": "service_demand_multiplier", "item_id": "activity", "low": 0.7, "high": 1.3, "unit": "ratio", "origin": "manual_scenario", "basis": "人工设定需求压力范围，不是实测波动或置信区间", "source_ref": "本报告机制演示", "as_of": "2026-10-13"},
        {"id": "fixed", "target": "cash_amount", "item_id": "fixed_cost", "low": 9000, "high": 11000, "unit": "yuan/month", "origin": "manual_scenario", "basis": "人工设定固定支出压力范围，不是实测分布", "source_ref": "本报告机制演示", "as_of": "2026-10-13"},
    ]
    stress_result = evaluate_operations(stress).model_dump(mode="json")
    peak = deepcopy(baseline)
    peak["unique_users"] = missing("person")
    peak["scope_note"] = "两时段需求不可转移；每时段各一场，每场50人次。"
    peak["services"][0]["time_blocks"] = [{"id": str(i), "name": f"时段{i}", "slots": value(1, "slot/month"),
                                          "capacity_per_slot": value(50, "visit/slot"), "demand_visits": value(demand, "visit/month")}
                                         for i, demand in enumerate([80, 20], 1)]
    peak_result = evaluate_operations(peak).model_dump(mode="json")
    sweep = []
    for demand in range(0, 701, 10):
        sample = deepcopy(baseline)
        sample["unique_users"] = missing("person")
        sample["services"][0]["demand_visits"] = value(demand, "visit/month")
        metrics = evaluate_operations(sample).model_dump(mode="json")["metrics"]
        sweep.append({"demand_visits": demand, "served_visits": metrics["served_visits"], "cash_balance": metrics["balance_after_support"]})
    fixed_stress = deepcopy(baseline)
    fixed_stress["cash_items"][0]["amount"] = value(11000, "yuan/month")
    fixed_result = evaluate_operations(fixed_stress).model_dump(mode="json")
    thresholds = {row["key"]: row for row in nominal["science"]["break_even"]}
    assert nominal["metrics"]["balance_after_support"] == -200
    assert thresholds["break_even_visits"]["value"] == 500
    assert thresholds["minimum_fee_per_visit"]["value"] == 11.25
    assert thresholds["minimum_paid_share"]["value"] == 0.45
    assert peak_result["metrics"]["served_visits"] == 70
    assert peak_result["services"][0]["aggregation_overstatement_visits"] == 30
    assert stress_result["science"]["joint_range"]["min_balance"] == -1440
    assert stress_result["science"]["joint_range"]["max_balance"] == 1040
    assert next(row for row in fixed_result["science"]["break_even"] if row["key"] == "break_even_visits")["status"] == "infeasible"
    result = {"source_class": "demonstration", "model_version": nominal["model_version"], "baseline_input": baseline,
              "baseline": nominal, "pressure_input": stress, "pressure": stress_result, "time_block_input": peak,
              "time_blocks": peak_result, "fixed_cost_stress": fixed_result, "demand_sweep": sweep,
              "code_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__), ROOT / 'services/capabilities/community_operations.py', ROOT / 'services/capabilities/operations_science.py']}}
    target = ROOT / 'research/test_results/scientific-methods-results.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({"result": str(target), "checks": "passed", "balance": -200, "break_even_visits": 500,
                      "capacity_mismatch": [100, 70], "tested_corner_range": [-1440, 1040]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
