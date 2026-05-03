---
type: community
cohesion: 0.09
members: 31
---

# Module: agent-engine.ts

**Cohesion:** 0.09 - loosely connected
**Members:** 31 nodes

## Members
- [[.constructor()_1]] - code - apps\backend\src\agents\agent-engine.ts
- [[.constructor()]] - code - apps\backend\src\agents\agent-engine.ts
- [[.constructor()_7]] - code - apps\backend\src\tools\tool-registry.ts
- [[.constructor()_8]] - code - apps\backend\src\tools\tool-registry.ts
- [[NoMatchingAgentError]] - code - apps\backend\src\agents\agent-engine.ts
- [[ToolNotAllowedError]] - code - apps\backend\src\agents\agent-engine.ts
- [[ToolNotFoundError]] - code - apps\backend\src\tools\tool-registry.ts
- [[ToolValidationError]] - code - apps\backend\src\tools\tool-registry.ts
- [[agent-engine.ts]] - code - apps\backend\src\agents\agent-engine.ts
- [[buildToolList()]] - code - apps\backend\src\orchestrator\orchestrator.ts
- [[cancel()]] - code - apps\backend\src\agents\agent-engine.ts
- [[dispatch()]] - code - apps\backend\src\agents\agent-engine.ts
- [[emitStatus()]] - code - apps\backend\src\agents\agent-engine.ts
- [[execute()]] - code - apps\backend\src\tools\tool-registry.ts
- [[executePipelineTool()]] - code - apps\backend\src\agents\agent-engine.ts
- [[extractUserMessage()]] - code - apps\backend\src\agents\agent-engine.ts
- [[getAgent()]] - code - apps\backend\src\agents\agent-engine.ts
- [[getPlugin()]] - code - apps\backend\src\tools\tool-registry.ts
- [[handle()]] - code - apps\backend\src\orchestrator\orchestrator.ts
- [[handleToolCall()]] - code - apps\backend\src\agents\agent-engine.ts
- [[indexTurn()]] - code - apps\backend\src\orchestrator\orchestrator.ts
- [[injectSystemPrompt()]] - code - apps\backend\src\agents\agent-engine.ts
- [[listAgents()]] - code - apps\backend\src\agents\agent-engine.ts
- [[listTools()]] - code - apps\backend\src\tools\tool-registry.ts
- [[loadAgents()]] - code - apps\backend\src\agents\agent-engine.ts
- [[loadPlugins()]] - code - apps\backend\src\tools\tool-registry.ts
- [[matchIntent()]] - code - apps\backend\src\agents\agent-engine.ts
- [[orchestrator.ts]] - code - apps\backend\src\orchestrator\orchestrator.ts
- [[registerAgent()]] - code - apps\backend\src\agents\agent-engine.ts
- [[syncContext()]] - code - apps\backend\src\agents\agent-engine.ts
- [[tool-registry.ts]] - code - apps\backend\src\tools\tool-registry.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_agent-engine.ts
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Module param.extractor.ts]]
- 3 edges to [[_COMMUNITY_Storage & Persistence]]
- 3 edges to [[_COMMUNITY_Module ws.server.ts]]
- 2 edges to [[_COMMUNITY_Module memory.service.ts]]
- 1 edge to [[_COMMUNITY_Module openclaude.client.ts]]
- 1 edge to [[_COMMUNITY_Module ollama.client.ts]]
- 1 edge to [[_COMMUNITY_Module session.manager.ts]]

## Top bridge nodes
- [[agent-engine.ts]] - degree 24, connects to 5 communities
- [[tool-registry.ts]] - degree 11, connects to 3 communities
- [[orchestrator.ts]] - degree 8, connects to 3 communities
- [[dispatch()]] - degree 10, connects to 1 community
- [[syncContext()]] - degree 3, connects to 1 community