---
source_file: "src\integrations\discoveryService.ts"
type: "code"
community: "Module: openaiShim.ts"
location: "L1"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/Module:_openaiShim.ts
---

# discoveryService.ts

## Connections
- [[ProviderManager.tsx]] - `imports_from` [EXTRACTED]
- [[bootstrap.ts]] - `imports_from` [EXTRACTED]
- [[descriptors.ts]] - `imports_from` [EXTRACTED]
- [[discoverModelsForRoute()]] - `contains` [EXTRACTED]
- [[discoveryCache.ts]] - `imports_from` [EXTRACTED]
- [[getCachedModels()]] - `imports` [EXTRACTED]
- [[getCatalogEntries()]] - `contains` [EXTRACTED]
- [[getDiscoveryCacheKey()]] - `contains` [EXTRACTED]
- [[getDiscoveryCacheTtlMs()]] - `contains` [EXTRACTED]
- [[getReadinessProbeKind()]] - `contains` [EXTRACTED]
- [[getRouteBaseUrl()]] - `contains` [EXTRACTED]
- [[getRouteCatalog()]] - `contains` [EXTRACTED]
- [[getRouteDescriptor()]] - `imports` [EXTRACTED]
- [[getRouteDiscoveryApiKey()]] - `contains` [EXTRACTED]
- [[getRouteDiscoveryHeaders()]] - `contains` [EXTRACTED]
- [[hashDiscoveryCachePartition()]] - `contains` [EXTRACTED]
- [[index.ts_80]] - `imports_from` [EXTRACTED]
- [[isCacheStale()]] - `imports` [EXTRACTED]
- [[isEssentialTrafficOnly()]] - `imports` [EXTRACTED]
- [[listOpenAICompatibleModels()]] - `imports` [EXTRACTED]
- [[main.tsx]] - `imports_from` [EXTRACTED]
- [[mergeCatalogEntries()]] - `contains` [EXTRACTED]
- [[model.tsx]] - `imports_from` [EXTRACTED]
- [[normalizeDiscoveryCacheBaseUrl()]] - `contains` [EXTRACTED]
- [[normalizeDiscoveryCacheHeaders()]] - `contains` [EXTRACTED]
- [[parseDurationString()]] - `imports` [EXTRACTED]
- [[privacyLevel.ts]] - `imports_from` [EXTRACTED]
- [[probeAtomicChatReadiness()]] - `imports` [EXTRACTED]
- [[probeOllamaGenerationReadiness()]] - `imports` [EXTRACTED]
- [[probeOllamaModelCatalog()]] - `imports` [EXTRACTED]
- [[probeRouteReadiness()]] - `contains` [EXTRACTED]
- [[provider.tsx]] - `imports_from` [EXTRACTED]
- [[providerDiscovery.ts]] - `imports_from` [EXTRACTED]
- [[providerProfiles.ts]] - `imports_from` [EXTRACTED]
- [[recordDiscoveryError()]] - `imports` [EXTRACTED]
- [[refreshStartupDiscoveryForActiveRoute()]] - `contains` [EXTRACTED]
- [[refreshStartupDiscoveryForRoute()]] - `contains` [EXTRACTED]
- [[resolveActiveRouteIdFromEnv()]] - `imports` [EXTRACTED]
- [[resolveDiscoveryRouteIdFromBaseUrl()]] - `contains` [EXTRACTED]
- [[resolveRouteCredentialValue()]] - `imports` [EXTRACTED]
- [[routeMetadata.ts]] - `imports_from` [EXTRACTED]
- [[runDiscovery()]] - `contains` [EXTRACTED]
- [[setCachedModels()]] - `imports` [EXTRACTED]
- [[shouldSkipNonessentialDiscoveryTraffic()]] - `contains` [EXTRACTED]
- [[toDiscoveredModelEntry()]] - `contains` [EXTRACTED]
- [[toOllamaModelEntry()]] - `contains` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/Module:_openaiShim.ts