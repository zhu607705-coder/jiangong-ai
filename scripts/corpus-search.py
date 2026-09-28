"""Search a local corpus with the existing permission-filtered BM25/RETQA entry."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.capabilities.analysis import retrieval_query

directory, query = Path(sys.argv[1]), sys.argv[2]
documents = {d['id']: d for d in (json.loads(s) for s in (directory / 'documents.jsonl').read_text().splitlines())}
chunks = {c['id']: c for c in (json.loads(s) for s in (directory / 'chunks.jsonl').read_text().splitlines())}
sources = [dict(id=c['id'], title=documents[c['document_id']]['title'],
                untrusted_text=c['text'], url=documents[c['document_id']]['url'] + '#' + c['id'],
                visibility='public') for c in chunks.values()]
result = retrieval_query({'sources': sources, 'scope': {}}, query, include_internal=False)
matches = []
for hit in result['matches']:
    chunk = chunks[hit['source_id']]
    doc = documents[chunk['document_id']]
    matches.append(dict(title=hit['title'], url=doc['url'], score=hit['score'],
                        chunk_id=chunk['id'], char_start=chunk['char_start'], char_end=chunk['char_end'],
                        text=chunk['text'], retrieved_at=doc['retrieved_at']))
print(json.dumps({'query': query, 'matches': matches, 'scope': 'local_snapshot_retrieval_not_current_policy_advice'}, ensure_ascii=False, indent=2))
