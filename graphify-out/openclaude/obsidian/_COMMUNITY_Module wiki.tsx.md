---
type: community
cohesion: 0.14
members: 34
---

# Module: wiki.tsx

**Cohesion:** 0.14 - loosely connected
**Members:** 34 nodes

## Members
- [[buildArchitectureTemplate()]] - code - src\services\wiki\init.ts
- [[buildIndexTemplate()]] - code - src\services\wiki\init.ts
- [[buildLogEntry()]] - code - src\services\wiki\ingest.ts
- [[buildLogTemplate()]] - code - src\services\wiki\init.ts
- [[buildSchemaTemplate()]] - code - src\services\wiki\init.ts
- [[buildSourceNote()]] - code - src\services\wiki\ingest.ts
- [[call()_71]] - code - src\commands\wiki\wiki.tsx
- [[ensureFile()]] - code - src\services\wiki\init.ts
- [[extractTitleFromText()]] - code - src\services\wiki\utils.ts
- [[formatIngestResult()]] - code - src\commands\wiki\wiki.tsx
- [[formatInitResult()]] - code - src\commands\wiki\wiki.tsx
- [[formatStatus()]] - code - src\commands\wiki\wiki.tsx
- [[getLastUpdatedAt()]] - code - src\services\wiki\status.ts
- [[getPageTitle()]] - code - src\services\wiki\indexBuilder.ts
- [[getWikiPaths()]] - code - src\services\wiki\paths.ts
- [[getWikiStatus()]] - code - src\services\wiki\status.ts
- [[indexBuilder.ts]] - code - src\services\wiki\indexBuilder.ts
- [[ingest.ts]] - code - src\services\wiki\ingest.ts
- [[ingestLocalWikiSource()]] - code - src\services\wiki\ingest.ts
- [[init.ts_2]] - code - src\services\wiki\init.ts
- [[initializeWiki()]] - code - src\services\wiki\init.ts
- [[listMarkdownFiles()]] - code - src\services\wiki\indexBuilder.ts
- [[listMarkdownFiles()_1]] - code - src\services\wiki\status.ts
- [[pathExists()]] - code - src\services\wiki\status.ts
- [[paths.ts_1]] - code - src\services\wiki\paths.ts
- [[rebuildWikiIndex()]] - code - src\services\wiki\indexBuilder.ts
- [[renderHelp()]] - code - src\commands\wiki\wiki.tsx
- [[runWikiCommand()]] - code - src\commands\wiki\wiki.tsx
- [[sanitizeWikiSlug()]] - code - src\services\wiki\utils.ts
- [[status.ts]] - code - src\services\wiki\status.ts
- [[summarizeText()]] - code - src\services\wiki\utils.ts
- [[types.ts_12]] - code - src\services\wiki\types.ts
- [[utils.ts_7]] - code - src\services\wiki\utils.ts
- [[wiki.tsx]] - code - src\commands\wiki\wiki.tsx

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_wiki.tsx
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Module main.tsx]]
- 2 edges to [[_COMMUNITY_Module hooks.ts]]
- 1 edge to [[_COMMUNITY_Module ink.ts]]
- 1 edge to [[_COMMUNITY_Module logForDebugging()]]
- 1 edge to [[_COMMUNITY_Module commands.ts]]

## Top bridge nodes
- [[wiki.tsx]] - degree 16, connects to 3 communities
- [[ingestLocalWikiSource()]] - degree 13, connects to 2 communities
- [[runWikiCommand()]] - degree 11, connects to 2 communities
- [[getPageTitle()]] - degree 2, connects to 1 community