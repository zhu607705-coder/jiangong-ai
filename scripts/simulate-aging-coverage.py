#!/usr/bin/env python3
"""Fixed-seed, person-deduplicated accessibility and facility-use scenarios."""
import argparse
import hashlib
import importlib.util
import json
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

# Reuse the source-labelled scalar contract of the existing offline calculator.
_SPEC = importlib.util.spec_from_file_location("renewal_economics", Path(__file__).with_name("compare-renewal-modes.py"))
_ECON = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_ECON)
value = _ECON.value
VERSION = "aging-coverage-0.1"


def count(item, unit, *, positive=False):
    n = value(item, unit)
    if n is not None and (n != n.to_integral_value() or (positive and n == 0)):
        raise ValueError(f"{unit} 须为{'正' if positive else '非负'}整数")
    return None if n is None else int(n)


def ratio(item):
    r = value(item, "ratio")
    if r is not None and r > 1:
        raise ValueError("比例须为 0–1")
    return r


def uniform(seed, person, facility):
    digest = hashlib.sha256(f"{seed}|{person}|{facility}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def percentage(numerator, denominator):
    return None if denominator == 0 else round(100 * numerator / denominator, 2)


def calculate(document):
    if type(document["seed"]) is not int or document["period"] != "month":
        raise ValueError("须登记整数 seed，测算期单位为 month")
    population = count(document["population"], "person")
    elderly_ratio = ratio(document["elderly_ratio"])
    missing = []
    if population is None:
        missing.append("population")
    elif population > 1_000_000:
        raise ValueError("离线逐人模拟上限为 100 万人")
    if elderly_ratio is None:
        missing.append("elderly_ratio")
    target = None if population is None or elderly_ratio is None else int((population * elderly_ratio).to_integral_value(rounding=ROUND_HALF_UP))
    groups, persons = {}, {}
    for group in document["groups"]:
        key = group["group_id"]
        if key in groups:
            raise ValueError("group_id 不得重复")
        number = count(group["elderly_count"], "person")
        if number is not None and number > 1_000_000:
            raise ValueError("分组人数超过离线模拟上限")
        distance = value(group["maximum_distance"], "m")
        visits = count(group["visits_per_user"], "visit/person/month", positive=True)
        groups[key] = {"name": group["name"], "count": number, "distance": distance, "visits": visits}
        for field, scalar in (("elderly_count", number), ("maximum_distance", distance), ("visits_per_user", visits)):
            if scalar is None:
                missing.append(f"groups.{key}.{field}")
        if number is not None and visits is not None:
            for i in range(number):
                persons[f"{key}:{i}"] = (key, visits)
    if target is not None and all(g["count"] is not None for g in groups.values()):
        if sum(g["count"] for g in groups.values()) != target:
            raise ValueError("分组老年人数合计须等于人口 × 老年占比取整后的人数")
    scenarios = {}
    for scenario in document["adoption_scenarios"]:
        key = scenario["scenario_id"]
        if key in scenarios:
            raise ValueError("scenario_id 不得重复")
        scenarios[key] = ratio(scenario["adoption_probability"])
        if scenarios[key] is None:
            missing.append(f"adoption_scenarios.{key}.adoption_probability")
    results, seen_modes = [], set()
    for mode in document["modes"]:
        if mode["mode_id"] in seen_modes:
            raise ValueError("mode_id 不得重复")
        seen_modes.add(mode["mode_id"])
        mode_missing, facilities = list(missing), {}
        for facility in mode["facilities"]:
            fid = facility["facility_id"]
            if fid in facilities:
                raise ValueError("同一模式的 facility_id 不得重复")
            capacity = count(facility["monthly_capacity"], "visit/month")
            factor = ratio(facility["adoption_factor"])
            if capacity is None:
                mode_missing.append(f"facilities.{fid}.monthly_capacity")
            if factor is None:
                mode_missing.append(f"facilities.{fid}.adoption_factor")
            reachable = set()
            access_groups = set()
            for route in facility["routes"]:
                gid = route["group_id"]
                if gid not in groups or gid in access_groups:
                    raise ValueError("路线的 group_id 须存在且在设施内不重复")
                access_groups.add(gid)
                distance = value(route["distance"], "m")
                continuous = value(route["continuous_accessible_route"], "boolean", boolean=True)
                if distance is None or continuous is None:
                    mode_missing.append(f"facilities.{fid}.routes.{gid}")
                elif continuous and groups[gid]["distance"] is not None and distance <= groups[gid]["distance"]:
                    reachable.update(p for p, (g, _) in persons.items() if g == gid)
            if access_groups != set(groups):
                raise ValueError("每个设施须明确所有群体的路线；不可达填写有依据的 false，未知填写 missing")
            facilities[fid] = {"name": facility["name"], "capacity": capacity, "factor": factor, "reachable": reachable}
        if mode_missing:
            results.append({"mode_id": mode["mode_id"], "name": mode["name"], "result_status": "incomplete_input",
                            "action_label": "先补充关键资料再判断", "missing": mode_missing,
                            "covered_people": None, "scenarios": None})
            continue
        reachable_people = set().union(*(f["reachable"] for f in facilities.values())) if facilities else set()
        scenario_results = []
        for sid, adoption in scenarios.items():
            users, potential_users, facility_rows = set(), set(), []
            total_visits = total_capacity = active_facilities = 0
            for fid, facility in facilities.items():
                probability = float(adoption * facility["factor"])
                # Common random numbers across modes and adoption scenarios.
                candidates = sorted((uniform(document["seed"], p, fid), p) for p in facility["reachable"]
                                    if uniform(document["seed"], p, fid) < probability)
                potential_users.update(p for _, p in candidates)
                selected, served_visits = set(), 0
                for _, person in candidates:
                    frequency = persons[person][1]
                    if served_visits + frequency <= facility["capacity"]:
                        selected.add(person)
                        served_visits += frequency
                users.update(selected)
                total_visits += served_visits
                total_capacity += facility["capacity"]
                active_facilities += bool(selected)
                facility_rows.append({"facility_id": fid, "name": facility["name"], "reachable_people": len(facility["reachable"]),
                                      "predicted_users": len(selected), "monthly_visits": served_visits,
                                      "monthly_capacity_visits": facility["capacity"],
                                      "capacity_utilization_percent": percentage(served_visits, facility["capacity"])})
            scenario_results.append({"scenario_id": sid, "result_status": "scenario_prediction",
                                     "covered_people": len(reachable_people), "target_elderly_people": target,
                                     "predicted_unique_users": len(users), "monthly_visits": total_visits,
                                     "potential_coverage_percent": percentage(len(reachable_people), target),
                                     "user_population_coverage_percent": percentage(len(users), target),
                                     "accessible_adoption_percent": percentage(len(users), len(reachable_people)),
                                     "unconstrained_adoption_people": len(potential_users),
                                     "capacity_utilization_percent": percentage(total_visits, total_capacity),
                                     "active_facility_percent": percentage(active_facilities, len(facilities)),
                                     "facilities": facility_rows,
                                     "group_results": [{"group_id": gid, "elderly_people": g["count"],
                                                        "covered_people": sum(persons[p][0] == gid for p in reachable_people),
                                                        "predicted_unique_users": sum(persons[p][0] == gid for p in users)} for gid, g in groups.items()]})
        results.append({"mode_id": mode["mode_id"], "name": mode["name"], "result_status": "scenario_prediction",
                        "action_label": "建议开展专项调查", "missing": [], "covered_people": len(reachable_people),
                        "scenarios": scenario_results})
    output = {"formula_version": VERSION, "purpose": document["purpose"], "period": document["period"],
              "seed": document["seed"], "population": population, "target_elderly_people": target,
              "metric_denominators": {"potential_coverage_percent": "可达去重老年人数 / 全部目标老年人数",
                                      "user_population_coverage_percent": "服务去重老年人数 / 全部目标老年人数",
                                      "accessible_adoption_percent": "服务去重老年人数 / 可达去重老年人数",
                                      "capacity_utilization_percent": "已提供月访问次数 / 月服务容量次数",
                                      "active_facility_percent": "至少服务一人的设施数 / 纳入设施数"},
              "input_snapshot": deepcopy(document), "modes": results}
    baseline = next((m for m in results if m["mode_id"] == document["baseline_mode_id"]), None)
    if baseline is None:
        raise ValueError("baseline_mode_id 须对应一个输入模式")
    changes = []
    if baseline["scenarios"]:
        base_by_scenario = {s["scenario_id"]: s for s in baseline["scenarios"]}
        for mode in results:
            if mode is baseline or not mode["scenarios"]:
                continue
            for s in mode["scenarios"]:
                b = base_by_scenario[s["scenario_id"]]
                changes.append({"mode_id": mode["mode_id"], "scenario_id": s["scenario_id"],
                                "result_status": "scenario_prediction", "additional_covered_people": s["covered_people"] - b["covered_people"],
                                "additional_unique_users": s["predicted_unique_users"] - b["predicted_unique_users"],
                                "user_coverage_percentage_point_change": round(s["user_population_coverage_percent"] - b["user_population_coverage_percent"], 2)
                                if target else None})
    output["changes_from_baseline"] = changes
    return output


def latex_table(result):
    rows = [r"\begin{tabular}{llrrrr}", r"\hline", r"组合 & 采用情景 & 可达人数 & 使用人数 & 覆盖率(\%) & 容量使用率(\%) \\", r"\hline"]
    for mode in result["modes"]:
        for row in mode["scenarios"] or []:
            rows.append(f"{mode['name']} & {row['scenario_id']} & {row['covered_people']} & {row['predicted_unique_users']} & {row['user_population_coverage_percent']} & {row['capacity_utilization_percent']} " + r"\\")
    rows += [r"\hline", r"\end{tabular}"]
    return "\n".join(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = calculate(json.loads(args.input.read_text(encoding="utf-8-sig")))
    result["result_table_latex"] = latex_table(result)
    payload = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload, encoding="utf-8")
    else:
        print(payload, end="")


if __name__ == "__main__":
    main()
