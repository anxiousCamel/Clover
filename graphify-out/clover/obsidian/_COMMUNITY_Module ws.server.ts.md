---
type: community
cohesion: 0.09
members: 34
---

# Module: ws.server.ts

**Cohesion:** 0.09 - loosely connected
**Members:** 34 nodes

## Members
- [[addConnection()]] - code - apps\backend\src\gateway\ws.server.ts
- [[boot()_1]] - code - apps\backend\src\index.ts
- [[buildTree()]] - code - apps\backend\src\gateway\routes\files.routes.ts
- [[chat.routes.ts]] - code - apps\backend\src\gateway\routes\chat.routes.ts
- [[chatRoutes()]] - code - apps\backend\src\gateway\routes\chat.routes.ts
- [[connections()]] - code - apps\backend\src\gateway\ws.server.ts
- [[countOccurrences()]] - code - apps\backend\src\gateway\routes\files.routes.ts
- [[emit()]] - code - apps\backend\src\gateway\ws.server.ts
- [[files.routes.ts]] - code - apps\backend\src\gateway\routes\files.routes.ts
- [[filesRoutes()]] - code - apps\backend\src\gateway\routes\files.routes.ts
- [[getDefaultShell()]] - code - apps\backend\src\gateway\routes\terminal.routes.ts
- [[getWorkspacePath()]] - code - apps\backend\src\gateway\routes\files.routes.ts
- [[handleIncomingMessage()]] - code - apps\backend\src\gateway\ws.server.ts
- [[http.server.ts]] - code - apps\backend\src\gateway\http.server.ts
- [[index.ts]] - code - apps\backend\src\index.ts
- [[memory.routes.ts]] - code - apps\backend\src\gateway\routes\memory.routes.ts
- [[memoryRoutes()]] - code - apps\backend\src\gateway\routes\memory.routes.ts
- [[onEvent()]] - code - apps\backend\src\gateway\ws.server.ts
- [[planner.routes.ts]] - code - apps\backend\src\gateway\routes\planner.routes.ts
- [[plannerRoutes()]] - code - apps\backend\src\gateway\routes\planner.routes.ts
- [[register()]] - code - apps\backend\src\gateway\ws.server.ts
- [[registerRoutes()]] - code - apps\backend\src\gateway\http.server.ts
- [[registerShutdownHandlers()]] - code - apps\backend\src\index.ts
- [[removeConnection()]] - code - apps\backend\src\gateway\ws.server.ts
- [[requestConfirmation()]] - code - apps\backend\src\gateway\ws.server.ts
- [[resolveAndValidate()]] - code - apps\backend\src\gateway\routes\files.routes.ts
- [[shutdown()]] - code - apps\backend\src\index.ts
- [[spawnTerminal()]] - code - apps\backend\src\gateway\routes\terminal.routes.ts
- [[start()]] - code - apps\backend\src\gateway\http.server.ts
- [[stop()]] - code - apps\backend\src\gateway\http.server.ts
- [[terminal.routes.ts]] - code - apps\backend\src\gateway\routes\terminal.routes.ts
- [[terminalRoutes()]] - code - apps\backend\src\gateway\routes\terminal.routes.ts
- [[wireConfirmationHandlers()]] - code - apps\backend\src\gateway\ws.server.ts
- [[ws.server.ts]] - code - apps\backend\src\gateway\ws.server.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_ws.server.ts
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Module memory.service.ts]]
- 3 edges to [[_COMMUNITY_Storage & Persistence]]
- 3 edges to [[_COMMUNITY_Module session.manager.ts]]
- 3 edges to [[_COMMUNITY_Module agent-engine.ts]]
- 2 edges to [[_COMMUNITY_Module ollama.client.ts]]
- 1 edge to [[_COMMUNITY_Module planner.service.ts]]

## Top bridge nodes
- [[index.ts]] - degree 16, connects to 5 communities
- [[registerRoutes()]] - degree 9, connects to 2 communities
- [[chat.routes.ts]] - degree 6, connects to 2 communities
- [[ws.server.ts]] - degree 16, connects to 1 community
- [[http.server.ts]] - degree 5, connects to 1 community