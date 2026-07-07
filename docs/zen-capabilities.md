# Zen Capabilities

Zen is a local-first, AI-integrated academic workspace. Its strongest shape is not just "notes plus chat", but a system that turns messy course material into focused study sessions, evidence-based mastery, and deadline-aware academic planning.

This document is an app-wide capability inventory extracted from the current source tree: `src`, `api`, `browser-extension`, `src-tauri`, `scripts`, release notes, stores, UI panels, service modules, sync adapters, and the AI tool catalog.

## Product Thesis

Zen helps a student answer four academic questions:

1. What material do I have?
2. What am I trying to learn or finish?
3. How ready am I, based on evidence?
4. What should I do next with the time I actually have?

The app already has the foundations for this: notes, PDFs, AI tools, Deep Work sessions, quizzes, study plans, memory, Google integrations, Canvas, connected sources, sync, and local-first storage.

## Core Workspace

- Native desktop app via Tauri, with browser development mode.
- Local-first storage for notes, Deep Work state, quizzes, memory, settings, PDFs, workspace state, and appearance.
- Persistent workspace state, including active surface and panel state.
- Status/toast feedback for saved state, sync, AI, and connection events.
- Settings for appearance, data, billing/account, AI behavior, integrations, sync, and tool policy.
- Production update path with release manifests and installer assets.
- Desktop window controls and resize handles.
- Skeleton loading states and reusable dropdown/status UI.
- Release notes modal and "What's new" surface.
- Onboarding state that can be completed and replayed.

## Home Dashboard

- Home surface can show notes, calendar events, Gmail threads, and Deep Work entry points.
- Daily/startup focus brief generated from recent calendar and mail context.
- Brief items preserve source links back to note, mail, event, or PDF targets.
- Brief checklist supports marking items done and avoids resurfacing completed items.
- Near-duplicate detection prevents reworded brief items from coming back.
- Focus target resolution chooses the most relevant note, event, or email thread.
- Event-centered action groups combine calendar anchors with related mail and notes.
- "Now" overflow bucket collects unanchored unread mail and note pressure.
- Calendar event tags can be applied by normalized event title across future occurrences.
- AI-assisted Gmail auto-labeling can match new emails to user-defined topic labels.
- Custom email labels include optional matching hints/criteria.
- Hidden home targets can be persisted locally.
- Home can launch any target into Deep Work.
- Home quote feature rotates categories: humor, philosophy, science, and literature.
- Weather utility maps weather codes to display indicators.

## Onboarding And First Run

- First-run onboarding introduces AI, Google, Deep Work, memory, study, quiz, and gallery concepts.
- Onboarding can seed a welcome note, sample note, sample PDF, and sample Deep Work session.
- Onboarding completion is persisted locally.
- Onboarding can be replayed from Settings.
- Seed state prevents repeated sample-session duplication.

## Notes

- Hierarchical note tree with parent/child organization.
- Rich block editor based on TipTap.
- Headings, paragraphs, lists, tables, math, geometry, SVG, and linked content.
- Slash-command insertion.
- Inline wiki-style links between notes.
- Note metadata: space, subject, unit, tags, inbox.
- Filtering by text and metadata facets.
- Autosave and persisted note content.
- AI tools can search, read, create, update, append to, move, delete, open, link, and set metadata on notes.
- Sidebar supports tree flattening, note collapse, root coloring, drag projection, sibling reorder, subtree handling, and parent changes.
- Notes can be marked as inbox items.
- Notes can be associated with PDFs through explicit attachments.
- Notes can include map-of-content blocks.
- Text can be extracted from TipTap documents for search, recall, AI context, and previews.
- Markdown can be converted into TipTap document content.

## Math And Technical Study

- Editable MathLive math fields.
- KaTeX rendering.
- Inline and block math.
- Checkable math blocks for practice answers.
- Geometry/graph blocks.
- AI can insert math, SVG diagrams, and tables into notes.
- Markdown rendering supports lesson content, math, code, SVG, snippets, and PDF references.
- Math checker can simplify, evaluate, compare equivalence, check a target answer, split multi-line derivations, and inspect derivation steps.
- Math answer verdicts include correct, equivalent, wrong, empty, and unknown.
- Geometry can parse construction specs and build JSXGraph-backed views.
- Geometry model supports object serialization, generated point names, dependent-object removal, object references, and human descriptions.
- SVG rendering is sanitized before display.

## PDFs

- PDF library with local storage and server-backed PDF binary sync.
- PDF viewer inside the main app and Deep Work canvas.
- AI tools can list PDFs, read pages, search PDFs, find text, inspect outlines, cite PDF passages into notes, highlight/bookmark passages, remove highlights, rename/tag/delete PDFs, attach/detach PDFs to notes, and navigate to pages.
- PDF annotations can connect concepts to source pages in the Study panel.
- On-device PDF indexing and recall can include PDF pages.
- PDFs store metadata, extracted text, annotations, tags, tombstones, and sync metadata.
- PDF text can be searched by exact keyword or semantically by concept/question.
- PDF outline reading helps jump to chapters before reading page ranges.
- PDF navigation state can open a target page inside Deep Work.
- Note/PDF split state supports side-by-side note and PDF work.
- PDF sync can upload large binaries in parts and assemble them server-side.
- Temporary PDF upload parts can be cleaned by the production health job.

## Deep Work

- Named Deep Work sessions.
- Each session can collect notes, PDFs, calendar events, and email threads.
- Deep Work canvas supports draggable, resizable windows for each source.
- Sessions persist with their windows, items, intent, focus time, study backbone, and study plan.
- Sessions can be created, switched, renamed, archived, unarchived, and deleted.
- Zen Mode can focus the workspace.
- AI tools can add/remove items, read session material, set session intent, and build or update study state.
- Add-to-session picker lets the user choose which session receives a target.
- Session tabs expose active and archived sessions.
- Source library can add connected sources or local material to the Deep Work canvas.
- Windows can be moved, resized, removed, and rescaled when the canvas size changes.
- Deep Work windows support editable notes, PDFs, calendar events, and email threads.
- Email windows can read a thread and reply inline.
- Event windows show calendar event details.
- Deep Work state is mirrored for legacy selectors while remaining session-scoped.

## Study Backbone

- AI can synthesize a study backbone from Deep Work material.
- Backbone contains concepts, summaries, mastery, sub-skills, review counts, and due dates.
- Overall readiness is derived from concept mastery.
- Sub-skills allow one facet of a concept to improve without overwriting the others.
- Review scheduling uses a spaced-repetition style interval/ease/due model.
- The app can identify the next concept to review based on due status, staleness, and low mastery.
- Study panel shows concept mastery, sub-skill mastery, review recency, due indicators, overall readiness, and linked PDF pages.

## Focus Sessions

- 25-minute study session entry point.
- Focus timer can be started, ended, and displayed while active.
- Focus time is credited to the active Deep Work session.
- Focus time can also credit the specific planned study session the user started.
- Daily study goal tracks focused time against a configurable target.
- Study streaks are computed from daily goal completion.

## Quizzes

- AI can generate quizzes from Deep Work material.
- Quiz generation is weighted toward weak, due, and previously missed concepts.
- Quiz history persists per Deep Work session.
- Quiz types include multiple choice, text, math, ordering, matching, numerical, fill-in-the-blank, step-by-step, error analysis, and true/false.
- Objective questions can grade instantly on-device when answer keys are available.
- Open-ended questions can be graded by AI with partial credit.
- Quiz results update concept and sub-skill mastery.
- Mistake bank tracks partial and incorrect answers by concept, sub-skill, prompt, answer, feedback, and timestamp.
- Re-quiz action can focus only on prior mistakes.
- Quiz sessions survive refreshes.
- Interrupted grading returns to active answering instead of stranding the user.
- Quiz history is capped to prevent unbounded local growth.
- Ordering questions are shuffled locally so the user does not see the correct order.
- Matching, ordering, choice, and numeric-answer questions can grade locally.
- AI grading prompt includes rubrics, expected answers, and the student's answer.
- Post-quiz review can store strengths and mistakes.

## Lessons

- AI can start a lesson/class for a topic.
- Lesson board can present text, SVG diagrams, snippets, PDF page references, and questions.
- Lesson content can be replaced or appended.
- Lesson completion is explicit, so the board can finish cleanly while still allowing the AI to continue when more slides are needed.
- The user can finish class and return home with the session saved.

## Adaptive Study Planning

- Study plans are scoped to Deep Work sessions.
- Plans contain a goal, optional exam/goal date, horizon, daily target minutes, and planned sessions.
- Planned sessions have date, start time, duration, kind, focus concepts, status, rationale, completion credit, quiz link, and optional Calendar event link.
- Session kinds: learn, review, quiz, catch-up.
- Plan status can mark sessions as planned, done, skipped, or missed.
- Missed sessions are reconciled automatically.
- AI can generate and revise study plans.
- Plans are calendar-native when Google is connected, but still render and reason offline.

## Deadline-Aware Strategy

This is the big academic usefulness lever.

Zen should treat the deadline as a strategy switch, not just a date in a forecast. The same course material requires different behavior depending on whether the exam is in six weeks, one week, tomorrow, or already missed.

### Current Foundation

Zen already computes:

- days left until a goal date
- effective readiness
- projected readiness
- evidence coverage
- mastery gap
- estimated minutes required
- minutes booked
- deficit
- daily pressure
- available capacity
- days needed
- buffer days
- missed sessions
- feasibility
- verdict: ahead, on-track, at-risk, or overcommitted

This is a strong base. The next step is to turn those numbers into explicit academic modes.

### Proposed Modes

#### Deep Learning Mode

Use when the deadline is far enough away and capacity is healthy.

- Build durable understanding.
- Teach prerequisites.
- Use harder transfer questions.
- Ask for explanations, examples, and connections.
- Allow slower lessons and deeper notes.
- Prioritize concept graph completeness over short-term score maximization.

#### Exam Build Mode

Use when the deadline is real but feasible.

- Convert the course graph into exam-relevant units.
- Mix learning, review, and quizzes.
- Increase retrieval practice.
- Schedule mock exams.
- Force evidence before marking readiness high.
- Keep maintenance reviews for already-mastered topics.

#### Catch-Up Mode

Use when the user is behind but recovery is possible.

- Identify minimum viable coverage.
- Prefer high-yield weak concepts.
- Shorten low-value lessons.
- Reschedule missed work.
- Turn skipped sessions into catch-up blocks.
- Show an honest deficit and the exact extra time needed.

#### Exam Survival Mode

Use when full readiness is unrealistic before the deadline.

- Stop pretending everything can be learned.
- Prioritize likely points.
- Focus on common problem types, formulas, definitions, and professor-style patterns.
- Use fast drills and error correction.
- Generate cheat-sheet style summaries where allowed.
- Make tradeoffs explicit: "skip this, drill that."

#### Review Only Mode

Use when readiness is high or the exam is imminent.

- Avoid introducing large new topics.
- Review weak edges and overdue items.
- Run timed mini-quizzes.
- Surface common mistakes.
- Protect sleep/time by trimming surplus sessions.

#### Post-Deadline Recovery Mode

Use when the goal date has passed.

- Ask whether to archive, re-plan, or convert the plan into long-term mastery.
- Summarize missed sessions and unresolved concepts.
- Preserve mistake history.
- Avoid showing stale "on track" language.

### What The Strategy Engine Should Decide

For every Deep Work session, Zen should be able to decide:

- what mode applies
- what the next 25 minutes should be
- whether to learn, review, quiz, catch up, or simulate an exam
- which concepts are worth studying now
- which concepts should be deferred
- whether the current goal is feasible
- what extra capacity would make it feasible
- whether to generate, revise, compress, or abandon the plan

### User-Facing Output

The Study panel should eventually say things like:

- "Exam Build: 9 days left, 72% reliable readiness, 4.5h deficit."
- "Catch-Up: you missed 2 sessions; do one 35-minute weak-concept block now."
- "Survival: full readiness is not feasible; prioritize integration by parts and series tests."
- "Review Only: you are ready enough; do a timed mixed quiz and stop adding new material."

The tone should be honest and useful. Zen should not flatter the user with optimistic readiness when evidence is thin.

## AI Assistant

- Streaming chat with model/provider abstraction.
- Subscription-backed AI usage and quotas.
- Context-aware prompts over notes, PDFs, Deep Work material, memory, calendar, mail, Canvas, and connected sources.
- Inline note actions.
- Tool calling with read-only tools, local study auto-tools, and configurable mutation tools.
- Tool policy can be auto, ask, or off for configurable tools.
- Destructive and outbound actions require confirmation.
- AI can navigate the app between home, deepwork, calendar, mail, and sources.
- Chat conversations persist locally and can be hydrated on launch.
- Chat panel open/closed state persists.
- AI supports proposal cards for mutating actions.
- AI supports interactive clarification cards through `ask_user`.
- Tool calls are categorized as Interaction, Memory, Notes, Calendar, Gmail, Canvas, Sources, PDF, Deep Work, and Navigation.
- Read-only tools run automatically.
- Study-state tools can auto-apply locally for smooth tutoring.
- User-configurable mutation tools can be disabled, auto-run, or require approval.
- Tool-call descriptions resolve IDs into human-readable note, event, mail, memory, PDF, and source labels.
- Tool argument parsing repairs common invalid JSON produced by LaTeX backslashes.
- AI settings include model/provider behavior and secret-field filtering for sync.
- AI usage service reports tier, period, budgets, and metered status.

## AI Tool Catalog

Zen's assistant can currently use tools for:

- Interaction: ask the user a clarifying multiple-choice question.
- Memory: update profile, save memory, list memories, forget memory, semantically recall.
- Notes: search, read, create, update, open, list tree, append, set metadata, move, delete, insert math, insert SVG, insert table, link notes.
- Calendar: list events, read event, create event, update event, delete event, find free slots.
- Gmail: search mail, read thread, create draft, send email, reply in thread, archive thread, mark read.
- Canvas: list courses, list assignments, read assignment, list modules, list announcements, list files.
- Sources: search connected sources, read source, refresh sources, cite source into a note.
- PDF: list PDFs, semantic find in PDF, read PDF pages/ranges, read outline, keyword search, cite page, highlight/bookmark, go to page, remove highlights, rename, tag, delete, attach, detach.
- Deep Work: add/remove items, set intent, read material, set backbone, update mastery, start quiz, grade quiz, list weak concepts, read plan status, set plan, revise plan, start lesson, present lesson blocks, end lesson.
- Navigation: apply filters, clear filters, list tags, list facets, open top-level views.

## Memory

- Persistent user profile with name, about, stack, and preferences.
- Persistent saved memories with title, content, and category.
- Semantic recall over notes and PDFs.
- Memory can be saved, listed, updated, forgotten, and injected into future conversation context.
- Memory profile and entries are syncable collections.
- Recent activities can be recorded and injected as episodic context.
- Keyword graph recall and vector embedding recall combine for better memory search.
- Embedding model status and indexing progress are observable in the UI.
- PDF semantic index readiness can be checked per PDF.
- Indexing can be cancelled.
- Vector payloads are persisted in an IndexedDB-backed vector store.

## Google Calendar

- Google sign-in.
- Calendar event listing and detail reading.
- Calendar event creation, update, deletion.
- Free-slot finding.
- Study plans can create calendar-backed study sessions.
- Deep Work can include calendar events as windows.
- Calendar panel can run embedded or as a full admin view.
- Google auth state can be observed by UI hooks.
- Google OAuth token persistence is handled locally, with desktop auth support in Tauri.
- Bundled Google credentials can be used instead of manual client setup.

## Gmail

- Gmail thread listing/search.
- Thread reading.
- Draft creation.
- Email sending.
- Reply in thread.
- Archive and mark-read actions.
- Custom email topic labels.
- Deep Work can include email threads as windows with reply support.
- Mail panel can run embedded or as a full admin view.
- Gmail labels can be ensured/applied for AI auto-labeling.
- Drafts are saved for review; outbound sends and replies are separate actions.

## Canvas

- Canvas connection through institution URL and access token.
- AI tools can list courses, assignments, modules, announcements, and files.
- AI can inspect assignment details and submission status.
- Canvas data can become academic planning context.
- Canvas settings are syncable with access-token filtering.
- Canvas assignment data includes due date, points, submission type, and submission state when available.
- Canvas course, module, announcement, and file data can flow into the connected source library.

## Connected Sources

- Source library for external material.
- Google Drive, Zotero, GitHub, Canvas, and browser captures are supported source categories.
- Sources can be refreshed, searched, read, and cited into notes.
- Connected credentials can be stored in the encrypted connection vault.
- Sources panel filters by provider: all, Canvas, Drive, Zotero, GitHub, Web.
- Sources panel supports search, source detail reading, opening originals, copying citations, and viewing captured images/text.
- Web capture JSON can be imported manually.
- Source refresh returns per-provider imported counts.
- Source kinds cover course material, assignments, modules, announcements, files, papers, repository docs, and web captures.
- External connection settings include Drive folder IDs, Zotero library/API settings, and GitHub repository/token settings.

## Browser Capture

- Browser extension can capture selected page content.
- Browser extension can capture screenshots.
- Captures can flow into the source library for later search and study.
- Captures include title, URL, text, timestamp, optional selection mode, and optional image data.
- Captures can be imported from `.zenclip.json`/JSON files.

## Settings

- Settings sections: Appearance, Connections, AI Behavior, Billing, Data.
- Appearance controls font, font size, accent color, glass/transparency, and reduced motion.
- Accent presets are available and applied through CSS variables.
- Connections manage Google, Canvas, Zotero, GitHub, Drive/source settings, and the encrypted vault.
- AI Behavior manages tool permissions.
- Billing shows account/subscription state.
- Data settings can export/import safe config keys.
- Data settings can check desktop updates.
- Data settings can open release notes.
- Data settings can reset tool permissions.
- Data settings can clear conversations.
- Data settings can wipe memories.
- Data settings can reset all local data and onboarding.
- Reset can clear localStorage, sessionStorage, relevant IndexedDB databases, caches, and Google sign-in.

## Appearance And UI Personalization

- Theme values are stored in `zen.appearance.v1`.
- UI font options are configurable.
- Font size can be adjusted.
- Accent color can be selected from presets.
- Glass effect and reduced motion can be toggled.
- Appearance changes hydrate and apply on launch.

## Sync And Account

- Google identity anchors account and sync.
- Serverless sync backend supports notes, AI, Deep Work, study log, workspace, PDFs, quizzes, memory, appearance, tool policy, AI settings, Google settings, Canvas settings, and external connections.
- Last-write-wins sync over MongoDB-backed collections.
- PDF binaries use chunked upload and GridFS storage.
- Subscription tiers determine AI access and budgets.
- AI requests are metered and rate-limited.
- Settings distinguish local-only secrets from syncable non-secret configuration.
- Sync can start, stop, clear state, track high-water cursors, track dirty records, and sync blob-style stores.
- Sync adapters cover notes, PDFs, plain blob stores, and filtered blob stores.
- Sync rejects oversized docs and unknown collections.
- Sync supports tombstones for deletions.
- Account service exposes logged-out, no-paid-account, active, trialing, past-due, unpaid, canceled, and expired access states.
- Subscription tiers include free, basic, and plus.
- AI model selection can depend on subscription tier.
- AI usage reservations can be created, accepted, settled, and reconciled.

## Production And Release

- Tauri desktop packaging.
- Public update endpoints for latest manifest and release assets.
- Release notes are versioned.
- Version sync scripts keep package and Tauri metadata aligned.
- Production health endpoint can reconcile interrupted AI reservations and clean temporary PDF uploads.
- API routes include account, subscriptions, AI chat, AI usage, health, sync collections, PDF binaries, connections, latest update, and update asset redirect.
- API CORS and request rate limits are centralized.
- API observability logs structured events and error fields.
- GitHub release helpers fetch latest releases and redirect private assets through public update endpoints.
- Production smoke script can validate deployed behavior.
- Windows signing configuration script supports release packaging.
- Icon generation script supports app icon assets.

## Academic Usefulness Roadmap

Highest-leverage next moves:

1. Promote deadline-aware modes into the Study panel and AI planning prompts.
2. Add exam simulator sessions with timed mixed quizzes and post-exam diagnosis.
3. Make mistake categories first-class, not just free-text feedback.
4. Build a course graph from Canvas, PDFs, notes, and quizzes.
5. Show proof-of-learning evidence for every concept.
6. Generate academic artifacts: exam sheets, formula sheets, office-hour questions, problem sets, and weak-topic reports.
7. Make "what should I do now?" the primary Study action.

## North Star

Zen should open to a calm but decisive answer:

> Here is what matters next, why it matters, how ready you are, and what evidence would prove you actually understand it.
