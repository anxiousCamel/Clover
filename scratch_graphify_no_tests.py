import json
from graphify.detect import detect
from pathlib import Path

result = detect(Path('.'))
filtered = {cat: [f for f in files if '__tests__' not in f and '.test.' not in f] for cat, files in result['files'].items()}
result['files'] = filtered
result['total_files'] = sum(len(f) for f in filtered.values())

with open('.graphify_detect_clover_no_tests.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, indent=2)

from graphify.extract import collect_files, extract
code_files = [Path(f) for f in filtered.get('code', [])]
if code_files:
    ast_result = extract(code_files)
    with open('.graphify_ast_clover_no_tests.json', 'w', encoding='utf-8') as f:
        json.dump(ast_result, f, indent=2)
    print(f"AST: {len(ast_result['nodes'])} nodes")
