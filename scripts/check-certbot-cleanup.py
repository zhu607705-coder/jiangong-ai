"""Regression: one RR can contain somebody else's TXT alongside our challenge.

Run with the Certbot venv: python check-certbot-cleanup.py /opt/certbot/haizhizi-certbot.py
"""
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

source = pathlib.Path(sys.argv.pop(1))
spec = importlib.util.spec_from_file_location('haizhizi_certbot', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeDNS:
    def __init__(self):
        self.deleted = []
    def _find_domain_id(self, domain):
        return 'laneanew.cn'
    def _request(self, action, values):
        if action == 'DeleteDomainRecord':
            self.deleted.append(values['RecordId'])
            return {}
        return {'DomainRecords': {'Record': [
            {'RR': '_acme-challenge', 'Type': 'TXT', 'Value': 'other-challenge', 'RecordId': 'keep'},
            {'RR': '_acme-challenge', 'Type': 'TXT', 'Value': 'our-challenge', 'RecordId': 'delete'},
            {'RR': '_acme-challenge.www', 'Type': 'TXT', 'Value': 'our-challenge', 'RecordId': 'keep-www'},
        ]}}


class CleanupTests(unittest.TestCase):
    def test_dns_transport_uses_only_the_declared_route(self):
        class Session:
            trust_env = True
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
            def get(self, url, **kwargs):
                self.trust_env_at_request = self.trust_env
                self.options = kwargs
                return 'response'
        direct = Session()
        with patch.dict(module.os.environ, {'HAIZHIZI_DNS_PROXY': '', 'HTTPS_PROXY': 'http://unrelated.invalid:8080'}), patch.object(module.requests, 'Session', return_value=direct):
            self.assertEqual(module.AliyunTransport.get('https://alidns.aliyuncs.com/'), 'response')
        self.assertFalse(direct.trust_env_at_request)
        self.assertEqual(direct.options['proxies'], {})
        configured = Session()
        with patch.dict(module.os.environ, {'HAIZHIZI_DNS_PROXY': 'http://127.0.0.1:17897'}), patch.object(module.requests, 'Session', return_value=configured):
            module.AliyunTransport.get('https://alidns.aliyuncs.com/')
        self.assertFalse(configured.trust_env_at_request)
        self.assertEqual(configured.options['proxies'], {'https': 'http://127.0.0.1:17897'})

    def test_only_exact_challenge_is_removed(self):
        client = FakeDNS()
        module.delete_exact_challenge(client, 'laneanew.cn', '_acme-challenge.laneanew.cn', 'our-challenge')
        self.assertEqual(client.deleted, ['delete'])
    def test_already_removed_challenge_is_harmless(self):
        client = FakeDNS()
        module.delete_exact_challenge(client, 'laneanew.cn', '_acme-challenge.laneanew.cn', 'missing')
        self.assertEqual(client.deleted, [])
    def test_other_domains_are_rejected(self):
        client = FakeDNS()
        with self.assertRaises(module.errors.PluginError):
            module.delete_exact_challenge(client, 'another.example', '_acme-challenge.another.example', 'our-challenge')
        self.assertEqual(client.deleted, [])


if __name__ == '__main__':
    unittest.main()
