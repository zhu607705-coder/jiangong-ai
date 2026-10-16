#!/opt/certbot/bin/python
"""Certbot entry point using the pinned Aliyun plugin with scoped TXT cleanup.

Upstream: tengattack/certbot-dns-aliyun 2.0.0, Apache-2.0.
The upstream client finds a cleanup record by RR alone. Keep its signing and DNS
implementation, but delete only the exact challenge value. The existing SSH
proxy, when configured, is used only for the Aliyun API, not the ACME service.
"""
import os
import sys
import requests
from certbot import errors
from certbot_dns_aliyun import alidns


class AliyunTransport:
    @staticmethod
    def get(url, **kwargs):
        if url != 'https://alidns.aliyuncs.com/':
            raise errors.PluginError('Unexpected Aliyun DNS endpoint')
        proxy = os.environ.get('HAIZHIZI_DNS_PROXY', '')
        if proxy and proxy != 'http://127.0.0.1:17897':
            raise errors.PluginError('Unexpected DNS proxy configuration')
        return requests.get(url, timeout=(10, 40), proxies={'https': proxy} if proxy else {}, **kwargs)


def delete_exact_challenge(client, domain, record_name, value):
    if domain not in {'laneanew.cn', 'www.laneanew.cn'}:
        raise errors.PluginError('Certificate domain is outside this deployment')
    zone = client._find_domain_id(domain)
    if zone != 'laneanew.cn' or record_name not in {'_acme-challenge.laneanew.cn', '_acme-challenge.www.laneanew.cn'}:
        raise errors.PluginError('Unexpected ACME challenge name')
    rr = record_name[:-(len(zone) + 1)]
    result = client._request('DescribeDomainRecords', {'DomainName': zone, 'RRKeyWord': rr, 'TypeKeyWord': 'TXT', 'ValueKeyWord': value, 'PageSize': 100})
    for record in result['DomainRecords']['Record']:
        if record['RR'] == rr and record['Type'] == 'TXT' and record['Value'] == value:
            client._request('DeleteDomainRecord', {'DomainName': zone, 'RecordId': record['RecordId']})


def main():
    alidns.requests = AliyunTransport
    alidns.AliDNSClient.del_txt_record = delete_exact_challenge
    from certbot.main import main as certbot_main
    return certbot_main()


if __name__ == '__main__':
    sys.exit(main())
