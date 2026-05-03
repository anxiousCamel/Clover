---
source_file: "src\utils\plugins\officialMarketplaceStartupCheck.ts"
type: "code"
community: "Module: String()"
location: "L142"
tags:
  - graphify/code
  - graphify/INFERRED
  - community/Module:_String()
---

# checkAndInstallOfficialMarketplace()

## Connections
- [[String()]] - `calls` [INFERRED]
- [[_temp()_87]] - `calls` [INFERRED]
- [[addMarketplaceSource()]] - `calls` [INFERRED]
- [[calculateNextRetryDelay()]] - `calls` [EXTRACTED]
- [[fetchOfficialMarketplaceFromGcs()]] - `calls` [INFERRED]
- [[getFeatureValue_CACHED_MAY_BE_STALE()]] - `calls` [INFERRED]
- [[getGlobalConfig()]] - `calls` [INFERRED]
- [[getMarketplacesCacheDir()]] - `calls` [INFERRED]
- [[isOfficialMarketplaceAutoInstallDisabled()]] - `calls` [EXTRACTED]
- [[isSourceAllowedByPolicy()]] - `calls` [INFERRED]
- [[loadKnownMarketplacesConfig()]] - `calls` [INFERRED]
- [[logError()]] - `calls` [INFERRED]
- [[logEvent()]] - `calls` [INFERRED]
- [[logForDebugging()]] - `calls` [INFERRED]
- [[lsp.ts]] - `imports` [EXTRACTED]
- [[markGitUnavailable()]] - `calls` [INFERRED]
- [[officialMarketplaceStartupCheck.ts]] - `contains` [EXTRACTED]
- [[saveKnownMarketplacesConfig()]] - `calls` [INFERRED]
- [[shouldRetryInstallation()]] - `calls` [EXTRACTED]
- [[toError()]] - `calls` [INFERRED]
- [[useOfficialMarketplaceNotification.tsx]] - `imports` [EXTRACTED]

#graphify/code #graphify/INFERRED #community/Module:_String()