import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  getAllTags,
  setIcon,
} from "obsidian";

const VIEW_TYPE_INBOX = "obsidian-inbox-view";
const DEFAULT_EXCERPT_LENGTH = 280;

type InboxMatchMode = "missing-tags-or-parent" | "missing-tags-and-parent";

interface InboxProcessorSettings {
  showExcerpts: boolean;
  includeSubfolders: boolean;
  excerptCharacterLimit: number;
  matchMode: InboxMatchMode;
}

const DEFAULT_SETTINGS: InboxProcessorSettings = {
  showExcerpts: true,
  includeSubfolders: false,
  excerptCharacterLimit: DEFAULT_EXCERPT_LENGTH,
  matchMode: "missing-tags-or-parent",
};

interface InboxRow {
  file: TFile;
  excerpt: string;
  changed: boolean;
}

function hasParentValue(parent: unknown): boolean {
  if (Array.isArray(parent)) {
    return parent.some((entry) => String(entry).trim().length > 0);
  }

  if (typeof parent === "string") {
    return parent.trim().length > 0;
  }

  return parent !== undefined && parent !== null;
}

function normalizeSingleTag(value: string): string {
  return value.trim().replace(/^#+/, "").trim();
}

function parseTagsFromInput(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map(normalizeSingleTag)
    .filter((tag) => tag.length > 0);
}

function getFrontmatterTags(tagsValue: unknown): string[] {
  if (Array.isArray(tagsValue)) {
    return tagsValue.map((tag) => normalizeSingleTag(String(tag))).filter((tag) => tag.length > 0);
  }

  if (typeof tagsValue === "string") {
    return parseTagsFromInput(tagsValue);
  }

  return [];
}

function mergeUniqueTags(existing: string[], additions: string[]): string[] {
  const lower = new Set<string>();
  const merged: string[] = [];

  for (const tag of [...existing, ...additions]) {
    const key = tag.toLowerCase();
    if (!lower.has(key)) {
      lower.add(key);
      merged.push(tag);
    }
  }

  return merged;
}

function stripLeadingFrontmatter(raw: string): string {
  return raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, "");
}

function buildExcerpt(raw: string, maxLength: number): string {
  const limit = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : DEFAULT_EXCERPT_LENGTH;
  const withoutFrontmatter = stripLeadingFrontmatter(raw).trimStart();
  const source = withoutFrontmatter.replace(/\s+/g, " ").trim();
  if (!source) {
    return "(No content)";
  }

  if (source.length <= limit) {
    return source;
  }

  return `${source.slice(0, limit).trimEnd()}…`;
}

// Query logic intentionally isolated for future reuse (e.g. Bases view integration).
function getInboxCandidates(app: App, settings: InboxProcessorSettings): TFile[] {
  return app.vault
    .getMarkdownFiles()
    .filter((file) => {
      if (file.extension.toLowerCase() !== "md") {
        return false;
      }

      if (!settings.includeSubfolders && file.path.includes("/")) {
        return false;
      }

      const cache = app.metadataCache.getFileCache(file);
      const tags = cache ? getAllTags(cache) : null;
      const hasTags = Boolean(tags && tags.length > 0);
      const hasParent = hasParentValue(cache?.frontmatter?.parent);

      if (settings.matchMode === "missing-tags-and-parent") {
        return !hasTags && !hasParent;
      }

      return !hasTags || !hasParent;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

class InboxProcessorView extends ItemView {
  private rows: InboxRow[] = [];
  private tagSuggestions: string[] = [];
  private parentSuggestions: TFile[] = [];
  private readonly tagListId = `inbox-tags-${Math.random().toString(36).slice(2)}`;
  private readonly parentListId = `inbox-parents-${Math.random().toString(36).slice(2)}`;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: InboxProcessorPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_INBOX;
  }

  getDisplayText(): string {
    return "Inbox Processor";
  }

  getIcon(): string {
    return "inbox";
  }

  async onOpen(): Promise<void> {
    this.addAction("refresh-cw", "Update inbox", () => {
      void this.refreshInbox();
    });

    await this.refreshInbox();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async refreshInbox(): Promise<void> {
    try {
      this.tagSuggestions = this.collectTagSuggestions();
      this.parentSuggestions = this.collectParentSuggestions();
      const files = getInboxCandidates(this.app, this.plugin.settings);

      this.rows = await Promise.all(
        files.map(async (file) => ({
          file,
          excerpt: this.plugin.settings.showExcerpts
            ? buildExcerpt(await this.app.vault.cachedRead(file), this.plugin.settings.excerptCharacterLimit)
            : "",
          changed: false,
        })),
      );

      this.render();
    } catch (error) {
      console.error("[inbox-processor] Failed to refresh inbox", error);
      new Notice("Failed to refresh inbox.");
    }
  }

  private collectTagSuggestions(): string[] {
    const tags = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) {
        continue;
      }

      for (const tag of getAllTags(cache) ?? []) {
        const normalized = normalizeSingleTag(tag);
        if (normalized.length > 0) {
          tags.add(normalized);
        }
      }
    }

    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }

  private collectParentSuggestions(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private render(): void {
    const content = this.contentEl;
    content.empty();
    content.addClass("inbox-processor-view");

    const toolbar = content.createDiv({ cls: "inbox-toolbar" });

    toolbar.createEl("span", {
      cls: "inbox-title",
      text: `Inbox (${this.rows.length})`,
    });

    const refreshButton = toolbar.createEl("button");
    setIcon(refreshButton, "rotate-cw");

    refreshButton.addEventListener("click", () => {
      void this.refreshInbox();
    });

    const tagDatalist = content.createEl("datalist", {
      attr: { id: this.tagListId },
    });
    for (const tag of this.tagSuggestions) {
      const option = tagDatalist.createEl("option");
      option.value = tag;
    }

    const parentDatalist = content.createEl("datalist", {
      attr: { id: this.parentListId },
    });
    for (const parent of this.parentSuggestions) {
      const option = parentDatalist.createEl("option");
      option.value = parent.path;
    }

    if (this.rows.length === 0) {
      content.createEl("p", {
        cls: "inbox-empty",
        text: "No inbox notes found.",
      });
      return;
    }

    const list = content.createDiv({ cls: "inbox-list" });
    for (const row of this.rows) {
      const rowEl = list.createDiv({ cls: "inbox-row" });
      if (row.changed) {
        rowEl.addClass("is-changed");
      }

      const headerEl = rowEl.createDiv({ cls: "inbox-row-header" });
      const titleEl = headerEl.createEl("button", {
        cls: "inbox-note-link",
        text: row.file.basename,
      });
      titleEl.addEventListener("click", () => {
        void this.app.workspace.getLeaf(true).openFile(row.file);
      });

      const deleteButton = headerEl.createEl("button", {
        cls: "mod-warning inbox-icon-button",
      });
      setIcon(deleteButton, "trash");
      deleteButton.setAttr("aria-label", "Delete note");
      deleteButton.setAttr("title", "Delete note");
      deleteButton.addEventListener("click", () => {
        void this.deleteNote(row.file);
      });

      if (this.plugin.settings.showExcerpts) {
        rowEl.createEl("p", { cls: "inbox-excerpt", text: row.excerpt });
      }

      const controls = rowEl.createDiv({ cls: "inbox-controls" });

      const tagGroup = controls.createDiv({ cls: "inbox-control-group" });
      const tagInput = tagGroup.createEl("input", {
        type: "text",
        placeholder: "Tags (comma or space separated)",
      });
      tagInput.setAttr("list", this.tagListId);
      const tagButton = tagGroup.createEl("button", { cls: "inbox-icon-button" });
      setIcon(tagButton, "check");
      tagButton.setAttr("aria-label", "Save tags");
      tagButton.setAttr("title", "Save tags");
      tagButton.addEventListener("click", () => {
        void this.applyTags(row, tagInput.value);
      });
      tagInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.applyTags(row, tagInput.value);
        }
      });

      const parentGroup = controls.createDiv({ cls: "inbox-control-group" });
      const parentInput = parentGroup.createEl("input", {
        type: "text",
        placeholder: "Parent note path",
      });
      parentInput.setAttr("list", this.parentListId);
      const parentButton = parentGroup.createEl("button", { cls: "inbox-icon-button" });
      setIcon(parentButton, "check");
      parentButton.setAttr("aria-label", "Set parent");
      parentButton.setAttr("title", "Set parent");
      parentButton.addEventListener("click", () => {
        void this.applyParent(row, parentInput.value);
      });
      parentInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.applyParent(row, parentInput.value);
        }
      });
    }
  }

  private async applyTags(row: InboxRow, rawInput: string): Promise<void> {
    const newTags = parseTagsFromInput(rawInput);
    if (newTags.length === 0) {
      new Notice("Enter at least one valid tag.");
      return;
    }

    try {
      await this.app.fileManager.processFrontMatter(row.file, (frontmatter) => {
        const existingTags = getFrontmatterTags(frontmatter.tags);
        frontmatter.tags = mergeUniqueTags(existingTags, newTags);
      });

      row.changed = true;
      new Notice(`Updated tags for ${row.file.basename}`);
      this.render();
    } catch (error) {
      console.error(`[inbox-processor] Failed to update tags: ${row.file.path}`, error);
      new Notice(`Could not update tags for ${row.file.basename}.`);
    }
  }

  private async applyParent(row: InboxRow, rawInput: string): Promise<void> {
    const selected = rawInput.trim();
    if (!selected) {
      new Notice("Enter a parent note path.");
      return;
    }

    const parentFile = this.resolveParentFile(selected, row.file);
    if (!parentFile) {
      new Notice("Parent note not found.");
      return;
    }

    if (parentFile.path === row.file.path) {
      new Notice("A note cannot be its own parent.");
      return;
    }

    try {
      const link = this.app.fileManager.generateMarkdownLink(parentFile, row.file.path);
      await this.app.fileManager.processFrontMatter(row.file, (frontmatter) => {
        frontmatter.parent = link;
      });

      row.changed = true;
      new Notice(`Set parent for ${row.file.basename}`);
      this.render();
    } catch (error) {
      console.error(`[inbox-processor] Failed to set parent: ${row.file.path}`, error);
      new Notice(`Could not set parent for ${row.file.basename}.`);
    }
  }

  private resolveParentFile(input: string, currentFile: TFile): TFile | undefined {
    const normalized = input.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    return this.parentSuggestions.find((candidate) => {
      if (candidate.path === currentFile.path) {
        return false;
      }

      return candidate.path.toLowerCase() === normalized || candidate.basename.toLowerCase() === normalized;
    });
  }

  private async deleteNote(file: TFile): Promise<void> {
    const confirmed = window.confirm(`Move "${file.basename}" to trash?`);
    if (!confirmed) {
      return;
    }

    try {
      const manager = this.app.fileManager as typeof this.app.fileManager & {
        trashFile?: (trashTarget: TFile) => Promise<void>;
      };

      if (typeof manager.trashFile === "function") {
        await manager.trashFile(file);
      } else {
        await this.app.vault.trash(file, false);
      }

      this.rows = this.rows.filter((row) => row.file.path !== file.path);
      new Notice(`Moved ${file.basename} to trash.`);
      this.render();
    } catch (error) {
      console.error(`[inbox-processor] Failed to delete file: ${file.path}`, error);
      new Notice(`Could not delete ${file.basename}.`);
    }
  }
}

class InboxProcessorSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: InboxProcessorPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Inbox Processor" });

    new Setting(containerEl)
      .setName("Show note excerpts")
      .setDesc("Display a short preview")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showExcerpts).onChange(async (value) => {
          this.plugin.settings.showExcerpts = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Excerpt character limit")
      .setDesc("Maximum number of characters shown in each note preview.")
      .addText((text) => {
        text.setValue(String(this.plugin.settings.excerptCharacterLimit));
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < 1) {
            return;
          }

          this.plugin.settings.excerptCharacterLimit = parsed;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Include notes in subfolders")
      .setDesc("When enabled, inbox matching includes notes from all folders.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeSubfolders).onChange(async (value) => {
          this.plugin.settings.includeSubfolders = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Inbox matching mode")
      .setDesc("Control whether notes are matched by missing tags or missing parent metadata.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("missing-tags-or-parent", "No tags OR no parent")
          .addOption("missing-tags-and-parent", "No tags AND no parent")
          .setValue(this.plugin.settings.matchMode)
          .onChange(async (value) => {
            if (value === "missing-tags-or-parent" || value === "missing-tags-and-parent") {
              this.plugin.settings.matchMode = value;
              await this.plugin.saveSettings();
            }
          }),
      );
  }
}

export default class InboxProcessorPlugin extends Plugin {
  settings: InboxProcessorSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_INBOX, (leaf) => new InboxProcessorView(leaf, this));

    this.addRibbonIcon("inbox", "Open inbox processor", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-inbox-processor",
      name: "Open inbox processor",
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new InboxProcessorSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_INBOX);
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<InboxProcessorSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...saved,
    };

    if (
      this.settings.matchMode !== "missing-tags-or-parent" &&
      this.settings.matchMode !== "missing-tags-and-parent"
    ) {
      this.settings.matchMode = DEFAULT_SETTINGS.matchMode;
    }

    if (!Number.isFinite(this.settings.excerptCharacterLimit) || this.settings.excerptCharacterLimit < 1) {
      this.settings.excerptCharacterLimit = DEFAULT_SETTINGS.excerptCharacterLimit;
    } else {
      this.settings.excerptCharacterLimit = Math.floor(this.settings.excerptCharacterLimit);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.refreshInboxViews();
  }

  private async refreshInboxViews(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_INBOX);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof InboxProcessorView) {
        await view.refreshInbox();
      }
    }
  }

  private async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_INBOX)[0];

    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    }

    await leaf.setViewState({
      type: VIEW_TYPE_INBOX,
      active: true,
    });

    this.app.workspace.revealLeaf(leaf);
  }
}
