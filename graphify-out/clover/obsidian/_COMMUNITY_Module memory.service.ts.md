---
type: community
cohesion: 0.09
members: 35
---

# Module: memory.service.ts

**Cohesion:** 0.09 - loosely connected
**Members:** 35 nodes

## Members
- [[.constructor()_2]] - code - apps\backend\src\confirmation\confirmation.bus.ts
- [[ConfirmationTimeoutError]] - code - apps\backend\src\confirmation\confirmation.bus.ts
- [[applyEnvOverrides()]] - code - apps\backend\src\config\config.ts
- [[chunker.ts]] - code - apps\backend\src\memory\chunker.ts
- [[coerce()]] - code - apps\backend\src\config\config.ts
- [[config.ts]] - code - apps\backend\src\config\config.ts
- [[confirmation.bus.ts]] - code - apps\backend\src\confirmation\confirmation.bus.ts
- [[exists()]] - code - apps\backend\src\tools\plugins\reversa-ingest.tool.ts
- [[fileExists()]] - code - apps\backend\src\memory\obsidian.adapter.ts
- [[formatChunks()]] - code - apps\backend\src\tools\plugins\search-memory.tool.ts
- [[indexFile()]] - code - apps\backend\src\memory\memory.service.ts
- [[indexFileWithSource()]] - code - apps\backend\src\tools\plugins\reversa-ingest.tool.ts
- [[indexText()]] - code - apps\backend\src\memory\memory.service.ts
- [[ingestDirectory()]] - code - apps\backend\src\memory\memory.service.ts
- [[ingestDirectoryWithSource()]] - code - apps\backend\src\tools\plugins\reversa-ingest.tool.ts
- [[memory-write.tool.ts]] - code - apps\backend\src\tools\plugins\memory-write.tool.ts
- [[memory.service.ts]] - code - apps\backend\src\memory\memory.service.ts
- [[obsidian.adapter.ts]] - code - apps\backend\src\memory\obsidian.adapter.ts
- [[push()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[read()]] - code - apps\backend\src\memory\obsidian.adapter.ts
- [[request()]] - code - apps\backend\src\confirmation\confirmation.bus.ts
- [[resolve()]] - code - apps\backend\src\confirmation\confirmation.bus.ts
- [[resolveVaultPath()]] - code - apps\backend\src\memory\obsidian.adapter.ts
- [[reversa-ingest.tool.ts]] - code - apps\backend\src\tools\plugins\reversa-ingest.tool.ts
- [[search()]] - code - apps\backend\src\memory\memory.service.ts
- [[search-memory.tool.ts]] - code - apps\backend\src\tools\plugins\search-memory.tool.ts
- [[snapToSentenceBoundary()]] - code - apps\backend\src\memory\chunker.ts
- [[split()]] - code - apps\backend\src\memory\chunker.ts
- [[start()_1]] - code - apps\backend\src\memory\vault.watcher.ts
- [[stop()_1]] - code - apps\backend\src\memory\vault.watcher.ts
- [[toEnvKey()]] - code - apps\backend\src\config\config.ts
- [[toVectorChunks()]] - code - apps\backend\src\memory\memory.service.ts
- [[vault.watcher.ts]] - code - apps\backend\src\memory\vault.watcher.ts
- [[writeNote()]] - code - apps\backend\src\memory\memory.service.ts
- [[writeNote()_1]] - code - apps\backend\src\memory\obsidian.adapter.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_memory.service.ts
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Module ws.server.ts]]
- 4 edges to [[_COMMUNITY_Module ollama.client.ts]]
- 2 edges to [[_COMMUNITY_Storage & Persistence]]
- 2 edges to [[_COMMUNITY_Module openclaude.client.ts]]
- 2 edges to [[_COMMUNITY_Module agent-engine.ts]]
- 2 edges to [[_COMMUNITY_Module planner.service.ts]]
- 1 edge to [[_COMMUNITY_Module exec-guard.ts]]
- 1 edge to [[_COMMUNITY_Module session.manager.ts]]
- 1 edge to [[_COMMUNITY_Module param.extractor.ts]]

## Top bridge nodes
- [[config.ts]] - degree 15, connects to 6 communities
- [[memory.service.ts]] - degree 21, connects to 5 communities
- [[confirmation.bus.ts]] - degree 6, connects to 2 communities
- [[obsidian.adapter.ts]] - degree 7, connects to 1 community
- [[vault.watcher.ts]] - degree 6, connects to 1 community