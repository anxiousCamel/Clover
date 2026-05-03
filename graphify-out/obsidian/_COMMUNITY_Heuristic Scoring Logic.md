---
type: community
cohesion: 0.47
members: 10
---

# Heuristic Scoring Logic

**Cohesion:** 0.47 - moderately connected
**Members:** 10 nodes

## Members
- [[evaluateGate()]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[heuristic.gate.ts]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[scoreActionVerb()]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[scoreContentRequest()]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[scoreDeictic()]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[scoreFilePath()]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[scoreFilesystemNoun()]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[scoreImperative()]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[scoreInterrogative()]] - code - apps\backend\src\pipeline\heuristic.gate.ts
- [[stripAccents()]] - code - apps\backend\src\pipeline\heuristic.gate.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Heuristic_Scoring_Logic
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_Context & Execution Routing]]

## Top bridge nodes
- [[heuristic.gate.ts]] - degree 10, connects to 1 community
- [[evaluateGate()]] - degree 10, connects to 1 community