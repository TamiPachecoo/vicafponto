#!/usr/bin/env python3
"""Validate the approved ZIP; optionally import into VICAF without overwriting files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

VICAF_URL = 'https://xuonzwvqqwbgcedidyie.supabase.co'
NAMESPACE = uuid.UUID('34087ec2-9aba-4e80-9d78-b55023d02e13')


def prepare(zip_path, manifest_path):
    if not Path(manifest_path).is_file():
        raise ValueError('Private import manifest missing. Obtain it from the private deliverables; do not commit it to GitHub.')
    manifest = json.loads(Path(manifest_path).read_text())
    with zipfile.ZipFile(zip_path) as archive:
        expected = {item['source'] for item in manifest}
        actual = {n for n in archive.namelist() if not n.endswith('/')}
        if actual != expected:
            raise ValueError('ZIP differs from reviewed manifest. Review missing/extra files before import.')
        prepared = []
        for item in manifest:
            raw = archive.read(item['source'])
            digest = hashlib.sha256(raw).hexdigest()
            if not raw.startswith(b'%PDF-') or len(raw) > 15 * 1024 * 1024:
                raise ValueError('Invalid PDF: ' + item['source'])
            if digest != item['sha256']:
                raise ValueError('PDF changed since review: ' + item['source'])
            product = dict(item['product'])
            product['id'] = str(uuid.uuid5(NAMESPACE, item['source']))
            revision = dict(item['revision'])
            revision.update(id=str(uuid.uuid5(NAMESPACE, item['source'] + digest)), product_id=product['id'],
                            version=1, sha256=digest, original_name=item['source'].split('/')[-1],
                            object_path=f'import/{digest}.pdf', summary='')
            prepared.append((product, revision, raw))
    return prepared


def api(path, method='GET', body=None, binary=False):
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/pdf' if binary else 'application/json'}
    data = body if binary else json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(VICAF_URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        # Never print request headers or credentials.
        raise RuntimeError(f'VICAF API returned HTTP {error.code}; stopped without deleting existing data.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip_path')
    parser.add_argument('--manifest', default=str(Path(__file__).with_name('fisqs_manifest.json')))
    parser.add_argument('--apply', action='store_true', help='Upload only missing products/documents into VICAF')
    args = parser.parse_args()
    items = prepare(args.zip_path, args.manifest)
    print(f'Validated {len(items)} PDFs; total {sum(len(raw) for _, _, raw in items):,} bytes.')
    if not args.apply:
        print('Validation only. No files uploaded and no database records changed.')
        return
    if not os.environ.get('SUPABASE_SERVICE_ROLE_KEY'):
        raise SystemExit('Set SUPABASE_SERVICE_ROLE_KEY locally; never paste it into chat or commit it.')
    # All preflight checks happen before writes. No alternate project URL is accepted.
    api('/rest/v1/fisqs_products?select=id&limit=1')
    api('/rest/v1/fisqs_revisions?select=id&limit=1')
    bucket = api('/storage/v1/bucket/fisqs')
    if bucket.get('public'):
        raise SystemExit('FISQS bucket must be private. Import stopped.')
    for product, revision, raw in items:
        existing = api('/rest/v1/fisqs_revisions?id=eq.' + revision['id'] + '&select=id,sha256')
        if existing:
            if existing[0]['sha256'] != revision['sha256']:
                raise RuntimeError('Existing revision differs. Import stopped.')
            print('Already imported: ' + product['name'])
            continue
        # Hash-addressed files are never overwritten. Retry reuses an existing matching object.
        path = revision['object_path']
        stored = api('/storage/v1/object/list/fisqs', 'POST', {'prefix':'import/', 'search':revision['sha256']+'.pdf', 'limit':100})
        if not any(obj.get('name') == revision['sha256']+'.pdf' for obj in stored):
            api('/storage/v1/object/fisqs/' + path, 'POST', raw, binary=True)
        if not api('/rest/v1/fisqs_products?id=eq.' + product['id'] + '&select=id'):
            api('/rest/v1/fisqs_products', 'POST', product)
        api('/rest/v1/fisqs_revisions', 'POST', revision)
        verified = api('/rest/v1/fisqs_revisions?id=eq.' + revision['id'] + '&select=id,sha256')
        if not verified or verified[0]['sha256'] != revision['sha256']:
            raise RuntimeError('Post-import verification failed; stopped.')
        print('Imported: ' + product['name'])
    print('Import completed and database records verified. Open a PDF through the app to verify Storage access.')

if __name__ == '__main__':
    main()
