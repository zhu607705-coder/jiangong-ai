"""Source-labelled monthly service and cash accounting; no learned predictions.

The renewal comparison prototype remains the shared implementation of labelled
Decimal inputs and monetary rounding. This adapter adds monthly operations
constraints without copying the prototype or the person-level simulator.
"""
from __future__ import annotations

import importlib.util
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Callable

from services.capabilities.generated.contracts import (
    OperationsComparison,
    OperationsInput,
    OperationsObservation,
    OperationsResult,
    OperationsSnapshot,
)
from services.capabilities.operations_science import analyze_operations


_PROTOTYPE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "compare-renewal-modes.py"
_SPEC = importlib.util.spec_from_file_location("_shared_renewal_economics", _PROTOTYPE_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"Cannot load shared calculation prototype: {_PROTOTYPE_PATH}")
_PROTOTYPE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_PROTOTYPE)

MODEL_VERSION = "community-operations-1.1"
_LIMIT = Decimal("1e12")
_ZERO = Decimal(0)
_SOURCE_KINDS = {
    "factual": {"observation", "public_record"},
    "reference": {"literature", "public_record"},
    "assumption": {"interview", "demo"},
    "missing": {"missing"},
}
_CASH_COLLECTION = {
    "fixed_cost": "向运营方取得当月工资、租金、水电及维护账单，按经济事项编号汇总；确认无支出时填0。",
    "other_earned_income": "向运营方取得当月经营收入流水，剔除按人次收费、政府购买服务及补贴后汇总；确认无收入时填0。",
    "government_purchase": "核对当月政府购买服务合同、结算单与到账流水，以同一经济事项编号登记；确认无购买款时填0。",
    "operating_subsidy": "核对财政运营补贴拨付凭证和当月到账流水，与购买服务款分别登记；确认无补贴时填0。",
    "other_support": "核对当月捐赠及其他非经营支持到账流水，剔除政府购买服务和运营补贴；确认无支持时填0。",
    "government_direct_cost": "核对政府当月直接支付的场地、维护等凭证，仅登记未计入运营方成本的事项；确认无直接支付时填0。",
}
_SERVICE_FIELDS = {
    "capacity_per_slot": ("visit/slot", True, "核对场地核定容量、设备或席位数量，登记每时段可接待人次。"),
    "available_slots": ("slot/month", True, "取得当月开放排班表，扣除停用时段；共享场地和人员的时段须拆分，避免重叠。"),
    "demand_visits": ("visit/month", True, "按服务类型汇总预约、候补与现场需求记录，使用同一月份的人次口径。"),
    "paid_share": ("ratio", False, "核对当月收费与免费服务人次，收费人次除以全部已服务人次。"),
    "fee_per_visit": ("yuan/visit", False, "取得收费公示和订单流水，按付费人次核对平均收费金额。"),
    "variable_cost_per_visit": ("yuan/visit", False, "取得耗材、餐食等随服务人次变化的成本台账，除以对应服务人次。"),
}
_OBSERVED_METRICS = (
    "served_visits", "unique_users", "fee_income", "operating_cost",
    "government_purchase", "operating_subsidy",
)


def _bounded(number: Decimal | None) -> Decimal | None:
    if number is not None and (not number.is_finite() or abs(number) > _LIMIT):
        raise ValueError("计算结果须为有限数且绝对值不超过1e12，请检查单位和统计范围")
    return number


def _calculate(fn: Callable[..., Decimal], *values: Decimal | None) -> Decimal | None:
    if any(value is None for value in values):
        return None
    return _bounded(fn(*values))


def _total(values: list[Decimal | None]) -> Decimal | None:
    return _calculate(lambda *parts: sum(parts, _ZERO), *values)


def _ratio(numerator: Decimal | None, denominator: Decimal | None) -> Decimal | None:
    if denominator == 0:
        return None
    return _calculate(lambda a, b: a / b, numerator, denominator)


def _number(number: Decimal | None) -> float | None:
    return None if number is None else float(_bounded(number))


def _iso_date(raw: str, field: str) -> date:
    if not isinstance(raw, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        raise ValueError(f"{field} 须为有效的 YYYY-MM-DD 日期")
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(f"{field} 须为有效的 YYYY-MM-DD 日期") from exc


def _value(item: dict, unit: str, field: str, *, integer: bool = False) -> Decimal | None:
    if item.get("source_kind") not in _SOURCE_KINDS.get(item.get("status"), set()):
        raise ValueError(f"{field} 的来源类型与事实/参考/假设/缺失状态不一致")
    if not isinstance(item.get("source"), str) or not item["source"].strip():
        raise ValueError(f"{field} 须登记具体来源")
    _iso_date(item.get("as_of"), f"{field}.as_of")
    number = _bounded(_PROTOTYPE.value(item, unit))
    if number is not None:
        if integer and number != number.to_integral_value():
            raise ValueError(f"{field} 须为非负整数")
        if unit == "ratio" and number > 1:
            raise ValueError(f"{field} 比例须在0至1之间")
    return number


def evaluate_operations(document: dict) -> OperationsResult:
    return _evaluate_operations(document, with_science=True)


def _evaluate_operations(document: dict, *, with_science: bool) -> OperationsResult:
    """Evaluate one facility/month, propagating only relevant missing inputs.

    Capacity aggregation assumes the independently allocated resource schedules
    described by scope_note. The calculator does not verify physical schedules.
    Monetary outputs are rounded to cents only after Decimal calculations.
    """
    OperationsInput.model_validate(document)
    if type(document["cost_scope_complete"]) is not bool:
        raise ValueError("cost_scope_complete 须为 true/false")
    if not document["scope_note"].strip():
        raise ValueError("scope_note 须说明服务范围及各服务资源排班不重叠的依据")

    missing = []
    warnings = ["容量汇总以各服务资源排班不重叠为前提；采用已登记的服务范围核算。"]

    def read(item, unit, field, collect_from, *, integer=False):
        number = _value(item, unit, field, integer=integer)
        if number is None:
            missing.append({"field": field, "reason": "该输入尚缺，依赖它的指标保留未知。", "collect_from": collect_from})
        return number

    population = read(document["target_population"], "person", "target_population",
                      "从社区人口底册按本设施服务范围及目标人群筛选，记录统计月份与去重人数。", integer=True)
    users = read(document["unique_users"], "person", "unique_users",
                 "将当月签到、预约与服务记录按匿名居民标识跨服务去重，限定同一目标人群范围。", integer=True)

    services = []
    service_ids = set()
    resource_ids = set()
    for index, service in enumerate(document["services"]):
        if service["id"] in service_ids:
            raise ValueError("服务id须唯一，避免重复汇总同一服务容量")
        service_ids.add(service["id"])
        if not service["resource_id"].strip() or not service["schedule_note"].strip():
            raise ValueError("resource_id及schedule_note须说明资源与有效时段、需求分配口径")
        if service["resource_id"] in resource_ids:
            raise ValueError("同一resource_id不得跨服务重复累计容量，请合并共享资源并说明有效时段和需求分配")
        resource_ids.add(service["resource_id"])
        blocks = service.get("time_blocks")
        monthly_fields = {"capacity_per_slot", "available_slots", "demand_visits"}
        values = {
            field: read(service[field], unit, f"services.{index}.{field}", collection, integer=integer)
            for field, (unit, integer, collection) in _SERVICE_FIELDS.items()
            if not blocks or field not in monthly_fields
        }
        if blocks:
            block_ids, capacities, demands, delivered = set(), [], [], []
            for block_index, block in enumerate(blocks):
                if not block["id"].strip() or block["id"] in block_ids:
                    raise ValueError("time_blocks的id须在同一服务内非空且唯一")
                block_ids.add(block["id"])
                prefix = f"services.{index}.time_blocks.{block_index}"
                slots = read(block["slots"], "slot/month", f"{prefix}.slots",
                             "取得本时段组当月有效排班，分别登记高峰、低峰或不同开放时段。", integer=True)
                per_slot = read(block["capacity_per_slot"], "visit/slot", f"{prefix}.capacity_per_slot",
                                "核对本时段组每场可用席位与服务人员容量。", integer=True)
                demand = read(block["demand_visits"], "visit/month", f"{prefix}.demand_visits",
                              "按本时段组汇总需求；同一预约或候补记录只分配一次。", integer=True)
                block_capacity = _calculate(lambda a, b: a * b, slots, per_slot)
                capacities.append(block_capacity)
                demands.append(demand)
                delivered.append(_calculate(min, demand, block_capacity))
            capacity, served = _total(capacities), _total(delivered)
            values["demand_visits"] = _total(demands)
            method = "time_blocks"
        else:
            capacity = _calculate(lambda a, b: a * b, values["capacity_per_slot"], values["available_slots"])
            served = _calculate(min, values["demand_visits"], capacity)
            method = "monthly_aggregate"
        pooled = _calculate(min, values["demand_visits"], capacity)
        unmet = _calculate(lambda demand, actual: max(_ZERO, demand - actual), values["demand_visits"], served)
        fees = _calculate(lambda count, paid, price: count * paid * price,
                          served, values["paid_share"], values["fee_per_visit"])
        variable_cost = _calculate(lambda count, price: count * price, served, values["variable_cost_per_visit"])
        services.append({
            "id": service["id"], "name": service["name"], "capacity_visits": capacity,
            "served_visits": served, "unmet_visits": unmet, "utilization": _ratio(served, capacity),
            "fee_income": fees, "variable_cost": variable_cost,
            "capacity_method": method, "monthly_pooled_upper_bound": pooled,
            "aggregation_overstatement_visits": _calculate(lambda upper, actual: upper - actual, pooled, served),
        })

    cash_rows = {kind: [] for kind in _CASH_COLLECTION}
    economic_ids = set()
    for index, item in enumerate(document["cash_items"]):
        economic_id = item["economic_item_id"]
        if economic_id in economic_ids:
            raise ValueError("economic_item_id须全局唯一，同一经济事项不得跨类或重复计入")
        economic_ids.add(economic_id)
        cash_rows[item["kind"]].append(read(
            item["amount"], "yuan/month", f"cash_items.{index}.amount", _CASH_COLLECTION[item["kind"]]))
    cash = {}
    for kind, rows in cash_rows.items():
        cash[kind] = _total(rows) if rows else None
        if not rows:
            missing.append({"field": f"cash_items.{kind}", "reason": "该现金类别未显式登记，不能将未填项视为0。",
                            "collect_from": _CASH_COLLECTION[kind]})
    if document["cost_scope_complete"] is False:
        missing.append({"field": "cost_scope_complete", "reason": "费用范围未确认完整，运营总成本及收支结余保留未知。",
                        "collect_from": "请运营方核对当月人工、场地、水电、维护、税费与服务变动成本清单，确认费用范围无遗漏。"})

    capacity = _total([service["capacity_visits"] for service in services])
    served = _total([service["served_visits"] for service in services])
    unmet = _total([service["unmet_visits"] for service in services])
    fee_income = _total([service["fee_income"] for service in services])
    variable_cost = _total([service["variable_cost"] for service in services])
    if users is not None and served is not None and users > served:
        raise ValueError("unique_users去重人数不得超过已服务人次")
    if users is not None and population is not None and users > population:
        raise ValueError("unique_users去重人数不得超过target_population目标人口")
    operating_cost = _total([cash["fixed_cost"], variable_cost]) if document["cost_scope_complete"] else None
    earned = _total([fee_income, cash["other_earned_income"], cash["government_purchase"]])
    before = _calculate(lambda income, cost: income - cost, earned, operating_cost)
    after = _calculate(lambda income, subsidy, support, cost: income + subsidy + support - cost,
                       earned, cash["operating_subsidy"], cash["other_support"], operating_cost)
    required = _calculate(lambda cost, income, support: max(_ZERO, cost - income - support),
                          operating_cost, earned, cash["other_support"])
    government_outlay = _total([cash["government_purchase"], cash["operating_subsidy"], cash["government_direct_cost"]])
    metrics = {
        "capacity_visits": capacity, "served_visits": served, "unmet_visits": unmet,
        "utilization": _ratio(served, capacity), "unique_users": users, "coverage": _ratio(users, population),
        "fee_income": fee_income, "earned_income": earned, "operating_cost": operating_cost,
        "government_direct_cost": cash["government_direct_cost"],
        "total_service_cost": _total([operating_cost, cash["government_direct_cost"]]),
        "government_purchase": cash["government_purchase"], "operating_subsidy": cash["operating_subsidy"],
        "other_support": cash["other_support"], "balance_before_support": before, "balance_after_support": after,
        "unfunded_gap": _calculate(lambda balance: max(_ZERO, -balance), after), "required_subsidy": required,
        "government_outlay": government_outlay, "government_cost_per_visit": _ratio(government_outlay, served),
        "commercial_cost_coverage": _ratio(_total([fee_income, cash["other_earned_income"]]), operating_cost),
    }
    if any(service["capacity_visits"] == 0 for service in services):
        warnings.append("容量为0的服务利用率无定义，保留null；服务人次及未满足需求仍按容量约束核算。")
    if population == 0:
        warnings.append("目标人口为0，覆盖率分母为0，保留null。")
    if served == 0:
        warnings.append("已服务人次为0，每服务人次财政支出分母为0，保留null。")
    if operating_cost == 0:
        warnings.append("运营成本为0，商业收入成本覆盖率分母为0，保留null。")
    monetary = {
        "fee_income", "earned_income", "operating_cost", "government_purchase", "operating_subsidy",
        "other_support", "balance_before_support", "balance_after_support", "unfunded_gap",
        "required_subsidy", "government_outlay", "government_cost_per_visit", "government_direct_cost", "total_service_cost",
    }
    output = {
        "model_version": MODEL_VERSION, "result_kind": "scenario_prediction",
        "status": "partial" if missing else "complete",
        "metrics": {key: _PROTOTYPE.money(number) if key in monetary else _number(number)
                    for key, number in metrics.items()},
        "services": [{key: value if key in {"id", "name", "capacity_method"} else
                      _PROTOTYPE.money(value) if key in {"fee_income", "variable_cost"} else _number(value)
                      for key, value in service.items()} for service in services],
        "missing": missing, "warnings": warnings,
    }
    if with_science:
        output["science"] = analyze_operations(
            document, services, cash, metrics,
            evaluate=lambda changed: _evaluate_operations(changed, with_science=False),
        )
    return OperationsResult.model_validate(output)


def _comparison_value(raw, field: str, *, integer=False) -> Decimal | None:
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError(f"{field} 须为有限非负数或null")
    number = _bounded(Decimal(str(raw)))
    if number < 0 or (integer and number != number.to_integral_value()):
        raise ValueError(f"{field} 须为非负数，人次和人数须为整数")
    return number


def compare_observation(snapshot: dict, observation: dict) -> OperationsComparison:
    """Compare immutable records; holdout membership does not imply prospective timing.

    percentage_error is the signed error / observed ratio, not percent points.
    A zero observed denominator and any missing operand produce null.
    """
    frozen = OperationsSnapshot.model_validate(snapshot)
    observed = OperationsObservation.model_validate(observation)
    if (observed.snapshot_id != frozen.id or observed.project_id != frozen.project_id
            or observed.input.facility_id != frozen.input.facility_id
            or observed.input.period != frozen.input.period):
        raise ValueError("只能比较同一项目、冻结方案、设施与月份的预测和观察")
    _iso_date(observation["input"]["collected_at"], "collected_at")
    observed_metrics = observation["input"]["metrics"]
    differences = []
    for metric in _OBSERVED_METRICS:
        is_count = metric in {"served_visits", "unique_users"}
        prediction = _comparison_value(snapshot["result"]["metrics"][metric], metric, integer=is_count)
        actual = _comparison_value(observed_metrics[metric], metric, integer=is_count)
        error = _calculate(lambda obs, pred: obs - pred, actual, prediction)
        differences.append({
            "metric": metric, "predicted": _number(prediction), "observed": _number(actual),
            "error": _number(error), "absolute_error": _number(None if error is None else abs(error)),
            "percentage_error": _number(_ratio(error, actual)),
        })
    actual_visits, actual_users = observed_metrics["served_visits"], observed_metrics["unique_users"]
    if actual_users is not None and actual_visits is not None and actual_users > actual_visits:
        raise ValueError("观察记录的去重人数不得超过已服务人次")
    # Business periods use the facility's China-local monthly accounting boundary.
    period_start = datetime.fromisoformat(frozen.input.period + "-01T00:00:00").replace(
        tzinfo=timezone(timedelta(hours=8)))
    timing = "prospective" if frozen.created_at < period_start else "retrospective"
    return OperationsComparison.model_validate({
        "snapshot_id": frozen.id, "observation_id": observed.id, "split": observed.input.split,
        "timing": timing, "differences": differences,
    })
