---
source_file: "src\tools\PowerShellTool\powershellPermissions.ts"
type: "code"
community: "Module: powershellPermissions.ts"
location: "L639"
tags:
  - graphify/code
  - graphify/INFERRED
  - community/Module:_powershellPermissions.ts
---

# powershellToolHasPermission()

## Connections
- [[PowerShellTool.tsx]] - `imports` [EXTRACTED]
- [[argLeaksValue()]] - `calls` [INFERRED]
- [[classifyCommandName()]] - `calls` [INFERRED]
- [[containsVulnerableUncPath()]] - `calls` [INFERRED]
- [[dangerousRemovalDeny()]] - `calls` [INFERRED]
- [[deriveSecurityFlags()]] - `calls` [INFERRED]
- [[getFileRedirections()]] - `calls` [INFERRED]
- [[getSubCommandsForPermissionCheck()]] - `calls` [EXTRACTED]
- [[isAllowlistedCommand()]] - `calls` [INFERRED]
- [[isCurrentDirectoryBareGitRepo()]] - `calls` [INFERRED]
- [[isDangerousRemovalRawPath()]] - `calls` [INFERRED]
- [[isProvablySafeStatement()]] - `calls` [INFERRED]
- [[isReadOnlyCommand()]] - `calls` [INFERRED]
- [[matchingRulesForInput()_1]] - `calls` [EXTRACTED]
- [[powershellCommandIsSafe()]] - `calls` [INFERRED]
- [[powershellPermissions.ts]] - `contains` [EXTRACTED]
- [[powershellToolCheckExactMatchPermission()]] - `calls` [EXTRACTED]
- [[powershellToolCheckPermission()]] - `calls` [EXTRACTED]
- [[resolveToCanonical()]] - `calls` [INFERRED]
- [[suggestionForExactCommand()_1]] - `calls` [EXTRACTED]

#graphify/code #graphify/INFERRED #community/Module:_powershellPermissions.ts