---
source_file: "src\tools\BashTool\bashPermissions.ts"
type: "code"
community: "Module: logEvent()"
location: "L1640"
tags:
  - graphify/code
  - graphify/INFERRED
  - community/Module:_logEvent()
---

# bashToolHasPermission()

## Connections
- [[BashTool.tsx]] - `imports` [EXTRACTED]
- [[MonitorTool.ts]] - `imports` [EXTRACTED]
- [[bashPermissions.ts]] - `contains` [EXTRACTED]
- [[bashToolCheckExactMatchPermission()]] - `calls` [EXTRACTED]
- [[buildPendingClassifierCheck()]] - `calls` [EXTRACTED]
- [[checkCommandAndSuggestRules()]] - `calls` [EXTRACTED]
- [[checkCommandOperatorPermissions()]] - `calls` [INFERRED]
- [[checkEarlyExitDeny()]] - `calls` [EXTRACTED]
- [[checkSandboxAutoAllow()]] - `calls` [EXTRACTED]
- [[checkSemantics()]] - `calls` [INFERRED]
- [[checkSemanticsDeny()]] - `calls` [EXTRACTED]
- [[classifyBashCommand()]] - `calls` [INFERRED]
- [[commandHasAnyCd()]] - `calls` [EXTRACTED]
- [[count()]] - `calls` [INFERRED]
- [[extractRules()]] - `calls` [INFERRED]
- [[filterCdCwdSubcommands()]] - `calls` [EXTRACTED]
- [[getBashPromptAskDescriptions()]] - `calls` [INFERRED]
- [[getBashPromptDenyDescriptions()]] - `calls` [INFERRED]
- [[getCwd()]] - `calls` [INFERRED]
- [[getFeatureValue_CACHED_MAY_BE_STALE()]] - `calls` [INFERRED]
- [[getPlatform()]] - `calls` [INFERRED]
- [[isClassifierPermissionsEnabled()]] - `calls` [INFERRED]
- [[logClassifierResultForAnts()]] - `calls` [EXTRACTED]
- [[logEvent()]] - `calls` [INFERRED]
- [[logForDebugging()]] - `calls` [INFERRED]
- [[nodeTypeId()]] - `calls` [INFERRED]
- [[parseCommandRaw()]] - `calls` [INFERRED]
- [[parseForSecurityFromAst()]] - `calls` [INFERRED]
- [[permissionRuleValueToString()]] - `calls` [INFERRED]
- [[shouldUseSandbox()]] - `calls` [INFERRED]
- [[stripSafeHeredocSubstitutions()]] - `calls` [INFERRED]
- [[suggestionForExactCommand()]] - `calls` [EXTRACTED]
- [[suggestionForPrefix()]] - `calls` [EXTRACTED]
- [[tryParseShellCommand()]] - `calls` [INFERRED]

#graphify/code #graphify/INFERRED #community/Module:_logEvent()