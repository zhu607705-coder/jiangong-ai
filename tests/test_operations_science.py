"""Independent arithmetic and validation checks for operations science methods.

All fixture values are labelled demonstration assumptions. These regressions
verify calculation behavior, not the accuracy of forecasts for real facilities.
"""
from copy import deepcopy

import pytest

from services.capabilities.community_operations import evaluate_operations
from services.capabilities.generated.contracts import OperationsSnapshot


def scalar(number, unit):
    return {
        "value": number, "unit": unit,
        "status": "missing" if number is None else "assumption",
        "source_kind": "missing" if number is None else "demo",
        "source": "科学核算回归的明确演示假设", "as_of": "2026-10-13",
    }


def scenario():
    cash = {
        "fixed_cost": 10000, "other_earned_income": 1000,
        "government_purchase": 2000, "operating_subsidy": 6000,
        "other_support": 0, "government_direct_cost": 0,
    }
    return {
        "name": "科学核算演示", "facility_id": "science-center",
        "facility_name": "演示中心", "period": "2026-10",
        "scope_note": "独立资源与不重叠排班；人次按月统计，用户跨服务去重。",
        "target_population": scalar(400, "person"),
        "unique_users": scalar(100, "person"), "cost_scope_complete": True,
        "services": [{
            "id": "meal", "name": "助餐", "resource_id": "dining-room",
            "schedule_note": "每月26个开放时段，每时段20人次，排班不重叠。",
            "capacity_per_slot": scalar(20, "visit/slot"),
            "available_slots": scalar(26, "slot/month"),
            "demand_visits": scalar(400, "visit/month"),
            "paid_share": scalar(0.4, "ratio"),
            "fee_per_visit": scalar(10, "yuan/visit"),
            "variable_cost_per_visit": scalar(2, "yuan/visit"),
        }],
        "cash_items": [{"economic_item_id": kind, "description": kind,
                        "kind": kind, "amount": scalar(amount, "yuan/month")}
                       for kind, amount in cash.items()],
    }


def result(doc=None):
    return evaluate_operations(scenario() if doc is None else doc).model_dump(mode="json")


def thresholds(output):
    items = output["science"]["break_even"]
    assert len({item["key"] for item in items}) == len(items)
    assert all(item["basis"].strip() and item["unit"].strip() for item in items)
    return {item["key"]: item for item in items}


def set_cash(doc, kind, value):
    next(item for item in doc["cash_items"] if item["kind"] == kind)["amount"] = scalar(value, "yuan/month")


def bound(target="service_demand_multiplier", item_id="meal", low=0.7, high=1.3,
          unit="ratio", identifier="demand-range"):
    return {
        "id": identifier, "target": target, "item_id": item_id,
        "low": low, "high": high, "unit": unit,
        "origin": "manual_scenario", "basis": "明确演示上下界，不代表统计置信区间。",
        "source_ref": "科学核算回归示例参数表", "as_of": "2026-10-13",
    }


def segmented_scenario():
    doc = scenario()
    doc["unique_users"] = scalar(50, "person")
    service = doc["services"][0]
    service["time_blocks"] = [
        {"id": "peak", "name": "高峰", "slots": scalar(1, "slot/month"),
         "capacity_per_slot": scalar(50, "visit/slot"), "demand_visits": scalar(80, "visit/month")},
        {"id": "off-peak", "name": "平峰", "slots": scalar(1, "slot/month"),
         "capacity_per_slot": scalar(50, "visit/slot"), "demand_visits": scalar(20, "visit/month")},
    ]
    return doc


def test_baseline_break_even_thresholds_match_hand_calculation():
    output = result()
    assert output["model_version"] == "community-operations-1.1"
    assert output["metrics"]["balance_after_support"] == -200
    assert output["services"][0]["capacity_method"] == "monthly_aggregate"
    limits = thresholds(output)
    assert limits["required_subsidy"]["value"] == 6200
    assert limits["required_subsidy"]["unit"] == "yuan/month"
    assert limits["minimum_fee_per_visit"]["value"] == 11.25
    assert limits["minimum_fee_per_visit"]["unit"] == "yuan/visit"
    assert limits["minimum_paid_share"]["value"] == 0.45
    assert limits["minimum_paid_share"]["unit"] == "ratio"
    assert limits["break_even_visits"]["value"] == 500
    assert limits["break_even_visits"]["unit"] == "visit/month"
    assert all(limits[key]["status"] == "feasible" for key in (
        "required_subsidy", "minimum_fee_per_visit", "minimum_paid_share", "break_even_visits"))


def test_break_even_visits_above_capacity_is_marked_infeasible():
    doc = scenario()
    set_cash(doc, "fixed_cost", 11000)
    limit = thresholds(result(doc))["break_even_visits"]
    assert limit["value"] == 1000
    assert limit["status"] == "infeasible"


@pytest.mark.parametrize("variable_cost", [4, 5])
def test_nonpositive_contribution_margin_cannot_close_existing_deficit(variable_cost):
    doc = scenario()
    doc["services"][0]["variable_cost_per_visit"] = scalar(variable_cost, "yuan/visit")
    limit = thresholds(result(doc))["break_even_visits"]
    assert limit["value"] is None
    assert limit["status"] == "infeasible"


def test_paid_share_threshold_above_one_is_not_reported_feasible():
    doc = scenario()
    set_cash(doc, "fixed_cost", 15000)
    limit = thresholds(result(doc))["minimum_paid_share"]
    assert limit["value"] == 1.7
    assert limit["status"] == "infeasible"


def test_already_balanced_scenario_has_no_required_subsidy():
    doc = scenario()
    set_cash(doc, "fixed_cost", 1000)
    output = result(doc)
    assert output["metrics"]["balance_after_support"] == 8800
    assert thresholds(output)["required_subsidy"]["value"] == 0


def test_time_blocks_preserve_peak_unmet_demand_and_measure_pooling_bias():
    output = result(segmented_scenario())
    service = output["services"][0]
    assert service["capacity_method"] == "time_blocks"
    assert service["capacity_visits"] == 100
    assert service["served_visits"] == 70
    assert service["unmet_visits"] == 30
    assert service["utilization"] == 0.7
    assert service["monthly_pooled_upper_bound"] == 100
    assert service["aggregation_overstatement_visits"] == 30
    assert service["fee_income"] == 280
    assert service["variable_cost"] == 140
    assert output["metrics"]["served_visits"] == 70


def test_time_blocks_replace_missing_legacy_monthly_capacity_and_demand():
    doc = segmented_scenario()
    service = doc["services"][0]
    for field, unit in (("capacity_per_slot", "visit/slot"),
                        ("available_slots", "slot/month"), ("demand_visits", "visit/month")):
        service[field] = scalar(None, unit)
    output = result(doc)
    assert output["status"] == "complete"
    assert not output["missing"]
    assert output["metrics"]["served_visits"] == 70


def test_time_blocks_do_not_claim_total_break_even_visits_without_demand_allocation():
    limit = thresholds(result(segmented_scenario()))["break_even_visits"]
    assert limit["value"] is None
    assert limit["status"] == "not_identifiable"


def test_time_blocks_still_reject_shared_resources_across_services():
    doc = segmented_scenario()
    duplicate = deepcopy(doc["services"][0])
    duplicate.update(id="other", name="同资源另一服务")
    doc["services"].append(duplicate)
    with pytest.raises(ValueError, match="resource_id"):
        result(doc)


def test_duplicate_time_block_id_rejected_instead_of_double_counted():
    doc = segmented_scenario()
    doc["services"][0]["time_blocks"][1]["id"] = "peak"
    with pytest.raises(ValueError):
        result(doc)


def test_missing_time_block_input_propagates_unknown_service_counts():
    doc = segmented_scenario()
    doc["services"][0]["time_blocks"][0]["demand_visits"] = scalar(None, "visit/month")
    output = result(doc)
    assert output["status"] == "partial"
    assert output["metrics"]["served_visits"] is None
    assert output["services"][0]["monthly_pooled_upper_bound"] is None
    assert any("time_blocks.0.demand_visits" in item["field"] for item in output["missing"])


@pytest.mark.parametrize("field", ["slots", "demand_visits"])
@pytest.mark.parametrize("value", [True, "2", 2.5])
def test_time_block_counts_reject_boolean_string_and_fractional_values(field, value):
    doc = segmented_scenario()
    doc["services"][0]["time_blocks"][0][field]["value"] = value
    with pytest.raises(ValueError):
        result(doc)


@pytest.mark.parametrize("field", ["slots", "demand_visits"])
@pytest.mark.parametrize("invalid", ["unit", "status"])
def test_time_block_counts_validate_units_and_source_status(field, invalid):
    doc = segmented_scenario()
    item = doc["services"][0]["time_blocks"][0][field]
    item[invalid] = "yuan/month" if invalid == "unit" else "factual"
    with pytest.raises(ValueError):
        result(doc)


def test_one_at_a_time_sensitivity_uses_baseline_and_ranks_balance_span():
    doc = scenario()
    doc["analysis_bounds"] = [bound(), bound("cash_amount", "fixed_cost", 9000, 11000,
                                             "yuan/month", "fixed-range")]
    output = result(doc)
    rows = output["science"]["sensitivity"]
    assert [row["id"] for row in rows] == ["fixed-range", "demand-range"]
    assert (rows[0]["low"], rows[0]["base"], rows[0]["high"]) == (9000, 10000, 11000)
    assert (rows[0]["low_balance"], rows[0]["base_balance"], rows[0]["high_balance"], rows[0]["span"]) == (800, -200, -1200, 2000)
    assert (rows[1]["low"], rows[1]["base"], rows[1]["high"]) == (0.7, 1, 1.3)
    assert (rows[1]["low_balance"], rows[1]["base_balance"], rows[1]["high_balance"], rows[1]["span"]) == (-440, -200, 40, 480)
    assert all(row["basis"].strip() and row["source_ref"] == "科学核算回归示例参数表" for row in rows)


def test_joint_range_evaluates_all_corners_and_preserves_input():
    doc = scenario()
    doc["analysis_bounds"] = [bound(), bound("cash_amount", "fixed_cost", 9000, 11000,
                                             "yuan/month", "fixed-range")]
    original = deepcopy(doc)
    joint = result(doc)["science"]["joint_range"]
    assert joint["tested_corners"] == joint["valid_corners"] == 4
    assert (joint["min_balance"], joint["max_balance"], joint["worst_gap"]) == (-1440, 1040, 1440)
    assert {item["id"]: item["value"] for item in joint["min_at"]} == {"demand-range": 0.7, "fixed-range": 11000}
    assert {item["id"]: item["value"] for item in joint["max_at"]} == {"demand-range": 1.3, "fixed-range": 9000}
    assert joint["label"].strip()
    assert doc == original


def test_demand_sensitivity_scales_time_blocks_instead_of_legacy_monthly_demand():
    doc = segmented_scenario()
    doc["analysis_bounds"] = [bound()]
    row = result(doc)["science"]["sensitivity"][0]
    # At 0.7: min(56, 50) + min(14, 50) = 64 visits.
    # At 1.3: min(104, 50) + min(26, 50) = 76 visits.
    assert (row["low_balance"], row["base_balance"], row["high_balance"], row["span"]) == (-872, -860, -848, 24)


def test_demand_sensitivity_rounds_each_time_block_to_whole_visits():
    doc = segmented_scenario()
    doc["analysis_bounds"] = [bound(low=0.3333)]
    row = result(doc)["science"]["sensitivity"][0]
    # 80*0.3333 rounds to 27, 20*0.3333 rounds to 7: 34 visits.
    assert row["low_balance"] == -932


def test_lower_demand_trial_releases_nominal_unique_users_without_mutating_baseline():
    doc = scenario()
    doc["unique_users"] = scalar(400, "person")
    doc["analysis_bounds"] = [bound(low=0.1)]
    output = result(doc)
    row = output["science"]["sensitivity"][0]
    assert row["low_balance"] == -920
    assert output["science"]["joint_range"]["valid_corners"] == 2
    assert output["metrics"]["unique_users"] == 400
    assert doc["unique_users"]["value"] == 400


def test_six_bounds_enumerate_64_corners_even_when_margin_changes_sign():
    doc = scenario()
    doc["analysis_bounds"] = [
        bound(), bound("service_fee", "meal", 8, 12, "yuan/visit", "fee"),
        bound("service_paid_share", "meal", 0.3, 0.5, "ratio", "paid"),
        bound("service_variable_cost", "meal", 1, 3, "yuan/visit", "variable"),
        bound("cash_amount", "fixed_cost", 9000, 11000, "yuan/month", "fixed"),
        bound("cash_amount", "other_earned_income", 500, 1500, "yuan/month", "other-income"),
    ]
    joint = result(doc)["science"]["joint_range"]
    assert joint["tested_corners"] == joint["valid_corners"] == 64
    assert (joint["min_balance"], joint["max_balance"], joint["worst_gap"]) == (-2812, 3100, 2812)
    # A negative margin makes higher demand worse in the adverse corner.
    assert {item["id"]: item["value"] for item in joint["min_at"]}["demand-range"] == 1.3


def test_full_length_source_metadata_does_not_invalidate_scenario_trials():
    doc = scenario()
    entry = bound()
    entry.update(basis="据" * 1500, source_ref="源" * 1500)
    doc["analysis_bounds"] = [entry]
    science = result(doc)["science"]
    assert science["sensitivity"][0]["span"] == 480
    assert science["sensitivity"][0]["source_ref"] == entry["source_ref"]
    assert science["joint_range"]["valid_corners"] == 2


def test_science_discloses_monthly_scope_and_method_provenance():
    notes = "\n".join(result()["science"]["notes"])
    assert "自然月" in notes
    assert "GAO" in notes and "Green Book" in notes


@pytest.mark.parametrize("target,low,high,unit,expected", [
    ("service_fee", 8, 12, "yuan/visit", (-520, 120, 640)),
    ("service_paid_share", 0.3, 0.5, "ratio", (-600, 200, 800)),
    ("service_variable_cost", 1, 3, "yuan/visit", (200, -600, 800)),
])
def test_each_service_sensitivity_target_changes_only_its_parameter(target, low, high, unit, expected):
    doc = scenario()
    doc["analysis_bounds"] = [bound(target, "meal", low, high, unit)]
    row = result(doc)["science"]["sensitivity"][0]
    assert (row["low_balance"], row["high_balance"], row["span"]) == expected
    assert row["base_balance"] == -200


@pytest.mark.parametrize("raw", [True, "0.7", float("nan"), float("inf"), -1])
@pytest.mark.parametrize("field", ["low", "high"])
def test_bounds_reject_non_numeric_or_invalid_raw_values(field, raw):
    doc = scenario()
    entry = bound()
    entry[field] = raw
    doc["analysis_bounds"] = [entry]
    with pytest.raises(ValueError):
        result(doc)


@pytest.mark.parametrize("low,high", [(1.1, 1.3), (0.3, 0.9), (1.2, 0.8)])
def test_bounds_must_bracket_baseline(low, high):
    doc = scenario()
    doc["analysis_bounds"] = [bound(low=low, high=high)]
    with pytest.raises(ValueError):
        result(doc)


def test_duplicate_target_and_item_is_rejected_even_with_distinct_ids():
    doc = scenario()
    doc["analysis_bounds"] = [bound(), bound(identifier="second-name")]
    with pytest.raises(ValueError):
        result(doc)


@pytest.mark.parametrize("field,value", [
    ("source_ref", ""), ("source_ref", "   "), ("basis", ""), ("basis", "  "),
    ("as_of", "2026-02-30"), ("as_of", "20261013"), ("as_of", "2026-10-13T00:00:00Z"),
    ("unit", "yuan/month"), ("item_id", "not-a-service"),
])
def test_bounds_require_traceable_sources_calendar_dates_and_correct_units(field, value):
    doc = scenario()
    entry = bound()
    entry[field] = value
    doc["analysis_bounds"] = [entry]
    with pytest.raises(ValueError):
        result(doc)


def test_paid_share_bound_cannot_exceed_one():
    doc = scenario()
    doc["analysis_bounds"] = [bound("service_paid_share", "meal", 0.2, 1.1, "ratio")]
    with pytest.raises(ValueError):
        result(doc)


def test_analysis_rejects_more_than_six_parameters():
    doc = scenario()
    doc["analysis_bounds"] = [
        bound(), bound("service_fee", "meal", 8, 12, "yuan/visit", "fee"),
        bound("service_paid_share", "meal", 0.3, 0.5, "ratio", "paid"),
        bound("service_variable_cost", "meal", 1, 3, "yuan/visit", "variable"),
        bound("cash_amount", "fixed_cost", 9000, 11000, "yuan/month", "fixed"),
        bound("cash_amount", "other_earned_income", 500, 1500, "yuan/month", "other-income"),
        bound("cash_amount", "government_purchase", 1000, 3000, "yuan/month", "purchase"),
    ]
    with pytest.raises(ValueError):
        result(doc)


def test_unknown_fee_keeps_cost_known_and_financial_thresholds_unidentified():
    doc = scenario()
    doc["services"][0]["fee_per_visit"] = scalar(None, "yuan/visit")
    output = result(doc)
    assert output["status"] == "partial"
    assert output["metrics"]["served_visits"] == 400
    assert output["metrics"]["operating_cost"] == 10800
    assert output["metrics"]["balance_after_support"] is None
    limits = thresholds(output)
    assert limits["required_subsidy"]["value"] is None
    assert limits["break_even_visits"]["status"] == "not_identifiable"


def test_missing_cost_allows_demand_analysis_but_retains_unknown_cash_results():
    doc = scenario()
    set_cash(doc, "fixed_cost", None)
    doc["analysis_bounds"] = [bound()]
    output = result(doc)
    assert output["status"] == "partial"
    science = output["science"]
    row, joint = science["sensitivity"][0], science["joint_range"]
    assert all(row[key] is None for key in ("low_balance", "base_balance", "high_balance", "span"))
    assert joint["tested_corners"] == 2 and joint["valid_corners"] == 0
    assert all(joint[key] is None for key in ("min_balance", "max_balance", "worst_gap"))
    assert joint["min_at"] == joint["max_at"] == []


@pytest.mark.parametrize("missing_target", ["service_fee", "cash_amount"])
def test_bound_cannot_supply_a_missing_baseline_value(missing_target):
    doc = scenario()
    if missing_target == "service_fee":
        doc["services"][0]["fee_per_visit"] = scalar(None, "yuan/visit")
        doc["analysis_bounds"] = [bound("service_fee", "meal", 8, 12, "yuan/visit")]
    else:
        set_cash(doc, "fixed_cost", None)
        doc["analysis_bounds"] = [bound("cash_amount", "fixed_cost", 9000, 11000, "yuan/month")]
    with pytest.raises(ValueError):
        result(doc)


def test_multiple_services_offer_uniform_fee_multiplier_without_assuming_visit_mix():
    doc = scenario()
    second = deepcopy(doc["services"][0])
    second.update(id="activity", name="活动", resource_id="activity-room")
    doc["services"].append(second)
    set_cash(doc, "fixed_cost", 13000)
    limits = thresholds(result(doc))
    assert limits["uniform_fee_multiplier"]["value"] == 1.75
    assert limits["uniform_fee_multiplier"]["status"] == "feasible"
    assert limits["break_even_visits"]["value"] is None
    assert limits["break_even_visits"]["status"] == "not_identifiable"


def test_new_optional_science_fields_do_not_break_legacy_snapshot_readback():
    doc = scenario()
    old_result = result(doc)
    old_result["model_version"] = "community-operations-1.0"
    old_result.pop("science")
    for service in old_result["services"]:
        for field in ("capacity_method", "monthly_pooled_upper_bound", "aggregation_overstatement_visits"):
            service.pop(field)
    snapshot = OperationsSnapshot.model_validate({
        "id": "legacy-snapshot", "project_id": "project-a", "context_version": 1,
        "input_hash": "a" * 64, "created_at": "2026-09-30T15:59:59Z",
        "input": doc, "result": old_result,
    })
    assert snapshot.result.science is None
    assert snapshot.result.services[0].capacity_method is None
    assert snapshot.result.metrics.balance_after_support == -200
