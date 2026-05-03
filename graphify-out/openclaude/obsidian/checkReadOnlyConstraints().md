---
source_file: "src\tools\BashTool\readOnlyValidation.ts"
type: "code"
community: "Module: logEvent()"
location: "L1810"
tags:
  - graphify/code
  - graphify/INFERRED
  - community/Module:_logEvent()
---

# checkReadOnlyConstraints()

## Connections
- [[BashTool.tsx]] - `imports` [EXTRACTED]
- [[bashCommandIsSafe_DEPRECATED()]] - `calls` [INFERRED]
- [[commandHasAnyGit()]] - `calls` [EXTRACTED]
- [[commandWritesToGitInternalPaths()]] - `calls` [EXTRACTED]
- [[containsVulnerableUncPath()]] - `calls` [INFERRED]
- [[getCwd()]] - `calls` [INFERRED]
- [[getOriginalCwd()]] - `calls` [INFERRED]
- [[isCurrentDirectoryBareGitRepo()]] - `calls` [INFERRED]
- [[modeValidation.ts]] - `imports` [EXTRACTED]
- [[readOnlyValidation.ts]] - `contains` [EXTRACTED]
- [[speculation.ts]] - `imports` [EXTRACTED]
- [[splitCommand_DEPRECATED()]] - `calls` [INFERRED]
- [[tryParseShellCommand()]] - `calls` [INFERRED]
- [[validateCommandForMode()]] - `calls` [INFERRED]

#graphify/code #graphify/INFERRED #community/Module:_logEvent()