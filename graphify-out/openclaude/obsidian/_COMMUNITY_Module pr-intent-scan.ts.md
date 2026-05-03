---
type: community
cohesion: 0.23
members: 16
---

# Module: pr-intent-scan.ts

**Cohesion:** 0.23 - loosely connected
**Members:** 16 nodes

## Members
- [[findCommandFindings()]] - code - scripts\pr-intent-scan.ts
- [[findSensitivePathFindings()]] - code - scripts\pr-intent-scan.ts
- [[findUrlFindings()]] - code - scripts\pr-intent-scan.ts
- [[getGitDiff()]] - code - scripts\pr-intent-scan.ts
- [[hasSuspiciousDownloadIndicators()]] - code - scripts\pr-intent-scan.ts
- [[hostMatches()]] - code - scripts\pr-intent-scan.ts
- [[parseAddedLines()]] - code - scripts\pr-intent-scan.ts
- [[parseOptions()]] - code - scripts\pr-intent-scan.ts
- [[pr-intent-scan.ts]] - code - scripts\pr-intent-scan.ts
- [[renderText()]] - code - scripts\pr-intent-scan.ts
- [[run()]] - code - scripts\pr-intent-scan.ts
- [[scanAddedLines()]] - code - scripts\pr-intent-scan.ts
- [[shouldFail()]] - code - scripts\pr-intent-scan.ts
- [[trimExcerpt()]] - code - scripts\pr-intent-scan.ts
- [[tryParseUrl()]] - code - scripts\pr-intent-scan.ts
- [[uniqueFindings()]] - code - scripts\pr-intent-scan.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_pr-intent-scan.ts
SORT file.name ASC
```
