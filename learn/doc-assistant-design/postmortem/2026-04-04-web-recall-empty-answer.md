# Web Recall Empty Answer Postmortem

## Incident

- Date: 2026-04-04
- Session transcript: `learn/doc-assistant-design/.mini-doc-assistant-data/runtime/transcripts/ac4785d0-cb49-4724-9c1f-82b8d31b1974.jsonl`
- Question: `How to recall a message in web?`
- Runtime result: the assistant returned a shell answer with only `Notes` and `Sources`, but no actual steps.
- History record: run `89675a1f-6e9b-45f8-8a53-c45f8a260608` was stored as `answered`.

## Executive Summary

This was not a "docs not found" incident.

The system retrieved the correct Web recall documentation, but the grounded answer builder had no task model for message recall or message deletion. Because of that, it failed to convert the retrieved evidence into a `Steps` section and produced an empty procedural shell.

The agent rewrite layer then ran on top of that shell using the non-authoritative `mock/learning-primary` surface. That backend echoed the prompt instead of producing a fresh answer. The runtime rejected the prompt echo and fell back to the already-broken grounded answer, so the user still saw the empty shell.

The final failure boundary is therefore:

1. `generation`: grounded answer synthesis could not map recall/delete docs into actionable steps.
2. `runtime/eval-surface`: the mock learning backend echoed the prompt.
3. `validation/history`: the run was still recorded as a successful answer.

## Artifact Reconstruction

### User-facing transcript

The user asked:

- `How to recall a message in web?`

The runtime answered:

- `Use the documented flow below.`
- Then only `Notes`
- Then only `Sources`

See `learn/doc-assistant-design/.mini-doc-assistant-data/runtime/transcripts/ac4785d0-cb49-4724-9c1f-82b8d31b1974.jsonl:45` and `learn/doc-assistant-design/.mini-doc-assistant-data/runtime/transcripts/ac4785d0-cb49-4724-9c1f-82b8d31b1974.jsonl:46`.

### Runtime surface

The local doc index used by this run was not the current repo `docs/` tree. The cached index metadata points to:

- `/Users/admin/Workspace@RongCloud/For-production/rc-new/docs`

See `learn/doc-assistant-design/.mini-doc-assistant-data/doc-index.meta.json:3`.

This matters because the cited Web recall docs are real retrieval hits from the cached external docs root, not fabricated path labels.

### Retrieved evidence

The run cited these documents:

- `docs/chatsdk-web/community-channel/recall-message.md#Delete a message`
- `docs/chatsdk-web/community-channel/recall-message.md#Handle deletion notifications`
- `docs/chatsdk-web/message/recall.md#Delete a message`
- `docs/chatsdk-web/message/manage-offline-message-duration.mdx#App-level offline message settings`

The first three are directly relevant. The fourth is retrieval noise.

The recall docs themselves contain the missing procedure:

- retrieve the target `Message`
- call `channel.deleteMessageForAll(...)`
- handle `onMessageDeleted` to update the UI

### Agent scratch transcript

The agent scratch transcript shows the exact rewrite prompt. The prompt already contained a broken `Draft answer`, and the sentinel region was prefilled with that same broken answer.

See `learn/doc-assistant-design/.mini-doc-assistant-data/agent-scratch/transcripts/e707960e-0ba7-4d96-88fd-a38062d0d89f.jsonl:1`.

The assistant reply in that scratch run is a prompt echo from `mock/learning-primary`, not a fresh grounded rewrite.

See `learn/doc-assistant-design/.mini-doc-assistant-data/agent-scratch/transcripts/e707960e-0ba7-4d96-88fd-a38062d0d89f.jsonl:2`.

## Reproduction Summary

Re-running the current code path against the cached docs root reproduces the same extractive answer:

- the top hits include the correct Web recall pages
- `buildDocAnswer(... mode: "extractive")` still returns only the intro, notes, and sources
- no `Steps` section is produced even before the agent rewrite layer runs

That proves the first failure is in grounded answer generation, not only in the agent layer.

## Findings

### 1. [High] Retrieval succeeded; this is not a missing-docs incident

The system had enough evidence to answer the user question.

Evidence:

- the runtime transcript cites the correct Web recall pages
- the cached doc index contains those pages
- the content of those pages includes the actual recall procedure and deletion notification handling

This rules out:

- no-hit retrieval
- insufficient-evidence due to absent docs
- a pure citation fabrication failure

### 2. [High] The grounded answer builder has no explicit task path for recall/delete-message questions

`classifyHitRole()` recognizes only these procedural categories:

- `setup`
- `connect`
- `navigation`
- `send_first_message`
- `start_chat`
- `platform`
- `reference`

See `learn/doc-assistant-design/src/doc-answer.ts:531-650`.

There is no role for:

- recall message
- delete message
- revoke message
- message moderation style client actions

As a result, the two most important recall hits are classified as generic `reference` hits instead of actionable task hits.

### 3. [High] The guide-kind selector also lacks a recall/delete branch

`detectGuideAnswerKind()` can classify only:

- `send_message`
- `start_chat`
- `channel_creation`
- fallback `generic_guide`

See `learn/doc-assistant-design/src/doc-answer.ts:1901-1932`.

For the question `How to recall a message in web?`:

- it is not a send-message task
- it is not a start-chat task
- it is not a channel-creation task

So the question falls through to `generic_guide`.

### 4. [High] `generic_guide` step extraction cannot consume recall hits

Inside `buildGuideAnswer()`, the `generic_guide` path builds `stepHits` only from:

- import
- initialize
- connect
- navigation
- channel
- send

See `learn/doc-assistant-design/src/doc-answer.ts:2175-2211`.

Because recall hits do not populate any of those slots, `stepHits` becomes empty. The renderer then emits:

- intro
- notes
- sources

but no `Steps` section.

This is the direct cause of the empty answer body.

### 5. [Medium] Answerability did not protect this case because it has no recall-specific coverage

`answerability.ts` is intentionally narrow. Its current explicit anchor rule set only covers the push-notification-language mismatch scenario.

See `learn/doc-assistant-design/src/answerability.ts:23-42`.

That means this run was never likely to be downgraded by answerability, because:

- the docs were relevant
- the failure was not evidence absence
- the failure was procedural rendering with an unsupported task type

This is a generation taxonomy gap, not primarily an answerability miss.

### 6. [High] The agent rewrite prompt is fragile because it preloads the broken draft answer into the sentinel output region

`buildAgentPromptFromPlan()` places the draft answer twice:

- once in `Draft answer:`
- once again between `FINAL_ANSWER_START` and `FINAL_ANSWER_END`

See `learn/doc-assistant-design/src/answer-render.ts:67-85`.

When the draft answer is already bad, the prompt scaffolding strongly biases echo-style backends toward returning the same broken content.

### 7. [High] The `mock/learning-primary` surface echoed the prompt instead of rewriting from evidence

The scratch transcript shows that the learning backend returned a message beginning with:

- `已通过 mock/learning-primary 完成这次 learning run`
- `你刚才说的是：...`

and then replayed the entire prompt.

See `learn/doc-assistant-design/.mini-doc-assistant-data/agent-scratch/transcripts/e707960e-0ba7-4d96-88fd-a38062d0d89f.jsonl:2`.

This is a classic prompt-echo surface, not a trustworthy answer-generation surface.

### 8. [Medium] The runtime correctly detects prompt echo, but only falls back to the already-broken grounded answer

`extractAcceptedAgentAnswer()` rejects obvious prompt echo. The runtime then uses:

- accepted agent answer, or
- streamed visible sentinel text, or
- `grounded.answer`

See `learn/doc-assistant-design/src/doc-answer.ts:2513-2549` and `learn/doc-assistant-design/src/doc-answer.ts:2691-2752`.

That fallback is reasonable in general. In this incident it preserved the failure because `grounded.answer` was already empty.

### 9. [Medium] The run was misclassified as a successful answer in history

The run history entry records:

- `answered: true`
- `answerOutcome: "answered"`
- `summary: "answered with mock/learning-primary"`

See `learn/doc-assistant-design/.mini-doc-assistant-data/question-history.jsonl:100`.

`summarizeQuestionOutcome()` treats anything that is not clarification, greeting, no-hit, or insufficient as `answered`. It does not inspect:

- `answerSurface.trust`
- `answerSurface.note`
- whether the answer body actually contains steps for a procedural question

See `learn/doc-assistant-design/src/question-history.ts:23-55`.

This means the system's operational logs currently overstate answer success for non-authoritative mock runs.

### 10. [Low] Retrieval ranking admitted a noisy offline-message settings page

The offline-message settings page is not required to answer recall-message behavior, but it still entered the top hit list.

This did not cause the empty answer by itself. The top recall docs were already sufficient. Still, it shows recall/delete queries would benefit from stronger lexical or task-specific ranking constraints.

## Why The System Allowed It

The system allowed this incident because multiple layers each assumed another layer would be safe enough:

- Retrieval assumed downstream answer synthesis could turn relevant procedural evidence into steps.
- Grounded generation assumed its current task taxonomy was broad enough to cover common client actions.
- The agent layer assumed the backend would actually rewrite instead of echoing prompt scaffolding.
- History classification assumed any non-error, non-clarification terminal result counted as a successful answer.

No layer enforced the critical invariant for this question type:

- if the question is procedural and the evidence contains task steps, the final answer must expose actionable steps or be downgraded

## Root Cause

Primary root cause:

- `learn/doc-assistant-design/src/doc-answer.ts` does not model "recall/delete a message" as a first-class procedural task, so the grounded answer builder cannot translate correct recall evidence into `Steps`.

Secondary root causes:

- `learn/doc-assistant-design/src/answer-render.ts` uses a sentinel prompt format that preloads the broken draft answer into the output slot.
- `mock/learning-primary` is a non-authoritative prompt-echo surface and should not be treated as evidence that rewrite quality is acceptable.
- `learn/doc-assistant-design/src/question-history.ts` records such runs as answered.

## Recommended Fixes

### Immediate guardrails

- Add a dedicated procedural branch for message recall or message deletion questions in `learn/doc-assistant-design/src/doc-answer.ts`.
- Teach `classifyHitRole()` to recognize recall/delete-message docs as actionable task hits rather than generic references.
- Teach `detectGuideAnswerKind()` to return a dedicated kind for recall/delete-message flows.

### Structural fixes

- Stop seeding the `FINAL_ANSWER_START` block with the full draft answer. Keep the output contract, but do not preload the exact broken answer into the slot the backend is supposed to generate.
- Treat `mock/learning-primary` and other `non_authoritative` surfaces as debug-only answer surfaces, not normal answer-success evidence.
- Consider bypassing agent rewrite entirely for grounded extractive answers that already satisfy the answer contract, especially in non-authoritative learning mode.

### Validation fixes

- Add a validator rule: if a procedural question has retrieved `task_steps` evidence but the rendered answer has no `Steps` section, downgrade to `insufficient`.
- Add a validator rule for recall/delete questions that requires at least one task action such as:
  - retrieve message
  - call `deleteMessageForAll`
  - handle deletion notification

### Observability fixes

- Record the grounded answer before agent rewrite in the run trace so empty grounded shells can be distinguished from bad rewrites.
- Record a trace flag when task-shaped evidence exists but the rendered answer omitted steps.
- Surface `answerSurface.trust` in history summaries or exclude non-authoritative runs from "answered" success metrics.

## Regression Coverage To Add

Add tests covering all of the following:

1. `How to recall a message in web?`
   Expect a `Steps` section with recall-specific actions and recall citations.

2. `How to delete a message in web direct channel?`
   Expect direct-channel recall guidance, not community-channel-only guidance.

3. Agent mode with `mock/learning-primary` on the same question
   Expect the final answer to preserve the grounded recall steps and never regress to an empty shell.

4. History classification for `non_authoritative` answer surfaces
   Expect such runs not to be counted as a clean `answered` success unless explicitly allowed.

5. Validator downgrade on procedural-no-steps cases
   Expect insufficient-evidence downgrade when task evidence exists but answer synthesis emits no steps.

## Suggested Rollout Order

1. Fix grounded answer generation for recall/delete-message tasks in `learn/doc-assistant-design/src/doc-answer.ts`.
2. Add regression tests for extractive and agent mode on the Web recall question.
3. Tighten validation so future unsupported procedural tasks fail closed instead of returning empty shells.
4. Adjust history and metrics classification for `non_authoritative` answer surfaces.
5. Refine retrieval ranking so offline-message settings do not outrank or pollute recall task answers.

## Bottom Line

The incident was caused by unsupported procedural answer synthesis, not by missing documentation.

The system already had the right docs. It failed to convert those docs into steps, then ran a non-authoritative rewrite layer that echoed the prompt, and finally recorded the run as if it had answered successfully.
