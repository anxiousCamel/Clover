---
type: community
cohesion: 0.13
members: 22
---

# Agent Pipeline Dispatch

**Cohesion:** 0.13 - loosely connected
**Members:** 22 nodes

## Members
- [[.constructor()_1]] - code - apps\backend\src\agents\agent-engine.ts
- [[.constructor()]] - code - apps\backend\src\agents\agent-engine.ts
- [[NoMatchingAgentError]] - code - apps\backend\src\agents\agent-engine.ts
- [[ToolNotAllowedError]] - code - apps\backend\src\agents\agent-engine.ts
- [[agent-engine.test.ts]] - code - apps\backend\src\agents\__tests__\agent-engine.test.ts
- [[agent-engine.ts]] - code - apps\backend\src\agents\agent-engine.ts
- [[cancel()]] - code - apps\backend\src\agents\agent-engine.ts
- [[dispatch()]] - code - apps\backend\src\agents\agent-engine.ts
- [[emitStatus()]] - code - apps\backend\src\agents\agent-engine.ts
- [[executePipelineTool()]] - code - apps\backend\src\agents\agent-engine.ts
- [[extractUserMessage()]] - code - apps\backend\src\agents\agent-engine.ts
- [[freshModule()]] - code - apps\backend\src\agents\__tests__\agent-engine.test.ts
- [[getAgent()]] - code - apps\backend\src\agents\agent-engine.ts
- [[handleToolCall()]] - code - apps\backend\src\agents\agent-engine.ts
- [[injectSystemPrompt()]] - code - apps\backend\src\agents\agent-engine.ts
- [[listAgents()]] - code - apps\backend\src\agents\agent-engine.ts
- [[loadAgents()]] - code - apps\backend\src\agents\agent-engine.ts
- [[makeAgent()]] - code - apps\backend\src\agents\__tests__\agent-engine.test.ts
- [[makeRequest()]] - code - apps\backend\src\agents\__tests__\agent-engine.test.ts
- [[matchIntent()]] - code - apps\backend\src\agents\agent-engine.ts
- [[registerAgent()]] - code - apps\backend\src\agents\agent-engine.ts
- [[syncContext()]] - code - apps\backend\src\agents\agent-engine.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Agent_Pipeline_Dispatch
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Context & Execution Routing]]
- 2 edges to [[_COMMUNITY_Session & History Management]]
- 2 edges to [[_COMMUNITY_Tool Plugin Registry]]
- 1 edge to [[_COMMUNITY_Confirmation & System Events]]
- 1 edge to [[_COMMUNITY_Proto Client Logic]]
- 1 edge to [[_COMMUNITY_Memory & Vector Search]]

## Top bridge nodes
- [[agent-engine.ts]] - degree 25, connects to 6 communities
- [[dispatch()]] - degree 10, connects to 1 community
- [[syncContext()]] - degree 3, connects to 1 community