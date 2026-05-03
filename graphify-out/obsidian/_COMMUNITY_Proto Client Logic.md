---
type: community
cohesion: 0.10
members: 27
---

# Proto Client Logic

**Cohesion:** 0.10 - loosely connected
**Members:** 27 nodes

## Members
- [[agents.ts]] - code - shared\types\agents.ts
- [[coder.agent.ts]] - code - apps\backend\src\agents\coder\coder.agent.ts
- [[complete()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[config.ts_1]] - code - shared\types\config.ts
- [[createClient()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[ensureProto()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[general.agent.ts]] - code - apps\backend\src\agents\general\general.agent.ts
- [[getAddress()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[getClient()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[index.ts_2]] - code - shared\protos\generated\index.ts
- [[index.ts_3]] - code - shared\types\index.ts
- [[loadOpenClaudeProto()]] - code - shared\protos\loader.ts
- [[loader.ts]] - code - shared\protos\loader.ts
- [[mapChunk()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[mapResponse()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[matchesIntent()_5]] - code - apps\backend\src\agents\coder\coder.agent.ts
- [[memory.ts]] - code - shared\types\memory.ts
- [[messages.ts]] - code - shared\types\messages.ts
- [[openclaude.client.ts]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[openclaude.ts]] - code - shared\protos\generated\openclaude.ts
- [[reconnect()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[search.ts]] - code - shared\types\search.ts
- [[shared-types.test.ts]] - code - shared\types\__tests__\shared-types.test.ts
- [[toProtoRequest()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[tools.ts]] - code - shared\types\tools.ts
- [[tryReconnectOnState()]] - code - apps\backend\src\openclaude\openclaude.client.ts
- [[watchChannelState()]] - code - apps\backend\src\openclaude\openclaude.client.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Proto_Client_Logic
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Environment & String Utils]]
- 1 edge to [[_COMMUNITY_Agent Pipeline Dispatch]]
- 1 edge to [[_COMMUNITY_Memory & Vector Search]]
- 1 edge to [[_COMMUNITY_Template Prompts & Scanning]]

## Top bridge nodes
- [[openclaude.client.ts]] - degree 16, connects to 4 communities