---
type: community
cohesion: 0.14
members: 25
---

# Module: test_ollama_provider.py

**Cohesion:** 0.14 - loosely connected
**Members:** 25 nodes

## Members
- [[_extract_ollama_image_data()]] - code - python\ollama_provider.py
- [[anthropic_to_ollama_messages()]] - code - python\ollama_provider.py
- [[check_ollama_running()]] - code - python\ollama_provider.py
- [[list_ollama_models()]] - code - python\ollama_provider.py
- [[normalize_ollama_model()]] - code - python\ollama_provider.py
- [[ollama_chat()]] - code - python\ollama_provider.py
- [[ollama_chat_stream()]] - code - python\ollama_provider.py
- [[ollama_provider.py]] - code - python\ollama_provider.py
- [[ollama_provider.py ------------------ Adds native Ollama support to openclaude]] - rationale - python\ollama_provider.py
- [[test_converts_base64_image_block_to_ollama_images()]] - code - python\tests\test_ollama_provider.py
- [[test_converts_image_block_to_placeholder()]] - code - python\tests\test_ollama_provider.py
- [[test_converts_multi_turn()]] - code - python\tests\test_ollama_provider.py
- [[test_converts_string_content()]] - code - python\tests\test_ollama_provider.py
- [[test_converts_text_block_list()]] - code - python\tests\test_ollama_provider.py
- [[test_list_models_returns_names()]] - code - python\tests\test_ollama_provider.py
- [[test_normalize_empty()]] - code - python\tests\test_ollama_provider.py
- [[test_normalize_no_prefix()]] - code - python\tests\test_ollama_provider.py
- [[test_normalize_strips_prefix()]] - code - python\tests\test_ollama_provider.py
- [[test_ollama_chat_includes_base64_images_in_payload()]] - code - python\tests\test_ollama_provider.py
- [[test_ollama_chat_prepends_system()]] - code - python\tests\test_ollama_provider.py
- [[test_ollama_chat_returns_anthropic_format()]] - code - python\tests\test_ollama_provider.py
- [[test_ollama_provider.py]] - code - python\tests\test_ollama_provider.py
- [[test_ollama_provider.py Run pytest pythonteststest_ollama_provider.py -v]] - rationale - python\tests\test_ollama_provider.py
- [[test_ollama_running_false_on_exception()]] - code - python\tests\test_ollama_provider.py
- [[test_ollama_running_true()]] - code - python\tests\test_ollama_provider.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Module:_test_ollama_provider.py
SORT file.name ASC
```
