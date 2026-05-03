---
type: community
cohesion: 0.06
members: 50
---

# Session & History Management

**Cohesion:** 0.06 - loosely connected
**Members:** 50 nodes

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
- [[buildContextWindow()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[chat()]] - code - apps\backend\src\cli.ts
- [[cli.ts]] - code - apps\backend\src\cli.ts
- [[compressHistory()]] - code - apps\backend\src\orchestrator\context-compressor.ts
- [[context-compressor.ts]] - code - apps\backend\src\orchestrator\context-compressor.ts
- [[createSession()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[createTask()]] - code - apps\backend\src\orchestrator\task.service.ts
- [[deleteSession()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[findWorkspaceRoot()]] - code - apps\backend\src\cli.ts
- [[formatMemoryChunks()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[getActiveTask()]] - code - apps\backend\src\orchestrator\task.service.ts
- [[getModel()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[getSession()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[init()_1]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[init()_2]] - code - apps\backend\src\orchestrator\task.service.ts
- [[initPipelineLogger()]] - code - apps\backend\src\pipeline\pipeline.logger.ts
- [[loadHistory()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[main()]] - code - apps\backend\src\cli.ts
- [[models.routes.ts]] - code - apps\backend\src\gateway\routes\models.routes.ts
- [[modelsRoutes()]] - code - apps\backend\src\gateway\routes\models.routes.ts
- [[recordAttempt()]] - code - apps\backend\src\orchestrator\task.service.ts
- [[renderBanner()]] - code - apps\backend\src\cli.ts
- [[rowToObject()]] - code - apps\backend\src\storage\sqlite.store.ts
- [[saveMessage()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[session.manager.test.ts]] - code - apps\backend\src\orchestrator\__tests__\session.manager.test.ts
- [[session.manager.ts]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[setModel()]] - code - apps\backend\src\orchestrator\session.manager.ts
- [[sqlite.store.test.ts]] - code - apps\backend\src\storage\__tests__\sqlite.store.test.ts
- [[sqlite.store.ts]] - code - apps\backend\src\storage\sqlite.store.ts
- [[task.service.ts]] - code - apps\backend\src\orchestrator\task.service.ts
- [[updateStep()]] - code - apps\backend\src\orchestrator\task.service.ts
- [[verifySuccess()]] - code - apps\backend\src\orchestrator\task.service.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Session_&_History_Management
SORT file.name ASC
```

## Connections to other communities
- 6 edges to [[_COMMUNITY_Confirmation & System Events]]
- 4 edges to [[_COMMUNITY_Memory & Vector Search]]
- 3 edges to [[_COMMUNITY_Environment & String Utils]]
- 2 edges to [[_COMMUNITY_Tool Plugin Registry]]
- 2 edges to [[_COMMUNITY_Agent Pipeline Dispatch]]
- 2 edges to [[_COMMUNITY_Context & Execution Routing]]

## Top bridge nodes
- [[cli.ts]] - degree 16, connects to 5 communities
- [[session.manager.ts]] - degree 23, connects to 4 communities
- [[task.service.ts]] - degree 12, connects to 2 communities
- [[models.routes.ts]] - degree 4, connects to 2 communities
- [[SQLiteStore]] - degree 23, connects to 1 community