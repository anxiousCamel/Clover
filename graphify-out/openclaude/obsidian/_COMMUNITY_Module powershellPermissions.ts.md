---
type: community
cohesion: 0.04
members: 130
---

# Module: powershellPermissions.ts

**Cohesion:** 0.04 - loosely connected
**Members:** 130 nodes

## Members
- [[alias.ts]] - code - src\utils\bash\specs\alias.ts
- [[aliasesOf()]] - code - src\utils\powershell\dangerousCmdlets.ts
- [[argLeaksValue()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[buildParseScript()]] - code - src\utils\powershell\parser.ts
- [[buildPrefix()]] - code - src\utils\shell\specPrefix.ts
- [[calculateDepth()]] - code - src\utils\shell\specPrefix.ts
- [[checkAddType()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkComObject()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkDangerousFilePathExecution()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkDownloadCradles()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkDownloadUtilities()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkDynamicCommandName()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkEncodedCommand()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkEnvVarManipulation()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkExpandableStrings()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkForEachMemberName()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkInvokeExpression()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkInvokeItem()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkMemberInvocations()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkModuleLoading()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkPermissionMode()_1]] - code - src\tools\PowerShellTool\modeValidation.ts
- [[checkPwshCommandOrFile()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkRuntimeStateManipulation()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkScheduledTask()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkScriptBlockInjection()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkSplatting()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkStartProcess()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkStopParsing()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkSubExpressions()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkTypeLiterals()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[checkWmiProcessSpawn()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[classifyCommandName()]] - code - src\utils\powershell\parser.ts
- [[clmTypes.ts]] - code - src\tools\PowerShellTool\clmTypes.ts
- [[commandHasArg()]] - code - src\utils\powershell\parser.ts
- [[commandHasArgAbbreviation()]] - code - src\utils\powershell\parser.ts
- [[commonParameters.ts]] - code - src\tools\PowerShellTool\commonParameters.ts
- [[dangerousCmdlets.ts]] - code - src\utils\powershell\dangerousCmdlets.ts
- [[dangerousPatterns.ts]] - code - src\utils\permissions\dangerousPatterns.ts
- [[dangerousRemovalDeny()]] - code - src\tools\PowerShellTool\pathValidation.ts
- [[deriveSecurityFlags()]] - code - src\utils\powershell\parser.ts
- [[ensureArray()]] - code - src\utils\powershell\parser.ts
- [[extractCommandName()]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[extractPrefixFromElement()]] - code - src\utils\powershell\staticPrefix.ts
- [[filterRulesByContentsMatchingInput()_1]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[findFirstSubcommand()]] - code - src\utils\shell\specPrefix.ts
- [[flagTakesArg()]] - code - src\utils\shell\specPrefix.ts
- [[getAllCommandNames()]] - code - src\utils\powershell\parser.ts
- [[getAllCommands()_1]] - code - src\utils\powershell\parser.ts
- [[getAllRedirections()]] - code - src\utils\powershell\parser.ts
- [[getCommandPrefixStatic()_1]] - code - src\utils\powershell\staticPrefix.ts
- [[getCompoundCommandPrefixesStatic()_1]] - code - src\utils\powershell\staticPrefix.ts
- [[getFileRedirections()]] - code - src\utils\powershell\parser.ts
- [[getParseTimeoutMs()]] - code - src\utils\powershell\parser.ts
- [[getPipelineSegments()]] - code - src\utils\powershell\parser.ts
- [[getSubCommandsForPermissionCheck()]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[getVariablesByScope()]] - code - src\utils\powershell\parser.ts
- [[gitSafety.ts]] - code - src\tools\PowerShellTool\gitSafety.ts
- [[hasCommandNamed()]] - code - src\utils\powershell\parser.ts
- [[hasDirectoryChange()]] - code - src\utils\powershell\parser.ts
- [[index.ts_94]] - code - src\utils\bash\specs\index.ts
- [[isAcceptEditsAllowedCmdlet()]] - code - src\tools\PowerShellTool\modeValidation.ts
- [[isAllowlistedCommand()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isAllowlistedPipelineTail()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isClmAllowedType()]] - code - src\tools\PowerShellTool\clmTypes.ts
- [[isCwdChangingCmdlet()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isDockerSafe()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isDotGitPathPS()]] - code - src\tools\PowerShellTool\gitSafety.ts
- [[isDotnetSafe()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isDownloader()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[isExternalCommandSafe()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isGhSafe()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isGitInternalPathPS()]] - code - src\tools\PowerShellTool\gitSafety.ts
- [[isGitSafe()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isIex()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[isItemTypeParamAbbrev()]] - code - src\tools\PowerShellTool\modeValidation.ts
- [[isKnownSubcommand()_1]] - code - src\utils\shell\specPrefix.ts
- [[isNullRedirectionTarget()]] - code - src\utils\powershell\parser.ts
- [[isPowerShellExecutable()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[isPowerShellParameter()]] - code - src\utils\powershell\parser.ts
- [[isProvablySafeStatement()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isReadOnlyCommand()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isSafeOutputCommand()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[isSingleCommand()]] - code - src\utils\powershell\parser.ts
- [[isSymlinkCreatingCommand()]] - code - src\tools\PowerShellTool\modeValidation.ts
- [[loadFigSpec()]] - code - src\utils\bash\registry.ts
- [[lookupAllowlist()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[makeInvalidResult()]] - code - src\utils\powershell\parser.ts
- [[mapElementType()]] - code - src\utils\powershell\parser.ts
- [[mapStatementType()]] - code - src\utils\powershell\parser.ts
- [[matchesDotGitPrefix()]] - code - src\tools\PowerShellTool\gitSafety.ts
- [[matchesGitInternalPrefix()]] - code - src\tools\PowerShellTool\gitSafety.ts
- [[matchingRulesForInput()_1]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[modeValidation.ts_1]] - code - src\tools\PowerShellTool\modeValidation.ts
- [[nohup.ts]] - code - src\utils\bash\specs\nohup.ts
- [[normalizeGitPathArg()]] - code - src\tools\PowerShellTool\gitSafety.ts
- [[normalizeTypeName()]] - code - src\tools\PowerShellTool\clmTypes.ts
- [[parsePowerShellCommandImpl()]] - code - src\utils\powershell\parser.ts
- [[parser.ts_3]] - code - src\utils\powershell\parser.ts
- [[powershellCommandIsSafe()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[powershellPermissions.ts]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[powershellSecurity.ts]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[powershellToolCheckExactMatchPermission()]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[powershellToolCheckPermission()]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[powershellToolHasPermission()]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[psExeHasParamAbbreviation()]] - code - src\tools\PowerShellTool\powershellSecurity.ts
- [[pyright.ts]] - code - src\utils\bash\specs\pyright.ts
- [[readOnlyValidation.ts_1]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[registry.ts_1]] - code - src\utils\bash\registry.ts
- [[resolveCwdReentry()]] - code - src\tools\PowerShellTool\gitSafety.ts
- [[resolveEscapingPathToCwdRelative()]] - code - src\tools\PowerShellTool\gitSafety.ts
- [[resolveToCanonical()]] - code - src\tools\PowerShellTool\readOnlyValidation.ts
- [[shouldStopAtArg()]] - code - src\utils\shell\specPrefix.ts
- [[sleep.ts_1]] - code - src\utils\bash\specs\sleep.ts
- [[specPrefix.ts]] - code - src\utils\shell\specPrefix.ts
- [[srun.ts]] - code - src\utils\bash\specs\srun.ts
- [[staticPrefix.ts]] - code - src\utils\powershell\staticPrefix.ts
- [[stripModulePrefix()]] - code - src\utils\powershell\parser.ts
- [[suggestionForExactCommand()_1]] - code - src\tools\PowerShellTool\powershellPermissions.ts
- [[time.ts]] - code - src\utils\bash\specs\time.ts
- [[timeout.ts]] - code - src\utils\bash\specs\timeout.ts
- [[toArray()_2]] - code - src\utils\shell\specPrefix.ts
- [[toUtf16LeBase64()]] - code - src\utils\powershell\parser.ts
- [[transformCommandAst()]] - code - src\utils\powershell\parser.ts
- [[transformExpressionElement()]] - code - src\utils\powershell\parser.ts
- [[transformRawOutput()]] - code - src\utils\powershell\parser.ts
- [[transformRedirection()]] - code - src\utils\powershell\parser.ts
- [[transformStatement()]] - code - src\utils\powershell\parser.ts
- [[validateFlagArgument()]] - code - src\utils\shell\readOnlyCommandValidation.ts
- [[validateFlags()]] - code - src\utils\shell\readOnlyCommandValidation.ts
- [[wordAlignedLCP()]] - code - src\utils\powershell\staticPrefix.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_powershellPermissions.ts
SORT file.name ASC
```

## Connections to other communities
- 49 edges to [[_COMMUNITY_Module main.tsx]]
- 14 edges to [[_COMMUNITY_Module logEvent()]]
- 11 edges to [[_COMMUNITY_Module logForDebugging()]]
- 7 edges to [[_COMMUNITY_Module ink.ts]]
- 2 edges to [[_COMMUNITY_Module log.ts]]
- 2 edges to [[_COMMUNITY_Module state.ts]]

## Top bridge nodes
- [[parser.ts_3]] - degree 45, connects to 4 communities
- [[powershellPermissions.ts]] - degree 54, connects to 3 communities
- [[registry.ts_1]] - degree 14, connects to 3 communities
- [[readOnlyValidation.ts_1]] - degree 29, connects to 2 communities
- [[modeValidation.ts_1]] - degree 16, connects to 2 communities