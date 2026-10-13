#!/usr/bin/env python3
"""Offline, source-labelled comparison of component-based renewal scenarios.

Standard library only. This is a calculation/gate prototype, not a production
Agent or an automatic choice of renewal mode. Monetary inputs use yuan.
"""
import argparse
import json
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

VERSION = "renewal-economics-0.1"
STATUSES = {"factual", "reference", "assumption", "missing"}


def value(item, unit, *, boolean=False, negative=False):
    """Read a labelled scalar; missing is None, never a numerical zero."""
    if not isinstance(item, dict):
        raise ValueError("输入须包含 value/status/source/as_of/unit")
    if item.get("status") not in STATUSES or item.get("unit") != unit:
        raise ValueError(f"无效来源状态或单位，应为 {unit}")
    if not item.get("source") or not item.get("as_of"):
        raise ValueError("每项输入须登记来源和时点")
    raw = item.get("value")
    if item["status"] == "missing":
        if raw is not None:
            raise ValueError("missing 输入的 value 须为 null")
        return None
    if boolean:
        if not isinstance(raw, bool):
            raise ValueError("条件须为 true/false 或 missing")
        return raw
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError("数值须为有限数或 missing")
    result = Decimal(str(raw))
    if not result.is_finite() or (not negative and result < 0):
        raise ValueError("数值须有限，费用与工程量须非负")
    return result


def years(row, horizon):
    first, last = row.get("year"), row.get("through_year", row.get("year"))
    if (type(first) is not int or type(last) is not int
            or not 0 <= first <= last <= horizon):
        raise ValueError("现金流年份须在 0 到 horizon_years 之间")
    return range(first, last + 1)


def money(number):
    return None if number is None else float(number.quantize(Decimal("0.01")))


def calculate_mode(mode, settings):
    horizon = settings["horizon_years"]
    if type(horizon) is not int or not 1 <= horizon <= 100:
        raise ValueError("horizon_years 须为 1–100 的整数")
    if not mode.get("mode_id") or not mode.get("components") or not mode.get("cash_subject"):
        raise ValueError("须登记 mode_id、components 和 cash_subject")
    rate = value(settings["discount_rate"], "ratio")
    opening = value(mode["opening_cash"], "yuan")
    missing, conflicts, opportunities, excluded, reasons = [], [], [], [], []
    costs, receipts, maintenance, operating = [[Decimal(0)] * (horizon + 1) for _ in range(4)]
    revenue_lines = []
    subject = mode["cash_subject"]

    def absent(path, rule, description):
        missing.append({"path": path, "rule_id": rule, "description": description})

    if rate is None:
        absent("settings.discount_rate", "ECON-PERIOD", "补充与测算期一致的折现率")
    if opening is None:
        absent("opening_cash", "ECON-FUNDING", "补充本方案可支配的期初资金")
    if value(mode["cost_scope_complete"], "boolean", boolean=True) is not True:
        absent("costs.scope", "ECON-COST", "补充完整的建设、安置与运维费用范围")
    funding_links = {r.get("economic_item_id") for r in mode["funding"] if r.get("economic_item_id")}
    for i, condition in enumerate(mode.get("hard_conditions", [])):
        hit = value(condition["conflict"], "boolean", boolean=True)
        if hit is True:
            conflicts.append({"rule_id": condition["rule_id"], "description": condition["description"],
                              "source": condition["conflict"]["source"]})
        elif hit is None:
            absent(f"hard_conditions.{i}", condition["rule_id"], condition["description"])

    for i, row in enumerate(mode["costs"]):
        periods = years(row, horizon)
        if row["payer"] != subject:
            excluded.append({"id": row["id"], "reason": "费用承担主体不在本方案现金账内"})
            continue
        amount = value(row["amount"], "yuan")
        if amount is None:
            absent(f"costs.{i}.amount", "ECON-COST", f"补充 {row['id']} 的费用")
            continue
        for t in periods:
            costs[t] += amount
            if row["kind"] == "maintenance":
                maintenance[t] += amount

    for i, row in enumerate(mode["cash_receipts"]):
        periods = list(years(row, horizon))
        path = f"cash_receipts.{i}"
        if row["recipient"] != subject:
            excluded.append({"id": row["id"], "reason": "收款权不归本方案现金主体"})
            continue
        if row.get("economic_item_id") in funding_links:
            raise ValueError("同一经济事项不得同时计为现金收入和出资；居民增面积付款应进入 funding")
        if row.get("transaction_type") == "resident_area_contribution":
            raise ValueError("居民增面积付款属于资金分担，请移至 funding")
        authorized = value(row["authorized"], "boolean", boolean=True)
        permissions = [value(row["use_permitted"], "boolean", boolean=True),
                       value(row["disposal_or_collection_permitted"], "boolean", boolean=True)]
        if False in permissions:
            authorized = False
        elif None in permissions:
            authorized = None
        if authorized is False:
            excluded.append({"id": row["id"], "reason": "未具备该现金收益的实现权利"})
            continue
        if row["kind"] == "sale":
            quantity = value(row["sellable_area"], "m2")
            price = value(row["unit_price"], "yuan/m2")
            coefficient = quantity
            price_unit = "yuan/m2"
        elif row["kind"] == "rent":
            area = value(row["rentable_area"], "m2")
            occupancy = value(row["occupancy"], "ratio")
            if occupancy is not None and occupancy > 1:
                raise ValueError("出租率须在 0–1 之间")
            price = value(row["monthly_rent"], "yuan/m2/month")
            coefficient = None if area is None or occupancy is None else area * occupancy * 12
            price_unit = "yuan/m2/month"
        elif row["kind"] == "service":
            price, coefficient, price_unit = value(row["amount"], "yuan"), Decimal(1), "yuan/year"
        else:
            raise ValueError("cash_receipts 仅接收 sale/rent/service；出资进入 funding，资产增值进入 asset_benefits")
        expected_basis = {"sale": "sellable_area", "rent": "rentable_area", "service": "service_amount"}[row["kind"]]
        basis = row.get("price_basis", {})
        if basis.get("area_measure") != expected_basis or not all(basis.get(k) for k in ("city", "as_of", "tax_basis", "use")):
            raise ValueError("收益须登记匹配的面积/计价口径、城市、时点、税费和用途")
        if authorized is None or coefficient is None or price is None:
            note = {"id": row["id"], "path": path, "rule_id": "ECON-REALIZABLE",
                    "description": "补充实现权利、工程量及市场价格后重算", "input": row}
            if row.get("required", True) or not mode.get("explicit_baseline", False):
                absent(path, "ECON-REALIZABLE", note["description"])
            else:
                opportunities.append(note)
            continue
        amount = coefficient * price
        for t in periods:
            receipts[t] += amount
            if row["kind"] in {"rent", "service"}:
                operating[t] += amount
        revenue_lines.append({"id": row["id"], "years": periods, "coefficient": coefficient,
                              "amount": amount, "unit": price_unit})

    # Finance inflows/outflows never enter economic revenue or NPV.
    planned, secured = [[Decimal(0)] * (horizon + 1) for _ in range(2)]
    planned_known = secured_known = True
    for i, row in enumerate(mode["funding"]):
        if row["recipient"] != subject:
            excluded.append({"id": row["id"], "reason": "资金不归本方案现金主体支配"})
            continue
        amount = value(row["amount"], "yuan")
        available = value(row["available"], "boolean", boolean=True)
        if amount is None:
            planned_known = secured_known = False
            absent(f"funding.{i}.amount", "ECON-FUNDING", "补充出资金额")
        if available is None:
            secured_known = False
            absent(f"funding.{i}.available", "ECON-FUNDING", "核实本方案可使用的出资")
        if row["kind"] == "loan":
            schedule = value(row["repayment_schedule_complete"], "boolean", boolean=True)
            repayment_ids = row.get("repayment_outflow_ids", [])
            repayment_rows = [r for r in mode.get("finance_outflows", []) if r["id"] in repayment_ids and r["payer"] == subject]
            repayment_values = [value(r["amount"], "yuan") for r in repayment_rows]
            principal = None if amount is None else amount * len(years(row, horizon))
            repayments = (sum(v * len(years(r, horizon)) for r, v in zip(repayment_rows, repayment_values))
                          if repayment_values and all(v is not None for v in repayment_values) else None)
            if (schedule is not True or not repayment_ids or len(repayment_rows) != len(set(repayment_ids))
                    or principal is None or repayments is None or repayments < principal):
                planned_known = secured_known = False
                absent(f"funding.{i}.repayment_schedule_complete", "ECON-DEBT", "补充贷款本息与还款时序")
        for t in years(row, horizon):
            if amount is not None:
                planned[t] += amount
                if available is True:
                    secured[t] += amount
    planned_inflows, secured_inflows = sum(planned), sum(secured)
    for i, row in enumerate(mode.get("finance_outflows", [])):
        if row["payer"] != subject:
            excluded.append({"id": row["id"], "reason": "融资支出不由本方案主体承担"})
            continue
        amount = value(row["amount"], "yuan")
        if amount is None:
            planned_known = secured_known = False
            absent(f"finance_outflows.{i}.amount", "ECON-DEBT", "补充本息偿付或出资返还安排")
        else:
            for t in years(row, horizon):
                planned[t] -= amount
                secured[t] -= amount

    affordability = []
    for i, group in enumerate(mode.get("target_groups", [])):
        checks = {}
        for prefix in ("monthly", "upfront"):
            unit = "yuan/household/month" if prefix == "monthly" else "yuan/household"
            charge = value(group[prefix + "_charge"], unit)
            budget = value(group[prefix + "_budget"], unit)
            checks[prefix + "_affordable"] = None if charge is None or budget is None else charge <= budget
            checks[prefix + "_gap"] = None if charge is None or budget is None else money(max(Decimal(0), charge - budget))
            if checks[prefix + "_affordable"] is None and group.get("required", True):
                absent(f"target_groups.{i}.{prefix}", "ECON-AFFORD", f"补充 {group['name']} 的支付额及预算")
        affordability.append({"group_id": group["id"], "name": group["name"], **checks})

    cost_missing = any(x["path"].startswith("costs.") for x in missing)
    revenue_missing = any(x["path"].startswith("cash_receipts.") for x in missing)
    economic_known = not cost_missing and not revenue_missing
    discount = None if rate is None else [(1 + rate) ** -t for t in range(horizon + 1)]
    pv_cost = None if discount is None or cost_missing else sum(x * d for x, d in zip(costs, discount))
    pv_receipt = None if discount is None or revenue_missing else sum(x * d for x, d in zip(receipts, discount))
    npv = None if pv_cost is None or pv_receipt is None else pv_receipt - pv_cost

    def gap(finance, complete):
        if not complete or not economic_known or opening is None:
            return None
        balance, lowest = opening, opening
        for t in range(horizon + 1):
            balance += receipts[t] - costs[t] + finance[t]
            lowest = min(lowest, balance)
        return max(Decimal(0), -lowest)

    breakeven = []
    for row in revenue_lines:
        denom = row["coefficient"] * sum(discount[t] for t in row["years"]) if discount else None
        current_pv = row["amount"] * sum(discount[t] for t in row["years"]) if discount else None
        required = None if not economic_known or not denom else max(Decimal(0), (pv_cost - pv_receipt + current_pv) / denom)
        breakeven.append({"receipt_id": row["id"], "price_unit": row["unit"], "npv_zero_price": money(required)})
    assets = [{"id": r["id"], "beneficiary": r["beneficiary"], "year": r["year"],
               "value_change_yuan": money(value(r["value_change"], "yuan", negative=True)),
               "source_status": r["value_change"]["status"]} for r in mode.get("asset_benefits", [])]
    # Bounds are checked even though asset appreciation is outside cash flow.
    for row in mode.get("asset_benefits", []):
        list(years(row, horizon))
    decision = "当前条件下暂缓" if conflicts else "先补充关键资料再判断" if missing else "建议开展专项调查"
    if npv is not None:
        reasons.append({"rule_id": "ECON-NPV", "text": f"{horizon} 年本方案现金主体净现值为 {money(npv):,.2f} 元"})
    secured_gap = gap(secured, secured_known)
    if secured_gap is not None and secured_gap > 0:
        reasons.append({"rule_id": "ECON-CASH-GAP", "text": f"按年度收支与出资时序，峰值资金缺口为 {money(secured_gap):,.2f} 元"})
    uncovered_years = [t for t in range(1, horizon + 1) if economic_known and operating[t] < maintenance[t]]
    if uncovered_years:
        reasons.append({"rule_id": "ECON-MAINTENANCE", "text": f"第 {uncovered_years} 年经营收入未覆盖维护支出"})
    if any(r["monthly_affordable"] is False or r["upfront_affordable"] is False for r in affordability):
        reasons.append({"rule_id": "ECON-AFFORD", "text": "部分目标人群支出超过已登记预算，调整分摊或服务方案"})
    return {"mode_id": mode["mode_id"], "name": mode["name"], "components": mode["components"],
            "cash_subject": subject, "calculation_gate": decision, "missing": missing,
            "hard_conflicts": conflicts, "reasons": reasons, "conditional_opportunities": opportunities,
            "excluded_items": excluded, "input_snapshot": deepcopy(mode),
            "cost_account": {"total_yuan": None if cost_missing else money(sum(costs)), "known_subtotal_yuan": money(sum(costs))},
            "revenue_account": {"total_yuan": None if revenue_missing else money(sum(receipts)), "baseline_known_yuan": money(sum(receipts)),
                                "scope": "explicit_baseline_excluding_conditional" if opportunities else "registered_receipts",
                                "conditional_opportunity_ids": [r["id"] for r in opportunities]},
            "economic_npv_yuan": money(npv), "static_net_cash_yuan": money(sum(receipts) - sum(costs)) if economic_known else None,
            "funding_account": {"planned_peak_gap_yuan": money(gap(planned, planned_known)),
                                "secured_peak_gap_yuan": money(secured_gap),
                                "planned_inflows_yuan": money(planned_inflows) if planned_known else None,
                                "secured_inflows_yuan": money(secured_inflows) if secured_known else None},
            "asset_benefit_account": assets, "break_even": breakeven, "affordability": affordability,
            "annual_cash": [{"year": t, "cost_yuan": None if cost_missing else money(costs[t]),
                             "revenue_yuan": None if revenue_missing else money(receipts[t]),
                             "operating_revenue_yuan": None if revenue_missing else money(operating[t]),
                             "maintenance_yuan": None if cost_missing else money(maintenance[t]),
                             "maintenance_balance_yuan": money(operating[t] - maintenance[t]) if economic_known else None,
                             "maintenance_coverage": float(operating[t] / maintenance[t]) if economic_known and maintenance[t] else None}
                            for t in range(horizon + 1)]}


def compare(document):
    modes = document["modes"]
    ids = [m["mode_id"] for m in modes]
    if len(ids) != len(set(ids)):
        raise ValueError("mode_id 不得重复")
    results = [calculate_mode(m, document["settings"]) for m in modes]
    return {"formula_version": VERSION, "purpose": document["purpose"], "settings": document["settings"],
            "modes": results, "comparison": [
                {"mode_id": r["mode_id"], "cash_subject": r["cash_subject"], "gate": r["calculation_gate"],
                 "npv_yuan": r["economic_npv_yuan"], "funding_gap_yuan": r["funding_account"]["secured_peak_gap_yuan"]}
                for r in results]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = compare(json.loads(args.input.read_text(encoding="utf-8-sig")))
    payload = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")


if __name__ == "__main__":
    main()
