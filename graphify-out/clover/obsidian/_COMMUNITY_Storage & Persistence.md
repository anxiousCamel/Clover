---
type: community
cohesion: 0.10
members: 33
---

# Storage & Persistence

**Cohesion:** 0.10 - loosely connected
**Members:** 33 nodes

## Members
- [[.close()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.constructor()_6]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.createSchema()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.createSession()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.deleteSession()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.ensureReady()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.getHistory()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.getSession()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.getTask()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.getTaskBySession()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.init()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.logToolExecution()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.persist()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.saveMessage()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.saveTask()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[.updateModel()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[SQLiteStore]] - code - apps\backend\src\storage\sqlite.store.ts
- [[boot()]] - code - apps\backend\src\cli.ts
- [[chat()]] - code - apps\backend\src\cli.ts
- [[cli.ts]] - code - apps\backend\src\cli.ts
- [[createTask()]] - code - apps\backend\src\orchestrator\task.service.ts
- [[findWorkspaceRoot()]] - code - apps\backend\src\cli.ts
- [[getActiveTask()]] - code - apps\backend\src\orchestrator\task.service.ts
- [[init()_2]] - code - apps\backend\src\orchestrator\task.service.ts
- [[initPipelineLogger()]] - code - apps\backend\src\pipeline\pipeline.logger.ts
- [[main()]] - code - apps\backend\src\cli.ts
- [[recordAttempt()]] - code - apps\backend\src\orchestrator\task.service.ts
- [[renderBanner()]] - code - apps\backend\src\cli.ts
- [[rowToObject()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[sqlite.store.ts]] - code - apps\backend\src\storage\sqlite.store.ts
- [[task.service.ts]] - code - apps\backend\src\orchestrator\task.service.ts
- [[updateStep()]] - code - apps\backend\src\orchestrator\task.service.ts
- [[verifySuccess()]] - code - apps\backend\src\orchestrator\task.service.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Storage_&_Persistence
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Module session.manager.ts]]
- 3 edges to [[_COMMUNITY_Module agent-engine.ts]]
- 3 edges to [[_COMMUNITY_Module ws.server.ts]]
- 2 edges to [[_COMMUNITY_Module memory.service.ts]]
- 2 edges to [[_COMMUNITY_Module ollama.client.ts]]
- 2 edges to [[_COMMUNITY_Module param.extractor.ts]]

## Top bridge nodes
- [[cli.ts]] - degree 16, connects to 5 communities
- [[task.service.ts]] - degree 12, connects to 3 communities
- [[SQLiteStore]] - degree 21, connects to 2 communities
- [[sqlite.store.ts]] - degree 6, connects to 2 communities
- [[initPipelineLogger()]] - degree 2, connects to 1 community