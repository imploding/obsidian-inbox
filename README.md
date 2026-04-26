# Inbox Processor (Obsidian Plugin)

A standalone Obsidian view for processing root-level inbox notes.

## What it does

The **Inbox Processor** view shows only Markdown notes that:

- are in the vault root (not in folders)
- have no tags (inline or frontmatter)
- have no `parent` frontmatter value

From the view, you can:

- open a note
- add tags
- set a `parent` link
- move a note to trash
- click **Update inbox** to refresh and remove notes that no longer match inbox rules

---

## Development setup

From this project directory:

```bash
npm install
npm run build
```

For watch mode during development:

```bash
npm run dev
```

This compiles `src/main.ts` into `main.js`.

---

## Install in your Obsidian vault

1. Build the plugin:

   ```bash
   npm run build
   ```

2. In your vault, create this folder (if it doesn’t exist):

   ```
   <your-vault>/.obsidian/plugins/obsidian-inbox-processor/
   ```

3. Copy these files from this repo into that folder:

- `main.js`
- `manifest.json`
- `styles.css`

4. Open Obsidian → **Settings** → **Community plugins**:
   - Turn off **Safe mode** (if needed)
   - Click **Reload plugins**
   - Enable **Inbox Processor**

---

## Open the view

Use either:

- the ribbon icon (**inbox**), or
- Command Palette → **Open inbox processor**

Inside the view, use **Update inbox** to refresh results.

---

## Notes

- Frontmatter edits are done with Obsidian’s `processFrontMatter` API.
- Delete uses Obsidian trash behavior (`fileManager.trashFile` when available, fallback to `vault.trash(file, false)`).
- V1 is intentionally a standalone custom view (not a Bases view).
