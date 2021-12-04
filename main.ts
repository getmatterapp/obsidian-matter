// TODO: replace `any` types with type definitions
import { App, ButtonComponent, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import QRious from 'qrious';

const CLIENT_TYPE = 'web';  // TODO: create an integration client type with read access
const MATTER_API_VERSION = 'v11';
const MATTER_API_DOMAIN = 'api.getmatter.app'
const MATTER_API_HOST = `https://${MATTER_API_DOMAIN}/api/${MATTER_API_VERSION}`;
const ENDPOINTS = {
  QR_LOGIN_TRIGGER: `${MATTER_API_HOST}/qr_login/trigger/`,
  QR_LOGIN_EXCHANGE: `${MATTER_API_HOST}/qr_login/exchange/`,
  REFRESH_TOKEN_EXCHANGE: `${MATTER_API_HOST}/token/refresh/`,
  HIGHLIGHTS_FEED: `${MATTER_API_HOST}/library_items/highlights_feed/`
}

const LOOP_SYNC_INTERVAL = 1000;  // TODO: increase to 1 minute

interface MatterSettings {
  accessToken: string | null;
  refreshToken: string | null;
  qrSessionToken: string | null;
  dataDir: string | null;
  syncInterval: number;
  hasCompletedInitialSetup: boolean;
  lastSync: Date | null;
  isSyncing: boolean;
}

const DEFAULT_SETTINGS: MatterSettings = {
  accessToken: null,
  refreshToken: null,
  qrSessionToken: null,
  dataDir: "Matter",
  syncInterval: 60,
  hasCompletedInitialSetup: false,
  lastSync: null,
  isSyncing: false,
}

export default class MatterPlugin extends Plugin {
  settings: MatterSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MatterSettingsTab(this.app, this));

    // Reset isSyncing when the plugin is loaded.
    this.settings.isSyncing = false;
    await this.saveSettings();
    await this.sync();

    setInterval(async () => {
      await this.loopSync();
    }, LOOP_SYNC_INTERVAL);
  }

  onunload() {
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
      console.error(error);
      new Notice('There was a problem syncing with Matter, try again later.');
    }

    this.settings.isSyncing = false;
    await this.saveSettings();
  }

  private async _pageAnnotations() {
    let url = ENDPOINTS.HIGHLIGHTS_FEED;
    while (url !== null) {
      const response = await this._authedRequest(url);
      for (let i = 0; i < response.feed.length; i++) {
        const feedEntry = response.feed[i];
        await this._handleFeedEntry(feedEntry);
      }
      url = response.next;
    }
  }

  private async _authedRequest(url: string) {
    try {
      return (await authedRequest(this.settings.accessToken, url));
    } catch(e) {
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

  private async _handleFeedEntry(feedEntry: any) {
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

  private _appendAnnotations(feedEntry: any, content: string, after: Date): string {
    const newAnnotations = feedEntry.content.my_annotations.filter((a: any) => new Date(a.created_date) > after);
    if (!newAnnotations.length) {
      return;
    }

    if (content[-1] !== '\n') {
      content += '\n';
    }

    return content + `${newAnnotations.map(this._renderAnnotation).join('\n')}`;
  }

  private _renderFeedEntry(feedEntry: any): string {
    let publicationDateStr = "";
    if (feedEntry.content.publication_date) {
      const publicationDate = new Date(feedEntry.content.publication_date);
      publicationDateStr = publicationDate.toISOString().slice(0, 10);
    }

    const annotations = feedEntry.content.my_annotations.sort((a: any, b: any) => a.word_start - b.word_start);
    // TODO: find a better of handling templates
    return `
## Metadata
* URL: [${feedEntry.content.url}](${feedEntry.content.url})
${publicationDateStr ? `* Published Date: ${publicationDateStr}` : ''}
${feedEntry.content.author ? `* Author: [[${feedEntry.content.author.any_name}]]\n` : ''}
## Highlights
${annotations.map(this._renderAnnotation).join("\n")}
`.trim();
  }

  private _renderAnnotation(annotation: any) {
    return `
* ${annotation.text}${annotation.note ? `
  * **Note**: ${annotation.note}`: ''}
`.trim()
  }
}

class MatterSettingsTab extends PluginSettingTab {
  // TODO: allow the user to stop syncing & sign out
  plugin: MatterPlugin;

  constructor(app: App, plugin: MatterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.loadInterface();
  }

  loadInterface(): void {
    const { containerEl } = this;
    containerEl.createEl('h1', { text: 'Matter' });

    if (!this.plugin.settings.accessToken || !this.plugin.settings.hasCompletedInitialSetup) {
      this.displaySetup();
    } else {
      this.displaySettings();
    }
  }

  async displaySetup(): Promise<void> {
    const { containerEl } = this;

    try {
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');

      const triggerResponse = await fetch(ENDPOINTS.QR_LOGIN_TRIGGER, {
        method: "POST",
        body: JSON.stringify({ client_type: CLIENT_TYPE }),
        headers,
      });
      this.plugin.settings.qrSessionToken = (await triggerResponse.json()).session_token;
    } catch (error) {
      return;
    }

    const setting = new Setting(containerEl)
      .setName('Scan this QR code in the Matter app')
      .setDesc('Go to Profile > Settings > Connected Accounts > Obsidian');

    if (!this.plugin.settings.accessToken) {
      const canvas = document.createElement('canvas');
      canvas.className = 'matter-qr';
      setting.settingEl.appendChild(canvas);

      new QRious({
        element: canvas,
        value: this.plugin.settings.qrSessionToken,
        size: 80,
        backgroundAlpha: 0.2,
      });
    } else {
      const authConfirmation = document.createElement('p');
      authConfirmation.className = 'matter-auth-confirmation';
      authConfirmation.appendText('✅');
      setting.settingEl.appendChild(authConfirmation);
    }

    new Setting(containerEl)
      .setName('Matter Sync Folder')
      .setDesc('Where do you want your Matter data to live in Obsidian?')
      .addText(text => text
        .setPlaceholder('Enter location')
        .setValue(this.plugin.settings.dataDir)
        .onChange(async (value) => {
          // TODO: move all data to the new directory
          this.plugin.settings.dataDir = value;
          await this.plugin.saveSettings();
        }));

    new ButtonComponent(containerEl)
      .setButtonText('Start Syncing')
      .setClass('matter-setup-btn')
      .setDisabled(!this.plugin.settings.accessToken)
      .onClick(async () => {
        this.plugin.settings.hasCompletedInitialSetup = true;
        await this.plugin.saveSettings();
        this.plugin.loopSync();
        this.display();
      });

    const { access_token, refresh_token } = await this._pollQRLoginExchange();
    if (access_token) {
      this.plugin.settings.accessToken = access_token;
      this.plugin.settings.refreshToken = refresh_token;
      await this.plugin.saveSettings();
      this.display();
    }
  }

  async displaySettings() {
    const { containerEl } = this;

    new Setting(containerEl)
      .setName('Sync with Matter')
      .setDesc('Manually start a sync with Matter')
      .addButton(button => button
        .setButtonText('Sync')
        .onClick(async () => {
          await this.plugin.sync()
        }));

    new Setting(containerEl)
      .setName('Matter Sync Folder')
      .setDesc('Where do you want your Matter data to live in Obsidian?')
      .addText(text => text
        .setPlaceholder('Enter location')
        .setValue(this.plugin.settings.dataDir)
        .onChange(async (value) => {
          this.plugin.settings.dataDir = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync Frequency')
      .setDesc('How often should Obsidian sync with Matter?')
      .addDropdown(dropdown => dropdown
        .addOption("1", "Every minute")  // TODO: remove before public release
        .addOption("60", "Every hour")
        .addOption("720", "Every 12 hours")
        .addOption("1440", "Every 24 hours")
        .setValue(this.plugin.settings.syncInterval.toString())
        .onChange(async (val) => {
          this.plugin.settings.syncInterval = parseInt(val)
          await this.plugin.saveSettings()
        })
      );
  }

  private async _pollQRLoginExchange() {
    if (!this.plugin.settings.qrSessionToken) {
      return;
    }

    let attempts = 0;
    while (attempts < 300) {
      try {
        const response = await this._qrLoginExchange(this.plugin.settings.qrSessionToken);
        const loginSession = await response.json();
        if (loginSession?.access_token) {
          return {
            access_token: loginSession.access_token,
            refresh_token: loginSession.refresh_token,
          };
        }
      } catch(e) {
        // TODO: handle
      } finally {
        attempts++;
        await sleep(1000);
      }
    }
  }

  private async _qrLoginExchange(session_token: string): Promise<any> {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    return await fetch(ENDPOINTS.QR_LOGIN_EXCHANGE, {
      method: "POST",
      body: JSON.stringify({
        session_token
      }),
      headers,
    });
  }
}

const authedRequest = async(
  accessToken: string,
  url: string,
  fetchArgs: RequestInit = {},
) => {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Content-Type', 'application/json');

  const response = await fetch(url, {
    ...fetchArgs,
    headers,
  });
  return response.json()
}

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const toFilename = (s: string): string => {
  return s.replace(/[/\\?%*:|"<>]/g, '-');
}
