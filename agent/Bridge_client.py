#!/usr/bin/env python3
"""Universal client for the Arena — Figma Agent Bridge (v2).

Works in any Arena chat / shell. The relay URL + publishable key are read from
this folder's ui.html (or ARENA_FIGMA_RELAY_URL / ARENA_FIGMA_RELAY_KEY env
vars), so the key is never hand-copied.

Session code: shown in the plugin popup in Figma. Pass --session, or set
ARENA_FIGMA_SESSION.

Usage:
  Bridge_client.py --session <code> --type ping
  Bridge_client.py --session <code> --type file_state
  Bridge_client.py --session <code> --type batch --payload @payload.json --out result.json
  Bridge_client.py --session <code> --type read_node --payload '{"id":"4:731","depth":99}' --out spec.json
  Bridge_client.py --session <code> --type list_styles --out styles.json
  Bridge_client.py --session <code> --type export_node --payload '{"id":"4:731","scale":1,"format":"PNG"}' --save export.png
  Bridge_client.py --session <code> --type export_node --payload '{"id":"1:2","format":"SVG"}' --save icon.svg
"""
import argparse
import base64
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
_candidates = [HERE / 'ui.html', HERE / '..' / 'plugin' / 'ui.html', HERE / 'plugin' / 'ui.html']
UI = next((p for p in _candidates if p.exists()), _candidates[0])


def _config():
    url = os.environ.get('ARENA_FIGMA_RELAY_URL')
    key = os.environ.get('ARENA_FIGMA_RELAY_KEY')
    if url and key:
        return url.rstrip('/'), key
    text = UI.read_text()
    base = re.search(r'url:\s*"([^"]+)"', text).group(1)
    key = re.search(r'key:\s*"([^"]+)"', text).group(1)
    return base, key


BASE, KEY = _config()
HEADERS = {
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json',
}
COMMANDS = os.environ.get('ARENA_FIGMA_COMMANDS_TABLE', 'arena_figma_commands')
EXPORTS = os.environ.get('ARENA_FIGMA_EXPORTS_TABLE', 'arena_figma_exports')


def request(method, path, body=None, prefer=None):
    headers = dict(HEADERS)
    if prefer:
        headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors='replace')[:1000]
        raise RuntimeError(f'HTTP {e.code}: {detail}') from e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--session', default=os.environ.get('ARENA_FIGMA_SESSION'))
    ap.add_argument('--type', required=True, dest='command_type')
    ap.add_argument('--payload', default='{}', help='JSON object or @path/to/file.json')
    ap.add_argument('--out', help='Write the completed command row to this JSON file')
    ap.add_argument('--save', help='For export_node: decode the exported file to this path')
    ap.add_argument('--timeout', type=int, default=600)
    ap.add_argument('--poll', type=float, default=1.0)
    args = ap.parse_args()
    if not args.session:
        raise SystemExit('No session: pass --session <code from the plugin popup> or set ARENA_FIGMA_SESSION')

    if args.payload.startswith('@'):
        payload = json.loads(pathlib.Path(args.payload[1:]).read_text())
    else:
        payload = json.loads(args.payload)
    if not isinstance(payload, dict):
        raise SystemExit('payload must be a JSON object')

    rows = request(
        'POST',
        f'/rest/v1/{COMMANDS}',
        {'session_id': args.session, 'command_type': args.command_type, 'payload': payload},
        prefer='return=representation',
    )
    if not rows:
        raise SystemExit('No command row returned')
    cmd = rows[0]
    cmd_id = cmd['id']
    print(f'command {cmd_id} queued', flush=True)

    deadline = time.time() + args.timeout
    last_status = None
    while time.time() < deadline:
        query = urllib.parse.urlencode({'id': f'eq.{cmd_id}', 'select': '*'})
        rows = request('GET', f'/rest/v1/{COMMANDS}?' + query)
        if not rows:
            raise SystemExit('Command row disappeared')
        row = rows[0]
        status = row.get('status')
        if status != last_status:
            print(f'status {status}', flush=True)
            last_status = status
        if status in ('done', 'error'):
            if args.out:
                pathlib.Path(args.out).write_text(json.dumps(row, indent=2))
                print(f'wrote {args.out}')
            if status == 'error':
                print('error:', row.get('error'))
                return 2
            if args.save:
                query = urllib.parse.urlencode({
                    'session_id': f'eq.{args.session}',
                    'command_id': f'eq.{cmd_id}',
                    'order': 'created_at.desc',
                    'limit': '1',
                    'select': 'node_id,node_name,format,width,height,data_base64',
                })
                ex = request('GET', f'/rest/v1/{EXPORTS}?' + query)
                if not ex:
                    raise SystemExit('export_node done but no export row found')
                data = base64.b64decode(ex[0]['data_base64'])
                pathlib.Path(args.save).write_bytes(data)
                print(f"saved {args.save} ({len(data)} bytes, {ex[0].get('format')})")
            result = row.get('result') or {}
            print('result keys:', ', '.join(sorted(result.keys())) if isinstance(result, dict) else type(result).__name__)
            return 0
        time.sleep(args.poll)
    print(f'Timed out after {args.timeout}s; command remains {last_status}', file=sys.stderr)
    return 124


if __name__ == '__main__':
    raise SystemExit(main())
