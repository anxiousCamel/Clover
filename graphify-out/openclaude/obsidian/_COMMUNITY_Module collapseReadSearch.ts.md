---
type: community
cohesion: 0.06
members: 75
---

# Module: collapseReadSearch.ts

**Cohesion:** 0.06 - loosely connected
**Members:** 75 nodes

## Members
- [[MessageModel()]] - code - src\components\MessageModel.tsx
- [[MessageRow.tsx]] - code - src\components\MessageRow.tsx
- [[MessageRowImpl()]] - code - src\components\MessageRow.tsx
- [[MessageTimestamp()]] - code - src\components\MessageTimestamp.tsx
- [[_temp()_23]] - code - src\components\MessageRow.tsx
- [[allToolsResolved()]] - code - src\components\MessageRow.tsx
- [[areMessageRowPropsEqual()]] - code - src\components\MessageRow.tsx
- [[collapseReadSearch.ts]] - code - src\utils\collapseReadSearch.ts
- [[collapseReadSearchGroups()]] - code - src\utils\collapseReadSearch.ts
- [[commandAsHint()]] - code - src\utils\collapseReadSearch.ts
- [[commentLabel.ts]] - code - src\tools\BashTool\commentLabel.ts
- [[countToolUses()_1]] - code - src\utils\collapseReadSearch.ts
- [[createCollapsedGroup()]] - code - src\utils\collapseReadSearch.ts
- [[createEmptyGroup()]] - code - src\utils\collapseReadSearch.ts
- [[detectGitOperation()]] - code - src\tools\shared\gitOperationTracking.ts
- [[detectSessionFileType()_1]] - code - src\utils\memoryFileDetection.ts
- [[detectSessionPatternType()]] - code - src\utils\memoryFileDetection.ts
- [[extractBashCommentLabel()]] - code - src\tools\BashTool\commentLabel.ts
- [[findPrInStdout()]] - code - src\tools\shared\gitOperationTracking.ts
- [[getCollapsibleToolInfo()]] - code - src\utils\collapseReadSearch.ts
- [[getCommitCounter()]] - code - src\bootstrap\state.ts
- [[getDisplayMessageFromCollapsed()]] - code - src\utils\collapseReadSearch.ts
- [[getFilePathFromInput()]] - code - src\utils\sessionFileAccessHooks.ts
- [[getFilePathFromToolInput()]] - code - src\utils\collapseReadSearch.ts
- [[getFilePathsFromReadMessage()]] - code - src\utils\collapseReadSearch.ts
- [[getMemoryBaseDir()]] - code - src\memdir\paths.ts
- [[getPrCounter()]] - code - src\bootstrap\state.ts
- [[getProgressMessagesFromLookup()]] - code - src\utils\messages.ts
- [[getReplPrimitiveTools()]] - code - src\tools\REPLTool\primitiveTools.ts
- [[getSearchOrReadFromContent()]] - code - src\utils\collapseReadSearch.ts
- [[getSessionFileTypeFromInput()]] - code - src\utils\sessionFileAccessHooks.ts
- [[getSiblingToolUseIDs()]] - code - src\utils\messages.ts
- [[getSiblingToolUseIDsFromLookup()]] - code - src\utils\messages.ts
- [[getSubagentLogName()]] - code - src\utils\agentContext.ts
- [[getToolSearchOrReadInfo()]] - code - src\utils\collapseReadSearch.ts
- [[getToolUseID()]] - code - src\utils\messages.ts
- [[getToolUseIdsFromCollapsedGroup()]] - code - src\utils\collapseReadSearch.ts
- [[getToolUseIdsFromMessage()]] - code - src\utils\collapseReadSearch.ts
- [[gitCmdRe()]] - code - src\tools\shared\gitOperationTracking.ts
- [[gitOperationTracking.ts]] - code - src\tools\shared\gitOperationTracking.ts
- [[handleSessionFileAccess()]] - code - src\utils\sessionFileAccessHooks.ts
- [[hasAnyToolInProgress()]] - code - src\utils\collapseReadSearch.ts
- [[hasContentAfterIndex()]] - code - src\components\MessageRow.tsx
- [[isAgentMemFile()]] - code - src\utils\memoryFileDetection.ts
- [[isAutoManagedMemoryFile()]] - code - src\utils\memoryFileDetection.ts
- [[isAutoManagedMemoryPattern()]] - code - src\utils\memoryFileDetection.ts
- [[isAutoMemFile()]] - code - src\utils\memoryFileDetection.ts
- [[isAutoMemoryEnabled()]] - code - src\memdir\paths.ts
- [[isCollapsibleToolResult()]] - code - src\utils\collapseReadSearch.ts
- [[isCollapsibleToolUse()]] - code - src\utils\collapseReadSearch.ts
- [[isMemoryDirectory()]] - code - src\utils\memoryFileDetection.ts
- [[isMemoryFileAccess()]] - code - src\utils\sessionFileAccessHooks.ts
- [[isMemorySearch()]] - code - src\utils\collapseReadSearch.ts
- [[isMemoryWriteOrEdit()]] - code - src\utils\collapseReadSearch.ts
- [[isMessageStreaming()]] - code - src\components\MessageRow.tsx
- [[isNonCollapsibleToolUse()]] - code - src\utils\collapseReadSearch.ts
- [[isPreToolHookSummary()]] - code - src\utils\collapseReadSearch.ts
- [[isShellCommandTargetingMemory()]] - code - src\utils\memoryFileDetection.ts
- [[isSubagentContext()]] - code - src\utils\agentContext.ts
- [[isTextBreaker()]] - code - src\utils\collapseReadSearch.ts
- [[isToolSearchOrRead()]] - code - src\utils\collapseReadSearch.ts
- [[memoryFileDetection.ts]] - code - src\utils\memoryFileDetection.ts
- [[memoryScopeForPath()]] - code - src\utils\memoryFileDetection.ts
- [[parseGitPushBranch()]] - code - src\tools\shared\gitOperationTracking.ts
- [[parsePrNumberFromText()]] - code - src\tools\shared\gitOperationTracking.ts
- [[parsePrUrl()]] - code - src\tools\shared\gitOperationTracking.ts
- [[parseRefFromCommand()]] - code - src\tools\shared\gitOperationTracking.ts
- [[registerHookCallbacks()]] - code - src\bootstrap\state.ts
- [[registerSessionFileAccessHooks()]] - code - src\utils\sessionFileAccessHooks.ts
- [[scanBashResultForGitOps()]] - code - src\utils\collapseReadSearch.ts
- [[sessionFileAccessHooks.ts]] - code - src\utils\sessionFileAccessHooks.ts
- [[shouldSkipMessage()]] - code - src\utils\collapseReadSearch.ts
- [[toComparable()]] - code - src\utils\memoryFileDetection.ts
- [[toPosix()]] - code - src\utils\memoryFileDetection.ts
- [[trackGitOperations()]] - code - src\tools\shared\gitOperationTracking.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_collapseReadSearch.ts
SORT file.name ASC
```

## Connections to other communities
- 44 edges to [[_COMMUNITY_Module ink.ts]]
- 41 edges to [[_COMMUNITY_Module main.tsx]]
- 16 edges to [[_COMMUNITY_Module logForDebugging()]]
- 9 edges to [[_COMMUNITY_Module messages.ts]]
- 9 edges to [[_COMMUNITY_Module log.ts]]
- 7 edges to [[_COMMUNITY_Module String()]]
- 6 edges to [[_COMMUNITY_Module state.ts]]
- 4 edges to [[_COMMUNITY_Module logEvent()]]
- 3 edges to [[_COMMUNITY_Module autoDream.ts]]
- 3 edges to [[_COMMUNITY_Module toolExecution.ts]]
- 3 edges to [[_COMMUNITY_Module prompts.ts]]
- 2 edges to [[_COMMUNITY_Module REPL.tsx]]
- 1 edge to [[_COMMUNITY_Module commands.ts]]
- 1 edge to [[_COMMUNITY_Module hooks.ts]]

## Top bridge nodes
- [[isAutoMemoryEnabled()]] - degree 37, connects to 7 communities
- [[sessionFileAccessHooks.ts]] - degree 30, connects to 7 communities
- [[gitOperationTracking.ts]] - degree 18, connects to 5 communities
- [[collapseReadSearch.ts]] - degree 56, connects to 4 communities
- [[MessageRow.tsx]] - degree 23, connects to 4 communities