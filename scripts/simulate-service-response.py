#!/usr/bin/env python3
"""Community service response scenarios: perception, choice and bounded rerouting.

Self-authored community model, inspired by perception/decision/action and
saturation rerouting, not a reproduction of the PKU flood-response model.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from collections import Counter, defaultdict
from copy import deepcopy
from decimal import ROUND_HALF_UP
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location("aging", Path(__file__).with_name("simulate-aging-coverage.py"))
_AGING = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_AGING)
value, count, ratio = _AGING.value, _AGING.count, _AGING.ratio
VERSION = "service-response-0.1"
STAGES = ("potential_demand", "aware", "reachable", "affordable", "active_applicants", "served", "capacity_unmet", "nonparticipating")


def random_number(seed, *keys):
    raw = hashlib.sha256(json.dumps([seed, *keys], ensure_ascii=False, separators=(",", ":")).encode()).digest()
    return ((int.from_bytes(raw[:8], "big") >> 11) + 0.5) / 2**53


def gumbel(seed, *keys):
    return -math.log(-math.log(random_number(seed, *keys)))


def simulate(document):
    seed = document["seed"]
    slots = sorted(document["time_slots"])
    if type(seed) is not int or not slots or any(type(t) is not int for t in slots) or len(slots) != len(set(slots)):
        raise ValueError("seed 和 time_slots 须为整数，时间槽不可重复")
    if document["period"] != "month":
        raise ValueError("测算期须登记为 month")
    needs = sorted(document["need_types"])
    if not needs or len(needs) != len(set(needs)):
        raise ValueError("need_types 须非空且不重复")
    global_missing, optional_omitted = [], []
    total = count(document["population"], "person")
    older_ratio = ratio(document["elderly_ratio"])
    if total is None:
        global_missing.append("population")
    elif total > 100_000:
        raise ValueError("此离线原型最多模拟 10 万总人口")
    if older_ratio is None:
        global_missing.append("elderly_ratio")
    target = None if total is None or older_ratio is None else int((total * older_ratio).to_integral_value(rounding=ROUND_HALF_UP))
    settings = document["settings"]
    coefficients = {}
    for field in ("attraction_weight", "distance_weight", "fee_weight", "risk_weight", "outside_score", "choice_temperature"):
        coefficients[field] = value(settings[field], "score")
        if coefficients[field] is None:
            global_missing.append("settings." + field)
    peer_spec = settings.get("peer_weight")
    peer_weight = None if peer_spec is None else value(peer_spec, "score")
    if peer_weight is None:
        optional_omitted.append("peer_weight")
    extension = document.get("teacher_76_extension")
    if extension is None or extension.get("status") == "missing":
        optional_omitted.append("teacher_76_extension")
    elif extension.get("values"):
        raise ValueError("教师扩展项尚无审核后的映射，暂不参加计算")
    groups, people = {}, {}
    for group in sorted(document["groups"], key=lambda g: g["group_id"]):
        gid = group["group_id"]
        if gid in groups or not group.get("building_id"):
            raise ValueError("群体 ID 须唯一并关联楼栋")
        n = count(group["elderly_count"], "person")
        if n is not None and n > 100_000:
            raise ValueError("分组人数超过离线模拟上限")
        maximum = value(group["maximum_distance"], "m")
        demands, budgets = {}, {}
        for need in needs:
            demands[need] = ratio(group["demand_probability"][need])
            budgets[need] = value(group["budget_per_visit"][need], "yuan/visit")
            for field, scalar in (("demand_probability", demands[need]), ("budget_per_visit", budgets[need])):
                if scalar is None:
                    global_missing.append(f"groups.{gid}.{field}.{need}")
        for field, scalar in (("elderly_count", n), ("maximum_distance", maximum)):
            if scalar is None:
                global_missing.append(f"groups.{gid}.{field}")
        groups[gid] = {"count": n, "maximum": maximum, "demands": demands, "budgets": budgets,
                       "name": group["name"], "building_id": group["building_id"]}
        if n is not None:
            for i in range(n):
                people[f"{group['building_id']}:{gid}:{i}"] = gid
    if target is not None and all(g["count"] is not None for g in groups.values()):
        if sum(g["count"] for g in groups.values()) != target:
            raise ValueError("群体分母合计须等于人口 × 老年占比取整结果")
    results, mode_ids = [], set()
    for mode in sorted(document["modes"], key=lambda m: m["mode_id"]):
        if mode["mode_id"] in mode_ids:
            raise ValueError("mode_id 不可重复")
        mode_ids.add(mode["mode_id"])
        missing, omitted, facilities = list(global_missing), list(optional_omitted), {}
        for facility in sorted(mode["facilities"], key=lambda f: f["facility_id"]):
            fid, need = facility["facility_id"], facility["need_type"]
            if fid in facilities or need not in needs:
                raise ValueError("设施 ID 不可重复，服务类型须在 need_types 中")
            capacity = count(facility["capacity_per_slot"], "visit/slot")
            fee = value(facility["fee_per_visit"], "yuan/visit")
            attraction = ratio(facility["attraction"])
            for field, scalar in (("capacity_per_slot", capacity), ("fee_per_visit", fee), ("attraction", attraction)):
                if scalar is None:
                    missing.append(f"facilities.{fid}.{field}")
            routes, awareness = {}, {}
            for gid in sorted(groups):
                awareness[gid] = ratio(facility["known_probability_by_group"][gid])
                if awareness[gid] is None:
                    missing.append(f"facilities.{fid}.known_probability_by_group.{gid}")
            for route in facility["routes"]:
                gid = route["group_id"]
                if gid not in groups or gid in routes:
                    raise ValueError("路线群体须存在且不可重复")
                distance = value(route["distance"], "m")
                continuous = value(route["continuous_accessible_route"], "boolean", boolean=True)
                risk_spec = route.get("perceived_risk")
                risk = None if risk_spec is None else ratio(risk_spec)
                if risk is None:
                    omitted.append(f"facilities.{fid}.routes.{gid}.perceived_risk")
                if distance is None or continuous is None:
                    missing.append(f"facilities.{fid}.routes.{gid}")
                routes[gid] = {"distance": distance, "continuous": continuous, "risk": risk}
            if set(routes) != set(groups):
                raise ValueError("设施须登记全部群体的路线状态，未知显式填写 missing")
            facilities[fid] = {"name": facility["name"], "need": need, "capacity": capacity, "fee": fee,
                               "attraction": attraction, "routes": routes, "awareness": awareness}
        if missing:
            results.append({"mode_id": mode["mode_id"], "name": mode["name"], "result_status": "incomplete_input",
                            "action_label": "先补充关键资料再判断", "missing": missing, "optional_omitted": sorted(set(omitted)),
                            "month_metrics": None, "slots": None, "earned_fee_income_yuan": None})
            continue
        accum = {stage: {"visits": 0, "people": set()} for stage in STAGES}
        slots_out, previous_rates, previous_slot = [], {}, None
        facility_visits, earned_income = Counter(), 0.0
        for slot in slots:
            slot_stages = {stage: set() for stage in STAGES}  # (person, need) pairs
            remaining = {fid: f["capacity"] for fid, f in facilities.items()}
            selected, slot_served, slot_income, applications, reroute_successes = [], Counter(), 0.0, 0, 0
            peer_inputs = [{"group_id": gid, "facility_id": fid, "source_slot": previous_slot,
                            "value": previous_rates.get((gid, fid)), "source_status": "simulation_previous_slot"}
                           for gid, fid in sorted(previous_rates) if peer_weight is not None]
            for need in needs:
                options, original_applicants = {}, set()
                for person, gid in sorted(people.items()):
                    if random_number(seed, "demand", person, slot, need) >= float(groups[gid]["demands"][need]):
                        continue
                    pair = (person, need)
                    slot_stages["potential_demand"].add(pair)
                    outside = float(coefficients["outside_score"]) + float(coefficients["choice_temperature"]) * gumbel(seed, "choice", person, slot, need, "outside")
                    ranked = []
                    for fid, f in facilities.items():
                        if f["need"] != need or random_number(seed, "awareness", person, fid) >= float(f["awareness"][gid]):
                            continue
                        slot_stages["aware"].add(pair)
                        route = f["routes"][gid]
                        if not route["continuous"] or route["distance"] > groups[gid]["maximum"]:
                            continue
                        slot_stages["reachable"].add(pair)
                        budget = groups[gid]["budgets"][need]
                        if f["fee"] > budget:
                            continue
                        slot_stages["affordable"].add(pair)
                        # Hard path/budget filters run before utility aggregation.
                        distance_penalty = float(route["distance"] / groups[gid]["maximum"]) if groups[gid]["maximum"] else 0.0
                        fee_penalty = float(f["fee"] / budget) if budget else 0.0
                        utility = (float(coefficients["attraction_weight"] * f["attraction"])
                                   - float(coefficients["distance_weight"]) * distance_penalty
                                   - float(coefficients["fee_weight"]) * fee_penalty)
                        if route["risk"] is not None:
                            utility -= float(coefficients["risk_weight"] * route["risk"])
                        if peer_weight is not None and (gid, fid) in previous_rates:
                            utility += float(peer_weight) * previous_rates[gid, fid]
                        utility += float(coefficients["choice_temperature"]) * gumbel(seed, "choice", person, slot, need, fid)
                        if utility > outside:
                            ranked.append((-utility, fid))
                    if ranked:
                        options[person] = [fid for _, fid in sorted(ranked)]
                        original_applicants.add(person)
                        slot_stages["active_applicants"].add(pair)
                    else:
                        slot_stages["nonparticipating"].add(pair)
                waiting, served_people = set(original_applicants), set()
                # Each rejection removes a facility. At most facility-count rounds.
                for attempt in range(sum(f["need"] == need for f in facilities.values())):
                    requests = defaultdict(list)
                    for person in sorted(waiting):
                        available = [fid for fid in options[person] if remaining[fid] > 0]
                        if attempt == 0:
                            # First applications can encounter a visibly full facility.
                            available = options[person]
                        if available:
                            requests[available[0]].append(person)
                    if not requests:
                        break
                    for fid in sorted(requests):
                        queue = sorted(requests[fid], key=lambda p: (random_number(seed, "queue", p, slot, need, fid), p))
                        applications += len(queue)
                        winners = queue[:remaining[fid]]
                        remaining[fid] -= len(winners)
                        for person in winners:
                            waiting.remove(person)
                            served_people.add(person)
                            slot_stages["served"].add((person, need))
                            gid = people[person]
                            selected.append({"person_id": person, "group_id": gid, "need_type": need, "facility_id": fid,
                                             "choice_round": attempt + 1})
                            slot_served[gid, fid] += 1
                            facility_visits[fid] += 1
                            slot_income += float(facilities[fid]["fee"])
                            reroute_successes += attempt > 0
                        for person in queue:
                            options[person] = [f for f in options[person] if f != fid]
                for person in original_applicants - served_people:
                    slot_stages["capacity_unmet"].add((person, need))
            previous_rates = {(gid, fid): slot_served[gid, fid] / g["count"] if g["count"] else 0.0
                              for gid, g in sorted(groups.items()) for fid in sorted(facilities)}
            previous_slot = slot
            for stage in STAGES:
                accum[stage]["visits"] += len(slot_stages[stage])
                accum[stage]["people"].update(p for p, _ in slot_stages[stage])
            demand_count = len(slot_stages["potential_demand"])
            if demand_count != sum(len(slot_stages[s]) for s in ("served", "capacity_unmet", "nonparticipating")):
                raise AssertionError("需求守恒失败")
            slots_out.append({"slot": slot, "counts": {s: len(slot_stages[s]) for s in STAGES},
                              "application_attempts": applications, "reroute_served_visits": reroute_successes,
                              "peer_inputs": peer_inputs, "services": selected,
                              "facility_counts": {fid: facilities[fid]["capacity"] - remaining[fid] for fid in sorted(facilities)},
                              "earned_fee_income_yuan": round(slot_income, 2)})
            earned_income += slot_income
        results.append({"mode_id": mode["mode_id"], "name": mode["name"], "result_status": "scenario_prediction",
                        "action_label": "建议开展专项调查", "missing": [], "optional_omitted": sorted(set(omitted)),
                        "month_metrics": {s: {"unique_people": len(accum[s]["people"]), "person_visits": accum[s]["visits"]} for s in STAGES},
                        "user_population_coverage_percent": _AGING.percentage(len(accum["served"]["people"]), target),
                        "facility_served_visits": dict(sorted(facility_visits.items())),
                        "reroute_served_visits": sum(s["reroute_served_visits"] for s in slots_out),
                        "earned_fee_income_yuan": round(earned_income, 2), "slots": slots_out})
    baseline = next((r for r in results if r["mode_id"] == document["baseline_mode_id"]), None)
    if baseline is None:
        raise ValueError("baseline_mode_id 须存在")
    measures = []
    if baseline["month_metrics"] is not None:
        b = baseline["month_metrics"]
        raw_modes = {m["mode_id"]: m for m in document["modes"]}
        for mode in results:
            if mode is baseline or mode["month_metrics"] is None:
                continue
            m = mode["month_metrics"]
            extra_people = m["served"]["unique_people"] - b["served"]["unique_people"]
            extra_visits = m["served"]["person_visits"] - b["served"]["person_visits"]
            cost_input = raw_modes[mode["mode_id"]].get("measure_cost")
            cost = None if cost_input is None else value(cost_input, "yuan")
            measures.append({"mode_id": mode["mode_id"], "name": mode["name"], "result_status": "scenario_prediction",
                             "additional_unique_users": extra_people, "additional_service_visits": extra_visits,
                             "capacity_unmet_reduction_visits": b["capacity_unmet"]["person_visits"] - m["capacity_unmet"]["person_visits"],
                             "measure_cost_yuan": None if cost is None else float(cost),
                             "unit_cost_per_additional_user_yuan": round(float(cost) / extra_people, 2) if cost is not None and extra_people > 0 else None,
                             "unit_cost_per_additional_visit_yuan": round(float(cost) / extra_visits, 2) if cost is not None and extra_visits > 0 else None,
                             "cost_source_status": None if cost_input is None else cost_input["status"]})
    measures.sort(key=lambda m: (-m["additional_unique_users"], -m["additional_service_visits"], -m["capacity_unmet_reduction_visits"], m["mode_id"]))
    return {"formula_version": VERSION, "purpose": document["purpose"], "model_origin": "self_authored_community_model_inspired_by_perception_decision_action",
            "inspiration_doi": "10.1038/s41893-026-01886-9", "period": "month", "time_slots": slots, "seed": seed,
            "target_elderly_people": target, "input_snapshot": deepcopy(document), "modes": results,
            "measures_rank": measures, "rank_basis": "额外去重使用人数，其次新增服务人次，再次容量缺口减少人次；同值按 mode_id 排列",
            "count_contract": "阶段人数可以重叠；各需求每槽潜在需求 = 实际服务 + 容量未满足 + 未参与。人/月去重与服务人次分别报告。",
            "peer_contract": "同伴项仅使用上一个时间槽同群体实际服务比例；第一槽无同伴值；missing 的 peer_weight 不参加计算。"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = simulate(json.loads(args.input.read_text(encoding="utf-8-sig")))
    text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text, end="")


if __name__ == "__main__":
    main()
