---
type: community
cohesion: 0.11
members: 44
---

# Context & Execution Routing

**Cohesion:** 0.11 - loosely connected
**Members:** 44 nodes

## Members
- [[buildPrompt()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[buildToolArgs()]] - code - apps\backend\src\pipeline\execution.router.ts
- [[cacheGet()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[cacheSet()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[classifyIntent()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[clearClassifyCache()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[clearContext()]] - code - apps\backend\src\pipeline\context.store.ts
- [[context.store.ts]] - code - apps\backend\src\pipeline\context.store.ts
- [[detectNewIntentSignal()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[execution.router.ts]] - code - apps\backend\src\pipeline\execution.router.ts
- [[extractDeleteParams()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[extractExecuteParams()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[extractListParams()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[extractNaturalFilename()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[extractParams()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[extractPathFromText()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[extractReadParams()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[extractWriteParams()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[generateContent()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[getCacheStats()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[getContext()]] - code - apps\backend\src\pipeline\context.store.ts
- [[hasDeictic()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[index.ts_1]] - code - apps\backend\src\pipeline\index.ts
- [[intent.classifier.ts]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[intent.types.ts]] - code - apps\backend\src\pipeline\intent.types.ts
- [[isPurelyDeictic()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[listSessions()]] - code - apps\backend\src\pipeline\context.store.ts
- [[normalizeKey()]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[param.extractor.ts]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[pipeline.logger.ts]] - code - apps\backend\src\pipeline\pipeline.logger.ts
- [[pipelineLog()]] - code - apps\backend\src\pipeline\pipeline.logger.ts
- [[resolveFilePath()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[resolvePath()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[resolveWellKnownLocation()]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[routeExecution()]] - code - apps\backend\src\pipeline\execution.router.ts
- [[runPipeline()]] - code - apps\backend\src\pipeline\index.ts
- [[setLastFilePath()]] - code - apps\backend\src\pipeline\context.store.ts
- [[setLastGeneratedContent()]] - code - apps\backend\src\pipeline\context.store.ts
- [[setLastIntent()]] - code - apps\backend\src\pipeline\context.store.ts
- [[stripAccents()_1]] - code - apps\backend\src\pipeline\intent.classifier.ts
- [[stripAccents()_2]] - code - apps\backend\src\pipeline\param.extractor.ts
- [[updateContext()]] - code - apps\backend\src\pipeline\context.store.ts
- [[validateBeforeExecution()]] - code - apps\backend\src\pipeline\execution.router.ts
- [[validatePath()]] - code - apps\backend\src\pipeline\param.extractor.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Context_&_Execution_Routing
SORT file.name ASC
```

## Connections to other communities
- 5 edges to [[_COMMUNITY_Agent Pipeline Dispatch]]
- 3 edges to [[_COMMUNITY_Heuristic Scoring Logic]]
- 2 edges to [[_COMMUNITY_Session & History Management]]
- 2 edges to [[_COMMUNITY_Memory & Vector Search]]
- 1 edge to [[_COMMUNITY_Environment & String Utils]]

## Top bridge nodes
- [[index.ts_1]] - degree 17, connects to 3 communities
- [[runPipeline()]] - degree 10, connects to 2 communities
- [[param.extractor.ts]] - degree 21, connects to 1 community
- [[intent.classifier.ts]] - degree 15, connects to 1 community
- [[updateContext()]] - degree 8, connects to 1 community