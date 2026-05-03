---
type: community
cohesion: 0.35
members: 11
---

# Template Prompts & Scanning

**Cohesion:** 0.35 - loosely connected
**Members:** 11 nodes

## Members
- [[buildDesignPrompt()]] - code - apps\backend\src\planner\templates\design.prompt.ts
- [[buildRequirementsPrompt()]] - code - apps\backend\src\planner\templates\requirements.prompt.ts
- [[buildTasksPrompt()]] - code - apps\backend\src\planner\templates\tasks.prompt.ts
- [[design.prompt.ts]] - code - apps\backend\src\planner\templates\design.prompt.ts
- [[emitProgress()]] - code - apps\backend\src\planner\planner.service.ts
- [[generate()]] - code - apps\backend\src\planner\planner.service.ts
- [[loadReversaContext()]] - code - apps\backend\src\planner\planner.service.ts
- [[planner.service.ts]] - code - apps\backend\src\planner\planner.service.ts
- [[requirements.prompt.ts]] - code - apps\backend\src\planner\templates\requirements.prompt.ts
- [[scanFileTree()]] - code - apps\backend\src\planner\planner.service.ts
- [[tasks.prompt.ts]] - code - apps\backend\src\planner\templates\tasks.prompt.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Template_Prompts_&_Scanning
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Environment & String Utils]]
- 1 edge to [[_COMMUNITY_Confirmation & System Events]]
- 1 edge to [[_COMMUNITY_Proto Client Logic]]

## Top bridge nodes
- [[planner.service.ts]] - degree 14, connects to 3 communities