"""Export only timing evidence from private Wrangler tail output; never headers."""
import json
from pathlib import Path
from urllib.parse import urlsplit

source = Path('test-output/worker-tail.raw.jsonl').read_text(encoding='utf-8-sig')
decoder = json.JSONDecoder()
rows, offset = [], 0
while offset < len(source):
    start = source.find('{', offset)
    if start < 0:
        break
    try:
        event, end = decoder.raw_decode(source, start)
    except json.JSONDecodeError:
        break
    offset = end
    request = event.get('event', {}).get('request', {})
    rows.append({
        'path': urlsplit(request.get('url', '')).path,
        'eventTimestamp': event.get('eventTimestamp'),
        'cpuMs': event.get('cpuTime'),
        'wallMs': event.get('wallTime'),
        'outcome': event.get('outcome'),
    })
Path('test-output/worker-timings.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
print(json.dumps(rows, indent=2))
