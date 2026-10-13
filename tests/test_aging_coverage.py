import importlib.util
import json
import unittest
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("aging", ROOT / "scripts/simulate-aging-coverage.py")
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)


def d(v, unit):
    return {"value": v, "unit": unit, "status": "missing" if v is None else "assumption",
            "source": {"kind": "演示假设", "ref": "regression-test"}, "as_of": "2026-10-12"}


def document():
    facility = {"facility_id": "meal", "name": "助餐", "monthly_capacity": d(80, "visit/month"),
                "adoption_factor": d(1, "ratio"), "routes": [{"group_id": "A", "distance": d(100, "m"),
                                                              "continuous_accessible_route": d(True, "boolean")} ]}
    second = deepcopy(facility)
    second.update(facility_id="exercise", name="活动")
    return {"purpose": "演示假设", "seed": 20261012, "period": "month", "population": d(20, "person"),
            "elderly_ratio": d(.5, "ratio"), "groups": [{"group_id": "A", "name": "长者", "elderly_count": d(10, "person"),
            "maximum_distance": d(300, "m"), "visits_per_user": d(4, "visit/person/month")}],
            "adoption_scenarios": [{"scenario_id": "full", "adoption_probability": d(1, "ratio")}],
            "baseline_mode_id": "baseline", "modes": [{"mode_id": "baseline", "name": "基线", "facilities": [facility, second]}]}


class AgingCoverageTest(unittest.TestCase):
    def test_person_deduplication_denominators_and_visits(self):
        result = MODEL.calculate(document())
        row = result["modes"][0]["scenarios"][0]
        self.assertEqual(result["target_elderly_people"], 10)
        self.assertEqual(row["covered_people"], 10)
        self.assertEqual(row["predicted_unique_users"], 10)
        self.assertEqual(sum(f["predicted_users"] for f in row["facilities"]), 20)
        self.assertEqual(row["monthly_visits"], 80)
        self.assertEqual(row["user_population_coverage_percent"], 100)
        self.assertEqual(row["accessible_adoption_percent"], 100)
        self.assertEqual(row["capacity_utilization_percent"], 50)

    def test_capacity_is_visit_slots_and_people_remain_bounded(self):
        sample = document()
        for f in sample["modes"][0]["facilities"]:
            f["monthly_capacity"] = d(5, "visit/month")
        row = MODEL.calculate(sample)["modes"][0]["scenarios"][0]
        self.assertLessEqual(row["predicted_unique_users"], row["covered_people"])
        self.assertLessEqual(row["covered_people"], row["target_elderly_people"])
        self.assertEqual(row["monthly_visits"], 8)
        for f in row["facilities"]:
            self.assertEqual(f["predicted_users"], 1)
            self.assertLessEqual(f["monthly_visits"], f["monthly_capacity_visits"])

    def test_fixed_seed_is_stable(self):
        sample = document()
        sample["adoption_scenarios"][0]["adoption_probability"] = d(.53, "ratio")
        self.assertEqual(MODEL.calculate(sample), MODEL.calculate(deepcopy(sample)))

    def test_route_improvement_and_adoption_scenario_direction(self):
        sample = document()
        base = sample["modes"][0]
        for f in base["facilities"]:
            f["routes"][0]["continuous_accessible_route"] = d(False, "boolean")
        improved = deepcopy(base)
        improved.update(mode_id="improved", name="改善")
        for f in improved["facilities"]:
            f["routes"][0]["continuous_accessible_route"] = d(True, "boolean")
        sample["modes"].append(improved)
        sample["adoption_scenarios"] = [{"scenario_id": k, "adoption_probability": d(p, "ratio")} for k, p in (("low", .2), ("mid", .5), ("high", .9))]
        result = MODEL.calculate(sample)
        self.assertEqual(result["modes"][0]["covered_people"], 0)
        self.assertEqual(result["modes"][1]["covered_people"], 10)
        uses = [r["predicted_unique_users"] for r in result["modes"][1]["scenarios"]]
        self.assertEqual(uses, sorted(uses))
        self.assertTrue(all(c["result_status"] == "scenario_prediction" for c in result["changes_from_baseline"]))

    def test_core_missing_is_none_and_exact_action_label(self):
        sample = document()
        sample["modes"][0]["facilities"][0]["monthly_capacity"] = d(None, "visit/month")
        row = MODEL.calculate(sample)["modes"][0]
        self.assertIsNone(row["covered_people"])
        self.assertIsNone(row["scenarios"])
        self.assertEqual(row["action_label"], "先补充关键资料再判断")
        sample = document()
        sample["population"] = d(None, "person")
        result = MODEL.calculate(sample)
        self.assertIsNone(result["target_elderly_people"])
        self.assertEqual(result["modes"][0]["action_label"], "先补充关键资料再判断")

    def test_units_population_consistency_and_example(self):
        sample = document()
        sample["groups"][0]["elderly_count"] = d(11, "person")
        with self.assertRaisesRegex(ValueError, "合计"):
            MODEL.calculate(sample)
        sample = document()
        sample["modes"][0]["facilities"][0]["monthly_capacity"]["unit"] = "person/month"
        with self.assertRaisesRegex(ValueError, "单位"):
            MODEL.calculate(sample)
        example = json.loads((ROOT / "data/templates/aging-coverage-input.example.json").read_text(encoding="utf-8"))
        result = MODEL.calculate(example)
        self.assertEqual(result["target_elderly_people"], 330)
        self.assertEqual(result["modes"][1]["scenarios"][1]["predicted_unique_users"], 213)
        self.assertEqual(result["modes"][2]["action_label"], "先补充关键资料再判断")


if __name__ == "__main__":
    unittest.main()
