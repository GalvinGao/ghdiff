# Voice and locales

## Approved voice

The user explicitly carried forward ghdiff's existing voice: short, plain,
conversational second-person copy; state the likely cause and next step, then
stop. Avoid exclamation marks, “please,” and marketing language. English
controls use sentence case. Always spell the product `ghdiff`.

Avoid jokes, manufactured celebrations, repeated apologies, and filler
reassurance. Preserve consequences, permission boundaries, negation, limits, and
recovery steps. Do not turn a possible cause into a certainty: a 404 does not
prove a repository is private. Second person does not require a literal pronoun
in every language. Avoid gender assumptions. Controls usually have no terminal
punctuation; complete explanatory sentences do. Questions retain
locale-appropriate question marks.

Examples grounded in the current UI:

- `Not now` in `src/components/WatchOfferDialog.tsx`: neutral refusal.
- `Your watch list stays in this browser.` in the same file: preserve
  browser-local storage; do not imply account synchronization or GitHub
  notifications.
- `Nothing watched yet.` in `src/components/WatchedReposEditor.tsx`: distinguish
  an empty watch list from watched repositories with no open pull requests.
- `Could not load the diff` in `src/lib/reviewFailure.ts`: name the failed
  action; recovery copy must match the actual button and signed-in state.
- Prefer `Try again` to `Please try again!`. This illustrates voice, not a
  request to edit current source text.

## First-batch selection

The user requested 20 common human languages used by programmers and delegated
selection. This means 20 target locales including source English. No source
consulted establishes an exact ranking by developers' spoken language. This is a
practical coverage decision, not a demographic claim.

[JetBrains' 2025 survey methodology](https://lp.jetbrains.com/developer-ecosystem-2025-methedology/)
lists English, Chinese, French, German, Japanese, Korean, Brazilian Portuguese,
Russian, Spanish, and Turkish as survey languages. That supplies a starting
point, not ranking evidence. Ten additional languages broaden coverage by
editorial judgment. Do not infer an individual's preferred language from their
country.

Tags/varieties below are explicit setup defaults, not existing runtime settings.
Simplified Chinese and Brazilian Portuguese are selected for this batch;
Traditional Chinese is outside it. Bare English, Spanish, French, and Bengali
tags do not imply a country: use broadly understood vocabulary. Arabic is Modern
Standard Arabic; Persian uses standard Iranian terminology. Bengali avoids
country-specific terms.

## Locale matrix

Register choices are editorial defaults derived from the approved voice, subject
to language review. Grammar/typography notes describe ordinary conventions.
There are no translated catalogs whose usage would approve these choices. All
locales need whole-message restructuring and runtime-aware number/date/count
handling. Never carry English singular/plural branches into another locale
unchanged.

| Locale / variety               | Register and controls                                          | Grammar / dynamic content                                         | Typography / layout                                                           |
| ------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `en` / international English   | Direct you; imperative controls                                | Avoid gender assumptions; retain explicit zero states             | Sentence case, natural apostrophes; no region inferred for formatting         |
| `zh-Hans` / Simplified Chinese | Neutral concise prose; omit 你 when unnecessary; no routine 您 | No forced number inflection; leave opaque names intact            | Chinese prose punctuation; preserve Latin tokens; CJK wrapping and fonts      |
| `es` / broad Spanish           | Tú when needed; imperative controls; avoid regional slang      | Agreement must not depend on the gender of an opaque name         | Opening ¿ in questions; sentence case; expansion                              |
| `fr` / broad French            | Vous in prose; infinitive controls                             | Restructure gender and possessives around names                   | French quotes/spacing, nonbreaking spacing where appropriate; narrow controls |
| `de` / German                  | Lowercase du in prose; infinitive controls                     | Keep case endings off opaque names; retain noun capitalization    | German punctuation; compound-label expansion                                  |
| `ja` / Japanese                | です・ます prose; short action labels; omit あなた             | Natural particles/clause order; no English plural suffix          | Japanese punctuation, kinsoku, no forced spaces between Japanese words        |
| `ko` / Korean                  | Consistent 해요체 prose; concise controls; omit 당신           | Rephrase rather than guess final-sound particles for Latin names  | Korean word spacing; font and wrapping checks                                 |
| `pt-BR` / Brazilian Portuguese | Você when needed; imperative controls                          | Brazilian vocabulary; verb agreement; avoid gender assumptions    | Sentence case, accents; no automatic pt-PT substitution                       |
| `ru` / Russian                 | Lowercase вы when needed; infinitive controls                  | Whole-message case/count/gender agreement                         | Russian quotes; nonbreaking count/unit spacing where useful; expansion        |
| `hi` / Hindi                   | आप; concise respectful controls                                | Avoid ornate bureaucracy; don't infer gender from names           | Modern UI punctuation; Devanagari shaping and line height                     |
| `ar` / Modern Standard Arabic  | Neutral address and concise controls                           | Avoid gender assumptions; all reachable count forms               | RTL, Arabic question mark; isolate LTR identifiers and keep code LTR          |
| `id` / Indonesian              | Omit pronouns naturally; Anda if needed; direct controls       | No forced noun repetition for UI counts                           | Sentence case; standard vocabulary; label expansion                           |
| `vi` / Vietnamese              | Bạn only when useful; concise verb controls                    | Classifiers depend on the concept; natural word order             | Diacritics and stacked-mark font coverage                                     |
| `tr` / Turkish                 | Neutral siz if needed; consistent concise controls             | Rephrase to avoid guessing suffixes for names                     | Dotted/dotless i; no English case transformations                             |
| `pl` / Polish                  | Direct neutral prose; omit ty; imperative controls             | Case/count agreement; avoid gendered past-tense address           | Polish diacritics/quotes; counts and expanded labels                          |
| `it` / Italian                 | Tu when needed; imperative controls                            | Natural number/gender agreement around opaque names               | Apostrophes/accents; sentence case; expansion                                 |
| `uk` / Ukrainian               | Lowercase ви when useful; infinitive controls                  | Ukrainian terms and inflection; no mechanical Russian adaptation  | Ukrainian apostrophe/letters; count and expansion tests                       |
| `nl` / Dutch                   | Je if needed; infinitive controls                              | Natural compounds; avoid formal u drift                           | Dutch punctuation; compound-label wrapping                                    |
| `fa` / Persian, Iranian terms  | شما when useful; respectful concise controls                   | Persian word order; keep opaque names intact                      | RTL, Persian ی/ک, appropriate ZWNJ; joining and LTR isolation                 |
| `bn` / region-neutral Bengali  | আপনি when useful; concise respectful controls                  | Natural classifiers/agreement; avoid regional loans when possible | Bengali shaping/conjuncts, line height, consistent sentence punctuation       |

## Dynamic values and surfaces

Use the selected UI locale for human-readable quantities and dates when a
formatter exists. Establish numbering-system behavior in the actual runtime.
Never substitute digits in SHAs, URLs, code, or API identifiers. Choose
grammatical branches using semantic numbers, never by reparsing formatted text.

Repository names, handles, code, and user-authored comments stay unchanged.
References to GitHub's own controls must remain recognizable in the external UI.
Preserve ghdiff's distinction between review state and automated checks.

The watch offer describes different navigation on phone and desktop. Preserve
the real destination rather than literally translating “left bar” everywhere.
Keep accessibility labels and test long names without deleting meaning to fit a
button.
