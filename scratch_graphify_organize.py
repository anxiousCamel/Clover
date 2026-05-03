import json
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json, to_obsidian, to_canvas, to_html
from pathlib import Path

# Load filtered extraction
ast = json.loads(Path('.graphify_ast_clover_no_tests.json').read_text(encoding='utf-8'))
sem_full = json.loads(Path('.graphify_semantic_clover.json').read_text(encoding='utf-8'))
sem_nodes = [n for n in sem_full['nodes'] if '__tests__' not in n['source_file'] and '.test.' not in n['source_file']]
sem_edges = [e for e in sem_full['edges'] if e['source'] in [n['id'] for n in sem_nodes] or e['target'] in [n['id'] for n in sem_nodes]]
sem = {'nodes': sem_nodes, 'edges': sem_edges}

seen = {n['id'] for n in ast['nodes']}
merged_nodes = list(ast['nodes'])
for n in sem['nodes']:
    if n['id'] not in seen:
        merged_nodes.append(n)
        seen.add(n['id'])

merged_edges = ast['edges'] + sem['edges']
extraction = {'nodes': merged_nodes, 'edges': merged_edges}

G = build_from_json(extraction)
communities_raw = cluster(G)

# Merge small communities
HELPERS_CID = 999
HELPERS_LABEL = "Helpers & Small Modules"
final_cid_to_nodes = {HELPERS_CID: []}

for cid, nids in communities_raw.items():
    if len(nids) < 5:
        final_cid_to_nodes[HELPERS_CID].extend(nids)
    else:
        final_cid_to_nodes[cid] = nids

cohesion = score_all(G, final_cid_to_nodes)

# Generate labels
labels = {HELPERS_CID: HELPERS_LABEL}
for cid, nids in final_cid_to_nodes.items():
    if cid == HELPERS_CID: continue
    
    node_degrees = {nid: G.degree(nid) for nid in nids}
    top_node_id = max(node_degrees, key=node_degrees.get)
    top_label = [n['label'] for n in extraction['nodes'] if n['id'] == top_node_id][0]
    
    if 'SQLiteStore' in top_label: labels[cid] = 'Storage & Persistence'
    elif 'dispatch' in top_label: labels[cid] = 'Agent Engine & Dispatch'
    elif 'evaluateGate' in top_label: labels[cid] = 'Heuristic Gate & Routing'
    elif 'runPipeline' in top_label: labels[cid] = 'Execution Pipeline'
    elif 'classifyIntent' in top_label: labels[cid] = 'Intent Classification'
    elif 'updateContext' in top_label: labels[cid] = 'Context & State Management'
    elif 'embed' in top_label: labels[cid] = 'Vector Memory & RAG'
    elif 'registerRoutes' in top_label: labels[cid] = 'API Gateway & Routes'
    elif 'ws.client' in top_label: labels[cid] = 'WebSocket Communication'
    elif 'buildDesignPrompt' in top_label: labels[cid] = 'Planner & Prompt Templates'
    else: labels[cid] = f"Module: {top_label}"

detection = json.loads(Path('.graphify_detect_clover_no_tests.json').read_text(encoding='utf-8'))
surprises = surprising_connections(G, final_cid_to_nodes)
# Note: some functions might still want node_to_cid. 
# But let's try passing the cid_to_nodes map first.
report = generate(G, final_cid_to_nodes, cohesion, labels, god_nodes(G), surprises, detection, {'input':0, 'output':0}, '.', suggested_questions=[])

out_dir = Path('graphify-out/clover')
out_dir.mkdir(parents=True, exist_ok=True)
obsidian_dir = out_dir / 'obsidian'
obsidian_dir.mkdir(parents=True, exist_ok=True)

(out_dir / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')
to_json(G, final_cid_to_nodes, str(out_dir / 'graph.json'))
to_obsidian(G, final_cid_to_nodes, str(obsidian_dir), community_labels=labels, cohesion=cohesion)
to_canvas(G, final_cid_to_nodes, str(obsidian_dir / 'graph.canvas'), community_labels=labels)
to_html(G, final_cid_to_nodes, str(out_dir / 'graph.html'), community_labels=labels)

print(f"Done! Reports in {out_dir}")
