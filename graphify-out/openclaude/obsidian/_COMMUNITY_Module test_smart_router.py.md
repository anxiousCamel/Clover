---
type: community
cohesion: 0.06
members: 62
---

# Module: test_smart_router.py

**Cohesion:** 0.06 - loosely connected
**Members:** 62 nodes

## Members
- [[.__init__()]] - code - python\smart_router.py
- [[._ping_provider()]] - code - python\smart_router.py
- [[._recheck_provider()]] - code - python\smart_router.py
- [[._update_latency()]] - code - python\smart_router.py
- [[.get_model_for_provider()]] - code - python\smart_router.py
- [[.initialize()]] - code - python\smart_router.py
- [[.is_large_request()]] - code - python\smart_router.py
- [[.record_result()]] - code - python\smart_router.py
- [[.route()]] - code - python\smart_router.py
- [[.score()]] - code - python\smart_router.py
- [[.select_provider()]] - code - python\smart_router.py
- [[.set()]] - code - src\utils\fileStateCache.ts
- [[.status()]] - code - python\smart_router.py
- [[Estimate if this is a large request based on message length.]] - rationale - python\smart_router.py
- [[Exponential moving average update for latency tracking.]] - rationale - python\smart_router.py
- [[Intelligently routes Claude Code API requests to the best     available LLM pro]] - rationale - python\smart_router.py
- [[Lower score = better provider.         strategy 'latency'  'cost'  'balanced]] - rationale - python\smart_router.py
- [[Map a Claude model name to the provider's actual model.]] - rationale - python\smart_router.py
- [[Measure latency to a provider's health endpoint.]] - rationale - python\smart_router.py
- [[Pick the best available provider for this request.         Returns None if no p]] - rationale - python\smart_router.py
- [[Ping all providers and build initial latency scores.]] - rationale - python\smart_router.py
- [[Provider]] - code - python\smart_router.py
- [[Re-ping a provider after a delay and restore if healthy.]] - rationale - python\smart_router.py
- [[Record the outcome of a request.         Called after each proxied request to u]] - rationale - python\smart_router.py
- [[Return current provider status for monitoring.]] - rationale - python\smart_router.py
- [[Route a request to the best provider.         Returns a dict with routing decis]] - rationale - python\smart_router.py
- [[SmartRouter]] - code - python\smart_router.py
- [[api_key()]] - code - python\smart_router.py
- [[build_default_providers()]] - code - python\smart_router.py
- [[error_rate()]] - code - python\smart_router.py
- [[fake_api_key()]] - code - python\tests\test_smart_router.py
- [[is_configured()]] - code - python\smart_router.py
- [[make_provider()]] - code - python\tests\test_smart_router.py
- [[make_router()]] - code - python\tests\test_smart_router.py
- [[smart_router.py]] - code - python\smart_router.py
- [[smart_router.py --------------- Intelligent auto-router for openclaude.  Ins]] - rationale - python\smart_router.py
- [[str()]] - code - src\components\messageActions.tsx
- [[test_get_model_large_message_overrides_claude_label()]] - code - python\tests\test_smart_router.py
- [[test_get_model_large_request()]] - code - python\tests\test_smart_router.py
- [[test_get_model_small_request()]] - code - python\tests\test_smart_router.py
- [[test_is_large_request_long()]] - code - python\tests\test_smart_router.py
- [[test_is_large_request_short()]] - code - python\tests\test_smart_router.py
- [[test_record_result_increments_errors()]] - code - python\tests\test_smart_router.py
- [[test_record_result_increments_requests()]] - code - python\tests\test_smart_router.py
- [[test_record_result_updates_latency()]] - code - python\tests\test_smart_router.py
- [[test_route_excludes_providers()]] - code - python\tests\test_smart_router.py
- [[test_route_raises_when_no_providers()]] - code - python\tests\test_smart_router.py
- [[test_route_returns_best_provider()]] - code - python\tests\test_smart_router.py
- [[test_route_uses_big_model_for_large_message_bodies()]] - code - python\tests\test_smart_router.py
- [[test_score_balanced_strategy_uses_both()]] - code - python\tests\test_smart_router.py
- [[test_score_cost_strategy_prefers_cheaper()]] - code - python\tests\test_smart_router.py
- [[test_score_error_rate_penalty()]] - code - python\tests\test_smart_router.py
- [[test_score_latency_strategy_prefers_faster()]] - code - python\tests\test_smart_router.py
- [[test_score_unconfigured_is_inf()]] - code - python\tests\test_smart_router.py
- [[test_score_unhealthy_is_inf()]] - code - python\tests\test_smart_router.py
- [[test_select_provider_picks_best_score()]] - code - python\tests\test_smart_router.py
- [[test_select_provider_returns_none_when_all_down()]] - code - python\tests\test_smart_router.py
- [[test_select_provider_skips_unhealthy()]] - code - python\tests\test_smart_router.py
- [[test_smart_router.py]] - code - python\tests\test_smart_router.py
- [[test_smart_router.py -------------------- Tests for the SmartRouter. Run pyt]] - rationale - python\tests\test_smart_router.py
- [[test_status_contains_required_fields()]] - code - python\tests\test_smart_router.py
- [[test_status_returns_all_providers()]] - code - python\tests\test_smart_router.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_test_smart_router.py
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_Module logForDebugging()]]
- 1 edge to [[_COMMUNITY_Module state.ts]]
- 1 edge to [[_COMMUNITY_Module ink.tsx]]

## Top bridge nodes
- [[.status()]] - degree 4, connects to 1 community
- [[.set()]] - degree 3, connects to 1 community
- [[str()]] - degree 2, connects to 1 community