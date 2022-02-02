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
import {
  DEFAULT_SETTINGS,
  MatterSettings,
  MatterSettingsTab
} from './settings';
import { toFilename } from './utils';

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

    if (this.settings.isSyncing || !this.settings.accessToken) {
      return;
    }

    this.settings.isSyncing = true;
    await this.saveSettings();

    try {
      new Notice('Syncing with Matter');
      await this._pageAnnotations();
      this.settings.lastSync = new Date();
      new Notice('Finished syncing with Matter');
    } catch (error) {
      console.error(error);
      new Notice('There was a problem syncing with Matter, try again later.');
    }

    this.settings.isSyncing = false;
    await this.saveSettings();
  }

  private async _pageAnnotations() {
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
      await fs.write(entryPath, this._renderFeedEntry(feedEntry));
    }
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

    this.settings.contentMap[name] = feedEntry.id;
    await this.saveSettings();
    return name;
  }

  private _appendAnnotations(feedEntry: FeedEntry, content: string, after: Date): string {
    const newAnnotations = feedEntry.content.my_annotations.filter(a => new Date(a.created_date) > after);
    if (!newAnnotations.length) {
      return content;
    }

    if (content[-1] !== '\n') {
      content += '\n';
    }

    return content + `${newAnnotations.map(this._renderAnnotation).join('\n')}`;
  }

  private _renderFeedEntry(feedEntry: FeedEntry): string {
    const annotations = feedEntry.content.my_annotations.sort((a, b) => a.word_start - b.word_start);
    return `
## Metadata
${this._renderMetadata(feedEntry)}
## Highlights
${annotations.map(this._renderAnnotation).join("\n")}
`.trim();
  }

  private _renderMetadata(feedEntry: FeedEntry): string {
    let metadata = `* URL: [${feedEntry.content.url}](${feedEntry.content.url})`;
    if (feedEntry.content.publication_date) {
      const publicationDate = new Date(feedEntry.content.publication_date);
      const publicationDateStr = publicationDate.toISOString().slice(0, 10);
      metadata += `\n* Published Date: ${publicationDateStr}`;
    }

    if (feedEntry.content.author) {
      metadata += `\n* Author: [[${feedEntry.content.author.any_name}]]`;
    }

    if (feedEntry.content.publisher) {
      metadata += `\n* Publisher: [[${feedEntry.content.publisher.any_name}]]`;
    }

    metadata += '\n';
    return metadata;
  }

  private _renderAnnotation(annotation: Annotation) {
    return `
* ${annotation.text}${annotation.note ? `
  * **Note**: ${annotation.note}` : ''}
`.trim()
  }
}
