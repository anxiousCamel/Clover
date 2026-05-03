---
type: community
cohesion: 0.12
members: 24
---

# Module: ollama.client.ts

**Cohesion:** 0.12 - loosely connected
**Members:** 24 nodes

## Members
- [[.constructor()_5]] - code - apps\backend\src\ollama\ollama.client.ts
- [[OllamaError]] - code - apps\backend\src\ollama\ollama.client.ts
- [[chat()_1]] - code - apps\backend\src\ollama\ollama.client.ts
- [[checkLanceDB()]] - code - apps\backend\src\gateway\routes\health.routes.ts
- [[checkOllama()]] - code - apps\backend\src\gateway\routes\health.routes.ts
- [[checkOpenClaude()]] - code - apps\backend\src\gateway\routes\health.routes.ts
- [[checkSQLite()]] - code - apps\backend\src\gateway\routes\health.routes.ts
- [[embed()]] - code - apps\backend\src\memory\embedder.ts
- [[embed()_1]] - code - apps\backend\src\ollama\ollama.client.ts
- [[embedder.ts]] - code - apps\backend\src\memory\embedder.ts
- [[fetchWithRetry()]] - code - apps\backend\src\ollama\ollama.client.ts
- [[getEmbedModel()]] - code - apps\backend\src\memory\embedder.ts
- [[health.routes.ts]] - code - apps\backend\src\gateway\routes\health.routes.ts
- [[healthRoutes()]] - code - apps\backend\src\gateway\routes\health.routes.ts
- [[init()]] - code - apps\backend\src\memory\lancedb.adapter.ts
- [[insert()]] - code - apps\backend\src\memory\lancedb.adapter.ts
- [[lancedb.adapter.ts]] - code - apps\backend\src\memory\lancedb.adapter.ts
- [[listModels()]] - code - apps\backend\src\ollama\ollama.client.ts
- [[offline.adapter.ts]] - code - apps\backend\src\search\offline.adapter.ts
- [[ollama.client.ts]] - code - apps\backend\src\ollama\ollama.client.ts
- [[similaritySearch()]] - code - apps\backend\src\memory\lancedb.adapter.ts
- [[sleep()]] - code - apps\backend\src\ollama\ollama.client.ts
- [[toRow()]] - code - apps\backend\src\memory\lancedb.adapter.ts
- [[upsertByPath()]] - code - apps\backend\src\memory\lancedb.adapter.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_ollama.client.ts
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Module memory.service.ts]]
- 2 edges to [[_COMMUNITY_Storage & Persistence]]
- 2 edges to [[_COMMUNITY_Module ws.server.ts]]
- 2 edges to [[_COMMUNITY_Module session.manager.ts]]
- 2 edges to [[_COMMUNITY_Module param.extractor.ts]]
- 1 edge to [[_COMMUNITY_Module agent-engine.ts]]
- 1 edge to [[_COMMUNITY_Module openclaude.client.ts]]
- 1 edge to [[_COMMUNITY_Module main.rs]]
- 1 edge to [[_COMMUNITY_Module search.service.ts]]

## Top bridge nodes
- [[ollama.client.ts]] - degree 14, connects to 5 communities
- [[health.routes.ts]] - degree 10, connects to 3 communities
- [[lancedb.adapter.ts]] - degree 10, connects to 3 communities
- [[embedder.ts]] - degree 6, connects to 1 community
- [[offline.adapter.ts]] - degree 5, connects to 1 community