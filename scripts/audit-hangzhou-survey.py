#!/usr/bin/env python3
"""Audit the public PLOS Hangzhou survey in memory; save aggregate statistics only.

Run from the repository root:
    python scripts/audit-hangzhou-survey.py

Dependencies: pandas and numpy. No raw dataset, identifiers, free text, street or
community names are persisted. The SHA pin prevents silent changes to the source.
This describes the published raw attachment, not the paper's unreproduced 2,202-row
analysis sample, Hangzhou's population, a treatment effect, or model accuracy.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import platform
import urllib.request
import warnings

import numpy as np
import pandas as pd


ARTICLE = "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0341177"
RAW_URL = (
    "https://journals.plos.org/plosone/article/file?"
    "id=10.1371%2Fjournal.pone.0341177.s001&type=supplementary"
)
EXPECTED_SHA256 = "49233d712ea4e76dfbd50e6f53baf16ec8f728209fb007f5f5b5c14928b09b27"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "research/test_results/hangzhou-survey-methods-audit.json"
ITEMS = {
    "community_eval_overall": "社区服务总体评价",
    "community_eval_fitness": "健身及文化活动场地改造评价",
    "community_eval_canteen": "社区食堂改造评价",
    "community_eval_eldercare": "社区养老设施改造评价",
    "community_eval_childcare": "社区幼育设施改造评价",
}
SEED = 20261013
REPLICATES = 10000


def wilson_interval(successes: int, n: int) -> list[float]:
    """NIST Wilson interval; an independence benchmark, not a survey-design CI."""
    if not 0 <= successes <= n or n <= 0:
        raise ValueError("Wilson requires 0 <= successes <= n and n > 0")
    z = 1.959963984540054
    p = successes / n
    denominator = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denominator
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return [round(max(0.0, center - half), 8), round(min(1.0, center + half), 8)]


def cluster_interval(group_counts: pd.DataFrame) -> list[float]:
    """Resample whole communities; estimate the ratio of summed successes/counts.

    This is a sensitivity calculation conditional on the observed communities.
    District-specific inclusion probabilities and population weights are absent,
    so it is deliberately not labelled a design-based population interval.
    """
    counts = group_counts[["satisfied", "valid"]].to_numpy(dtype=float)
    rng = np.random.default_rng(SEED)
    selected = rng.integers(0, len(counts), size=(REPLICATES, len(counts)))
    totals = counts[selected].sum(axis=1)
    ratios = totals[:, 0] / totals[:, 1]
    return np.quantile(ratios, [0.025, 0.975]).round(8).tolist()


def describe_item(data: pd.DataFrame, field: str, labels: dict) -> dict:
    values = pd.to_numeric(data[field], errors="coerce")
    valid = values.isin([1, 2, 3, 4, 5])
    satisfied = values.isin([1, 2]) & valid
    grouped = pd.DataFrame({
        "community": data["community_unit"],
        "satisfied": satisfied.astype(int),
        "valid": valid.astype(int),
    }).groupby("community", sort=True)[["satisfied", "valid"]].sum()
    grouped = grouped.loc[grouped["valid"] > 0]
    n, k = int(valid.sum()), int(satisfied.sum())
    return {
        "field": field,
        "question": ITEMS[field],
        "valid_n": n,
        "missing_n": int(values.isna().sum()),
        "invalid_code_n": int((values.notna() & ~valid).sum()),
        "five_category_distribution": [
            {"code": code, "label": labels[code], "n": int(values.eq(code).sum())}
            for code in range(1, 6)
        ],
        "satisfied_definition": "原附件代码1=非常满意或2=基本满意；中性代码3单独保留",
        "satisfied_n": k,
        "respondent_weighted_sample_proportion": round(k / n, 8),
        "equal_community_mean_proportion": round(float((grouped.satisfied / grouped.valid).mean()), 8),
        "community_clusters": len(grouped),
        "cluster_resampling_sensitivity_interval_95": cluster_interval(grouped),
        "iid_wilson_interval_95_for_comparison_only": wilson_interval(k, n),
    }


def build_audit(payload: bytes) -> dict:
    digest = hashlib.sha256(payload).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError("Public attachment SHA256 changed; review the new version before reusing this audit")
    # The DTA contains some unused corrupted street value labels. Numeric fields
    # remain unconverted; label warnings are counted without logging raw content.
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always", UnicodeWarning)
        reader = pd.io.stata.StataReader(io.BytesIO(payload), convert_categoricals=False)
        data = reader.read()
        label_sets = reader.value_labels()
    labels = {int(k): v for k, v in label_sets["satisfaction_lbl"].items()}
    if labels != {1: "非常满意", 2: "基本满意", 3: "一般", 4: "不满意", 5: "非常不满意"}:
        raise ValueError("Satisfaction codebook changed; do not guess score direction")
    sizes = data.groupby("community_unit", sort=True).size()
    size_values = sizes.to_numpy()
    pair_sum_34_count = sum(
        int(size_values[i] + size_values[j] == len(data) - 2202)
        for i in range(len(size_values)) for j in range(i + 1, len(size_values))
    )
    numeric = data.select_dtypes(include="number")
    missing = {k: int(v) for k, v in numeric.isna().sum().items() if v > 0}
    identifiers = ["ID", "date", "time", "source", "source_detail", "IP", "interviewer", "questionnaire_id"]
    complete = data.dropna()
    result = {
        "schema_version": "1.0",
        "audit_date": "2026-10-13",
        "status": "aggregate_raw_attachment_audit_complete_analysis_sample_unreconciled",
        "source": {
            "doi": "10.1371/journal.pone.0341177",
            "article_url": ARTICLE,
            "attachment_url": RAW_URL,
            "attachment_sha256": digest,
            "attachment_bytes": len(payload),
            "attachment_is_persisted": False,
            "survey_period_reported_by_paper": "2024-09",
            "publication_date": "2026-01-23",
            "metadata_crosscheck": "CrossRef DOI lookup verified title/authors/year/journal on 2026-10-13",
        },
        "runtime": {"python": platform.python_version(), "pandas": pd.__version__, "numpy": np.__version__},
        "privacy": {
            "raw_records_written": 0,
            "output_contains_individual_records": False,
            "identifier_fields_never_exported": identifiers,
            "free_text_and_community_names_never_exported": True,
            "note": "原附件具有潜在识别字段；仅在内存解析，聚合后输出。",
        },
        "paper_report": {
            "source_location": "Section 3.1 Survey design and sampling; Section 3.2 Variable selection",
            "questionnaires_collected": 2300,
            "analysis_responses": 2202,
            "sampled_communities": 36,
            "districts": 10,
            "reported_exclusion": "incomplete or invalid responses",
            "row_level_exclusion_rule_published_in_materials_inspected": False,
            "materials_inspected": [
                "Article Sections 3.1-3.2 and Supporting information list",
                "S1 Data raw DTA including variable/value labels",
                "S1 Table PDF: Harman single-factor test",
                "S2 Table PDF: alternative instruments robustness checks",
                "Public peer-review and author-response HTML",
            ],
            "reconciliation_needed": "作者的分析样本标记或清洗代码、完整问卷编码说明及小区抽样权重",
        },
        "raw_attachment": {
            "rows": len(data),
            "columns": len(data.columns),
            "communities_by_name": int(data.community_name.nunique()),
            "communities_by_code": int(data.community_unit.nunique()),
            "districts": int(data.district.nunique()),
            "observed_street_codes": int(data.street.nunique()),
            "whole_row_exact_duplicates": int(data.duplicated().sum()),
            "numeric_missing_nonzero": missing,
            "community_sizes_sorted_without_names": sorted(int(n) for n in sizes),
            "community_sizes_min_median_max": [int(sizes.min()), float(sizes.median()), int(sizes.max())],
            "label_decoding_warnings_n": len(captured),
            "satisfaction_codebook_checked": labels,
        },
        "filter_diagnostics_not_applied": [
            {"candidate": "all_columns_nonmissing", "remaining_rows": len(complete), "remaining_communities": int(complete.community_unit.nunique())},
            {"candidate": "renewal_equals_1", "remaining_rows": int(data.renewal.eq(1).sum()), "remaining_communities": int(data.loc[data.renewal.eq(1), "community_unit"].nunique())},
            {"candidate": "trim_community_names_only", "remaining_rows": len(data), "remaining_communities": int(data.community_name.str.strip().nunique())},
            {"candidate": "drop_two_whole_communities_to_remove_34_rows", "pairs_matching_required_row_count": pair_sum_34_count},
        ],
        "analysis_sample_reconciliation": {
            "reproduced": False,
            "raw_minus_paper_rows": len(data) - 2202,
            "raw_minus_paper_communities": int(data.community_unit.nunique()) - 36,
            "rows_deleted_in_this_audit": 0,
            "decision": "保留全部原附件行，以下统计明确描述2236份原附件，等待作者清洗依据再复现2202份分析样本。",
        },
        "descriptive_results": [describe_item(data, name, labels) for name in ITEMS],
        "uncertainty_method": {
            "cluster_unit": "community_unit",
            "bootstrap_seed": SEED,
            "bootstrap_replicates": REPLICATES,
            "bootstrap_estimator": "抽取38个小区，有放回；小区内受访记录整组保留；每次计算满意数总和/有效样本总和；取2.5%和97.5%分位",
            "scope": "对已公开样本的社区构成敏感性；没有小区入样概率、居民总体边际或完整抽样权重，不解释为杭州总体设计置信区间",
            "iid_wilson_scope": "仅作忽略群集相关的区间宽度对照，正式报告优先使用社区群集敏感区间",
            "point_estimate_scope": "respondent_weighted是原附件各问卷等权描述；equal_community_mean是各小区等权描述，两者估计对象不同",
        },
        "application": {
            "enabled": ["五级满意度编码方向校验", "样本数与来源版本核验", "食堂/养老/幼育等逐题分布", "社区整组重采样敏感性", "问卷加权与社区等权并列描述"],
            "requires_more_data": ["原作者分析样本排除规则", "目标社区人口结构与抽样权重", "设施实际使用人次和去重人数", "完整月度运营收支台账"],
            "demand_and_usage": "满意度是已感知服务评价；到访概率、需求人数和付费采用率需另用签到/调查字段，不用满意率直接填充运营模型采用率。",
            "validation_protocol": "有模型后按社区/项目整组留出；跨期预测按时间前推；基线、权重、清洗、调参均只使用训练部分；同时报告留出项目数和观测数。",
            "model_accuracy_or_causal_effect_estimated": False,
        },
        "method_sources": [
            {"title": "NIST/SEMATECH e-Handbook 7.2.4.1 Confidence intervals", "url": "https://itl.nist.gov/div898/handbook/prc/section2/prc241.htm", "use": "Wilson比例区间公式；用于独立抽样比较基准"},
            {"title": "scikit-learn Cross-validation: grouped data and time series", "url": "https://scikit-learn.org/stable/modules/cross_validation.html", "use": "群组留出避免同社区记录跨训练测试；时间前推避免未来信息泄漏"},
            {"title": "CDC NHANES Variance Estimation Module", "url": "https://wwwn.cdc.gov/nchs/nhanes/tutorials/varianceestimation.aspx", "use": "群集相关及不等概率抽样影响标准误；本审计借鉴原则并明确尚缺调查权重"},
        ],
    }
    # Prevent accidental changes from exporting row records through helper output.
    assert len(result["descriptive_results"]) == len(ITEMS)
    assert all(sum(c["n"] for c in item["five_category_distribution"]) == item["valid_n"] for item in result["descriptive_results"])
    assert result["privacy"]["raw_records_written"] == 0
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    request = urllib.request.Request(RAW_URL, headers={"User-Agent": "CommunityResearchAudit/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = response.read()
    audit = build_audit(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output.resolve()),
        "status": audit["status"],
        "raw_rows": audit["raw_attachment"]["rows"],
        "raw_communities": audit["raw_attachment"]["communities_by_code"],
        "analysis_sample_reproduced": False,
        "raw_records_written": 0,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
