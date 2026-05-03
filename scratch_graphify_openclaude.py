import json
from graphify.detect import detect
from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json, to_obsidian, to_canvas, to_html
from pathlib import Path

# OpenClaude (AST only, no tests)
root = Path('.example/openclaude/openclaude')
result = detect(root)
filtered = {cat: [f for f in files if '__tests__' not in f and '.test.' not in f and '/tests/' not in f] for cat, files in result['files'].items()}
result['files'] = filtered
result['total_files'] = sum(len(f) for f in filtered.values())

code_files = [Path(f) for f in filtered.get('code', [])]
if code_files:
    ast_result = extract(code_files)
    G = build_from_json(ast_result)
    communities_raw = cluster(G)
    
    HELPERS_CID = 999
    final_cid_to_nodes = {HELPERS_CID: []}
    for cid, nids in communities_raw.items():
        if len(nids) < 10:
            final_cid_to_nodes[HELPERS_CID].extend(nids)
        else:
            final_cid_to_nodes[cid] = nids
            
    cohesion = score_all(G, final_cid_to_nodes)
    labels = {HELPERS_CID: "Helpers & Small Modules"}
    for cid, nids in final_cid_to_nodes.items():
        if cid == HELPERS_CID: continue
        node_degrees = {nid: G.degree(nid) for nid in nids}
        top_node_id = max(node_degrees, key=node_degrees.get)
        top_label = [n['label'] for n in ast_result['nodes'] if n['id'] == top_node_id][0]
        labels[cid] = f"Module: {top_label}"

    surprises = surprising_connections(G, final_cid_to_nodes)
    report = generate(G, final_cid_to_nodes, cohesion, labels, god_nodes(G), surprises, result, {'input':0, 'output':0}, str(root), suggested_questions=[])
    
    out_dir = Path('graphify-out/openclaude')
    out_dir.mkdir(parents=True, exist_ok=True)
    obsidian_dir = out_dir / 'obsidian'
    obsidian_dir.mkdir(parents=True, exist_ok=True)
    
    (out_dir / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')
    to_json(G, final_cid_to_nodes, str(out_dir / 'graph.json'))
    to_obsidian(G, final_cid_to_nodes, str(obsidian_dir), community_labels=labels, cohesion=cohesion)
    to_canvas(G, final_cid_to_nodes, str(obsidian_dir / 'graph.canvas'), community_labels=labels)
    to_html(G, final_cid_to_nodes, str(out_dir / 'graph.html'), community_labels=labels)
    print(f"Done! OpenClaude reports in {out_dir}")
