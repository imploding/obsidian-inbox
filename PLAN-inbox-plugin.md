# Obsidian Inbox Processor Plugin Plan

## Summary
Build a new TypeScript Obsidian plugin in the empty `/Users/matt/Repos/obsidian-inbox` workspace. V1 will provide a standalone inbox view, opened by ribbon icon and command palette, listing root-level Markdown notes that have neither tags nor a `parent` frontmatter link.

Use Obsidian’s sample plugin structure, native Obsidian DOM APIs, and minimal CSS only if required for layout/excerpt truncation. Do not use Tailwind.

Research references:
- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Build a plugin](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)
- [Bases custom view API](https://docs.obsidian.md/plugins/guides/bases-view)
- [Bases syntax and `file.tags`](https://obsidian.md/help/bases/syntax)
- [Frontmatter updates with `processFrontMatter`](https://obsidian-developer-docs.pages.dev/Reference/TypeScript-API/FileManager/processFrontMatter)
- [Vault trash/delete behavior](https://docs.obsidian.md/Plugins/Vault)

## Key Changes
- Scaffold a standard Obsidian plugin: `manifest.json`, `versions.json`, `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `src/main.ts`, and optional `styles.css`.
- Register a custom `ItemView` called something like `obsidian-inbox-view`.
- Add:
  - Ribbon icon: opens/focuses inbox view.
  - Command: “Open inbox processor”.
  - View action/button: “Update inbox”.
- Query candidates from `app.vault.getMarkdownFiles()` and include only files where:
  - `file.path` has no `/`, meaning vault root only.
  - file extension is Markdown.
  - `getAllTags(cache)` or equivalent tag extraction returns no tags.
  - `cache.frontmatter?.parent` is empty/missing.
- Render each note row with:
  - Clickable title that opens the note.
  - Short excerpt from `vault.cachedRead(file)`, excluding YAML frontmatter and blank-leading content.
  - Tag editor input with suggestions from existing vault tags.
  - Parent note picker using root/non-root Markdown note suggestions.
  - Delete button with confirmation.
- Keep edited notes visible until the user presses “Update inbox”; local row state should mark “changed” but not auto-remove matching notes.
- On “Update inbox”, rerun the query and remove notes that now have tags or a `parent` link.

## Data And Actions
- Tags:
  - Write to frontmatter `tags`.
  - Normalize entered tags by trimming whitespace and removing leading `#`.
  - Preserve existing tags and append only new unique tags.
- Parent:
  - Write to frontmatter field `parent`.
  - Store as an Obsidian link generated from the selected note, e.g. `[[Parent Note]]`, using Obsidian link generation where practical.
- Frontmatter writes:
  - Use `app.fileManager.processFrontMatter(file, fn)` for atomic YAML updates.
  - Catch YAML/write errors and show `Notice` messages without losing view state.
- Delete:
  - Use Obsidian’s preferred trash behavior via `app.fileManager.trashFile(file)` if available; otherwise fall back to `app.vault.trash(file, false)`.
  - Remove the row from the current view after successful trashing.
- Bases:
  - Do not build a Bases view in v1. The standalone view is the primary implementation because it supports direct editing, staged refresh, and deletion cleanly.
  - Keep the query/filter logic isolated so a future `registerBasesView` integration can reuse it.

## Test Plan
- Build checks:
  - `npm install`
  - `npm run build`
- Manual vault scenarios:
  - Root note with no tags and no `parent` appears.
  - Root note with frontmatter tags does not appear.
  - Root note with inline `#tag` does not appear.
  - Root note with `parent: [[Some Note]]` does not appear.
  - Nested folder note never appears.
  - Adding a tag keeps the row visible until “Update inbox”.
  - Adding only a parent keeps the row visible until “Update inbox”, then removes it.
  - Multiple tags preserve existing frontmatter.
  - Delete prompts, trashes note, and removes row.
  - Invalid YAML frontmatter surfaces an error notice and does not corrupt the file.

## Assumptions
- Inbox means root-level Markdown notes only.
- A note leaves the inbox after manual update if it has at least one tag or a `parent` value.
- Parent field is named `parent`.
- Parent value is stored as an Obsidian note link.
- V1 is a standalone plugin view, not a Bases view.
- Quick delete uses Obsidian’s configured trash behavior, not permanent deletion.
