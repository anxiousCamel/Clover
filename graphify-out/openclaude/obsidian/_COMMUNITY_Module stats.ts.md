---
type: community
cohesion: 0.16
members: 30
---

# Module: stats.ts

**Cohesion:** 0.16 - loosely connected
**Members:** 30 nodes

## Members
- [[aggregateClaudeCodeStats()]] - code - src\utils\stats.ts
- [[aggregateClaudeCodeStatsForRange()]] - code - src\utils\stats.ts
- [[cacheToStats()]] - code - src\utils\stats.ts
- [[calculatePercentiles()]] - code - src\utils\heatmap.ts
- [[calculateStreaks()]] - code - src\utils\stats.ts
- [[extractShotCountFromMessages()]] - code - src\utils\stats.ts
- [[generateHeatmap()]] - code - src\utils\heatmap.ts
- [[getAllSessionFiles()]] - code - src\utils\stats.ts
- [[getEmptyCache()]] - code - src\utils\statsCache.ts
- [[getEmptyStats()]] - code - src\utils\stats.ts
- [[getHeatmapChar()]] - code - src\utils\heatmap.ts
- [[getIntensity()]] - code - src\utils\heatmap.ts
- [[getNextDay()]] - code - src\utils\stats.ts
- [[getStatsCachePath()]] - code - src\utils\statsCache.ts
- [[getTodayDateString()]] - code - src\utils\statsCache.ts
- [[getYesterdayDateString()]] - code - src\utils\statsCache.ts
- [[heatmap.ts]] - code - src\utils\heatmap.ts
- [[isDateBefore()]] - code - src\utils\statsCache.ts
- [[isTranscriptMessage()]] - code - src\utils\sessionStorage.ts
- [[loadStatsCache()]] - code - src\utils\statsCache.ts
- [[mergeCacheWithNewStats()]] - code - src\utils\statsCache.ts
- [[migrateStatsCache()]] - code - src\utils\statsCache.ts
- [[processSessionFiles()]] - code - src\utils\stats.ts
- [[processedStatsToClaudeCodeStats()]] - code - src\utils\stats.ts
- [[readSessionStartDate()]] - code - src\utils\stats.ts
- [[saveStatsCache()]] - code - src\utils\statsCache.ts
- [[stats.ts]] - code - src\utils\stats.ts
- [[statsCache.ts]] - code - src\utils\statsCache.ts
- [[toDateString()]] - code - src\utils\statsCache.ts
- [[withStatsCacheLock()]] - code - src\utils\statsCache.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_stats.ts
SORT file.name ASC
```

## Connections to other communities
- 15 edges to [[_COMMUNITY_Module logForDebugging()]]
- 13 edges to [[_COMMUNITY_Module main.tsx]]
- 7 edges to [[_COMMUNITY_Module log.ts]]
- 6 edges to [[_COMMUNITY_Module REPL.tsx]]
- 5 edges to [[_COMMUNITY_Module ink.ts]]
- 4 edges to [[_COMMUNITY_Module logError()]]
- 1 edge to [[_COMMUNITY_Module messages.ts]]

## Top bridge nodes
- [[stats.ts]] - degree 39, connects to 7 communities
- [[statsCache.ts]] - degree 26, connects to 4 communities
- [[saveStatsCache()]] - degree 8, connects to 3 communities
- [[processSessionFiles()]] - degree 9, connects to 2 communities
- [[loadStatsCache()]] - degree 9, connects to 2 communities