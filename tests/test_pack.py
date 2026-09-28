"""Local checks only: selective port behavior and fixture integrity.

These tests do not claim an Agent runtime, GIS server, parser, or search API ran.
"""
from __future__ import annotations
import json
import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from ported.retqa_slots import extract_entity_slots, restore_keywords_from_query

class PortTests(unittest.TestCase):
    def test_city(self):
        self.assertEqual(restore_keywords_from_query('杭州','B-city I-city'),['城市:杭州'])
    def test_enterprise_bug_patch(self):
        self.assertEqual(restore_keywords_from_query('示范建投','B-enterprise I-enterprise I-enterprise I-enterprise'),['企业:示范建投'])
    def test_empty(self): self.assertEqual(extract_entity_slots('',[]),[])
    def test_cls_sep(self):
        self.assertEqual(restore_keywords_from_query('杭州',['[CLS]','B-city','I-city','[SEP]']),['城市:杭州'])
    def test_length(self):
        with self.assertRaises(ValueError): extract_entity_slots('杭州',['B-city'])
    def test_orphan(self):
        with self.assertRaises(ValueError): extract_entity_slots('杭',['I-city'])
    def test_separate_entity(self):
        self.assertEqual(restore_keywords_from_query('杭州某区',['B-city','I-city','B-district','I-district']),['城市:杭州','区域:某区'])

class FixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files=list((ROOT/'fixtures'/'inputs').glob('*.json'))
        cls.items={p.stem:json.loads(p.read_text()) for p in cls.files}
    def test_ten_inputs(self): self.assertEqual(len(self.files),10)
    def test_labels_and_references(self):
        for data in self.items.values():
            self.assertTrue(data['synthetic'])
            sources={s['id'] for s in data['sources']}
            self.assertEqual(len(sources),len(data['sources']))
            for s in data['sources']: self.assertTrue(s['synthetic'])
            for x in data['facts']+data['context_rules']: self.assertIn(x['source_id'],sources)
    def test_geometry_closed(self):
        for data in self.items.values():
            ring=data['scope']['geometry']['coordinates'][0]
            self.assertEqual(ring[0],ring[-1]); self.assertFalse(data['scope']['legal_parcel_confirmed'])
    def test_area(self):
        v=self.items['01_auto']['facts'][0]['value']
        self.assertAlmostEqual(v['vacant_m2']/v['gfa_m2'],0.6)
    def test_no_hidden_truth_in_input(self):
        for d in self.items.values():
            self.assertNotIn('expected',d)
            self.assertNotIn('expected_verdict',d)
    def test_missing_preserved(self):
        self.assertIsNone(self.items['03_missing']['facts'][0]['value']['vacant_m2'])
    def test_project_rule(self):
        r=self.items['02_enterprise']['context_rules'][0]
        self.assertEqual(r['scope'],'project')
        self.assertEqual(r['kind'],'organizational_constraint')
    def test_permutation_pairs(self):
        for name,d in self.items.items():
            if name.endswith('_reordered'): continue
            v=self.items[name+'_reordered']
            self.assertEqual(d['facts'],v['facts'])
            self.assertEqual(d['context_rules'],v['context_rules'])
            self.assertEqual(d['candidate_ids'],list(reversed(v['candidate_ids'])))
    def test_rule_source_private(self):
        d=self.items['02_enterprise']; r=d['context_rules'][0]
        s=next(s for s in d['sources'] if s['id']==r['source_id'])
        self.assertEqual(s['visibility'],'internal')

if __name__=='__main__': unittest.main()
