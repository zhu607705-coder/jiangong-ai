"""Economically meaningful regression checks for the standalone calculator."""
import importlib.util
import unittest
from copy import deepcopy
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("renewal", Path(__file__).parents[1] / "scripts/compare-renewal-modes.py")
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)


def datum(number, unit):
    return {"value": number, "unit": unit, "status": "missing" if number is None else "assumption",
            "source": {"kind": "演示假设", "ref": "unit-test"}, "as_of": "2026-10-12"}


def receipt(kind="rent"):
    row = {"id": "rent", "kind": kind, "year": 1, "through_year": 2, "recipient": "cooperative",
           "beneficiaries": ["residents"], "authorized": datum(True, "boolean"),
           "use_permitted": datum(True, "boolean"), "disposal_or_collection_permitted": datum(True, "boolean"),
           "price_basis": {"city": "演示城市", "as_of": "2026-10-12", "tax_basis": "含税",
                           "use": "服务空间", "area_measure": "rentable_area"},
           "rentable_area": datum(10, "m2"), "monthly_rent": datum(10, "yuan/m2/month"),
           "occupancy": datum(0.5, "ratio")}
    if kind == "sale":
        row.update(id="sale", through_year=1, sellable_area=datum(100, "m2"), unit_price=datum(1000, "yuan/m2"))
        row["price_basis"]["area_measure"] = "sellable_area"
    return row


def baseline():
    return {"mode_id": "hybrid-any-id", "name": "演示假设：混合改造", "components": ["repair", "selective_rebuild", "service_operation"],
            "cash_subject": "cooperative", "explicit_baseline": True, "opening_cash": datum(0, "yuan"),
            "cost_scope_complete": datum(True, "boolean"), "hard_conditions": [],
            "costs": [{"id": "construction", "kind": "construction", "year": 0, "payer": "cooperative", "amount": datum(1000, "yuan")},
                      {"id": "maintenance", "kind": "maintenance", "year": 1, "through_year": 2, "payer": "cooperative", "amount": datum(100, "yuan")}],
            "cash_receipts": [receipt()],
            "funding": [{"id": "resident", "kind": "resident", "year": 0, "recipient": "cooperative", "amount": datum(1000, "yuan"), "available": datum(True, "boolean")}],
            "finance_outflows": [], "asset_benefits": [{"id": "house-value", "year": 2, "beneficiary": "residents", "value_change": datum(50000, "yuan")}],
            "target_groups": [{"id": "elderly", "name": "养老居民", "monthly_charge": datum(100, "yuan/household/month"),
                               "monthly_budget": datum(150, "yuan/household/month"), "upfront_charge": datum(500, "yuan/household"),
                               "upfront_budget": datum(600, "yuan/household")} ]}


def run(mode, rate=0):
    return MODEL.calculate_mode(mode, {"horizon_years": 2, "discount_rate": datum(rate, "ratio")})


class RenewalEconomicsTest(unittest.TestCase):
    def test_four_accounts_and_exact_cash(self):
        result = run(baseline())
        self.assertEqual(result["cost_account"]["total_yuan"], 1200)
        self.assertEqual(result["revenue_account"]["total_yuan"], 1200)
        self.assertEqual(result["economic_npv_yuan"], 0)
        self.assertEqual(result["asset_benefit_account"][0]["value_change_yuan"], 50000)
        self.assertEqual(result["annual_cash"][1]["maintenance_coverage"], 6)
        self.assertEqual(result["break_even"][0]["npv_zero_price"], 10)

    def test_resident_and_loan_funds_are_not_income(self):
        mode = baseline()
        mode["funding"].append({"id": "loan", "kind": "loan", "year": 0, "recipient": "cooperative",
                                "amount": datum(500, "yuan"), "available": datum(True, "boolean"),
                                "repayment_outflow_ids": ["debt"],
                                "repayment_schedule_complete": datum(True, "boolean")})
        mode["finance_outflows"].append({"id": "debt", "year": 2, "payer": "cooperative", "amount": datum(550, "yuan")})
        result = run(mode)
        self.assertEqual(result["revenue_account"]["total_yuan"], 1200)
        self.assertEqual(result["economic_npv_yuan"], 0)
        self.assertEqual(result["funding_account"]["secured_peak_gap_yuan"], 0)
        mode["finance_outflows"] = []
        self.assertIsNone(run(mode)["funding_account"]["secured_peak_gap_yuan"])

    def test_missing_core_cost_is_not_zero(self):
        mode = baseline()
        mode["costs"][0]["amount"] = datum(None, "yuan")
        result = run(mode)
        self.assertIsNone(result["cost_account"]["total_yuan"])
        self.assertIsNone(result["economic_npv_yuan"])
        self.assertEqual(result["cost_account"]["known_subtotal_yuan"], 200)
        self.assertEqual(result["calculation_gate"], "先补充关键资料再判断")

    def test_no_disposal_right_no_area_sale_revenue(self):
        mode = baseline()
        sale = receipt("sale")
        sale["disposal_or_collection_permitted"] = datum(False, "boolean")
        mode["cash_receipts"].append(sale)
        result = run(mode)
        self.assertEqual(result["revenue_account"]["total_yuan"], 1200)
        self.assertEqual(result["excluded_items"][0]["id"], "sale")

    def test_optional_unknown_is_a_separate_opportunity(self):
        mode = baseline()
        sale = receipt("sale")
        sale.update(required=False, unit_price=datum(None, "yuan/m2"))
        mode["cash_receipts"].append(sale)
        result = run(mode)
        self.assertEqual(result["economic_npv_yuan"], 0)
        self.assertEqual(len(result["conditional_opportunities"]), 1)
        self.assertEqual(result["calculation_gate"], "建议开展专项调查")
        mode["explicit_baseline"] = False
        self.assertIsNone(run(mode)["economic_npv_yuan"])

    def test_area_contribution_cannot_be_counted_twice(self):
        mode = baseline()
        mode["funding"][0]["economic_item_id"] = "extra-area"
        sale = receipt("sale")
        sale["economic_item_id"] = "extra-area"
        mode["cash_receipts"].append(sale)
        with self.assertRaisesRegex(ValueError, "同时"):
            run(mode)

    def test_price_discount_and_cost_sensitivity(self):
        original = baseline()
        higher_price = deepcopy(original)
        higher_price["cash_receipts"][0]["monthly_rent"] = datum(11, "yuan/m2/month")
        self.assertGreater(run(higher_price)["economic_npv_yuan"], run(original)["economic_npv_yuan"])
        self.assertEqual(run(original, 0.1)["economic_npv_yuan"], -132.23)
        higher_cost = deepcopy(original)
        higher_cost["costs"][0]["amount"] = datum(1100, "yuan")
        self.assertEqual(run(higher_cost)["economic_npv_yuan"], -100)
        self.assertGreater(run(higher_cost)["break_even"][0]["npv_zero_price"], 10)

    def test_mode_specific_conflict_and_budget_match(self):
        mode = baseline()
        blocked = deepcopy(mode)
        blocked["mode_id"] = "selective-other"
        blocked["hard_conditions"] = [{"rule_id": "SAFE-01", "description": "本拆建范围与已确认保留要求冲突", "conflict": datum(True, "boolean")}]
        blocked["target_groups"][0]["upfront_charge"] = datum(700, "yuan/household")
        document = {"purpose": "演示假设", "settings": {"horizon_years": 2, "discount_rate": datum(0, "ratio")}, "modes": [mode, blocked]}
        result = MODEL.compare(document)
        self.assertEqual(result["modes"][0]["calculation_gate"], "建议开展专项调查")
        self.assertEqual(result["modes"][1]["calculation_gate"], "当前条件下暂缓")
        self.assertFalse(result["modes"][1]["affordability"][0]["upfront_affordable"])
        self.assertEqual(result["modes"][0]["components"], mode["components"])

    def test_core_right_and_budget_unknown(self):
        mode = baseline()
        mode["cash_receipts"][0]["authorized"] = datum(None, "boolean")
        mode["target_groups"][0]["monthly_budget"] = datum(None, "yuan/household/month")
        result = run(mode)
        self.assertIsNone(result["revenue_account"]["total_yuan"])
        self.assertIsNone(result["affordability"][0]["monthly_affordable"])
        self.assertEqual(result["calculation_gate"], "先补充关键资料再判断")

    def test_units_incomplete_scope_and_unknown_funding(self):
        mode = baseline()
        mode["costs"][0]["amount"]["unit"] = "万元"
        with self.assertRaisesRegex(ValueError, "单位"):
            run(mode)
        mode = baseline()
        mode["funding"][0]["available"] = datum(None, "boolean")
        result = run(mode)
        self.assertIsNone(result["funding_account"]["secured_peak_gap_yuan"])
        self.assertEqual(result["funding_account"]["planned_peak_gap_yuan"], 0)
        mode["cost_scope_complete"] = datum(False, "boolean")
        self.assertIsNone(run(mode)["cost_account"]["total_yuan"])


if __name__ == "__main__":
    unittest.main()
