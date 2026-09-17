---
name: high-quality-i18n
description:
  Write, translate, and audit ghdiff UI copy for meaning, register, glossary
  consistency, and rendered fit. English is the source in messages/en.json,
  rendered through Paraglide JS. Use the 20 target locales and Antigravity audit
  with Codex fallback defined here.
---

# ghdiff localization

ghdiff is a GitHub code review surface for developers. Read
[VOICE.md](VOICE.md), [GLOSSARY.md](GLOSSARY.md), [ADVISORY.md](ADVISORY.md),
and [QA.md](QA.md).

## Current implementation

English (`en`) is the source. All 20 target locales are enabled, each with 387
messages. `messages/en.json` holds interface copy. Paraglide generates
`src/paraglide/`; `src/server.ts` scopes cookie/base-locale detection per
request, and the root document sets locale and direction. `src/userscript.js` is
bundled with catalog messages into the generated `public/ghdiff.user.js`. See
[I18N.md](../../../I18N.md) for runtime ownership, commands, audit records, and
the pinned Pierre label adapter. A globe menu changes the locale on home, setup,
and review screens. Arabic and Persian prose uses RTL while code and technical
identifiers remain LTR.

The target batch is 20 locales total, including English: `en`, `zh-Hans`, `es`,
`fr`, `de`, `ja`, `ko`, `pt-BR`, `ru`, `hi`, `ar`, `id`, `vi`, `tr`, `pl`, `it`,
`uk`, `nl`, `fa`, `bn`. This is a coverage plan, not a measured ranking.
Varieties are defined in VOICE.md.

## Workflow

1. Establish requested messages/source locations, locales, and a fresh QA
   baseline. Separate interface text from user content and opaque identifiers.
2. Resolve unclear source before propagating it. Keep focused corrections
   focused; source/key changes require checking all affected locales and
   generated artifacts.
3. Build a context pack per message: source, candidate, rendering call site,
   control type, neighbors, layout budget, dynamic values and examples, semantic
   branches, glossary terms, and intended behavior. Use actual catalog keys and
   source locations.
4. Evaluate at least five structurally different candidates per message and
   locale: literal, idiomatic, concise, alternate register, and restructured.
   Keep concise candidate notes and a selection reason, not a transcript of
   deliberation. Test meaning, grammar, placeholders, terminology, register, and
   fit. Alternate register is a comparison, not authorization to depart from
   VOICE.md.
5. Audit every changed message through ADVISORY.md in manageable per-locale
   batches. Include deeper context for errors, confirmations, access setup, and
   onboarding. Reviewers suggest; the editing agent reconciles suggestions
   against evidence.
6. Apply small edits preserving interpolation expressions, JSX markup, ordering,
   accessibility text, and technical values. Never replace duplicate text
   globally without checking meaning. Use the catalog editor and
   `pnpm i18n:compile`; see I18N.md for the editor limitation around valid
   multi-selector branches.
7. Run QA, sweep changed concept families, and inspect rendered fit. Report
   exact scope, wording decisions, checks, auditor/model and coverage, fallback
   use, and unresolved findings. AI review is not human native-speaker
   validation.

Maintain approved voice and glossary changes in these project-local files. Keep
private project context out of reusable setup instructions and global skills.
