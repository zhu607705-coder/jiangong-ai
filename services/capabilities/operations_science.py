"""Deterministic switching values and explicitly sourced scenario bounds.

All perturbations call the same operations calculator. Endpoint enumeration is
a tested scenario range; it is not a confidence interval or a global optimizer.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
from itertools import product
from typing import Callable


METHOD_VERSION = "operations-science-1.0"
_ZERO = Decimal(0)
_LIMIT = Decimal("1e12")
_TARGETS = {
    "service_demand_multiplier": ("ratio", None, "服务需求倍率"),
    "service_fee": ("yuan/visit", "fee_per_visit", "每付费人次收费"),
    "service_paid_share": ("ratio", "paid_share", "收费人次比例"),
    "service_variable_cost": ("yuan/visit", "variable_cost_per_visit", "每服务人次变动成本"),
    "cash_amount": ("yuan/month", "amount", "月度现金事项"),
}


def _subtract(first, *rest):
    if first is None or any(value is None for value in rest):
        return None
    return first - sum(rest, _ZERO)


def _threshold(key, label, value, unit, basis, *, status=None):
    if status is None:
        status = "not_identifiable" if value is None else "feasible"
    # A tiny positive denominator can produce a finite threshold beyond the
    # supported input range. Keep the base calculation usable in that case.
    if value is not None and (not value.is_finite() or abs(value) > _LIMIT):
        value, status = None, "not_identifiable"
        basis += "；阈值超出本计算器支持的1e12数值范围。"
    return {"key": key, "label": label, "value": None if value is None else float(value),
            "unit": unit, "status": status, "basis": basis}


def _positive_ratio(numerator, denominator):
    if numerator is None or denominator is None or denominator == 0:
        return None
    return max(_ZERO, numerator) / denominator


def _known_value(item):
    return None if item["value"] is None else Decimal(str(item["value"]))


def _break_even(document, services, cash, metrics):
    required = metrics["required_subsidy"]
    thresholds = [_threshold(
        "required_subsidy", "按当前服务量所需运营补贴", required, "yuan/month",
        "复用月度核算：max(0,运营成本－收费收入－其他经营收入－政府购买服务－其他支持)；政府直接支付单列。",
        status="not_identifiable" if required is None else "already_balanced" if required == 0 else "feasible",
    )]
    revenue_needed = _subtract(metrics["operating_cost"], cash["other_earned_income"],
                               cash["government_purchase"], cash["operating_subsidy"], cash["other_support"])
    fixed_needed = _subtract(cash["fixed_cost"], cash["other_earned_income"], cash["government_purchase"],
                             cash["operating_subsidy"], cash["other_support"])
    if not document["cost_scope_complete"]:
        fixed_needed = None
    if len(services) != 1:
        for key, label, unit in [
            ("minimum_fee_per_visit", "单服务最低收费", "yuan/visit"),
            ("minimum_paid_share", "单服务最低收费比例", "ratio"),
            ("break_even_visits", "单服务保本人次", "visit/month"),
        ]:
            thresholds.append(_threshold(key, label, None, unit,
                                         "存在多个服务；未固定服务组合，无法确定一个共同的单服务阈值。"))
        multiplier = _positive_ratio(revenue_needed, metrics["fee_income"])
        thresholds.append(_threshold(
            "uniform_fee_multiplier", "各服务统一收费倍率阈值", multiplier, "ratio",
            "保持各服务量、收费比例、成本与其他收支不变，同倍率调整全部收费；未预测调价后的需求变化。",
        ))
        return thresholds

    service, delivered = document["services"][0], services[0]
    visits, capacity = delivered["served_visits"], delivered["capacity_visits"]
    share = _known_value(service["paid_share"])
    price = _known_value(service["fee_per_visit"])
    variable = _known_value(service["variable_cost_per_visit"])
    paid_visits = None if visits is None or share is None else visits * share
    potential_fees = None if visits is None or price is None else visits * price
    minimum_price = _positive_ratio(revenue_needed, paid_visits)
    minimum_share = _positive_ratio(revenue_needed, potential_fees)
    thresholds.extend([
        _threshold("minimum_fee_per_visit", "固定服务量时最低收费", minimum_price, "yuan/visit",
                   "保持当前已服务人次、收费比例、成本和其他收支不变求收支平衡；未预测调价后的需求变化。"),
        _threshold("minimum_paid_share", "固定服务量时最低收费比例", minimum_share, "ratio",
                   "保持当前已服务人次、单价、成本和其他收支不变；收费比例须在0至1之间。",
                   status="infeasible" if minimum_share is not None and minimum_share > 1 else None),
    ])
    explanation = "月度汇总单服务，保持单价、收费比例、单位变动成本和其他收支不变；每人次边际结余=收费比例×单价－单位变动成本。"
    if service.get("time_blocks"):
        thresholds.append(_threshold("break_even_visits", "单服务保本人次", None, "visit/month",
                                     "采用分时段容量；总人次无法指定需求落在哪些时段，需要给出分时段需求结构再判断。"))
        return thresholds
    margin = None if share is None or price is None or variable is None else share * price - variable
    if fixed_needed is None or margin is None or capacity is None:
        value, status = None, "not_identifiable"
        explanation += "相关成本、收入、单位边际结余或容量缺失。"
    elif margin <= 0 and fixed_needed > 0:
        value, status = None, "infeasible"
        explanation += "单位边际结余不为正且固定支出仍有缺口，增加服务人次无法保本。"
    elif margin < 0:
        value, status = None, "not_identifiable"
        explanation += "单位边际结余为负，应另核可承受的最高服务人次；增加客流会减少结余。"
    elif fixed_needed <= 0:
        value, status = _ZERO, "already_balanced"
        explanation += "固定支出已由其他收入与支持覆盖，非负边际结余下无需额外服务人次。"
    else:
        value = (fixed_needed / margin).to_integral_value(rounding=ROUND_CEILING)
        status = "infeasible" if value > capacity else "feasible"
        explanation += f"所需人次与登记月容量{capacity}比较；容量可达不等于已经取得相应需求。"
    thresholds.append(_threshold("break_even_visits", "单服务保本人次", value, "visit/month",
                                 explanation, status=status))
    return thresholds


def _numeric(raw, field):
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError(f"{field}须为有限非负数，不能为布尔值或字符串")
    value = Decimal(str(raw))
    if not value.is_finite() or not 0 <= value <= _LIMIT:
        raise ValueError(f"{field}须为0至1e12之间的有限数")
    return value


def _validated_bounds(document):
    bounds, seen, ids = [], set(), set()
    for raw in document.get("analysis_bounds") or []:
        target, item_id = raw["target"], raw["item_id"]
        identity = target, item_id
        if identity in seen or raw["id"] in ids:
            raise ValueError("analysis_bounds的id及target+item_id须唯一")
        seen.add(identity)
        ids.add(raw["id"])
        unit, field, label = _TARGETS[target]
        if raw["unit"] != unit:
            raise ValueError(f"analysis_bounds.{raw['id']}单位须为{unit}")
        for required in ("id", "item_id", "basis", "source_ref", "origin"):
            if not isinstance(raw.get(required), str) or not raw[required].strip():
                raise ValueError(f"analysis_bounds.{required}须提供非空说明")
        if not isinstance(raw["as_of"], str) or len(raw["as_of"]) != 10:
            raise ValueError("analysis_bounds.as_of须为YYYY-MM-DD")
        try:
            if date.fromisoformat(raw["as_of"]).isoformat() != raw["as_of"]:
                raise ValueError
        except ValueError as exc:
            raise ValueError("analysis_bounds.as_of须为有效的YYYY-MM-DD日期") from exc
        collection = "cash_items" if target == "cash_amount" else "services"
        key = "economic_item_id" if collection == "cash_items" else "id"
        matches = [(index, row) for index, row in enumerate(document[collection]) if row[key] == item_id]
        if len(matches) != 1:
            raise ValueError(f"analysis_bounds的item_id未唯一匹配{collection}")
        index, row = matches[0]
        base = Decimal(1) if target == "service_demand_multiplier" else _known_value(row[field])
        low, high = _numeric(raw["low"], "analysis_bounds.low"), _numeric(raw["high"], "analysis_bounds.high")
        if base is None:
            raise ValueError("指定敏感性分析的基准值缺失，请先补齐基准输入或移除此范围")
        if not low <= base <= high:
            raise ValueError("analysis_bounds须满足low <= base <= high")
        if target == "service_paid_share" and high > 1:
            raise ValueError("收费比例的范围须在0至1之间")
        bounds.append({**raw, "low": low, "base": base, "high": high, "index": index,
                       "collection": collection, "field": field,
                       "label": f"{row.get('name', row.get('description', item_id))}：{label}"})
    return bounds


def _set_assumption(item, value, bound):
    item.update(value=float(value), status="assumption", source_kind="demo",
                source=f"情景分析假设；analysis_bounds.{bound['id']}；范围类型{bound['origin']}；完整来源与依据见对应范围条目。",
                as_of=bound["as_of"])


def _perturb(document, bounds, values):
    changed = deepcopy(document)
    changed.pop("analysis_bounds", None)
    for bound, value in zip(bounds, values):
        item = changed[bound["collection"]][bound["index"]]
        if bound["target"] != "service_demand_multiplier":
            _set_assumption(item[bound["field"]], value, bound)
            continue
        demands = ([block["demand_visits"] for block in item["time_blocks"]]
                   if item.get("time_blocks") else [item["demand_visits"]])
        for demand in demands:
            if demand["value"] is not None:
                scaled = (_known_value(demand) * value).to_integral_value(rounding=ROUND_HALF_UP)
                _set_assumption(demand, scaled, bound)
        # Visits do not determine distinct people. The nominal record is kept
        # untouched; all modified-demand trials explicitly lose user coverage.
        changed["unique_users"].update(value=None, status="missing", source_kind="missing",
                                       source="需求情景变化，尚无对应去重人数观测；须重新取得匿名签到记录。",
                                       as_of=bound["as_of"])
    return changed


def _trial(document, bounds, values, evaluate):
    try:
        return evaluate(_perturb(document, bounds, values)).metrics.balance_after_support
    except (ValueError, OverflowError):
        # Bounds can yield an overflow or violate a capacity/population check.
        # Such corners remain counted as tested but have no valid cash result.
        return None


def analyze_operations(document: dict, services: list, cash: dict, metrics: dict,
                       *, evaluate: Callable) -> dict:
    bounds = _validated_bounds(document)
    sensitivity = []
    for bound in bounds:
        balances = [_trial(document, [bound], [bound[level]], evaluate) for level in ("low", "base", "high")]
        span = None if any(value is None for value in balances) else round(max(balances) - min(balances), 2)
        sensitivity.append({
            "id": bound["id"], "label": bound["label"],
            **{level: float(bound[level]) for level in ("low", "base", "high")},
            **dict(zip(("low_balance", "base_balance", "high_balance"), balances)), "span": span,
            "basis": f"情景假设，逐项变动其余输入固定；{bound['basis']}；范围类型{bound['origin']}，时点{bound['as_of']}。",
            "source_ref": bound["source_ref"],
        })
    sensitivity.sort(key=lambda row: (row["span"] is not None, row["span"] or 0), reverse=True)
    joint = None
    if bounds:
        results = []
        for values in product(*[(bound["low"], bound["high"]) for bound in bounds]):
            balance = _trial(document, bounds, values, evaluate)
            if balance is not None:
                results.append((balance, [{"id": bound["id"], "value": float(value)}
                                          for bound, value in zip(bounds, values)]))
        lowest = min(results, key=lambda row: row[0]) if results else (None, [])
        highest = max(results, key=lambda row: row[0]) if results else (None, [])
        joint = {"tested_corners": 2 ** len(bounds), "valid_corners": len(results),
                 "min_balance": lowest[0], "max_balance": highest[0],
                 "worst_gap": None if lowest[0] is None else max(0, -lowest[0]),
                 "min_at": lowest[1], "max_at": highest[1], "label": "已测试参数组合范围"}
    return {"method_version": METHOD_VERSION, "break_even": _break_even(document, services, cash, metrics),
            "sensitivity": sensitivity, "joint_range": joint,
            "notes": [
                "分析期沿用输入period对应自然月；资金与政府直接支付口径复用正式月度核算。",
                "分时段方法逐组计算min(需求,容量)再汇总，容量不跨时段结转；月度汇总潜在高估量另列。尚未执行共享资源排班优化。",
                "方法参考：GAO Cost Estimating and Assessment Guide (2020) 敏感性分析；HM Treasury Green Book (2026) switching values；Green等(2007)时变需求与服务能力。",
                "范围端点均作为情景假设输入，observed_range或literature_range只说明范围来源，不将模拟结果标为事实。",
                "单参数低/基准/高测试及全部范围端点组合沿用同一核算公式；已测试参数组合范围不代表全域极值或95%概率区间。",
                "改变需求时各时段按倍率调整并四舍五入为整数，去重人数及覆盖率保留未知；缺项或超出支持范围的试算无有效现金结果。",
                "收费与比例阈值保持服务量不变，用于识别改变结论的条件；未估计价格弹性，未自动优化收费。",
            ]}
