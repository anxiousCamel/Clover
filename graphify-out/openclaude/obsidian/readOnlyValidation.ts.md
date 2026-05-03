---
source_file: "src\tools\BashTool\readOnlyValidation.ts"
type: "code"
community: "Module: logEvent()"
location: "L1"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/Module:_logEvent()
---

# readOnlyValidation.ts

## Connections
- [[BashTool.tsx]] - `imports_from` [EXTRACTED]
- [[PermissionResult.ts]] - `imports_from` [EXTRACTED]
- [[bashCommandIsSafe_DEPRECATED()]] - `imports` [EXTRACTED]
- [[bashPermissions.ts]] - `imports_from` [EXTRACTED]
- [[bashSecurity.ts]] - `imports_from` [EXTRACTED]
- [[checkReadOnlyConstraints()]] - `contains` [EXTRACTED]
- [[commandHasAnyGit()]] - `contains` [EXTRACTED]
- [[commandWritesToGitInternalPaths()]] - `contains` [EXTRACTED]
- [[commands.ts_1]] - `imports_from` [EXTRACTED]
- [[containsUnquotedExpansion()]] - `contains` [EXTRACTED]
- [[containsVulnerableUncPath()]] - `imports` [EXTRACTED]
- [[cwd.ts]] - `imports_from` [EXTRACTED]
- [[extractOutputRedirections()]] - `imports` [EXTRACTED]
- [[extractWritePathsFromSubcommand()]] - `contains` [EXTRACTED]
- [[getCommandAllowlist()]] - `contains` [EXTRACTED]
- [[getCwd()]] - `imports` [EXTRACTED]
- [[getOriginalCwd()]] - `imports` [EXTRACTED]
- [[git.ts]] - `imports_from` [EXTRACTED]
- [[isCommandReadOnly()]] - `contains` [EXTRACTED]
- [[isCommandSafeViaFlagParsing()]] - `contains` [EXTRACTED]
- [[isCurrentDirectoryBareGitRepo()]] - `imports` [EXTRACTED]
- [[isGitInternalPath()]] - `contains` [EXTRACTED]
- [[isNormalizedGitCommand()]] - `imports` [EXTRACTED]
- [[makeRegexForSafeCommand()]] - `contains` [EXTRACTED]
- [[modeValidation.ts]] - `imports_from` [EXTRACTED]
- [[pathValidation.ts]] - `imports_from` [EXTRACTED]
- [[platform.ts]] - `imports_from` [EXTRACTED]
- [[readOnlyCommandValidation.ts]] - `imports_from` [EXTRACTED]
- [[sandbox-adapter.ts]] - `imports_from` [EXTRACTED]
- [[sedCommandIsAllowedByAllowlist()]] - `imports` [EXTRACTED]
- [[sedValidation.ts]] - `imports_from` [EXTRACTED]
- [[shellQuote.ts]] - `imports_from` [EXTRACTED]
- [[speculation.ts]] - `imports_from` [EXTRACTED]
- [[splitCommand_DEPRECATED()]] - `imports` [EXTRACTED]
- [[state.ts]] - `imports_from` [EXTRACTED]
- [[tryParseShellCommand()]] - `imports` [EXTRACTED]
- [[validateFlags()]] - `imports` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/Module:_logEvent()