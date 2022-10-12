import {
  normalizePath,
  Notice,
  Plugin,
} from 'obsidian';
import {
  Annotation,
  ENDPOINTS,
  FeedEntry,
  FeedResponse,
  authedRequest,
} from './api';
import { LAYOUT_TEMPLATE, HIGHLIGHT_TEMPLATE, METADATA_TEMPLATE } from './rendering';
import {
  DEFAULT_SETTINGS,
  MatterSettings,
  MatterSettingsTab
} from './settings';
import { toFilename } from './utils';
import * as nunjucks from 'nunjucks';
nunjucks.configure({trimBlocks: true, autoescape: false})

const LOOP_SYNC_INTERVAL = 60 * 1000;

export default class MatterPlugin extends Plugin {
  settings: MatterSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MatterSettingsTab(this.app, this));

    // Call in parallel to avoid long loading times.
    this.initialSync();

    // Set up sync interval
    this.registerInterval(window.setInterval(async () => {
      await this.loopSync();
    }, LOOP_SYNC_INTERVAL));

    this.addCommand({
      id: 'matter-sync',
      name: 'Sync',
      callback: () => {
        this.sync();
      },
    });
  }

  onunload() {
  }

  async initialSync() {
    // Reset isSyncing when the plugin is loaded.
    this.settings.isSyncing = false;
    await this.saveSettings();

    // Sync on load
    if (
      this.settings.accessToken
      && this.settings.hasCompletedInitialSetup
    ) {
      await this.sync();
    } else {
      new Notice("Finish setting up Matter in settings");
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async loopSync() {
    const msSinceLastSync = new Date().valueOf() - new Date(this.settings.lastSync).valueOf();
    const mssyncInterval = this.settings.syncInterval * 60 * 1000;
    if (
      this.settings.accessToken
      && this.settings.hasCompletedInitialSetup
      && msSinceLastSync >= mssyncInterval
    ) {
      this.sync();
    }
  }

  async sync() {
    // The settings file can change via multiple device sync. Fetch a fresh copy
    // just in case another sync is happening elsewhere.
    await this.loadSettings();
    const initialSyncState = Object.values(this.settings.contentMap);

    if (this.settings.isSyncing || !this.settings.accessToken) {
      return;
    }

    this.settings.isSyncing = true;
    await this.saveSettings();

    try {
      new Notice('Syncing with Matter');
      await this._pageAnnotations(initialSyncState);
      this.settings.lastSync = new Date();
      new Notice('Finished syncing with Matter');
    } catch (error) {
      console.error(error);
      new Notice('There was a problem syncing with Matter, try again later.');
    }

    this.settings.isSyncing = false;
    await this.saveSettings();
  }

  private async _pageAnnotations(initialSyncState: string[]) {
    let url = ENDPOINTS.HIGHLIGHTS_FEED;
    let feedEntries: FeedEntry[] = [];

    // Load all feed items new to old.
    while (url !== null) {
      const response: FeedResponse = await this._authedRequest(url);
      feedEntries = feedEntries.concat(response.feed);
      url = response.next;
    }

    // Reverse the feed items so that chronological ordering is preserved.
    feedEntries = feedEntries.reverse();
    for (const feedEntry of feedEntries) {
      // If an entry has appeared with the same id since the sync started, skip it
      // for now. This indicates a race condition with another sync service.
      await this.loadSettings()
      const currentSyncState = Object.values(this.settings.contentMap);
      if (
        !initialSyncState.includes(feedEntry.id)
        && currentSyncState.includes(feedEntry.id)
      ) {
        continue
      }

      await this._handleFeedEntry(feedEntry);
    }
  }

  private async _authedRequest(url: string) {
    try {
      return (await authedRequest(this.settings.accessToken, url));
    } catch (e) {
      await this._refreshTokenExchange();
      return (await authedRequest(this.settings.accessToken, url));
    }
  }

  private async _refreshTokenExchange() {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const response = await fetch(ENDPOINTS.REFRESH_TOKEN_EXCHANGE, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refresh_token: this.settings.refreshToken })
    });
    const payload = await response.json();
    this.settings.accessToken = payload.access_token;
    this.settings.refreshToken = payload.refresh_token;
    await this.saveSettings();

    if (!this.settings.accessToken) {
      new Notice("Unable to sync with Matter, please sign in again.");
      throw new Error("Authentication failed");
    }
  }

  private async _handleFeedEntry(feedEntry: FeedEntry) {
    const fs = this.app.vault.adapter;
    if (!(await fs.exists(this.settings.dataDir))) {
      await fs.mkdir(this.settings.dataDir);
    }

    const entryName = await this._generateEntryName(feedEntry);
    const entryPath = this._getPath(entryName);

    if (await fs.exists(entryPath)) {
      const after = new Date(this.settings.lastSync);
      const content = await fs.read(entryPath);
      const newContent = this._appendAnnotations(feedEntry, content, after);
      if (newContent != content) {
        await fs.write(entryPath, newContent);
      }
    } else {
      if (!this.settings.contentMap[entryName] || this.settings.recreateIfMissing) {
        await fs.write(entryPath, this._renderFeedEntry(feedEntry));
      }
    }

    this.settings.contentMap[entryName] = feedEntry.id;
    await this.saveSettings();
  }

  private _getPath(name: string){
    return normalizePath(`${this.settings.dataDir}/${name}`);
  }

  private async _generateEntryName(feedEntry: FeedEntry): Promise<string> {
    const fs = this.app.vault.adapter;
    let name = `${toFilename(feedEntry.content.title)}.md`
    let i = 1;
    while (
      (await fs.exists(this._getPath(name)))
      && this.settings.contentMap[name] !== feedEntry.id
    ) {
      i++;
      name = `${toFilename(feedEntry.content.title)}-${i}.md`;
    }

    return name;
  }

  private _appendAnnotations(feedEntry: FeedEntry, content: string, after: Date): string {
    const newAnnotations = feedEntry.content.my_annotations.filter(a => new Date(a.created_date) > after);
    if (!newAnnotations.length) {
      return content;
    }

    return content.trimEnd() + '\n' + newAnnotations.map((a) => this._renderAnnotation(a)).join('');
  }

  private _renderFeedEntry(feedEntry: FeedEntry): string {
    let metadata;
    try {
      metadata = this._renderMetadata(feedEntry);
    } catch (error) {
      new Notice("There was a problem with your Matter metadata template. Please update it in settings.");
      return
    }


    let highlights;
    try {
      const annotations = feedEntry.content.my_annotations.sort((a, b) => a.word_start - b.word_start);
      highlights = annotations.map((a) => this._renderAnnotation(a)).join('')
    } catch (error) {
      console.error(error)
      new Notice("There was a problem with your Matter highlight template. Please update it in settings.");
      return
    }

    try {
      return nunjucks.renderString(LAYOUT_TEMPLATE.trim(), {
        title: feedEntry.content.title,
        metadata: metadata,
        highlights: highlights,
      })
    } catch (error) {
      new Notice("There was a problem with your Matter template. Please update it in settings.");
    }
  }

  private _renderMetadata(feedEntry: FeedEntry): string {
    const template = this.settings.metadataTemplate || METADATA_TEMPLATE;

    let publishedDate: string | null = null;
    if (feedEntry.content.publication_date) {
      const publicationDate = new Date(feedEntry.content.publication_date);
      publishedDate = publicationDate.toISOString().slice(0, 10);
    }

    return nunjucks.renderString(template.trim(), {
      url: feedEntry.content.url,
      title: feedEntry.content.title,
      author: feedEntry.content.author?.any_name,
      publisher: feedEntry.content.publisher?.any_name,
      published_date: publishedDate,
      note: feedEntry.content.my_note?.note,
      tags: feedEntry.content.tags.map(t => t.name)
    })
  }

  private _renderAnnotation(annotation: Annotation) {
    const template = this.settings.highlightTemplate || HIGHLIGHT_TEMPLATE;
    return nunjucks.renderString(template.trim(), {
      text: annotation.text,
      note: annotation.note,
    })
  }
}
