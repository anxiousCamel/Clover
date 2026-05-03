---
type: community
cohesion: 0.09
members: 37
---

# Environment & String Utils

**Cohesion:** 0.09 - loosely connected
**Members:** 37 nodes

## Members
- [[.constructor()_2]] - code - apps\backend\src\confirmation\confirmation.bus.ts
- [[ConfirmationTimeoutError]] - code - apps\backend\src\confirmation\confirmation.bus.ts
- [[applyEnvOverrides()]] - code - apps\backend\src\config\config.ts
- [[chunker.ts]] - code - apps\backend\src\memory\chunker.ts
- [[coerce()]] - code - apps\backend\src\config\config.ts
- [[config.ts]] - code - apps\backend\src\config\config.ts
- [[confirmation.bus.test.ts]] - code - apps\backend\src\confirmation\__tests__\confirmation.bus.test.ts
- [[confirmation.bus.ts]] - code - apps\backend\src\confirmation\confirmation.bus.ts
- [[exists()]] - code - apps\backend\src\tools\plugins\reversa-ingest.tool.ts
- [[fileExists()]] - code - apps\backend\src\memory\obsidian.adapter.ts
- [[formatChunks()]] - code - apps\backend\src\tools\plugins\search-memory.tool.ts
- [[indexFile()]] - code - apps\backend\src\memory\memory.service.ts
- [[indexFileWithSource()]] - code - apps\backend\src\tools\plugins\reversa-ingest.tool.ts
- [[indexText()]] - code - apps\backend\src\memory\memory.service.ts
- [[ingestDirectory()]] - code - apps\backend\src\memory\memory.service.ts
- [[ingestDirectoryWithSource()]] - code - apps\backend\src\tools\plugins\reversa-ingest.tool.ts
- [[makeRequest()_1]] - code - apps\backend\src\confirmation\__tests__\confirmation.bus.test.ts
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
TABLE source_file, type FROM #community/Environment_&_String_Utils
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Confirmation & System Events]]
- 4 edges to [[_COMMUNITY_Memory & Vector Search]]
- 3 edges to [[_COMMUNITY_Session & History Management]]
- 2 edges to [[_COMMUNITY_Proto Client Logic]]
- 2 edges to [[_COMMUNITY_Tool Plugin Registry]]
- 2 edges to [[_COMMUNITY_Template Prompts & Scanning]]
- 1 edge to [[_COMMUNITY_Command Execution & Guard]]
- 1 edge to [[_COMMUNITY_String & Workspace Errors]]
- 1 edge to [[_COMMUNITY_Context & Execution Routing]]

## Top bridge nodes
- [[memory.service.ts]] - degree 21, connects to 5 communities
- [[config.ts]] - degree 15, connects to 5 communities
- [[confirmation.bus.ts]] - degree 8, connects to 3 communities
- [[obsidian.adapter.ts]] - degree 7, connects to 1 community
- [[vault.watcher.ts]] - degree 6, connects to 1 community