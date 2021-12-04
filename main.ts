import {
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

const LOOP_SYNC_INTERVAL = 1000;  // TODO: increase to 1 minute

export default class MatterPlugin extends Plugin {
  intervalRef: NodeJS.Timer;
  settings: MatterSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MatterSettingsTab(this.app, this));

    // Reset isSyncing when the plugin is loaded.
    this.settings.isSyncing = false;
    await this.saveSettings();

    // Sync on load
    if (
      this.settings.accessToken
      && this.settings.hasCompletedInitialSetup
    ) {
      await this.sync();
    }

    // Set up sync interval
    this.intervalRef = setInterval(async () => {
      await this.loopSync();
    }, LOOP_SYNC_INTERVAL);
  }

  onunload() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
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
      new Notice('There was a problem syncing with Matter, try again later.');
    }

    this.settings.isSyncing = false;
    await this.saveSettings();
  }

  private async _pageAnnotations() {
    let url = ENDPOINTS.HIGHLIGHTS_FEED;
    while (url !== null) {
      const response: FeedResponse = await this._authedRequest(url);
      for (const feedEntry of response.feed) {
        await this._handleFeedEntry(feedEntry);
      }
      url = response.next;
    }
  }

  private async _authedRequest(url: string) {
    try {
      return (await authedRequest(this.settings.accessToken, url));
    } catch (e) {
      // TODO: verify status code before retrying
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
  }

  private async _handleFeedEntry(feedEntry: FeedEntry) {
    const fs = this.app.vault.adapter;
    if (!(await fs.exists(this.settings.dataDir))) {
      fs.mkdir(this.settings.dataDir);
    }

    const entryPath = `${this.settings.dataDir}/${toFilename(feedEntry.content.title)}.md`;
    if (await fs.exists(entryPath)) {
      const after = new Date(this.settings.lastSync);
      let content = await fs.read(entryPath);
      content = this._appendAnnotations(feedEntry, content, after);
      await fs.write(entryPath, content);
    } else {
      await fs.write(entryPath, this._renderFeedEntry(feedEntry));
    }
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
    let publicationDateStr = "";
    if (feedEntry.content.publication_date) {
      const publicationDate = new Date(feedEntry.content.publication_date);
      publicationDateStr = publicationDate.toISOString().slice(0, 10);
    }

    const annotations = feedEntry.content.my_annotations.sort((a, b) => a.word_start - b.word_start);
    return `
## Metadata
* URL: [${feedEntry.content.url}](${feedEntry.content.url})
${publicationDateStr ? `* Published Date: ${publicationDateStr}` : ''}
${feedEntry.content.author ? `* Author: [[${feedEntry.content.author.any_name}]]\n` : ''}
## Highlights
${annotations.map(this._renderAnnotation).join("\n")}
`.trim();
  }

  private _renderAnnotation(annotation: Annotation) {
    return `
* ${annotation.text}${annotation.note ? `
  * **Note**: ${annotation.note}` : ''}
`.trim()
  }
}
