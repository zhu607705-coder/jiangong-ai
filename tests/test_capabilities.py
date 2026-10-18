import copy
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from services.capabilities.app import app
from services.capabilities.analysis import analyze, inventory_metrics, spatial_profile, retrieval_query, structured_query, gap_plan
from services.capabilities.generated.contracts import ProjectInput, CapabilityResult
from vendor.hire.readonly import ReadonlyQueryExecutor, validate_readonly
from vendor.storm.curation import construct_url_to_info, DialogueTurn, Information
from vendor.geoagent.metadata import get_geo_meta
from vendor.search_o1.gap import extract_between


def fixture(name="01_auto"):
    return ProjectInput.model_validate(json.loads(Path(f"fixtures/inputs/{name}.json").read_text())).model_dump(mode="json")


@pytest.mark.parametrize("path", sorted(Path("fixtures/inputs").glob("*.json")))
def test_all_fixtures_execute_without_gold(path):
    p = ProjectInput.model_validate(json.loads(path.read_text())).model_dump(mode="json")
    for role in ["building_feasibility", "demand_operations", "case_enterprise"]:
        CapabilityResult.model_validate(analyze(p, role))


def test_missing_vacancy_not_filled():
    result = analyze(fixture("03_missing"), "building_feasibility")
    assert next(m for m in result["metrics"] if m["key"] == "vacancy_ratio")["value"] is None


def test_conflicting_areas_are_not_averaged():
    result = analyze(fixture("04_conflict"), "building_feasibility")
    metrics = {m["key"]: m for m in result["metrics"]}
    assert metrics["gfa_m2"]["value"] is None
    assert metrics["vacancy_ratio"]["status"] == "conflict"


def test_invalid_inventory_does_not_generate_credible_ratio():
    p = fixture(); p["facts"][0]["value"]["vacant_m2"] = 99999
    metrics, warnings, _ = inventory_metrics(p)
    assert metrics[2]["value"] is None and warnings


def test_expired_source_and_future_fact_excluded():
    p = fixture(); p["sources"][0]["expires_at"] = "2020-01-01"
    assert inventory_metrics(p)[0][0]["value"] is None
    p = fixture(); p["facts"][0]["observed_at"] = "2099-01-01"
    assert inventory_metrics(p)[0][0]["value"] is None


def test_unknown_structure_is_not_safe_by_default():
    result = analyze(fixture(), "building_feasibility")
    assert next(f for f in result["findings"] if f["id"] == "FIND-STRUCTURE")["status"] == "unknown"


def test_spatial_uses_verified_geometry_and_metadata():
    assert 1_230_000 < spatial_profile(fixture()["scope"])["area_m2"] < 1_232_000
    assert get_geo_meta(spatial_profile)["category"] == "spatial"
    scope = fixture()["scope"]; scope["geometry"] = None
    assert spatial_profile(scope)["status"] == "unknown"


@pytest.mark.parametrize("ring", [[[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]], [[0, 0], [190, 0], [190, 1], [0, 0]]])
def test_invalid_geometry_is_refused(ring):
    scope = fixture()["scope"]; scope["geometry"]["coordinates"] = [ring]
    with pytest.raises(ValueError): spatial_profile(scope)


def test_acl_filters_before_bm25_and_curation():
    p = fixture("02_enterprise")
    p["sources"][2]["untrusted_text"] = "机密厂房"
    assert "S-03" not in [m["source_id"] for m in retrieval_query(p, "机密厂房", False)["matches"]]
    assert "S-03" in [m["source_id"] for m in retrieval_query(p, "机密厂房", True)["matches"]]


def test_storm_dedup_does_not_mutate_original():
    first = Information("url", "t", ["one"])
    second = Information("url", "t", ["one", "two"])
    result = construct_url_to_info([("a", [DialogueTurn([first])]), ("b", [DialogueTurn([second])])])
    assert result["url"].snippets == ["one", "two"] and first.snippets == ["one"]


@pytest.mark.parametrize("sql", ["DELETE FROM evidence", "SELECT * FROM evidence; DROP TABLE evidence", "SELECT * FROM secrets", "PRAGMA table_info(evidence)", "SELECT load_extension('bad')", "SELECT * INTO new_table FROM evidence"])
def test_hire_port_rejects_unsafe_queries(sql):
    with pytest.raises(ValueError): validate_readonly(sql)


def test_hire_port_parameterizes_source_identifiers():
    p = fixture()
    assert structured_query(p, "S-01")["rows"]
    assert structured_query(p, "S-01' OR 1=1 --")["rows"] == []


def test_search_o1_extraction_and_round_budget():
    assert extract_between("<s>a</s><s>b</s>", "<s>", "</s>") == "b"
    assert gap_plan(fixture(), 2)["status"] == "blocked"
    assert gap_plan(fixture(), 0)["queries"]


def test_capability_endpoint_requires_private_token(monkeypatch):
    monkeypatch.setenv("CAPABILITY_TOKEN", "test-private-token")
    client = TestClient(app)
    assert client.post("/capabilities/analyze", json={"project": fixture()}).status_code == 403
    response = client.post("/capabilities/analyze", headers={"X-Capability-Token": "test-private-token"}, json={"project": fixture()})
    assert response.status_code == 200


def test_no_model_api_or_shell_is_needed_for_injection_fixture():
    result = analyze(fixture("05_injection"), "building_feasibility")
    clean = analyze(fixture(), "building_feasibility")
    assert result == clean


def test_different_buildings_are_not_stitched_together():
    p = fixture(); p["facts"][0]["object_ref"] = "B1"
    other = copy.deepcopy(p["facts"][0]); other.update(id="F-B2", object_ref="B2")
    other["value"] = {"gfa_m2": 9000, "vacant_m2": 1000}; p["facts"].append(other)
    metrics, warnings, _ = inventory_metrics(p)
    assert metrics[2]["value"] is None
    assert any("不同对象" in warning for warning in warnings)


def test_sql_operation_budget_interrupts_expensive_select():
    connection = sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE evidence (id INT)")
    connection.executemany("INSERT INTO evidence VALUES (?)", [(i,) for i in range(100)])
    connection.commit()
    executor = ReadonlyQueryExecutor(connection)
    try:
        with pytest.raises(sqlite3.OperationalError, match="interrupted"):
            executor.execute_sql("SELECT count(*) FROM evidence a CROSS JOIN evidence b CROSS JOIN evidence c CROSS JOIN evidence d")
    finally:
        executor.close()


def test_retrieval_recall_limit_preserves_default_and_expands_hybrid_candidates():
    p = fixture()
    template = copy.deepcopy(p["sources"][0])
    p["sources"] = [dict(template, id=f"RECALL-{i}", title="供水改造公告",
                         visibility="public", data_class="public", synthetic=False,
                         url=f"https://example.org/recall/{i}", untrusted_text="供水管网改造安排。")
                    for i in range(12)]
    assert len(retrieval_query(p, "供水", False)["matches"]) == 5
    assert len(retrieval_query(p, "供水", False, limit=30)["matches"]) == 12


def test_retrieval_statistics_reuse_keeps_ranking_and_current_permission_scope():
    from services.capabilities.analysis import _cached_retrieval_corpus
    _cached_retrieval_corpus.cache_clear()
    p = fixture()
    p["sources"] = [dict(p["sources"][0], id="ORIGINAL", title="供水公告", untrusted_text="供水改造预算50万元。", visibility="public", url="https://example.org/cache")]
    first = retrieval_query(p, "供水预算", False)
    assert first == retrieval_query(p, "供水预算", False)
    assert _cached_retrieval_corpus.cache_info().hits == 1
    other = copy.deepcopy(p)
    other["sources"][0].update(id="OTHER", visibility="internal")
    assert retrieval_query(other, "供水预算", False)["matches"] == []
    assert retrieval_query(other, "供水预算", True)["matches"][0]["source_id"] == "OTHER"
    # Reused statistics must not return the previous source's ID or metadata.
    other["sources"][0]["untrusted_text"] = "供水改造预算80万元。"
    result = retrieval_query(other, "供水预算", True)
    assert "80万元" in result["matches"][0]["snippets"][0]
    assert _cached_retrieval_corpus.cache_info().misses == 2
