"""Monthly accounting invariants and immutable same-facility observation checks."""
from copy import deepcopy
from decimal import Decimal

import pytest

from services.capabilities.community_operations import compare_observation, evaluate_operations


def scalar(number, unit, *, status="assumption", source_kind="demo"):
    return {"value": number, "unit": unit, "status": status, "source_kind": source_kind,
            "source": "明确标注的演示假设，供月度核算测试使用", "as_of": "2026-09-20"}


def scenario():
    costs = {
        "fixed_cost": 2600, "other_earned_income": 100, "government_purchase": 500,
        "operating_subsidy": 1000, "other_support": 200, "government_direct_cost": 400,
    }
    return {
        "name": "演示基准", "facility_id": "center-a", "facility_name": "示例社区中心",
        "period": "2026-10", "scope_note": "各服务使用独立资源且排班不重叠；人数在设施范围跨服务去重。",
        "target_population": scalar(400, "person"), "unique_users": scalar(100, "person"),
        "cost_scope_complete": True,
        "services": [{
            "id": "meal", "name": "助餐", "resource_id": "dining-room",
            "schedule_note": "独立食堂每日一餐，20个有效开放日；需求为这20个时段的需求人次。",
            "capacity_per_slot": scalar(10, "visit/slot"), "available_slots": scalar(20, "slot/month"),
            "demand_visits": scalar(250, "visit/month"), "paid_share": scalar(0.5, "ratio"),
            "fee_per_visit": scalar(10, "yuan/visit"), "variable_cost_per_visit": scalar(2, "yuan/visit"),
        }],
        "cash_items": [{"economic_item_id": kind, "description": kind,
                        "kind": kind, "amount": scalar(amount, "yuan/month")} for kind, amount in costs.items()],
    }


def result(document=None):
    return evaluate_operations(document or scenario()).model_dump(mode="json")


def records():
    doc = scenario()
    snapshot = {
        "id": "snap-1", "project_id": "project-a", "context_version": 2, "input_hash": "a" * 64,
        "created_at": "2026-09-30T15:59:59Z", "input": doc, "result": result(doc),
    }
    observation = {
        "id": "obs-1", "project_id": "project-a", "snapshot_id": "snap-1",
        "created_at": "2026-11-03T00:00:00Z", "source_hash": "b" * 64, "source_title": "十月真实运营台账",
        "source_snapshot": {
            "id": "source-1", "title": "工程测试台账，非实际运营数据",
            "synthetic": False, "data_class": "internal", "visibility": "internal",
            "content_status": "uploaded", "untrusted_text": "仅用于测试来源快照字段的工程样本。",
        },
        "input": {
            "facility_id": "center-a", "period": "2026-10", "source_id": "source-1",
            "locator": "月报第2页", "collected_at": "2026-11-02", "split": "holdout", "note": "月结后核实的记录",
            "metrics": {"served_visits": 250, "unique_users": 125, "fee_income": 1200,
                        "operating_cost": 3200, "government_purchase": 500, "operating_subsidy": 1000},
        },
    }
    return snapshot, observation


def test_operator_and_government_cash_views_do_not_double_count():
    output = result()
    m = output["metrics"]
    assert output["model_version"] == "community-operations-1.1"
    assert output["result_kind"] == "scenario_prediction"
    assert output["status"] == "complete"
    assert m["fee_income"] == 1000
    assert m["earned_income"] == 1600
    assert m["operating_cost"] == 3000
    assert m["government_direct_cost"] == 400
    assert m["total_service_cost"] == 3400
    assert m["balance_before_support"] == -1400
    assert m["balance_after_support"] == -200
    assert m["unfunded_gap"] == 200
    assert m["required_subsidy"] == 1200
    assert m["government_outlay"] == 1900
    assert m["government_cost_per_visit"] == 9.5
    assert m["commercial_cost_coverage"] == pytest.approx(1100 / 3000)


def test_capacity_saturation_preserves_unmet_demand():
    m = result()["metrics"]
    assert (m["capacity_visits"], m["served_visits"], m["unmet_visits"], m["utilization"]) == (200, 200, 50, 1)


def test_utilization_aggregates_counts_instead_of_averaging_rates():
    doc = scenario()
    second = deepcopy(doc["services"][0])
    second.update(id="activity", name="活动", resource_id="activity-room")
    second["capacity_per_slot"]["value"] = 50
    second["demand_visits"]["value"] = 100
    doc["services"].append(second)
    output = result(doc)
    assert output["metrics"]["utilization"] == 300 / 1200
    assert [s["utilization"] for s in output["services"]] == [1, 0.1]
    assert output["metrics"]["unique_users"] == 100


def test_unknown_fee_only_affects_fee_dependent_metrics():
    doc = scenario()
    doc["services"][0]["fee_per_visit"] = scalar(None, "yuan/visit", status="missing", source_kind="missing")
    output = result(doc)
    assert output["status"] == "partial"
    assert output["metrics"]["fee_income"] is None
    assert output["metrics"]["balance_after_support"] is None
    assert output["metrics"]["operating_cost"] == 3000
    assert output["metrics"]["served_visits"] == 200
    assert output["metrics"]["government_outlay"] == 1900
    assert output["missing"][0]["field"] == "services.0.fee_per_visit"
    assert "流水" in output["missing"][0]["collect_from"]


@pytest.mark.parametrize("kind", ["fixed_cost", "other_earned_income", "government_purchase", "operating_subsidy", "other_support", "government_direct_cost"])
def test_each_cash_category_must_be_explicit_even_if_zero(kind):
    doc = scenario()
    doc["cash_items"] = [item for item in doc["cash_items"] if item["kind"] != kind]
    output = result(doc)
    assert any(item["field"] == f"cash_items.{kind}" for item in output["missing"])
    assert output["metrics"]["served_visits"] == 200
    if kind == "government_direct_cost":
        assert output["metrics"]["government_outlay"] is None
        assert output["metrics"]["total_service_cost"] is None
        assert output["metrics"]["balance_after_support"] == -200
    doc["cash_items"].append({"kind": kind, "economic_item_id": kind, "description": "已核实为零",
                              "amount": scalar(0, "yuan/month")})
    assert not any(item["field"] == f"cash_items.{kind}" for item in result(doc)["missing"])


def test_zero_is_known_and_zero_denominators_are_null():
    doc = scenario()
    doc["target_population"]["value"] = doc["unique_users"]["value"] = 0
    doc["services"][0]["available_slots"]["value"] = 0
    for item in doc["cash_items"]:
        item["amount"]["value"] = 0
    output = result(doc)
    assert output["status"] == "complete"
    assert not output["missing"]
    m = output["metrics"]
    assert m["served_visits"] == 0 and m["unmet_visits"] == 250
    assert m["fee_income"] == m["operating_cost"] == m["balance_after_support"] == 0
    assert all(m[field] is None for field in ["utilization", "coverage", "government_cost_per_visit", "commercial_cost_coverage"])


def test_incomplete_cost_scope_does_not_discard_known_income_or_service():
    doc = scenario()
    doc["cost_scope_complete"] = False
    m = result(doc)["metrics"]
    assert m["operating_cost"] is None and m["total_service_cost"] is None
    assert m["balance_after_support"] is None and m["required_subsidy"] is None
    assert m["earned_income"] == 1600 and m["served_visits"] == 200


@pytest.mark.parametrize("other_kind", ["fixed_cost", "operating_subsidy", "government_direct_cost"])
def test_duplicate_economic_item_rejected_across_and_within_categories(other_kind):
    doc = scenario()
    duplicate = deepcopy(doc["cash_items"][0])
    duplicate["kind"] = other_kind
    doc["cash_items"].append(duplicate)
    with pytest.raises(ValueError, match="economic_item_id"):
        result(doc)


def test_shared_resource_is_not_counted_twice_under_different_service_names():
    doc = scenario()
    service = deepcopy(doc["services"][0])
    service.update(id="evening-event", name="活动")
    doc["services"].append(service)
    with pytest.raises(ValueError, match="resource_id"):
        result(doc)


@pytest.mark.parametrize("status,kind", [("factual", "demo"), ("factual", "literature"), ("reference", "interview"), ("assumption", "observation"), ("missing", "demo")])
def test_invalid_source_status_combination_rejected(status, kind):
    doc = scenario()
    doc["target_population"].update(status=status, source_kind=kind)
    with pytest.raises(ValueError):
        result(doc)


@pytest.mark.parametrize("status,kind", [("factual", "observation"), ("factual", "public_record"), ("reference", "literature"), ("reference", "public_record"), ("assumption", "interview"), ("assumption", "demo")])
def test_valid_source_status_combinations(status, kind):
    doc = scenario()
    doc["target_population"].update(status=status, source_kind=kind)
    assert result(doc)["metrics"]["coverage"] == 0.25


def test_missing_must_be_null_and_known_values_must_be_numbers():
    doc = scenario()
    doc["target_population"].update(status="missing", source_kind="missing")
    with pytest.raises(ValueError):
        result(doc)
    doc["target_population"].update(status="factual", source_kind="observation", value=None)
    with pytest.raises(ValueError):
        result(doc)


@pytest.mark.parametrize("raw", [True, "400", float("nan"), float("inf"), -1, 1e13, 2.5])
def test_population_rejects_invalid_numbers(raw):
    doc = scenario()
    doc["target_population"]["value"] = raw
    with pytest.raises(ValueError):
        result(doc)


@pytest.mark.parametrize("as_of", ["2026-02-30", "20260920", "tomorrow", "2026-09-20T00:00:00Z"])
def test_source_requires_calendar_date(as_of):
    doc = scenario()
    doc["target_population"]["as_of"] = as_of
    with pytest.raises(ValueError):
        result(doc)


def test_ratios_counts_and_computed_bounds_are_checked():
    doc = scenario()
    doc["services"][0]["paid_share"]["value"] = 1.1
    with pytest.raises(ValueError):
        result(doc)
    doc = scenario()
    doc["services"][0]["available_slots"]["value"] = 2.5
    with pytest.raises(ValueError):
        result(doc)
    doc = scenario()
    doc["services"][0]["capacity_per_slot"]["value"] = 1e12
    with pytest.raises(ValueError, match="1e12"):
        result(doc)


def test_money_uses_decimal_expected_paid_share_without_rounding_people():
    doc = scenario()
    doc["unique_users"]["value"] = 1
    service = doc["services"][0]
    service["demand_visits"]["value"] = 3
    service["paid_share"]["value"] = 0.1
    service["fee_per_visit"]["value"] = 0.1
    service["variable_cost_per_visit"]["value"] = 0.2
    output = result(doc)
    assert output["metrics"]["fee_income"] == 0.03
    assert output["services"][0]["variable_cost"] == 0.6
    assert Decimal(str(output["metrics"]["fee_income"])) == Decimal("0.03")


def test_unknown_unique_users_stay_unknown_instead_of_being_inferred_from_visits():
    doc = scenario()
    doc["unique_users"] = scalar(None, "person", status="missing", source_kind="missing")
    m = result(doc)["metrics"]
    assert m["unique_users"] is None and m["coverage"] is None
    assert m["served_visits"] == 200


@pytest.mark.parametrize("field,value", [("unique_users", 201), ("target_population", 99)])
def test_unique_user_counts_cannot_exceed_population_or_visits(field, value):
    doc = scenario()
    doc[field]["value"] = value
    with pytest.raises(ValueError, match="unique_users"):
        result(doc)


def test_comparison_preserves_split_and_observed_denominator():
    snapshot, observation = records()
    comparison = compare_observation(snapshot, observation).model_dump(mode="json")
    assert comparison["timing"] == "prospective" and comparison["split"] == "holdout"
    assert len(comparison["differences"]) == 6
    visits = comparison["differences"][0]
    assert visits == {"metric": "served_visits", "predicted": 200, "observed": 250,
                      "error": 50, "absolute_error": 50, "percentage_error": 0.2}


@pytest.mark.parametrize("created_at,expected", [
    ("2026-09-30T23:59:59+08:00", "prospective"), ("2026-09-30T16:00:00Z", "retrospective"),
    ("2026-10-01T00:00:00+08:00", "retrospective"), ("2026-10-13T00:00:00Z", "retrospective"),
])
def test_post_period_start_freeze_never_claims_prospective_validation(created_at, expected):
    snapshot, observation = records()
    snapshot["created_at"] = created_at
    assert compare_observation(snapshot, observation).timing == expected


@pytest.mark.parametrize("field,value", [("facility_id", "center-b"), ("period", "2026-11")])
def test_only_same_facility_month_can_be_compared(field, value):
    snapshot, observation = records()
    observation["input"][field] = value
    with pytest.raises(ValueError, match="同一"):
        compare_observation(snapshot, observation)


def test_comparison_zero_and_unknown_inputs_do_not_manufacture_percentage_error():
    snapshot, observation = records()
    observation["input"]["metrics"].update(served_visits=0, unique_users=0, fee_income=None)
    differences = compare_observation(snapshot, observation).model_dump(mode="json")["differences"]
    visits = differences[0]
    assert visits["error"] == -200 and visits["absolute_error"] == 200 and visits["percentage_error"] is None
    assert all(differences[2][key] is None for key in ["observed", "error", "absolute_error", "percentage_error"])
    snapshot["result"]["metrics"]["operating_cost"] = None
    assert compare_observation(snapshot, observation).differences[3].error is None


@pytest.mark.parametrize("value", [True, 1.5, float("inf"), -1])
def test_observed_visits_require_real_nonnegative_integers(value):
    snapshot, observation = records()
    observation["input"]["metrics"]["served_visits"] = value
    with pytest.raises(ValueError):
        compare_observation(snapshot, observation)
