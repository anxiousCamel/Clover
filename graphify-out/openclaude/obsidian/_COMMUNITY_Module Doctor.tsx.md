---
type: community
cohesion: 0.04
members: 88
---

# Module: Doctor.tsx

**Cohesion:** 0.04 - loosely connected
**Members:** 88 nodes

## Members
- [[.drain()_2]] - code - src\utils\task\diskOutput.ts
- [[.drainAllChunks()]] - code - src\utils\task\diskOutput.ts
- [[.queueToBuffers()]] - code - src\utils\task\diskOutput.ts
- [[.readStdoutFromFile()]] - code - src\utils\task\TaskOutput.ts
- [[.spillToDisk()]] - code - src\utils\task\TaskOutput.ts
- [[.tick()]] - code - src\utils\task\TaskOutput.ts
- [[.updateProgress()]] - code - src\utils\task\TaskOutput.ts
- [[.writeAllChunks()]] - code - src\utils\task\diskOutput.ts
- [[.writeBuffered()]] - code - src\utils\task\TaskOutput.ts
- [[.add()_1]] - code - src\utils\CircularBuffer.ts
- [[.addAll()]] - code - src\utils\CircularBuffer.ts
- [[.append()_1]] - code - src\utils\task\diskOutput.ts
- [[.cancel()]] - code - src\utils\task\diskOutput.ts
- [[.clear()_6]] - code - src\utils\task\TaskOutput.ts
- [[.clear()_2]] - code - src\utils\CircularBuffer.ts
- [[.constructor()_107]] - code - src\utils\task\diskOutput.ts
- [[.constructor()_108]] - code - src\utils\task\TaskOutput.ts
- [[.constructor()_67]] - code - src\utils\CircularBuffer.ts
- [[.deleteOutputFile()]] - code - src\utils\task\TaskOutput.ts
- [[.flush()_5]] - code - src\utils\task\diskOutput.ts
- [[.flush()_6]] - code - src\utils\task\TaskOutput.ts
- [[.getRecent()]] - code - src\utils\CircularBuffer.ts
- [[.getStderr()]] - code - src\utils\task\TaskOutput.ts
- [[.getStdout()]] - code - src\utils\task\TaskOutput.ts
- [[.isOverflowed()]] - code - src\utils\task\TaskOutput.ts
- [[.length()]] - code - src\utils\CircularBuffer.ts
- [[.outputFileRedundant()]] - code - src\utils\task\TaskOutput.ts
- [[.outputFileSize()]] - code - src\utils\task\TaskOutput.ts
- [[.startPolling()]] - code - src\utils\task\TaskOutput.ts
- [[.stopPolling()]] - code - src\utils\task\TaskOutput.ts
- [[.toArray()]] - code - src\utils\CircularBuffer.ts
- [[.totalBytes()_1]] - code - src\utils\task\TaskOutput.ts
- [[.totalLines()]] - code - src\utils\task\TaskOutput.ts
- [[.writeStderr()]] - code - src\utils\task\TaskOutput.ts
- [[.writeStdout()]] - code - src\utils\task\TaskOutput.ts
- [[CircularBuffer]] - code - src\utils\CircularBuffer.ts
- [[CircularBuffer.ts]] - code - src\utils\CircularBuffer.ts
- [[DiskTaskOutput]] - code - src\utils\task\diskOutput.ts
- [[DistTagsDisplay()]] - code - src\screens\Doctor.tsx
- [[Doctor.tsx]] - code - src\screens\Doctor.tsx
- [[SandboxDoctorSection()]] - code - src\components\sandbox\SandboxDoctorSection.tsx
- [[SandboxDoctorSection.tsx]] - code - src\components\sandbox\SandboxDoctorSection.tsx
- [[TaskOutput]] - code - src\utils\task\TaskOutput.ts
- [[TaskOutput.ts]] - code - src\utils\task\TaskOutput.ts
- [[_clearOutputsForTest()]] - code - src\utils\task\diskOutput.ts
- [[_resetTaskOutputDirForTest()]] - code - src\utils\task\diskOutput.ts
- [[_temp()_104]] - code - src\screens\Doctor.tsx
- [[_temp10()_2]] - code - src\screens\Doctor.tsx
- [[_temp12()_1]] - code - src\screens\Doctor.tsx
- [[_temp13()_1]] - code - src\screens\Doctor.tsx
- [[_temp2()_50]] - code - src\screens\Doctor.tsx
- [[_temp3()_31]] - code - src\screens\Doctor.tsx
- [[_temp4()_18]] - code - src\screens\Doctor.tsx
- [[_temp5()_12]] - code - src\screens\Doctor.tsx
- [[_temp6()_9]] - code - src\screens\Doctor.tsx
- [[_temp7()_7]] - code - src\screens\Doctor.tsx
- [[_temp8()_7]] - code - src\screens\Doctor.tsx
- [[_temp9()_5]] - code - src\screens\Doctor.tsx
- [[appendTaskOutput()]] - code - src\utils\task\diskOutput.ts
- [[applyTaskOffsetsAndEvictions()]] - code - src\utils\task\framework.ts
- [[cleanupTaskOutput()]] - code - src\utils\task\diskOutput.ts
- [[diskOutput.ts]] - code - src\utils\task\diskOutput.ts
- [[enqueueTaskNotification()]] - code - src\utils\task\framework.ts
- [[ensureOutputDir()]] - code - src\utils\task\diskOutput.ts
- [[envValidation.ts]] - code - src\utils\envValidation.ts
- [[flushTaskOutput()]] - code - src\utils\task\diskOutput.ts
- [[formatTaskOutput()]] - code - src\utils\task\outputFormatting.ts
- [[framework.ts]] - code - src\utils\task\framework.ts
- [[generateTaskAttachments()]] - code - src\utils\task\framework.ts
- [[getMaxOutputLength()]] - code - src\utils\shell\outputLimits.ts
- [[getMaxTaskOutputLength()]] - code - src\utils\task\outputFormatting.ts
- [[getNpmDistTags()]] - code - src\utils\autoUpdater.ts
- [[getOrCreateOutput()]] - code - src\utils\task\diskOutput.ts
- [[getRunningTasks()]] - code - src\utils\task\framework.ts
- [[getStatusText()]] - code - src\utils\task\framework.ts
- [[getTaskOutput()_1]] - code - src\utils\task\diskOutput.ts
- [[getTaskOutput()]] - code - src\components\tasks\ShellDetailDialog.tsx
- [[getTaskOutputDelta()]] - code - src\utils\task\diskOutput.ts
- [[getTaskOutputPath()]] - code - src\utils\task\diskOutput.ts
- [[getTaskOutputSize()]] - code - src\utils\task\diskOutput.ts
- [[getUnifiedTaskAttachments()]] - code - src\utils\attachments.ts
- [[outputFormatting.ts]] - code - src\utils\task\outputFormatting.ts
- [[outputLimits.ts]] - code - src\utils\shell\outputLimits.ts
- [[pollTasks()]] - code - src\utils\task\framework.ts
- [[readFileRange()]] - code - src\utils\fsOperations.ts
- [[safeJoinLines()]] - code - src\utils\stringUtils.ts
- [[tailFile()]] - code - src\utils\fsOperations.ts
- [[validateBoundedIntEnvVar()]] - code - src\utils\envValidation.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_Doctor.tsx
SORT file.name ASC
```

## Connections to other communities
- 58 edges to [[_COMMUNITY_Module main.tsx]]
- 47 edges to [[_COMMUNITY_Module logForDebugging()]]
- 26 edges to [[_COMMUNITY_Module ink.ts]]
- 12 edges to [[_COMMUNITY_Module log.ts]]
- 12 edges to [[_COMMUNITY_Module logError()]]
- 7 edges to [[_COMMUNITY_Module REPL.tsx]]
- 5 edges to [[_COMMUNITY_Module state.ts]]
- 5 edges to [[_COMMUNITY_Module messages.ts]]
- 4 edges to [[_COMMUNITY_Module String()]]
- 2 edges to [[_COMMUNITY_Module hooks.ts]]
- 1 edge to [[_COMMUNITY_Module commands.ts]]
- 1 edge to [[_COMMUNITY_Module loadUserBindings.ts]]
- 1 edge to [[_COMMUNITY_Module autoDream.ts]]
- 1 edge to [[_COMMUNITY_Module client.ts]]

## Top bridge nodes
- [[Doctor.tsx]] - degree 53, connects to 8 communities
- [[diskOutput.ts]] - degree 53, connects to 8 communities
- [[getTaskOutputPath()]] - degree 34, connects to 7 communities
- [[framework.ts]] - degree 37, connects to 6 communities
- [[TaskOutput.ts]] - degree 20, connects to 4 communities