from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("teacher_review", ROOT / "scripts/review-teacher-criteria.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class TeacherCriteriaReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = ROOT / "data/imports/teacher-criteria-20261012.json"
        cls.criteria = json.loads(cls.source.read_text(encoding="utf-8"))

    def test_default_preserves_all_rules_and_omits_all_noncore(self):
        result = MODULE.build_review(self.criteria)
        self.assertEqual(result["selected_rules"], self.criteria["normalized"]["selected_rules"])
        self.assertEqual(result["summary"]["retained_rules"], 27)
        self.assertEqual(result["summary"]["default_missing_fields"], 76)
        self.assertEqual(result["collection_tasks"], [])
        self.assertTrue(all(row["state"] == "not_requested" for row in result["rule_states"]))

    def test_report_requests_only_related_missing_parameters(self):
        result = MODULE.build_review(self.criteria, needed_rules=["R007"])
        self.assertEqual([task["field_id"] for task in result["collection_tasks"]], ["X013", "X014"])
        self.assertEqual(result["summary"]["default_missing_fields"], 74)
        self.assertTrue(all(not row["blocks_unrequested_rules"] for row in result["noncore_field_states"]))
        self.assertEqual(next(row for row in result["rule_states"] if row["rule_id"] == "R001")["state"], "not_requested")

    def test_source_simulation_is_preserved_and_excluded_from_compliance(self):
        result = MODULE.build_review(self.criteria, needed_rules=["R007", "R022"])
        expected = [row for row in self.criteria["normalized"]["core_data_fields"] if row["source_class"] == "source_ai_demo"]
        self.assertEqual(result["source_ai_demo_records"], expected)
        self.assertEqual(len(expected), 15)
        self.assertEqual(result["compliance_inputs_from_simulation"], [])
        self.assertTrue(all(task["state"] == "awaiting_manual_fill" for task in result["collection_tasks"]))
        self.assertEqual(len(result["core_restrictions"]), 11)

    def test_manual_fill_updates_task_and_keeps_other_missing_fields(self):
        original = copy.deepcopy(self.criteria)
        patch = {"X013": {"value": "演示人工补填：主要通行路径资料索引", "source_label": "人工补填流程演示，待核对实际资料"}}
        result = MODULE.build_review(self.criteria, needed_rules=["R007"], manual_fills=patch)
        self.assertEqual(result["summary"]["supplied_pending_review"], 1)
        self.assertEqual(result["summary"]["awaiting_manual_fill"], 1)
        self.assertEqual(next(task for task in result["collection_tasks"] if task["field_id"] == "X013")["manual_submission"], patch["X013"])
        self.assertFalse(result["manual_submissions_are_approvals"])
        self.assertEqual(self.criteria, original)
        with self.assertRaises(ValueError):
            MODULE.build_review(self.criteria, manual_fills=patch)

    def test_provenance_cells_and_hash_survive_review_without_source_edit(self):
        before = hashlib.sha256(self.source.read_bytes()).hexdigest()
        result = MODULE.build_review(self.criteria, needed_fields=["X013"])
        source = next(row for row in self.criteria["normalized"]["noncore_default_fields"] if row["field_id"] == "X013")
        self.assertEqual(result["collection_tasks"][0]["source_locator"], source["provenance"])
        self.assertEqual(result["collection_tasks"][0]["source_locator"]["row"], 14)
        self.assertEqual(result["collection_tasks"][0]["source_locator"]["cells_by_column"]["C"], "C14")
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), before)
        self.assertFalse(result["original_workbook_mutated"])


if __name__ == "__main__":
    unittest.main()
