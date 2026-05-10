<!--
source_id: anthropic-claude-token-efficient-tool-use
source_url: https://platform.claude.com/docs/en/about-claude/models/migration-guide
reader: jina
reader_url: https://r.jina.ai/https://platform.claude.com/docs/en/about-claude/models/migration-guide
fetched_at: 2026-05-10T07:57:40.903Z
-->

# Token-efficient tool use notes

#### Additional recommended changes

*   **Remove legacy beta headers:** Remove `token-efficient-tools-2025-02-19` and `output-128k-2025-02-19`. All Claude 4+ models have built-in token-efficient tool use and these headers have no effect.

### Migration checklist (from Opus 4.5 or earlier)

*   - [x] Update model ID to `claude-opus-4-7`
*   - [x] Apply all [Opus 4.7 breaking changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-opus-4-7) (extended thinking removed, sampling parameters removed, thinking display omitted by default, updated tokenization)
*   - [x] **BREAKING:** Remove assistant message prefills (returns 400 error); use structured outputs or `output_config.format` instead
*   - [x] **BREAKING on Opus 4.7:** Replace `thinking: {type: "enabled", budget_tokens: N}` with `thinking: {type: "adaptive"}` plus the [effort parameter](https://platform.claude.com/docs/en/build-with-claude/effort) (returns 400 on Opus 4.7)
*   - [x] Verify tool call JSON parsing uses a standard JSON parser
*   - [x] Remove `effort-2025-11-24` beta header (effort is now GA)
*   - [x] Remove `fine-grained-tool-streaming-2025-05-14` beta header
*   - [x] Remove `interleaved-thinking-2025-05-14` beta header (adaptive thinking enables interleaved thinking automatically)
*   - [x] Migrate `output_format` to `output_config.format` (if applicable)
*   - [x] If migrating from Claude 4.1 or earlier: remove `temperature`, `top_p`, and `top_k` (non-default values return 400 on Opus 4.7)
*   - [x] If migrating from Claude 4.1 or earlier: update tool versions (`text_editor_20250728`, `code_execution_20250825`)
*   - [x] If migrating from Claude 4.1 or earlier: handle `refusal` stop reason
*   - [x] If migrating from Claude 4.1 or earlier: handle `model_context_window_exceeded` stop reason
*   - [x] If migrating from Claude 4.1 or earlier: verify tool string parameter handling for trailing newlines
*   - [x] If migrating from Claude 4.1 or earlier: remove legacy beta headers (`token-efficient-tools-2025-02-19`, `output-128k-2025-02-19`)
*   - [x] Review and update prompts following [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
*   - [x] Test in development environment before production deployment

* * *

## Migrating to Claude Sonnet 4.6

Claude Sonnet 4.6 combines strong intelligence with fast performance, featuring improved agentic search capabilities and free code execution when used with web search or web fetch. It is ideal for everyday coding, analysis, and content tasks.

For a complete overview of capabilities, see the [models overview](https://platform.claude.com/docs/en/about-claude/models/overview).

Sonnet 4.6 pricing is $3 per million input tokens, $15 per million output tokens. See [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) for details.

**Update your model name:**

```
# From Sonnet 4.5
model = "claude-sonnet-4-5"  # Before
model = "claude-sonnet-4-6"  # After

# From Sonnet 4
model = "claude-sonnet-4-20250514"  # Before
model = "claude-sonnet-4-6"  # After
```

### Breaking changes

#### When migrating from Sonnet 4.5

1.   **Prefilling assistant messages is no longer supported**

  This is a breaking change when migrating from Sonnet 4.5 or earlier.
Prefilling assistant messages returns a `400` error on Sonnet 4.6. Use [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), system prompt instructions, or `output_config.format` instead.

**Common prefill use cases and migrations:**

    *   **Controlling output formatting** (forcing JSON/YAML output): Use [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) or tools with enum fields for classification tasks.

    *   **Eliminating preambles** (removing "Here is..." phrases): Add direct instructions in the system prompt: "Respond directly without preamble. Do not start with phrases like 'Here is...', 'Based on...', etc."

    *   **Avoiding bad refusals:** Claude is much better at appropriate refusals now. Clear prompting in the user message without prefill should be sufficient.

    *   **Continuations** (resuming interrupted responses): Move the continuation to the user message: "Your previous response was interrupted and ended with `[previous_response]`. Continue from where you left off."

    *   **Context hydration / role consistency** (refreshing context in long conversations): Inject what were previously prefilled-assistant reminders into the user turn instead.

2.   **Tool parameter JSON escaping may differ**

  This is a breaking change when migrating from Sonnet 4.5 or earlier.
JSON string escaping in tool parameters may differ from previous models. Standard JSON parsers handle this automatically, but custom string-based parsing may need updates.

#### When migrating from Claude 3.x

1.   **Update sampling parameters**

  This is a breaking change when migrating from Claude 3.x models.
Use only `temperature` OR `top_p`, not both.

2.   **Update tool versions**

  This is a breaking change when migrating from Claude 3.x models.
Update to the latest tool versions (`text_editor_20250728`, `code_execution_20250825`). Remove any code using the `undo_edit` command.

3.   **Handle the `refusal` stop reason**

Update your application to [handle `refusal` stop reasons](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals).

4.   **Update your prompts for behavioral changes**

Claude 4 models have a more concise, direct communication style. Review [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) for optimization guidance.

### Recommended changes

1.   **Remove `fine-grained-tool-streaming-2025-05-14` beta header:** Fine-grained tool streaming is now GA on Sonnet 4.6 and no longer requires a beta header.
2.   **Migrate `output_format` to `output_config.format`:** The `output_format` parameter is deprecated. Use `output_config.format` instead.

### Migrating from Sonnet 4.5

Consider migrating from Sonnet 4.5 to Sonnet 4.6, which delivers more intelligence at the same price point.

Sonnet 4.6 defaults to an effort level of `high`, in contrast to Sonnet 4.5 which had no effort parameter. Consider adjusting the effort parameter as you migrate from Sonnet 4.5 to Sonnet 4.6. If not explicitly set, you may experience higher latency with the default effort level.

#### If you're not using extended thinking

If you're not using extended thinking on Sonnet 4.5, you can continue without it on Sonnet 4.6. You should explicitly set effort to the level appropriate for your use case. At `low` effort with thinking disabled, you can expect similar or better performance relative to Sonnet 4.5 with no extended thinking.

cURL CLI Python TypeScript C#Go Java PHP Ruby

```
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=8192,
    output_config={"effort": "low"},
    messages=[{"role": "user", "content": "Your prompt here"}],
)
```

#### If you're using extended thinking

If you're using extended thinking with `budget_tokens` on Sonnet 4.5, it is still functional on Sonnet 4.6 but is deprecated. Migrate to [adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) with the [effort parameter](https://platform.claude.com/docs/en/build-with-claude/effort).

##### Migrating to adaptive thinking

[Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) is the recommended replacement for `budget_tokens` on Sonnet 4.6. It is particularly well suited to the following workload patterns:

*   **Autonomous multi-step agents:** coding agents that turn requirements into working software, data analysis pipelines, and bug finding where the model runs independently across many steps. Adaptive thinking lets the model calibrate its reasoning per step, staying on path over longer trajectories. For these workloads, start at `high` effort. If latency or token usage is a concern, scale down to `medium`.
*   **Computer use agents:** Sonnet 4.6 achieved best-in-class accuracy on computer use evaluations using adaptive mode.
*   **Bimodal workloads:** a mix of easy and hard tasks where adaptive skips thinking on simple queries and reasons deeply on complex ones.

When using adaptive thinking, evaluate `medium` and `high` effort on your tasks. The right level depends on your workload's tradeoff between quality, latency, and token usage.

cURL CLI Python TypeScript C#Go Java PHP Ruby

```
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=64000,
    thinking={"type": "adaptive"},
    output_config={"effort": "medium"},
    messages=[{"role": "user", "content": "Your prompt here"}],
)
```

If you see inconsistent behavior or quality regressions with adaptive thinking, try lowering the [effort](https://platform.claude.com/docs/en/build-with-claude/effort) setting or using `max_tokens` as a hard limit first. Extended thinking with `budget_tokens` is still functional on Sonnet 4.6 but is deprecated and no longer recommended.

##### Keeping budget_tokens during migration

If you need to keep `budget_tokens` temporarily while migrating, a budget around 16k tokens provides headroom for harder problems without risk of runaway token usage. This configuration is deprecated and will be removed in a future model release.

###### Coding and agentic use cases

For agentic coding, frontend design, tool-heavy workflows, and complex enterprise workflows, start with `medium` effort. If you find latency is too high, consider reducing effort to `low`. If you need higher intelligence, consider increasing effort to `high` or migrating to Opus 4.7.

cURL CLI Python TypeScript C#Go Java PHP Ruby

```
response = client.beta.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16384,
    thinking={"type": "enabled", "budget_tokens": 16384},
    output_config={"effort": "medium"},
    betas=["interleaved-thinking-2025-05-14"],
    messages=[{"role": "user", "content": "Your prompt here"}],
)
```

###### Chat and non-coding use cases

For chat, content generation, search, classification, and other non-coding tasks, start with `low` effort with extended thinking. If you need more depth, increase effort to `medium`.

cURL CLI Python TypeScript C#Go Java PHP Ruby

```
response = client.beta.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=8192,
    thinking={"type": "enabled", "budget_tokens": 16384},
    output_config={"effort": "low"},
    betas=["interleaved-thinking-2025-05-14"],
    messages=[{"role": "user", "content": "Your prompt here"}],
)
```

### Sonnet 4.6 migration checklist

*   - [x] Update model ID to `claude-sonnet-4-6`
*   - [x] **BREAKING:** Remove assistant message prefilling; use structured outputs or `output_config.format` instead
*   - [x] **BREAKING:** Verify tool parameter JSON parsing handles escaping differences
*   - [x] **BREAKING:** Update tool versions to latest (`text_editor_20250728`, `code_execution_20250825`); legacy versions are not supported (if migrating from 3.x)
*   - [x] **BREAKING:** Remove any code using the `undo_edit` command (if applicable)
*   - [x] **BREAKING:** Update sampling parameters to use only `temperature` OR `top_p`, not both (if migrating from 3.x)
*   - [x] Handle new `refusal` stop reason in your application
*   - [x] Remove `fine-grained-tool-streaming-2025-05-14` beta header (now GA)
*   - [x] Migrate `output_format` to `output_config.format`
*   - [x] Review and update prompts following [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
*   - [x] **Recommended:** Migrate from `thinking: {type: "enabled", budget_tokens: N}` to `thinking: {type: "adaptive"}` with the [effort parameter](https://platform.claude.com/docs/en/build-with-claude/effort) (`budget_tokens` is deprecated and will be removed in a future release)
*   - [x] Test in development environment before production deployment

* * *

## Migrating to Claude Sonnet 4.5

Claude Sonnet 4.5 combines strong intelligence with fast performance, making it ideal for everyday coding, analysis, and content tasks.

For a complete overview of capabilities, see the [models overview](https://platform.claude.com/docs/en/about-claude/models/overview).

Sonnet 4.5 pricing is $3 per million input tokens, $15 per million output tokens. See [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) for details.

**Update your model name:**

```
# From Sonnet 4
model = "claude-sonnet-4-20250514"  # Before
model = "claude-sonnet-4-5-20250929"  # After

# From Sonnet 3.7
model = "claude-3-7-sonnet-20250219"  # Before
model = "claude-sonnet-4-5-20250929"  # After
```

### Breaking changes

These breaking changes apply when migrating from Claude 3.x Sonnet models.

1.   **Update sampling parameters**

  This is a breaking change when migrating from Claude 3.x models.
Use only `temperature` OR `top_p`, not both.

2.   **Update tool versions**

  This is a breaking change when migrating from Claude 3.x models.
Update to the latest tool versions (`text_editor_20250728`, `code_execution_20250825`). Remove any code using the `undo_edit` command.

3.   **Handle the `refusal` stop reason**

Update your application to [handle `refusal` stop reasons](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals).

4.   **Update your prompts for behavioral changes**

Claude 4 models have a more concise, direct communication style. Review [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) for optimization guidance.

### Sonnet 4.5 migration checklist

*   - [x] Update model ID to `claude-sonnet-4-5-20250929`
*   - [x] **BREAKING:** Update tool versions to latest (`text_editor_20250728`, `code_execution_20250825`); legacy versions are not supported (if migrating from 3.x)
*   - [x] **BREAKING:** Remove any code using the `undo_edit` command (if applicable)
*   - [x] **BREAKING:** Update sampling parameters to use only `temperature` OR `top_p`, not both (if migrating from 3.x)
*   - [x] Handle new `refusal` stop reason in your application
*   - [x] Review and update prompts following [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
*   - [x] Consider enabling extended thinking for complex reasoning tasks
*   - [x] Test in development environment before production deployment

* * *

## Migrating to Claude Haiku 4.5

Claude Haiku 4.5 is the fastest and most intelligent Haiku model with near-frontier performance, delivering premium model quality for interactive applications and high-volume processing.

For a complete overview of capabilities, see the [models overview](https://platform.claude.com/docs/en/about-claude/models/overview).

Haiku 4.5 pricing is $1 per million input tokens, $5 per million output tokens. See [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) for details.

**Update your model name:**

```
# From Haiku 3.5
model = "claude-3-5-haiku-20241022"  # Before
model = "claude-haiku-4-5-20251001"  # After
```

**Review new rate limits:** Haiku 4.5 has separate rate limits from Haiku 3.5. See [Rate limits documentation](https://platform.claude.com/docs/en/api/rate-limits) for details.

For significant performance improvements on coding and reasoning tasks, consider enabling extended thinking with `thinking: {type: "enabled", budget_tokens: N}`.

Extended thinking impacts [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#caching-with-thinking-blocks) efficiency.

Extended thinking is deprecated in Claude 4.6 or newer models. If using newer models, use [adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking) instead.

**Explore new capabilities:** See the [models overview](https://platform.claude.com/docs/en/about-claude/models/overview) for details on context awareness, increased output capacity (64k tokens), higher intelligence, and improved speed.

### Breaking changes

These breaking changes apply when migrating from Claude 3.x Haiku models.

1.   **Update sampling parameters**

  This is a breaking change when migrating from Claude 3.x models.
Use only `temperature` OR `top_p`, not both.

2.   **Update tool versions**

  This is a breaking change when migrating from Claude 3.x models.
Update to the latest tool versions (`text_editor_20250728`, `code_execution_20250825`). Remove any code using the `undo_edit` command.

3.   **Handle the `refusal` stop reason**

Update your application to [handle `refusal` stop reasons](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals).

4.   **Update your prompts for behavioral changes**

Claude 4 models have a more concise, direct communication style. Review [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) for optimization guidance.

### Haiku 4.5 migration checklist

*   - [x] Update model ID to `claude-haiku-4-5-20251001`
*   - [x] **BREAKING:** Update tool versions to latest (`text_editor_20250728`, `code_execution_20250825`); legacy versions are not supported
*   - [x] **BREAKING:** Remove any code using the `undo_edit` command (if applicable)
*   - [x] **BREAKING:** Update sampling parameters to use only `temperature` OR `top_p`, not both
*   - [x] Handle new `refusal` stop reason in your application
*   - [x] Review and adjust for new rate limits (separate from Haiku 3.5)
*   - [x] Review and update prompts following [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
*   - [x] Consider enabling extended thinking for complex reasoning tasks
*   - [x] Test in development environment before production deployment

* * *

## Get help

*   Check the [API documentation](https://platform.claude.com/docs/en/api/overview) for detailed specifications
*   Review [model capabilities](https://platform.claude.com/docs/en/about-claude/models/overview) for performance comparisons
*   Review [API release notes](https://platform.claude.com/docs/en/release-notes/api) for API updates
*   Contact support if you encounter any issues during migration

Was this page helpful?

*   [Migrating to Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-opus-4-7)
*   [Update your model name](https://platform.claude.com/docs/en/about-claude/models/migration-guide#update-your-model-name)
*   [Breaking changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#breaking-changes)
*   [Choosing an effort level](https://platform.claude.com/docs/en/about-claude/models/migration-guide#choosing-an-effort-level)
*   [Behavior changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#behavior-changes)
*   [Recommended changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#recommended-changes)
*   [Migration checklist](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migration-checklist)
*   [Migrating to Claude Opus 4.7 from Opus 4.5 or earlier](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-opus-4-7-from-opus-4-5-or-earlier)
*   [Update your model name](https://platform.claude.com/docs/en/about-claude/models/migration-guide#update-your-model-name-2)
*   [Breaking changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#breaking-changes-2)
*   [Recommended changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#recommended-changes-2)
*   [Migrating from Claude 4.1 or earlier](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-from-claude-4-1-or-earlier)
*   [Migration checklist (from Opus 4.5 or earlier)](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migration-checklist-from-opus-4-5-or-earlier)
*   [Migrating to Claude Sonnet 4.6](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-sonnet-4-6)
*   [Breaking changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#breaking-changes-3)
*   [Recommended changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#recommended-changes-3)
*   [Migrating from Sonnet 4.5](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-from-sonnet-4-5)
*   [Sonnet 4.6 migration checklist](https://platform.claude.com/docs/en/about-claude/models/migration-guide#sonnet-4-6-migration-checklist)
*   [Migrating to Claude Sonnet 4.5](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-sonnet-4-5)
*   [Breaking changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#breaking-changes-4)
*   [Sonnet 4.5 migration checklist](https://platform.claude.com/docs/en/about-claude/models/migration-guide#sonnet-4-5-migration-checklist)
*   [Migrating to Claude Haiku 4.5](https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-haiku-4-5)
*   [Breaking changes](https://platform.claude.com/docs/en/about-claude/models/migration-guide#breaking-changes-5)
*   [Haiku 4.5 migration checklist](https://platform.claude.com/docs/en/about-claude/models/migration-guide#haiku-4-5-migration-checklist)
*   [Get help](https://platform.claude.com/docs/en/about-claude/models/migration-guide#get-help)
