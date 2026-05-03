---
source_file: "src\utils\permissions\yoloClassifier.ts"
type: "code"
community: "Module: state.ts"
location: "L1130"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/Module:_state.ts
---

# classifyYoloAction()

## Connections
- [[Boolean()]] - `calls` [INFERRED]
- [[agentToolUtils.ts]] - `imports` [EXTRACTED]
- [[buildClaudeMdMessage()]] - `calls` [EXTRACTED]
- [[buildToolLookup()]] - `calls` [EXTRACTED]
- [[buildYoloSystemPrompt()]] - `calls` [EXTRACTED]
- [[classifyHandoffIfNeeded()]] - `calls` [INFERRED]
- [[classifyYoloActionXml()]] - `calls` [EXTRACTED]
- [[detectPromptTooLong()]] - `calls` [EXTRACTED]
- [[dumpErrorPrompts()]] - `calls` [EXTRACTED]
- [[extractRequestId()]] - `calls` [EXTRACTED]
- [[extractToolUseBlock()]] - `calls` [INFERRED]
- [[getCacheControl()]] - `calls` [INFERRED]
- [[getClassifierModel()]] - `calls` [EXTRACTED]
- [[getClassifierThinkingConfig()]] - `calls` [EXTRACTED]
- [[getDefaultMaxRetries()]] - `calls` [INFERRED]
- [[getTwoStageMode()]] - `calls` [EXTRACTED]
- [[hasPermissionsToUseTool()]] - `calls` [INFERRED]
- [[isTwoStageClassifierEnabled()]] - `calls` [EXTRACTED]
- [[logAutoModeOutcome()]] - `calls` [EXTRACTED]
- [[logForDebugging()]] - `calls` [INFERRED]
- [[maybeDumpAutoMode()]] - `calls` [EXTRACTED]
- [[parseClassifierResponse()]] - `calls` [INFERRED]
- [[permissions.ts_2]] - `imports` [EXTRACTED]
- [[serializeTranscriptForClassifier()]] - `calls` [EXTRACTED]
- [[setLastClassifierRequests()]] - `calls` [INFERRED]
- [[sideQuery()]] - `calls` [INFERRED]
- [[toCompact()]] - `calls` [EXTRACTED]
- [[yoloClassifier.ts]] - `contains` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/Module:_state.ts