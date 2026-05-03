---
type: community
cohesion: 0.18
members: 17
---

# Tool Plugin Registry

**Cohesion:** 0.18 - loosely connected
**Members:** 17 nodes

## Members
- [[.constructor()_9]] - code - apps\backend\src\tools\tool-registry.ts
- [[.constructor()_10]] - code - apps\backend\src\tools\tool-registry.ts
- [[ToolNotFoundError]] - code - apps\backend\src\tools\tool-registry.ts
- [[ToolValidationError]] - code - apps\backend\src\tools\tool-registry.ts
- [[buildToolList()]] - code - apps\backend\src\orchestrator\orchestrator.ts
- [[execute()]] - code - apps\backend\src\tools\tool-registry.ts
- [[executeWithPlugin()]] - code - apps\backend\src\tools\__tests__\tool-registry.test.ts
- [[getPlugin()]] - code - apps\backend\src\tools\tool-registry.ts
- [[handle()]] - code - apps\backend\src\orchestrator\orchestrator.ts
- [[indexTurn()]] - code - apps\backend\src\orchestrator\orchestrator.ts
- [[listTools()]] - code - apps\backend\src\tools\tool-registry.ts
- [[loadPlugins()]] - code - apps\backend\src\tools\tool-registry.ts
- [[makeFakePlugin()]] - code - apps\backend\src\tools\__tests__\tool-registry.test.ts
- [[makeToolContext()]] - code - apps\backend\src\tools\__tests__\tool-registry.test.ts
- [[orchestrator.ts]] - code - apps\backend\src\orchestrator\orchestrator.ts
- [[tool-registry.test.ts]] - code - apps\backend\src\tools\__tests__\tool-registry.test.ts
- [[tool-registry.ts]] - code - apps\backend\src\tools\tool-registry.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Tool_Plugin_Registry
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Session & History Management]]
- 2 edges to [[_COMMUNITY_Confirmation & System Events]]
- 2 edges to [[_COMMUNITY_Agent Pipeline Dispatch]]
- 2 edges to [[_COMMUNITY_Environment & String Utils]]

## Top bridge nodes
- [[tool-registry.ts]] - degree 12, connects to 4 communities
- [[orchestrator.ts]] - degree 8, connects to 4 communities