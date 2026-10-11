"""Read back the actual local knowledge pipeline using already-saved public originals.

No external search/model request, simulated input, policy approval, or case review is made.
Repeated runs reuse imported documents and existing extraction drafts.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--source", action="append", required=True)
    parser.add_argument("--base", default="http://127.0.0.1:4310")
    parser.add_argument("--output", default="research/test_results/knowledge-pipeline-public-local.json")
    args = parser.parse_args()
    records = []
    with httpx.Client(base_url=args.base, trust_env=False, timeout=90, headers={"X-Requested-With": "haizhizi"}) as client:
        def request(path, body=None):
            response = client.get(path) if body is None else client.post(path, json=body)
            response.raise_for_status()
            return response.json()

        request("/api/session")
        base = "/api/projects/" + args.project
        project = request(base)
        assert not project["input"]["synthetic"], "Real readback requires a real-data project"
        for source_id in args.source:
            source = next(s for s in project["input"]["sources"] if s["id"] == source_id)
            assert source["visibility"] == source["data_class"] == "public" and not source["synthetic"]
            body = source["untrusted_text"]
            sha256 = hashlib.sha256(body.encode("utf-8")).hexdigest()
            imported = request(base + "/knowledge/public-document", {"source_id": source_id})
            doc_id = imported["id"]
            parsed = imported["parser_result"]
            assert parsed["status"] == "extracted" and parsed["text"] == body
            assert parsed["source_hash"] == sha256
            repeated = request(base + "/knowledge/public-document", {"source_id": source_id})
            assert repeated["reused"] and repeated["id"] == doc_id
            chunks = request(base + "/knowledge/chunks", {"document_id": doc_id})
            state = request(base + "/knowledge/pipeline")
            cards = [card for card in state["cards"] if all(chunk.get("classification") == "local" for chunk in card.get("knowledge", {}).get("chunks", [])) and any(
                chunk["document_id"] == doc_id for chunk in card.get("knowledge", {}).get("chunks", []))]
            if not cards:
                extracted = request(base + "/knowledge/extract", {"document_ids": [doc_id], "use_model": False})
                assert extracted["model_calls"] == 0
                cards = extracted["cards"]
            citations = 0
            for chunk in chunks["chunks"]:
                assert chunk["document_version"] == sha256
                for cite in chunk["spans"]:
                    assert cite["document_id"] == doc_id and cite["version"] == sha256 and cite["quote"] in body
                    citations += 1
            for card in cards:
                knowledge = card["knowledge"]
                evidence = [cite for field in card["fields"] for cite in field["evidence"]]
                evidence += [cite for chunk in knowledge.get("chunks", []) for cite in chunk["spans"]]
                evidence += [cite for factor in knowledge.get("factors", []) for cite in factor["evidence"]]
                for cite in evidence:
                    assert cite["document_id"] == doc_id and cite["version"] == sha256 and cite["quote"] in body
                    citations += 1
                assert card["status"] == "draft" and card["review_note"] is None
            records.append({"source_id": source_id, "source_url": source.get("url"), "document_id": doc_id,
                            "title": source["title"], "sha256": sha256, "original_characters": len(body),
                            "chunk_count": len(chunks["chunks"]), "draft_cards": len(cards),
                            "measure_keys": sorted({card["knowledge"]["measure_key"] for card in cards}),
                            "factor_count": sum(len(card["knowledge"].get("factors", [])) for card in cards),
                            "citations_read_back": citations, "repeat_import_reused": True})
        final = request(base + "/knowledge/pipeline")
        assert final["policies"] == [] and final["skills"] == [], "This validation never manufactures expert reviews"
    result = {"status": "passed", "checked_at": datetime.now(timezone.utc).isoformat(),
              "project_id": args.project, "input_class": "actual_saved_public_originals", "records": records,
              "external_model_calls": 0, "policy_or_case_approvals": 0,
              "scope": "Actual parser, HTTP, immutable original binding, action chunks and factor draft citation readback; not decision-quality evaluation"}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "records": records, "output": str(output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
