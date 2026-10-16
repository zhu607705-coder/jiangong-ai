"""Run once in the owner's authenticated Aliyun CloudShell after authorization.

Creates only the named DNS service identity. Writes the new secret to a 0600
temporary file for immediate transfer; never prints or logs credential values.
"""
import json
import os
import pathlib
import subprocess
from urllib.parse import unquote

USER = 'haizhizi-acme'
POLICY_NAME = 'HaizhiziAcmeLaneanewDns'
POLICY = {'Version': '1', 'Statement': [
    {'Effect': 'Allow', 'Action': ['alidns:DescribeDomains'], 'Resource': '*'},
    {'Effect': 'Allow', 'Action': ['alidns:DescribeDomainRecords', 'alidns:AddDomainRecord', 'alidns:DeleteDomainRecord'], 'Resource': 'acs:alidns::*:domain/laneanew.cn'},
]}


def api(action, missing=False, **values):
    args = ['aliyun', 'ram', action]
    for key, value in values.items():
        args.extend(['--' + key, str(value)])
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=60)
    if result.returncode:
        if missing and any(code in result.stderr for code in ['EntityNotExist.', 'NoSuchEntity']):
            return None
        raise RuntimeError(action + ' failed; credential output was not printed')
    return json.loads(result.stdout)


def main():
    os.umask(0o077)
    if api('GetUser', missing=True, UserName=USER) is None:
        api('CreateUser', UserName=USER, DisplayName='Certbot laneanew.cn DNS renewal')
    profile = api('GetLoginProfile', missing=True, UserName=USER)
    if profile is not None:
        raise RuntimeError('Existing console login profile requires separate review')
    existing = api('GetPolicy', missing=True, PolicyType='Custom', PolicyName=POLICY_NAME)
    if existing is None:
        api('CreatePolicy', PolicyName=POLICY_NAME, PolicyDocument=json.dumps(POLICY), Description='Restricted DNS access for laneanew.cn ACME renewal')
    else:
        version = existing['Policy']['DefaultVersion']
        raw = api('GetPolicyVersion', PolicyType='Custom', PolicyName=POLICY_NAME, VersionId=version)['PolicyVersion']['PolicyDocument']
        if json.loads(unquote(raw)) != POLICY:
            raise RuntimeError('Existing policy differs; do not overwrite it')
    api('AttachPolicyToUser', PolicyType='Custom', PolicyName=POLICY_NAME, UserName=USER)
    attached = api('ListPoliciesForUser', UserName=USER)['Policies']['Policy']
    if any(item['PolicyType'] != 'Custom' or item['PolicyName'] != POLICY_NAME for item in attached):
        raise RuntimeError('Unexpected additional user permissions')
    destination = pathlib.Path.home() / '.haizhizi-acme-credentials.ini'
    if not destination.exists():
        keys = api('ListAccessKeys', UserName=USER)['AccessKeys']['AccessKey']
        if keys:
            raise RuntimeError('A key already exists without the temporary transfer file; do not create duplicates')
        key = api('CreateAccessKey', UserName=USER)['AccessKey']
        text = 'dns_aliyun_access_key = ' + key['AccessKeyId'] + '\ndns_aliyun_access_key_secret = ' + key['AccessKeySecret'] + '\n'
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(text)
    destination.chmod(0o600)
    print('RAM_ACME_READY; console_login=disabled; credential_file=' + str(destination))


if __name__ == '__main__':
    main()
