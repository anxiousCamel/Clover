---
type: community
cohesion: 0.04
members: 105
---

# Module: prompts.ts

**Cohesion:** 0.04 - loosely connected
**Members:** 105 nodes

## Members
- [[DANGEROUS_uncachedSystemPromptSection()]] - code - src\constants\systemPromptSections.ts
- [[attribution.ts]] - code - src\utils\attribution.ts
- [[calculateCommitAttribution()]] - code - src\utils\commitAttribution.ts
- [[clearBetaHeaderLatches()]] - code - src\bootstrap\state.ts
- [[clearSystemPromptSectionState()]] - code - src\bootstrap\state.ts
- [[clearSystemPromptSections()]] - code - src\constants\systemPromptSections.ts
- [[commit-push-pr.ts]] - code - src\commands\commit-push-pr.ts
- [[commit.ts]] - code - src\commands\commit.ts
- [[commitAttribution.ts]] - code - src\utils\commitAttribution.ts
- [[computeContentHash()]] - code - src\utils\commitAttribution.ts
- [[computeEnvInfo()]] - code - src\constants\prompts.ts
- [[computeFileModificationState()]] - code - src\utils\commitAttribution.ts
- [[computeSimpleEnvInfo()]] - code - src\constants\prompts.ts
- [[countMemoryFileAccessFromEntries()]] - code - src\utils\attribution.ts
- [[countUserPromptsFromEntries()]] - code - src\utils\attribution.ts
- [[countUserPromptsInMessages()]] - code - src\utils\attribution.ts
- [[createEmptyAttributionState()]] - code - src\utils\commitAttribution.ts
- [[cyberRiskInstruction.ts]] - code - src\constants\cyberRiskInstruction.ts
- [[dedup()]] - code - src\tools\BashTool\prompt.ts
- [[enhanceSystemPromptWithEnvDetails()]] - code - src\constants\prompts.ts
- [[expandFilePath()]] - code - src\utils\commitAttribution.ts
- [[filterGeneratedFiles()]] - code - src\utils\generatedFiles.ts
- [[generatedFiles.ts]] - code - src\utils\generatedFiles.ts
- [[getActionsSection()]] - code - src\constants\prompts.ts
- [[getAgentSystemPrompt()]] - code - src\tools\AgentTool\runAgent.ts
- [[getAgentToolSection()]] - code - src\constants\prompts.ts
- [[getAttributionRepoRoot()]] - code - src\utils\commitAttribution.ts
- [[getAttributionTexts()]] - code - src\utils\attribution.ts
- [[getBackgroundUsageNote()]] - code - src\tools\BashTool\prompt.ts
- [[getBriefSection()]] - code - src\constants\prompts.ts
- [[getClientSurface()]] - code - src\utils\commitAttribution.ts
- [[getClientType()]] - code - src\bootstrap\state.ts
- [[getCommitAndPRInstructions()]] - code - src\tools\BashTool\prompt.ts
- [[getDefaultBashTimeoutMs()]] - code - src\utils\timeouts.ts
- [[getDefaultTimeoutMs()]] - code - src\tools\BashTool\prompt.ts
- [[getDiscoverSkillsGuidance()]] - code - src\constants\prompts.ts
- [[getEnhancedPRAttribution()]] - code - src\utils\attribution.ts
- [[getFileMtime()]] - code - src\utils\commitAttribution.ts
- [[getFunctionResultClearingSection()]] - code - src\constants\prompts.ts
- [[getGitDiffSize()]] - code - src\utils\commitAttribution.ts
- [[getHooksSection()]] - code - src\constants\prompts.ts
- [[getKnowledgeCutoff()]] - code - src\constants\prompts.ts
- [[getLanguageSection()]] - code - src\constants\prompts.ts
- [[getMaxBashTimeoutMs()]] - code - src\utils\timeouts.ts
- [[getMaxTimeoutMs()]] - code - src\tools\BashTool\prompt.ts
- [[getMcpInstructions()]] - code - src\constants\prompts.ts
- [[getMcpInstructionsSection()]] - code - src\constants\prompts.ts
- [[getOutputEfficiencySection()]] - code - src\constants\prompts.ts
- [[getOutputStyleConfig()]] - code - src\constants\outputStyles.ts
- [[getOutputStyleSection()]] - code - src\constants\prompts.ts
- [[getPRAttributionData()]] - code - src\utils\attribution.ts
- [[getProactiveSection()]] - code - src\constants\prompts.ts
- [[getPromptContent()_1]] - code - src\commands\commit.ts
- [[getPromptContent()]] - code - src\commands\commit-push-pr.ts
- [[getPublicModelDisplayName()]] - code - src\utils\model\model.ts
- [[getPublicModelName()]] - code - src\utils\model\model.ts
- [[getRepoClassCached()]] - code - src\utils\commitAttribution.ts
- [[getScratchpadInstructions()]] - code - src\constants\prompts.ts
- [[getSessionSpecificGuidanceSection()]] - code - src\constants\prompts.ts
- [[getShellInfoLine()]] - code - src\constants\prompts.ts
- [[getSimpleDoingTasksSection()]] - code - src\constants\prompts.ts
- [[getSimpleIntroSection()]] - code - src\constants\prompts.ts
- [[getSimplePrompt()]] - code - src\tools\BashTool\prompt.ts
- [[getSimpleSandboxSection()]] - code - src\tools\BashTool\prompt.ts
- [[getSimpleSystemSection()]] - code - src\constants\prompts.ts
- [[getSimpleToneAndStyleSection()]] - code - src\constants\prompts.ts
- [[getStagedFiles()]] - code - src\utils\commitAttribution.ts
- [[getSystemPrompt()]] - code - src\constants\prompts.ts
- [[getSystemPromptSectionCache()]] - code - src\bootstrap\state.ts
- [[getSystemRemindersSection()]] - code - src\constants\prompts.ts
- [[getTranscriptStats()]] - code - src\utils\attribution.ts
- [[getUnameSR()]] - code - src\constants\prompts.ts
- [[getUndercoverInstructions()]] - code - src\utils\undercover.ts
- [[getUsingYourToolsSection()]] - code - src\constants\prompts.ts
- [[incrementPromptCount()]] - code - src\utils\commitAttribution.ts
- [[isFileDeleted()]] - code - src\utils\commitAttribution.ts
- [[isForkSubagentEnabled()]] - code - src\tools\AgentTool\forkSubagent.ts
- [[isGeneratedFile()]] - code - src\utils\generatedFiles.ts
- [[isGitTransientState()]] - code - src\utils\commitAttribution.ts
- [[isInternalModelRepoCached()]] - code - src\utils\commitAttribution.ts
- [[isMcpInstructionsDeltaEnabled()]] - code - src\utils\mcpInstructionsDelta.ts
- [[isRemoteSessionLocal()]] - code - src\constants\product.ts
- [[isScratchpadEnabled()]] - code - src\utils\permissions\filesystem.ts
- [[isTerminalOutput()]] - code - src\utils\attribution.ts
- [[isUndercover()]] - code - src\utils\undercover.ts
- [[normalizeFilePath()]] - code - src\utils\commitAttribution.ts
- [[prependBullets()]] - code - src\constants\prompts.ts
- [[prompt.ts_4]] - code - src\tools\BashTool\prompt.ts
- [[prompts.ts]] - code - src\constants\prompts.ts
- [[resolveSystemPromptSections()]] - code - src\constants\systemPromptSections.ts
- [[sanitizeModelName()]] - code - src\utils\commitAttribution.ts
- [[sanitizeSurfaceKey()]] - code - src\utils\commitAttribution.ts
- [[setSystemPromptSectionCacheEntry()]] - code - src\bootstrap\state.ts
- [[shouldIncludeGitInstructions()]] - code - src\utils\gitSettings.ts
- [[shouldShowUndercoverAutoNotice()]] - code - src\utils\undercover.ts
- [[shouldUseGlobalCacheScope()]] - code - src\utils\betas.ts
- [[stateToSnapshotMessage()]] - code - src\utils\commitAttribution.ts
- [[systemPromptSection()]] - code - src\constants\systemPromptSections.ts
- [[systemPromptSections.ts]] - code - src\constants\systemPromptSections.ts
- [[timeouts.ts]] - code - src\utils\timeouts.ts
- [[trackBulkFileChanges()]] - code - src\utils\commitAttribution.ts
- [[trackFileCreation()]] - code - src\utils\commitAttribution.ts
- [[trackFileDeletion()]] - code - src\utils\commitAttribution.ts
- [[trackFileModification()]] - code - src\utils\commitAttribution.ts
- [[undercover.ts]] - code - src\utils\undercover.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_prompts.ts
SORT file.name ASC
```

## Connections to other communities
- 71 edges to [[_COMMUNITY_Module main.tsx]]
- 60 edges to [[_COMMUNITY_Module logForDebugging()]]
- 45 edges to [[_COMMUNITY_Module state.ts]]
- 25 edges to [[_COMMUNITY_Module messages.ts]]
- 24 edges to [[_COMMUNITY_Module REPL.tsx]]
- 24 edges to [[_COMMUNITY_Module log.ts]]
- 9 edges to [[_COMMUNITY_Module hooks.ts]]
- 8 edges to [[_COMMUNITY_Module logError()]]
- 5 edges to [[_COMMUNITY_Module ink.ts]]
- 4 edges to [[_COMMUNITY_Module String()]]
- 3 edges to [[_COMMUNITY_Module commands.ts]]
- 3 edges to [[_COMMUNITY_Module main()]]
- 3 edges to [[_COMMUNITY_Module collapseReadSearch.ts]]
- 3 edges to [[_COMMUNITY_Module autoDream.ts]]

## Top bridge nodes
- [[prompts.ts]] - degree 97, connects to 10 communities
- [[attribution.ts]] - degree 52, connects to 9 communities
- [[commitAttribution.ts]] - degree 58, connects to 7 communities
- [[getSystemPrompt()]] - degree 42, connects to 7 communities
- [[systemPromptSections.ts]] - degree 14, connects to 5 communities