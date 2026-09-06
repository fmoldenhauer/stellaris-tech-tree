# Stellaris technology tree with save import

Fork of [LindaKuiper/stellaris-tech-tree](https://github.com/LindaKuiper/stellaris-tech-tree), retaining its **Pegasus 4.4.6** technology data and older version trees.

## Use

Serve this directory with any static HTTP server, for example:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Open <http://127.0.0.1:8765/?pegasus-4.4.6>, choose **Empire**, and select a Stellaris `.sav` file or an extracted text `gamestate`. Review the empire and import summary, then choose **Import selected empire**. Saves with multiple human empires require an explicit selection. Countries whose generated names need game localization are identified by their save ID.

The importer replaces research check marks and Empire inputs together. **Undo import** restores the previous state until the page is closed or reloaded. Research and configuration persist in this browser; **Research List → Save** stores a named copy of both. Existing manual controls remain editable. **Reset** resets Empire inputs and imported context; **Clear All** clears research using the existing starting-tech behavior.

Use a current browser with Web Workers, `File.arrayBuffer`, and `DecompressionStream('deflate-raw')`. No installation, build step, backend, or runtime package download is needed. Open the site over HTTP(S), rather than `file://`.

## Imported data

- Completed technologies, including event-granted technologies without their prerequisites. Queued research and research alternatives are never mistaken for completed technologies.
- Ethics, authority, civics, origin, traditions, ascension perks, DLCs recorded in `required_dlcs`, and traits of council-seat holders plus the ruler.
- Repeatable technology levels and active research queues/progress, retained in the preview and imported context. The tree continues to use a boolean researched check mark.
- Country/global flags, active country modifiers, policy flags, country type, owned planet count, bypass discoveries, and cosmic storm count when present. These are available in the imported context.
- Direct flag conditions, Curator Insight, supported outlawed-policy checks, fallen/awakened empire type checks, planet-count thresholds, and cosmic-storm thresholds now feed the weight evaluator.

Values absent from the manual form are retained and listed in the preview. Technologies absent from the selected tree are reported and retained for `has_technology` conditions. Explicitly empty imported sections are known empty; missing or unresolved data remains unknown. Importing another save replaces the previous snapshot instead of mixing empires.

## Limits

This is a save-to-tree importer, not a complete simulation of Stellaris research rolls. It evaluates the rules in this repository's generated 4.4.6 data. Complex planet, neighbor, federation, megastructure, species, game-year, and scripted conditions can still be unsupported, and remain marked **?**. Not every stored modifier has an evaluable rule. The importer does not calculate live research speed, empire-size cost penalties, or research times. Trait IDs are matched exactly; it does not invent aliases between trait tiers. DLC selection follows what the save records and can be adjusted manually.

The included 4.4.6 database and the upstream generated rules may themselves contain omissions. Version mismatches produce a warning; modded technologies and other versions are not guaranteed compatible. Older version trees remain available but do not offer save import.

Only text gamestates, either raw or in stored/DEFLATE ZIP archives, are supported. Binary, encrypted, split, ZIP64, corrupt, or oversized saves are rejected. Compressed and decompressed input are limited to 256 MiB; parser nesting and token counts are bounded. Large saves are read in a cancellable worker.

## Privacy

Save bytes never leave the browser. The importer does not upload, edit, or write the original save. Only selected empire inputs and research state are persisted in local browser storage; named research lists use IndexedDB. No private saves are included in this repository. The inherited site uses Google Fonts, but save data is not sent to it.

## Validation

With Node.js 22 or newer:

```sh
npm test
```

Tests cover Clausewitz syntax and repeated fields, council references, completed versus queued research, projection into 4.4.6 options, unknown/known-empty semantics, weight evaluation, persistence, and ZIP integrity/error paths. Fixtures are synthetic.

For browser integration checks, serve on a separate localhost port (for example `8766`), open `/tests/browser.html`, and select **Run smoke test**. This drives the actual file input, worker, import preview, selection, undo, named list save/load, and reload behavior with the synthetic fixture. It restores localStorage and removes its temporary named list afterward. Use a separate origin from any active personal tree session.

The importer was additionally checked locally against a real Pegasus 4.4.6 late-game save containing 203 completed technologies, all of which matched this tree. That save is not distributed.

## Implementation

`save-import-core.js` reads ZIP containers, parses ordered Clausewitz blocks, and projects country data. `save-import-worker.js` isolates expensive parsing. `save-import-ui.js` provides the preview and import/undo workflow. `EmpireConfig` stores inputs and snapshot context; `ResearchState` applies exact research sets to every rendered node and connector. Research snapshots are keyed by version URL. The inherited global `empireConfig` key and named-list format remain compatible, with added `known_fields` and `save_context` fields.

The original MIT license and attribution are retained in `LICENCE` and the site.
