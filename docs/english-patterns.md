# English rule notes

The default configuration now combines the existing eight Chinese groups with nine English groups. English rules are case-insensitive, accept straight and curly apostrophes in common contractions, and use word boundaries and bounded clause spans where applicable. The final broad-negation rules run after the more specific groups.

These patterns are lexical heuristics. They do not establish that a statement is irrelevant, incorrect, or defensive. Ordinary comparisons, quotations, code blocks, capability limits, and useful caveats may trigger them. Correction prompts preserve factual accuracy, important uncertainty, risks, user constraints, and the user's requested reply language.

## User reports consulted

- [OpenAI Community: Strawman reframing](https://community.openai.com/t/strawman-reframing-chatgpt-sometimes-answers-a-stronger-or-different-claim-than-the-user-actually-made/1399610), September 21, 2026. The author describes replacing qualified claims with stronger ones, with examples including “That doesn’t mean X has no effect” and unsolicited correlation/causation reminders. This informed the hypothetical-implication and exclusive-causality groups. The page was fetched directly.
- [Reddit discussion snapshot: Anyone else tired of how boring and repetitive it is](https://reddit.sentinel-team.org/posts/1vb0419/snapshots/2026-07-31T20%3A47%3A15.30109Z). The captured post singles out “this/that doesn’t mean,” “one thing I’d caution against,” and repetitive rephrasing. This informed implication and formulaic-caveat rules. This is a third-party snapshot, not a verified live Reddit page.
- [Reddit discussion snapshot: It’s not just X, it’s Y](https://reddit.sentinel-team.org/posts/1ttjctx/snapshots/2026-06-05T19%3A30%3A44.375215Z). The captured discussion describes repeated negative-positive contrasts and also notes that people use the construction naturally. This informed the contrast group and its false-positive warning. Available through search results from a third-party snapshot.

These reports supply examples of user experience, not measured prevalence or evidence about training causes. Other English groups are design translations of the Chinese preset, rather than phrases independently verified in these posts.

## Coverage

- Contrasts: `not X but Y`, `it's not X, it's Y`, `this isn't X. It's Y`, `you're not X—you're Y`, `rather than`, `instead of`.
- Repackaging: `repackaging`, `passing off`, `reinventing the wheel`.
- Evidence: `cannot claim`, `shouldn't assume`, `not claiming`, `without assuming`.
- Replacement: `not a substitute for`, `cannot replace`.
- Causality: `the sole cause`, `the only reason`, `correlation doesn't imply causation`.
- Action exclusions: `cannot yet`, `won't engage`, `no longer`.
- Implications: `that doesn't necessarily mean`, `this does not prove`, `not equivalent to`.
- Formulaic caveats: `one important distinction`, `one caveat`, `one thing I'd caution against`, `it's important to note`, `to be clear`.
- Broad fallback: `cannot`, `can't`, `must not`, `mustn't`.

Short prefixes can trigger before a longer, more specific phrase arrives. Rule ordering only resolves matches available in the same accumulated snapshot. The existing retry limit remains two; this change does not alter stream interruption or retry mechanics.
