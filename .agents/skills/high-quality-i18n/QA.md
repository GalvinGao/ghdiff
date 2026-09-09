# QA

## Current implementation

`messages/en.json` contains the English source. All 20 locales are enabled, with
387 messages each. `src/lib/i18n.test.ts` covers compiled plurals, semantic
branches, rich-text interpolation, checker failures, and request isolation.
`scripts/check-i18n.mjs` checks catalog shape/parity, literal JSX/accessibility
text, and import-time message calls. These are structural guards, not linguistic
validation.

Run `pnpm i18n:compile`, `pnpm i18n:check`, `pnpm test`, `pnpm lint`,
`pnpm fmt:check`, `pnpm typecheck`, `pnpm build`, and the Worker deployment dry
run. Inspect actual pages in a browser. See [I18N.md](../../../I18N.md).

Keep all/zero-selected installation states separate from plural categories,
phone/desktop watch-offer sentences complete, and repository names opaque. The
userscript is generated from `src/userscript.js`, with its own document-language
selection and metadata version. Intl formatting follows the active locale.

## Structural review

Check the actual compiler and runtime, in addition to the structural guard:

1. Validate parsing, scoped missing/extra keys, source validity, and enabled
   locale coverage. Separate generated key/pseudo locales from linguistic
   review.
2. Preserve interpolation names, multiplicity, markup nesting, escaping, and
   required tokens per corresponding semantic branch. A source branch can omit
   tokens legitimately: don't require the union of all tokens in every branch. A
   target language can need selectors that English lacks.
3. Verify fallback/default branches and missing-message handling in the
   installed runtime. Never assume ICU syntax applies to an unknown compiler.
4. Test reachable zero, one, two, other relevant count values, boundaries, and
   large numbers against actual locale data. Don't hardcode plural-category
   lists. Test fractions only if the value domain accepts them; repository
   counts are nonnegative integers. Ordinals need tests only where actually
   used.
5. Check glossary/register drift, punctuation, whitespace, and source-identical
   text. Protected names may remain identical; prose needs review. Latin script
   alone is not an exemption. Heuristics are flags, not grammar verdicts.

If a QA adapter becomes justified, test valid and intentionally invalid
fixtures: missing keys, broken per-branch tokens/markup, selector defaults,
unsupported shapes, and invalid scope arguments. Structural failures must return
nonzero and piped reports remain complete. Avoid tests that merely freeze
editorial wording.

## Manual coverage for all 20 locales

- Inspect controls, errors, hints, empty states, and onboarding in the actual
  app at phone/desktop sizes. Test long names and realistic text expansion; do
  not drop meaning or shrink fonts to match English character counts.
- Check register and arbitrary names in whole sentences. Preserve code, authors'
  comments, repository names, handles, and other opaque data.
- Verify font coverage, accents, conjuncts, shaping, line height, wrapping, and
  truncation. Inspect CJK boundaries, Devanagari/Bengali shaping, Vietnamese
  marks, and Persian joining specifically.
- For `ar`/`fa`, use RTL prose with isolated LTR paths/URLs/SHAs; keep
  code/diffs LTR. Decide pane placement/icons by meaning, not blind mirroring.
  Test selection and mixed-script punctuation.
- Check document language/direction, screen-reader and tooltip labels, and
  fonts. Sweep changed concept families across visible text, accessibility, and
  variants. Report actual locales/surfaces inspected.

## Setup sample

Existing English source and candidate are identical; no source edits.
Identifiers below are audit labels, not catalog keys. Layout was not measured in
setup.

| Identifier  | Source                                                                            | Context                                                                                  |
| ----------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| control     | Not now                                                                           | WatchOfferDialog: decline browser-local watch offer                                      |
| error       | Could not load the diff                                                           | reviewFailure: generic title; recovery text separate                                     |
| placeholder | Watch {subject}?                                                                  | WatchOfferDialog title; arbitrary `owner/repo`                                           |
| count       | All repositories / No repositories selected / 1 repository / {count} repositories | describeInstallationReach: all overrides count, then zero/one/multiple; 0, 1, 2, 21, 100 |

Preserve literal source expressions. Arbitrary names must not acquire
grammatical endings inside their tokens. The sample tests policy handling and
auditor readiness, not all target translations or a complete source-copy audit.

## Historical setup verification — 2026-09-08 (before export authorization)

- `pnpm test`: 438 passed, zero failed. `pnpm lint`: passed. The first
  restricted invocations could not verify pnpm's registry signature;
  network-enabled runs succeeded without changing the package-manager
  configuration.
- The five files, skill frontmatter, relative links, source paths, and exactly
  20 distinct locales in the voice/glossary matrices were checked.
- `agy models` returned `gemini-3.1-pro-high`. Codex's local model catalog
  contains `gpt-5.6-terra`; `codex exec --help` confirms
  stdin/read-only/output-file flags.
- The four-message English context pack was prepared and inspected. Antigravity
  sample execution was rejected by automatic approval review because it exports
  project-specific copy and guidance to an external service. It was not
  executed. The reviewer requires explicit authorization for that payload. Do
  not bypass this rejection by sending the same payload through the fallback.
- Neither auditor's end-to-end readiness is confirmed. Codex fallback is
  configured and user-selected, but not executed. No translated locale or
  rendered multilingual surface has been audited. There was no human
  native-speaker validation.

The primary agent checked the sample's semantic boundaries: neutral refusal,
failure-title scope, opaque repository interpolation, and all/zero/one/multiple
installation states. This is local setup inspection, not an independent audit.

## First locale batch — 2026-09-09

The user authorized the catalog/context export. Antigravity returned an
interrupted stream with no output at its timeout; Codex `gpt-5.6-terra`
completed translation and independent per-key review for every target locale.
See [the audit records](../../../docs/i18n/audit/) and
[I18N.md](../../../I18N.md) for coverage, reconciliation, checks, and rendered
QA. The initial uncertainties are retained alongside follow-up findings; they
are not all outstanding issues. AI review does not claim human native-speaker
validation.
