"""Merge explicitly verified case manifests; the application revalidates every original.

The AI-collected workbook remains a separate immutable input and is not itself
used as an official price or quantity source.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'data/public_cases/renewal-cost-library-20261013.json'
PARTS = [ROOT / 'data/public_cases/methods-expansion' / name for name in
         ['guangzhou-manifest.json', 'shanghai-manifest.json', 'zhejiang-workbook-manifest.json']]


def main():
    merged = json.loads(TARGET.read_text(encoding='utf-8'))
    sources = {row['id']: row for row in merged['sources']}
    records = {row['id']: row for row in merged['records']}
    for path in PARTS:
        document = json.loads(path.read_text(encoding='utf-8'))
        for row in document['sources']:
            sources[row['id']] = row
        for row in document['records']:
            records[row['id']] = row
    merged['sources'] = list(sources.values())
    merged['records'] = list(records.values())
    merged['lineage'] = {
        'merged_as_of': '2026-10-13', 'source_manifests': [str(path.relative_to(ROOT)).replace('\\', '/') for path in PARTS],
        'workbook_source_class': 'user_ai_collected_leads',
        'workbook_sha256': 'd9578f005d48136be6e7971d8760399392f36def99b0727d27b3bcfd5091b16a',
        'admission': 'Only original-backed records enter this manifest; workbook formulas do not establish source truth.'}
    for platform in merged['platforms']:
        if '广东' in platform['name']:
            platform.update(status='public_contracts_verified', note='新增广州青年苑、鸿中楼、颐和片区3个施工合同原件；金额及建筑面积同源。原有佛山整体投资估算单列。')
        if '上海' in platform['name']:
            platform.update(status='housing_repair_results_verified', note='通过上海住宅修缮工程交易平台公开接口核验4个施工中标项目，以项目编号和C01标段关联对应招标原件；原有通信分项合同单列。')
    TARGET.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'records': len(records), 'archived_originals': len(sources), 'target': str(TARGET)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
