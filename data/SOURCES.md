# Bundled reference data — sources & licensing

Neither the JLPT (Japan Foundation) nor WaniKani publishes an official
kanji/vocabulary list per level. `jlpt.json` and `jlpt_vocab.json` are
unofficial reference lists used to *estimate* proficiency against — treat
percentages derived from them as approximations, not certified scores.

## `jlpt.json` (kanji → level)

Predates this file's creation; original provenance wasn't recorded when it
was added to the project. Content matches the widely-circulated unofficial
JLPT kanji-by-level list originally compiled by Jonathan Waller
(tanos.co.uk/jlpt), which is the de facto standard list most third-party
JLPT/WaniKani tools use. If bundling this data long-term, attribute Jonathan
Waller / tanos.co.uk (his site licenses the data CC BY).

## `jlpt_vocab.json` (word → level)

Added to power JLPT vocabulary-coverage estimates with a real external
denominator (previously vocab % was scoped to WaniKani's own curriculum
only, which isn't comparable to a true "how much exam vocab do you know").

- **Source**: Jonathan Waller's JLPT Resources (tanos.co.uk/jlpt), licensed
  **Creative Commons BY**.
- **Obtained via**: [Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary)
  (MIT-licensed parser; the underlying *data* remains Jonathan Waller's,
  CC BY), `data/vocab/results/JLPT_vocab_ALL.json`, fetched 2026-07-18.
- **Transform**: flattened to `{ "word": "N3" }`. Where a word carries
  different levels across different readings (~3% of entries — e.g. 銅
  is N1 as あかがね but N2 as どう), the harder (lower-N) level was kept.
- **Coverage note**: only ~53% of WaniKani's vocabulary subjects have an
  exact match in this list — the rest are words WaniKani teaches that
  aren't on any official-ish JLPT vocab list (or differ in kana/kanji
  spelling from this list's entry), so they're excluded from JLPT-vocab
  percentages/gap counts rather than guessed at.
