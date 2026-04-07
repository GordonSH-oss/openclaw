# Doc Assistant Answer Synthesis Redesign Report

## Scope

This report redesigns the answer-synthesis layer in `learn/doc-assistant-design`.

It focuses on the boundary from retrieved `DocSearchHit[]` to grounded answer sections. It does not propose a new retrieval engine or a new LLM prompt strategy. The goal is to remove the current dependence on scene-by-scene answer enums and replace it with a smaller, more stable semantic model.

## Executive Summary

The current design is usable for a small set of common tasks, but it will become increasingly brittle if it keeps expanding by adding new `AnswerRole` and `GroundedAnswerKind` cases.

The main problem is not that the code has enums. The main problem is that the system currently maintains multiple overlapping taxonomies for the same question:

- `QuestionState.taskKind` in `src/question-state.ts`
- procedural task detection in `src/question-planning.ts`
- hit classification in `src/doc-answer.ts`
- answer-kind routing in `src/doc-answer.ts`
- validator heuristics in `src/answer-validator.ts`

Those taxonomies are not modeled from one stable source of truth. As a result, every new procedural scenario tends to require edits in several places:

- classify the hit
- classify the question
- choose a rendering template
- pick step hits
- teach the validator what success looks like

That design scales by incident patching, not by composition.

The recommended redesign is:

1. Keep `QuestionState` as the shared state contract.
2. Replace `AnswerRole` and most `GroundedAnswerKind` branching with a compositional `TaskFrame`.
3. Split answer synthesis into four smaller stages:
   - question framing
   - evidence labeling
   - step assembly
   - section rendering
4. Move most scenario knowledge from hard-coded answer cases to reusable action/object/capability labels.
5. Keep a small number of render modes only where answer structure is genuinely different.

## Current Design

### What works

The current pipeline already has several good building blocks:

- `QuestionState` captures stable dimensions such as `intent`, `platform`, `channelKind`, `apiLayer`, `product`, and `taskKind`.
- `planDocQuestion()` already separates concept and procedural segments.
- `detectDocShape()` already provides a coarse retrieval-oriented document shape.
- `validateAnswer()` already acts as a post-generation guardrail.

This means the system is not starting from nothing. The redesign should build on those parts instead of replacing them.

### What is unstable

The instability is centered in `src/doc-answer.ts`.

Current answer synthesis relies on:

- `AnswerRole`
- `GroundedAnswerKind`
- many path- and phrase-specific checks in `classifyHitRole()`
- additional question-based switches in `detectGuideAnswerKind()`
- answer-kind-specific step selection logic in `buildGuideAnswer()`

This creates three problems.

#### Problem 1: Duplicate semantics

The same concept appears in multiple layers with different names and different granularity.

Examples:

- `QuestionState.taskKind` already distinguishes procedural classes.
- `GroundedAnswerKind` introduces another routing taxonomy.
- `AnswerRole` then introduces a hit taxonomy that partially overlaps with both.

This duplication creates drift.

#### Problem 2: New tasks require cross-cutting edits

To support a new scenario such as message recall, the current design typically requires:

- adding a new hit role or extending an existing one
- adding a new answer kind or a new question detector
- adding new step-hit extraction rules
- extending API-term collection
- extending validator expectations

That is an architecture smell. A new user task should usually be data flowing through existing stages, not a new hard-coded route.

#### Problem 3: The fallback path is too generic

When a scenario is not explicitly recognized, the system falls back to `generic_guide`.

That fallback is useful, but it is too weak because it does not understand the procedural structure of the evidence. It only knows a narrow set of role buckets. So the system oscillates between:

- over-specialized branches
- underpowered generic fallback

There is not enough middle structure.

## Design Goal

The redesign should satisfy these properties:

1. The system must not try to enumerate every user scenario.
2. The system must still support high-quality structured answers for common procedural tasks.
3. The model must be additive.
   New tasks should usually add labels, not new control flow branches.
4. The validator must check against the same semantic model used by synthesis.
5. The fallback path must remain useful when the task is unfamiliar.

## Proposed Architecture

### Core idea

Replace scene-driven synthesis with frame-driven synthesis.

The answer generator should operate on a single intermediate representation:

```ts
type TaskFrame = {
  intent: "concept" | "procedural" | "mixed";
  product?: "chat" | "call" | "server";
  platform?: "android" | "ios" | "web" | "flutter";
  apiLayer?: "client" | "server";
  channelKind?: "direct" | "group" | "community" | "open";
  action?: "connect" | "start" | "create" | "send" | "recall" | "delete" | "update" | "query";
  object?: "message" | "channel" | "conversation" | "notification" | "user" | "webhook";
  objectQualifier?: "text" | "image" | "file" | "voice" | "targeted" | "generic";
  responseMode: "definition" | "procedure" | "mixed" | "clarification" | "insufficient";
};
```

This frame should come from `QuestionState` plus a small amount of answer-time inference from evidence. It should be the only semantic contract that answer synthesis and validation share.

### Stage 1: Question framing

Add a dedicated `buildTaskFrame(question, state, hits)` stage.

Responsibilities:

- derive `responseMode`
- derive `action`
- derive `object`
- keep using `QuestionState` as the base source of truth
- avoid reading doc path details when the question already says enough

This stage should absorb logic that is currently split across:

- `detectGuideAnswerKind()`
- `isSendMessageQuestion()`
- `isMessageRecallQuestion()`
- `isStartChatQuestion()`
- ad hoc branches in `buildGuideAnswer()`

The important difference is that the output is not a large case enum. It is a composed semantic frame.

### Stage 2: Evidence labeling

Replace `AnswerRole` with smaller evidence labels.

Recommended evidence model:

```ts
type EvidenceLabel =
  | "setup"
  | "connect"
  | "navigate"
  | "action"
  | "event"
  | "overview"
  | "definition"
  | "reference"
  | "server_only"
  | "client_only";

type LabeledHit = DocSearchHit & {
  labels: EvidenceLabel[];
  docShape: DocSearchDocShape;
  platform?: QuestionPlatform;
  channelKind?: QuestionChannelKind;
  action?: TaskFrame["action"];
  object?: TaskFrame["object"];
};
```

This is a better level of abstraction than `message_recall` or `send_first_message` as hit roles.

Reason:

- `deleteMessageForAll()` is an `action` hit about `recall` on `message`
- `onMessageDeleted` is an `event` hit about `recall` on `message`
- a setup page is still just `setup`

The hit does not need to encode the entire end-user scenario.

### Stage 3: Step assembly

Add a generic planner that assembles answer steps from the frame and labeled evidence.

Recommended API:

```ts
type AnswerStep = {
  kind: "prerequisite" | "action" | "verification" | "event_handling" | "note";
  text: string;
  citations: DocCitation[];
  sourceHitIds: string[];
};

type AnswerOutline = {
  intro?: string;
  prerequisites: AnswerStep[];
  steps: AnswerStep[];
  apis: string[];
  notes: string[];
  citations: DocCitation[];
};
```

Assembly rules should be generic:

- if the frame says `responseMode=procedure`, the planner must search for action-bearing hits
- if the frame has `action=recall` and `object=message`, the planner should prefer:
  - `action` hits with message deletion verbs
  - `event` hits with deletion callback coverage
- if the frame has `action=send` and `object=message`, the planner should prefer:
  - send action hits
  - subtype-specific params

This is still rule-based, but the rules are now per semantic dimension, not per whole scenario.

### Stage 4: Rendering

Keep only a very small set of final render modes:

- `definition`
- `procedure`
- `mixed`
- `clarification`
- `insufficient`

These modes are stable because they describe output structure, not product scenarios.

That means:

- `message recall` is not a render mode
- `send message` is not a render mode
- `start chat` is not a render mode

They are task frames rendered through the same `procedure` renderer.

## What to Remove

The redesign should delete or shrink the following patterns over time.

### 1. Scenario-specific hit roles

Current roles such as:

- `message_recall`
- `send_first_message`
- `start_chat`

should not remain the primary evidence abstraction.

They mix:

- what the doc chunk is
- what action it describes
- what end-user scenario the system inferred

That is too much packed into one enum.

### 2. Scenario-specific answer kinds

Current answer kinds such as:

- `message_recall`
- `send_message`
- `start_chat`
- `channel_creation`

should be folded into a smaller structural response mode plus a richer `TaskFrame`.

### 3. Answer synthesis logic that duplicates `QuestionState`

If `QuestionState` already tells us:

- platform
- channel kind
- api layer
- product
- procedural task kind

then answer synthesis should consume that object, not re-derive parallel classifications from scratch.

## What to Keep

Some current constructs are still good and should remain.

### 1. `QuestionState`

This should remain the canonical question snapshot.

It may need one controlled extension:

```ts
type QuestionAction =
  | "connect"
  | "start"
  | "create"
  | "send"
  | "recall"
  | "delete"
  | "update"
  | "query";

type QuestionObject = "message" | "channel" | "conversation" | "notification" | "user" | "webhook";
```

If added, this should happen in `QuestionState`, not as ad hoc answer-local inference only.

### 2. `DocSearchDocShape`

This is still useful because quickstart pages and specialized task pages matter for ranking and outline choice.

### 3. Clarification and answerability

Those guards should remain separate from rendering. They should consume the same `TaskFrame`, but they should not be merged into the renderer.

## Proposed Data Flow

The new procedural answer path should look like this:

1. `buildQuestionState(question)`
2. `decideClarification(state, hits)`
3. `decideAnswerability(state, hits)`
4. `buildTaskFrame(question, state, hits)`
5. `labelEvidence(hits, frame)`
6. `assembleAnswerOutline(frame, labeledHits)`
7. `renderAnswerOutline(frame, outline, language)`
8. `validateAnswer(frame, evidence, answer)`

This gives each stage one job.

## Validator Redesign

The validator should stop inferring the expected task shape from raw text as much as possible.

Instead, it should validate against the same `TaskFrame`.

Examples:

- if `frame.responseMode === "procedure"`, require at least one actionable step
- if `frame.action === "recall"` and `frame.object === "message"`, accept:
  - delete-for-all action coverage
  - optional deletion event coverage
- if `frame.platform === "web"`, fail answers that switch to Android or iOS
- if `frame.apiLayer === "client"`, fail answers that only cite server endpoints unless the answer explicitly says client SDK does not support the operation

This reduces drift between synthesis and validation.

## Migration Plan

The migration should be incremental.

### Phase 1: Introduce the new frame

Add:

- `TaskFrame`
- `buildTaskFrame()`

Do not remove old enums yet. Use the new frame only for tracing and tests first.

Deliverables:

- unit tests for frame construction
- trace output that shows frame fields

### Phase 2: Introduce evidence labeling

Add:

- `labelEvidence()`
- `LabeledHit`

At this phase, keep current answer generation but record both:

- old role
- new labels

Deliverables:

- side-by-side snapshots for top hits on known questions
- regression tests for recall, send, connect, create, webhook

### Phase 3: Replace procedural answer assembly

Introduce:

- `assembleAnswerOutline()`
- shared `procedure` renderer

Migrate known procedural tasks first:

- send message
- recall message
- connect
- channel creation
- webhook setup

At this point, `GroundedAnswerKind` should shrink to structural modes.

### Phase 4: Align validator

Update `answer-validator.ts` to consume `TaskFrame`.

Remove validator assumptions that depend on old scene enums.

### Phase 5: Remove legacy classification

Delete or reduce:

- `AnswerRole`
- `detectGuideAnswerKind()`
- scenario-specific branches in `buildGuideAnswer()`

The old fallback path should be replaced by `procedure` rendering over incomplete but still labeled evidence.

## Test Strategy

The redesign needs tests at three levels.

### 1. Frame tests

Examples:

- `How to recall a message in web?` -> `procedure + recall + message + web`
- `What is community channel?` -> `definition`
- `What is community channel? How to create it?` -> `mixed`

### 2. Evidence labeling tests

Examples:

- `deleteMessageForAll` hit -> `action`, `object=message`, `action=recall`
- `onMessageDeleted` hit -> `event`, `object=message`, `action=recall`
- `Connect` page -> `connect`

### 3. Outline tests

Examples:

- recall answers produce at least one actionable step
- send answers produce one send step plus optional prerequisites
- generic procedural questions still produce steps when evidence is narrow but directly actionable

## Risks

### Risk 1: Over-modeling

If the new frame becomes too detailed, it will repeat the same mistake in another form.

Constraint:

- only add dimensions that are reused by both synthesis and validation

### Risk 2: Weak label quality

If evidence labeling is poor, the new planner will still fail.

Mitigation:

- keep labels coarse
- prefer additive labels over mutually exclusive labels
- test on a small fixed suite of representative questions

### Risk 3: Migration complexity

The current code already ships behavior. A full rewrite would be risky.

Mitigation:

- run new framing and labeling in shadow mode first
- keep old rendering until outline parity is visible in tests

## Recommended Implementation Order

1. Add `TaskFrame` and frame tests.
2. Add evidence labeling and snapshot tests.
3. Add `assembleAnswerOutline()` and route only `message_recall` through it first.
4. Migrate `send_message`, `start_chat`, and `channel_creation`.
5. Collapse old answer kinds to structural response modes.
6. Update validator to use `TaskFrame`.
7. Remove legacy branches.

## Final Recommendation

The current design is acceptable as a tactical rule-based prototype, but it is not a good long-term answer-synthesis architecture.

The correct redesign is not "remove enums entirely". The correct redesign is:

- keep enums only for stable structural boundaries
- move scenario knowledge into a compositional semantic frame
- label evidence with reusable capabilities
- assemble answers from those capabilities

That gives the system a path to support many more question types without continuing to grow by one incident, one branch, and one enum at a time.
