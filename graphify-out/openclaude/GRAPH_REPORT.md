# Graph Report - .example\openclaude\openclaude  (2026-05-03)

## Corpus Check
- Large corpus: 2384 files · ~2,289,815 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 13073 nodes · 50979 edges · 49 communities detected
- Extraction: 80% EXTRACTED · 20% INFERRED · 0% AMBIGUOUS · INFERRED: 10019 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Helpers & Small Modules|Helpers & Small Modules]]
- [[_COMMUNITY_Module ink.ts|Module: ink.ts]]
- [[_COMMUNITY_Module main.tsx|Module: main.tsx]]
- [[_COMMUNITY_Module logForDebugging()|Module: logForDebugging()]]
- [[_COMMUNITY_Module log.ts|Module: log.ts]]
- [[_COMMUNITY_Module state.ts|Module: state.ts]]
- [[_COMMUNITY_Module openaiShim.ts|Module: openaiShim.ts]]
- [[_COMMUNITY_Module ink.tsx|Module: ink.tsx]]
- [[_COMMUNITY_Module String()|Module: String()]]
- [[_COMMUNITY_Module REPL.tsx|Module: REPL.tsx]]
- [[_COMMUNITY_Module messages.ts|Module: messages.ts]]
- [[_COMMUNITY_Module logError()|Module: logError()]]
- [[_COMMUNITY_Module logEvent()|Module: logEvent()]]
- [[_COMMUNITY_Module client.ts|Module: client.ts]]
- [[_COMMUNITY_Module toolExecution.ts|Module: toolExecution.ts]]
- [[_COMMUNITY_Module hooks.ts|Module: hooks.ts]]
- [[_COMMUNITY_Module commands.ts|Module: commands.ts]]
- [[_COMMUNITY_Module Cursor|Module: Cursor]]
- [[_COMMUNITY_Module autoDream.ts|Module: autoDream.ts]]
- [[_COMMUNITY_Module main()|Module: main()]]
- [[_COMMUNITY_Module Node|Module: Node]]
- [[_COMMUNITY_Module powershellPermissions.ts|Module: powershellPermissions.ts]]
- [[_COMMUNITY_Module ide.ts|Module: ide.ts]]
- [[_COMMUNITY_Module loadUserBindings.ts|Module: loadUserBindings.ts]]
- [[_COMMUNITY_Module prompts.ts|Module: prompts.ts]]
- [[_COMMUNITY_Module Doctor.tsx|Module: Doctor.tsx]]
- [[_COMMUNITY_Module protocol.js|Module: protocol.js]]
- [[_COMMUNITY_Module bashParser.ts|Module: bashParser.ts]]
- [[_COMMUNITY_Module collapseReadSearch.ts|Module: collapseReadSearch.ts]]
- [[_COMMUNITY_Module define.ts|Module: define.ts]]
- [[_COMMUNITY_Module test_smart_router.py|Module: test_smart_router.py]]
- [[_COMMUNITY_Module utils.ts|Module: utils.ts]]
- [[_COMMUNITY_Module LSPTool.ts|Module: LSPTool.ts]]
- [[_COMMUNITY_Module index.ts|Module: index.ts]]
- [[_COMMUNITY_Module custom.ts|Module: custom.ts]]
- [[_COMMUNITY_Module ElicitationDialog.tsx|Module: ElicitationDialog.tsx]]
- [[_COMMUNITY_Module wiki.tsx|Module: wiki.tsx]]
- [[_COMMUNITY_Module parse.ts|Module: parse.ts]]
- [[_COMMUNITY_Module stats.ts|Module: stats.ts]]
- [[_COMMUNITY_Module test_ollama_provider.py|Module: test_ollama_provider.py]]
- [[_COMMUNITY_Module ShellCommandImpl|Module: ShellCommandImpl]]
- [[_COMMUNITY_Module SessionManager|Module: SessionManager]]
- [[_COMMUNITY_Module test_atomic_chat_provider.py|Module: test_atomic_chat_provider.py]]
- [[_COMMUNITY_Module pr-intent-scan.ts|Module: pr-intent-scan.ts]]
- [[_COMMUNITY_Module FileIndex|Module: FileIndex]]
- [[_COMMUNITY_Module multiTurnContext.ts|Module: multiTurnContext.ts]]
- [[_COMMUNITY_Module diffController.js|Module: diffController.js]]
- [[_COMMUNITY_Module sdk.d.ts|Module: sdk.d.ts]]
- [[_COMMUNITY_Module hybridContextStrategy.ts|Module: hybridContextStrategy.ts]]

## God Nodes (most connected - your core abstractions)
1. `logForDebugging()` - 1189 edges
2. `logEvent()` - 604 edges
3. `logError()` - 582 edges
4. `jsonStringify()` - 355 edges
5. `getFsImplementation()` - 267 edges
6. `getGlobalConfig()` - 262 edges
7. `getCwd()` - 225 edges
8. `getFeatureValue_CACHED_MAY_BE_STALE()` - 207 edges
9. `jsonParse()` - 180 edges
10. `isEnvTruthy()` - 176 edges

## Surprising Connections (you probably didn't know these)
- `deserializeLogEntry()` --calls--> `jsonParse()`  [INFERRED]
  src\history.ts → src\utils\slowOperations.ts
- `getCcrAutoConnectDefault()` --calls--> `getFeatureValue_CACHED_MAY_BE_STALE()`  [INFERRED]
  src\bridge\bridgeEnabled.ts → src\services\analytics\growthbook.ts
- `isCcrMirrorEnabled()` --calls--> `getFeatureValue_CACHED_MAY_BE_STALE()`  [INFERRED]
  src\bridge\bridgeEnabled.ts → src\services\analytics\growthbook.ts
- `buildChildEnv()` --calls--> `String()`  [INFERRED]
  src\bridge\sessionRunner.ts → src\components\CustomSelect\SelectMulti.tsx
- `installPluginAndNotify()` --calls--> `Install()`  [INFERRED]
  src\hooks\usePluginRecommendationBase.tsx → src\commands\install.tsx

## Communities

### Community 999 - "Helpers & Small Modules"
Cohesion: 0.01
Nodes (24): detectBestProvider(), detectLocalService(), detectProviderFromEnv(), envHasNonEmpty(), firstSet(), isOptionsObject(), EndTruncatingAccumulator, createLinkedTransportPair() (+16 more)

### Community 0 - "Module: ink.ts"
Cohesion: 0.0
Nodes (883): AgentDetail(), AgentEditor(), deleteAgentFromFile(), ensureAgentDirectoryExists(), formatAgentAsMarkdown(), getActualAgentFilePath(), getActualRelativeAgentFilePath(), getAgentDirectoryPath() (+875 more)

### Community 1 - "Module: main.tsx"
Cohesion: 0.0
Nodes (998): addDirHelpMessage(), validateDirectoryForWorkspace(), getLocalAgentMemoryDir(), isAgentMemoryPath(), loadAgentMemoryPrompt(), initializeAnalyticsGates(), getCachedRemainingPasses(), applySedEdit() (+990 more)

### Community 2 - "Module: logForDebugging()"
Cohesion: 0.01
Nodes (760): call(), generateAgent(), startAgentSummarization(), getAgentMemoryDir(), getAgentMemoryEntrypoint(), sanitizeAgentTypeForPath(), checkAgentMemorySnapshot(), copySnapshotToLocal() (+752 more)

### Community 3 - "Module: log.ts"
Cohesion: 0.01
Nodes (643): shutdown1PEventLogging(), refreshGrowthBookAfterAuthChange(), logEventAsync(), checkAdminRequestEligibility(), createAdminRequest(), getMyAdminRequests(), getSSLErrorHint(), fetchWithProxyRetry() (+635 more)

### Community 4 - "Module: state.ts"
Cohesion: 0.01
Nodes (574): resetSessionCacheStats(), accumulateUsage(), addCacheBreakpoints(), assistantMessageToMessageParam(), buildSystemPromptBlocks(), cleanupStream(), clearStreamIdleTimers(), configureEffortParams() (+566 more)

### Community 5 - "Module: openaiShim.ts"
Cohesion: 0.01
Nodes (584): shouldUseFirstPartyAnthropicAuth(), shouldUseFirstPartyAnthropicAuthForProvider(), fetchBootstrapAPI(), fetchBootstrapData(), fetchLocalOpenAIModelOptions(), addCacheMetrics(), asNumber(), buildAnthropicUsageFromRawUsage() (+576 more)

### Community 6 - "Module: ink.tsx"
Cohesion: 0.01
Nodes (341): flushInteractionTime(), flushInteractionTime_inner(), markScrollActivity(), updateLastInteractionTime(), AlternateScreen(), App, handleMouseEvent(), processKeysInBatch() (+333 more)

### Community 7 - "Module: String()"
Cohesion: 0.01
Nodes (517): getBuiltInAgents(), clearAgentDefinitionsCache(), parseAgentFromJson(), parseAgentFromMarkdown(), parseAgentsFromJson(), parseHooksFromFrontmatter(), clearRegisteredPluginHooks(), getAdditionalDirectoriesForClaudeMd() (+509 more)

### Community 8 - "Module: REPL.tsx"
Cohesion: 0.01
Nodes (420): isBuiltInAgent(), resumeAgentBackground(), getLastMainRequestId(), getPlanSlugCache(), getSessionProjectDir(), getTurnHookCount(), getTurnHookDurationMs(), getTurnToolCount() (+412 more)

### Community 9 - "Module: messages.ts"
Cohesion: 0.01
Nodes (457): getAutoBackgroundMs(), areExplorePlanAgentsEnabled(), initializeAgentMcpServers(), callSafe(), checkGate_CACHED_OR_BLOCKING(), checkSecurityRestrictionGate(), checkStatsigFeatureGate_CACHED_MAY_BE_STALE(), clearGrowthBookConfigOverrides() (+449 more)

### Community 10 - "Module: logError()"
Cohesion: 0.01
Nodes (313): FirstPartyEventLoggingExporter, getAxiosErrorContext(), getStorageDir(), buildDownloadPath(), downloadAndSaveFile(), downloadFile(), downloadSessionFiles(), getDefaultApiBaseUrl() (+305 more)

### Community 11 - "Module: logEvent()"
Cohesion: 0.01
Nodes (323): logEvent(), formatGrantAmount(), getCachedOverageCreditGrant(), refreshOverageCreditGrantCache(), applyVarToScope(), checkSemantics(), collectCommands(), collectCommandSubstitution() (+315 more)

### Community 12 - "Module: client.ts"
Cohesion: 0.01
Nodes (244): getAllowedChannels(), getHasDevChannels(), handleChannelEnable(), reregisterChannelHandlerAfterReconnect(), isComputerUseMCPServer(), containsControlChars(), parseDeepLink(), checkMcpServerHealth() (+236 more)

### Community 13 - "Module: toolExecution.ts"
Cohesion: 0.02
Nodes (199): extractMcpToolDetails(), extractSkillName(), extractToolInputForTelemetry(), getFileExtensionForAnalytics(), getFileExtensionsFromBashCommand(), isToolDetailsLoggingEnabled(), mcpToolDetailsForAnalytics(), truncateToolInputValue() (+191 more)

### Community 14 - "Module: hooks.ts"
Cohesion: 0.02
Nodes (189): addToTurnHookDuration(), getLastInteractionTime(), getRegisteredHooks(), resetSdkInitState(), setOriginalCwd(), setProjectRoot(), recordWorktreeExit(), WorktreeExitDialog() (+181 more)

### Community 15 - "Module: commands.ts"
Cohesion: 0.02
Nodes (78): onGrowthBookRefresh(), call(), createStoredCompanion(), hashString(), pickDeterministic(), setCompanionReaction(), showHelp(), titleCase() (+70 more)

### Community 16 - "Module: Cursor"
Cohesion: 0.03
Nodes (56): useVimInput(), Cursor, isVimPunctuation(), isVimWhitespace(), isVimWordChar(), MeasuredText, consumeEarlyInput(), processChunk() (+48 more)

### Community 17 - "Module: autoDream.ts"
Cohesion: 0.03
Nodes (111): executeAutoDream(), getConfig(), initAutoDream(), isForced(), isGateOpen(), makeDreamProgressWatcher(), isAutoDreamEnabled(), listSessionsTouchedSince() (+103 more)

### Community 18 - "Module: main()"
Cohesion: 0.03
Nodes (101): isAnalyticsDisabled(), isFeedbackSurveyDisabled(), camelToSnakeCase(), flushLogs(), getFlushIntervalMs(), scheduleFlush(), shutdownDatadog(), trackDatadogEvent() (+93 more)

### Community 19 - "Module: Node"
Cohesion: 0.03
Nodes (41): alignAbsolute(), boundAxis(), cacheWrite(), calculateBaseline(), childMarginForAxis(), collectLayoutChildren(), commitCacheOutputs(), computeFlexBasis() (+33 more)

### Community 20 - "Module: powershellPermissions.ts"
Cohesion: 0.04
Nodes (95): buildParseScript(), classifyCommandName(), commandHasArgAbbreviation(), deriveSecurityFlags(), ensureArray(), getAllCommandNames(), getAllCommands(), getAllRedirections() (+87 more)

### Community 21 - "Module: ide.ts"
Cohesion: 0.03
Nodes (74): getIsScrollDraining(), IdeAutoConnectDialog(), IdeDisableAutoConnectDialog(), shouldShowAutoConnectDialog(), shouldShowDisableAutoConnectDialog(), hasIdeOnboardingDialogBeenShown(), IdeOnboardingDialog(), markDialogAsShown() (+66 more)

### Community 22 - "Module: loadUserBindings.ts"
Cohesion: 0.04
Nodes (75): registerBatchSkill(), buildInlineReference(), buildPrompt(), detectLanguage(), getFilesForLanguage(), processContent(), registerClaudeApiSkill(), registerClaudeInChromeSkill() (+67 more)

### Community 23 - "Module: prompts.ts"
Cohesion: 0.04
Nodes (89): isForkSubagentEnabled(), getAgentSystemPrompt(), dedup(), getBackgroundUsageNote(), getCommitAndPRInstructions(), getDefaultTimeoutMs(), getMaxTimeoutMs(), getSimplePrompt() (+81 more)

### Community 24 - "Module: Doctor.tsx"
Cohesion: 0.04
Nodes (31): SandboxDoctorSection(), _temp8(), getMaxOutputLength(), appendTaskOutput(), cleanupTaskOutput(), _clearOutputsForTest(), DiskTaskOutput, ensureOutputDir() (+23 more)

### Community 25 - "Module: protocol.js"
Cohesion: 0.04
Nodes (30): ChatController, getLaunchConfig(), OpenClaudeChatPanelManager, OpenClaudeChatViewProvider, escapeHtml(), renderChatHtml(), parseToolInput(), toolDisplayName() (+22 more)

### Community 26 - "Module: bashParser.ts"
Cohesion: 0.16
Nodes (79): advance(), byteAt(), byteLengthUtf8(), checkBudget(), consumeKeyword(), isArithStop(), isBaseDigit(), isDigit() (+71 more)

### Community 27 - "Module: collapseReadSearch.ts"
Cohesion: 0.06
Nodes (68): extractBashCommentLabel(), getCommitCounter(), getPrCounter(), registerHookCallbacks(), MessageModel(), allToolsResolved(), areMessageRowPropsEqual(), hasContentAfterIndex() (+60 more)

### Community 28 - "Module: define.ts"
Cohesion: 0.08
Nodes (11): defineBrand(), defineGateway(), defineModel(), defineVendor(), geminiModel(), glmModel(), gptModel(), kimiModel() (+3 more)

### Community 29 - "Module: test_smart_router.py"
Cohesion: 0.06
Nodes (43): str(), build_default_providers(), Provider, smart_router.py --------------- Intelligent auto-router for openclaude.  Ins, Intelligently routes Claude Code API requests to the best     available LLM pro, Ping all providers and build initial latency scores., Measure latency to a provider's health endpoint., Pick the best available provider for this request.         Returns None if no p (+35 more)

### Community 30 - "Module: utils.ts"
Cohesion: 0.07
Nodes (34): execHttpHook(), getHttpHookPolicy(), getSandboxProxyConfig(), interpolateEnvVars(), sanitizeHeaderValue(), expandIPv6Groups(), extractMappedIPv4(), isBlockedAddress() (+26 more)

### Community 31 - "Module: LSPTool.ts"
Cohesion: 0.1
Nodes (34): createLSPServerManager(), getInitializationStatus(), getLspServerManager(), initializeLspServerManager(), isLspConnected(), shutdownLspServerManager(), waitForInitialization(), extractMarkupText() (+26 more)

### Community 32 - "Module: index.ts"
Cohesion: 0.11
Nodes (33): addLineNumber(), addMarker(), ansi256FromRgb(), ansiIdx(), applyBackground(), asTerminalEscaped(), buildTheme(), charWidth() (+25 more)

### Community 33 - "Module: custom.ts"
Cohesion: 0.11
Nodes (23): auditLogCustomSearch(), buildAuthHeadersForPreset(), buildRequest(), extractFromNode(), extractHits(), fetchWithRetry(), ipv4DottedToInt(), isPrivateHostname() (+15 more)

### Community 34 - "Module: ElicitationDialog.tsx"
Cohesion: 0.11
Nodes (26): looksLikeISO8601(), commitTextField(), ElicitationDialog(), handleAbort(), handleNavigation(), handleTextInputChange(), handleTextInputSubmit(), resolveFieldAsync() (+18 more)

### Community 35 - "Module: wiki.tsx"
Cohesion: 0.14
Nodes (26): getPageTitle(), listMarkdownFiles(), rebuildWikiIndex(), buildLogEntry(), buildSourceNote(), ingestLocalWikiSource(), buildArchitectureTemplate(), buildIndexTemplate() (+18 more)

### Community 36 - "Module: parse.ts"
Cohesion: 0.14
Nodes (26): buildUnavailableResult(), fetchMiniMaxUsage(), getMiniMaxUsageUrls(), resolveConfiguredMiniMaxUsageBaseUrl(), resolveMiniMaxUsageBaseUrl(), trimTrailingSlash(), asNumber(), asString() (+18 more)

### Community 37 - "Module: stats.ts"
Cohesion: 0.16
Nodes (27): calculatePercentiles(), generateHeatmap(), getHeatmapChar(), getIntensity(), isTranscriptMessage(), aggregateClaudeCodeStats(), aggregateClaudeCodeStatsForRange(), cacheToStats() (+19 more)

### Community 38 - "Module: test_ollama_provider.py"
Cohesion: 0.14
Nodes (23): anthropic_to_ollama_messages(), check_ollama_running(), _extract_ollama_image_data(), list_ollama_models(), normalize_ollama_model(), ollama_chat(), ollama_chat_stream(), ollama_provider.py ------------------ Adds native Ollama support to openclaude (+15 more)

### Community 39 - "Module: ShellCommandImpl"
Cohesion: 0.13
Nodes (3): AbortedShellCommand, prependStderr(), ShellCommandImpl

### Community 40 - "Module: SessionManager"
Cohesion: 0.22
Nodes (7): formatRelativeTime(), getProjectDir(), getProjectsDir(), resolveConfigDir(), sanitizePath(), SessionManager, simpleHash()

### Community 41 - "Module: test_atomic_chat_provider.py"
Cohesion: 0.21
Nodes (14): _api_url(), atomic_chat(), atomic_chat_stream(), check_atomic_chat_running(), list_atomic_chat_models(), atomic_chat_provider.py ----------------------- Adds native Atomic Chat suppor, test_atomic_chat_provider.py Run: pytest python/tests/test_atomic_chat_provider, test_atomic_chat_prepends_system() (+6 more)

### Community 42 - "Module: pr-intent-scan.ts"
Cohesion: 0.23
Nodes (14): findCommandFindings(), findSensitivePathFindings(), findUrlFindings(), getGitDiff(), hasSuspiciousDownloadIndicators(), hostMatches(), parseAddedLines(), renderText() (+6 more)

### Community 43 - "Module: FileIndex"
Cohesion: 0.26
Nodes (6): computeTopLevelEntries(), FileIndex, isBoundary(), isLower(), isUpper(), scoreBonusAt()

### Community 44 - "Module: multiTurnContext.ts"
Cohesion: 0.21
Nodes (6): addMessageToTurn(), addToolCallToTurn(), clearTurnHistory(), resetMultiTurnState(), setTurnState(), startNewTurn()

### Community 45 - "Module: diffController.js"
Cohesion: 0.22
Nodes (4): DiffContentProvider, openDiff(), openFileDiff(), storeContent()

### Community 46 - "Module: sdk.d.ts"
Cohesion: 0.2
Nodes (9): AbortError, ClaudeError, SDKAuthenticationError, SDKBillingError, SDKError, SDKInvalidRequestError, SDKMaxOutputTokensError, SDKRateLimitError (+1 more)

### Community 47 - "Module: hybridContextStrategy.ts"
Cohesion: 0.38
Nodes (8): applyHybridStrategy(), calculateCacheValue(), getCacheAge(), getMessageChain(), getMessageTokenCount(), optimizeForAccuracy(), optimizeForCost(), splitContext()

## Knowledge Gaps
- **33 isolated node(s):** `atomic_chat_provider.py ----------------------- Adds native Atomic Chat suppor`, `ollama_provider.py ------------------ Adds native Ollama support to openclaude`, `smart_router.py --------------- Intelligent auto-router for openclaude.  Ins`, `True if the provider has an API key set.`, `Lower score = better provider.         strategy: 'latency' | 'cost' | 'balanced` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.