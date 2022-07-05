import {
  App,
  ButtonComponent,
  normalizePath,
  Notice,
  PluginSettingTab,
  Setting,
  TFolder,
} from 'obsidian';
import QRious from 'qrious';
import {
  CLIENT_TYPE,
  ENDPOINTS,
  QRLoginExchangeResponse,
} from './api';
import MatterPlugin from './main';
import { sleep } from './utils';

export interface ContentMap {
  [key: string]: string;
}

export interface MatterSettings {
  accessToken: string | null;
  refreshToken: string | null;
  qrSessionToken: string | null;
  dataDir: string | null;
  syncInterval: number;
  hasCompletedInitialSetup: boolean;
  lastSync: Date | null;
  isSyncing: boolean;
  contentMap: ContentMap
  recreateIfMissing: boolean;
}

export const DEFAULT_SETTINGS: MatterSettings = {
  accessToken: null,
  refreshToken: null,
  qrSessionToken: null,
  dataDir: "Matter",
  syncInterval: 60,
  hasCompletedInitialSetup: false,
  lastSync: null,
  isSyncing: false,
  contentMap: {},
  recreateIfMissing: true,
}

export class MatterSettingsTab extends PluginSettingTab {
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

    const qrSetting = new Setting(containerEl)
      .setName('Scan this QR code in the Matter app')
      .setDesc('Go to Profile > Settings > Connected Accounts > Obsidian');

    const canvas = document.createElement('canvas');
    canvas.className = 'matter-qr';
    qrSetting.settingEl.appendChild(canvas);

    new QRious({
      element: canvas,
      value: this.plugin.settings.qrSessionToken,
      size: 80,
      backgroundAlpha: 0.2,
    });

    new Setting(containerEl)
      .setName('Matter Sync Folder')
      .setDesc('Where do you want your Matter data to live in Obsidian?')
      .addText(text => text
        .setPlaceholder('Enter location')
        .setValue(this.plugin.settings.dataDir)
        .onChange(async (value) => {
          value = value.replace(/^\/+|\/+$/g, '');
          this.plugin.settings.dataDir = normalizePath(value);
          await this.plugin.saveSettings();
        }));

    console.log(this.plugin.app.workspace.getLayout())
    const startBtn = new ButtonComponent(containerEl)
      .setButtonText('Start Syncing')
      .setClass('mod-cta')
      .setClass('matter-setup-btn')
      .setDisabled(true)
      .onClick(async () => {
        this.plugin.settings.hasCompletedInitialSetup = true;
        await this.plugin.saveSettings();
        this.plugin.sync();
        this.plugin.loopSync();
        this.display();
      });

    const { access_token, refresh_token } = await this._pollQRLoginExchange();
    if (access_token) {
      this.plugin.settings.accessToken = access_token;
      this.plugin.settings.refreshToken = refresh_token;
      await this.plugin.saveSettings();

      canvas.remove();
      const authConfirmation = document.createElement('p');
      authConfirmation.className = 'matter-auth-confirmation';
      authConfirmation.appendText('✅');
      qrSetting.settingEl.appendChild(authConfirmation);
      startBtn.setDisabled(false);
    }
  }

  async displaySettings() {
    const { containerEl } = this;

    let newDataDir = this.plugin.settings.dataDir;
    new Setting(containerEl)
      .setName('Matter Sync Folder')
      .setDesc('Where do you want your Matter data to live in Obsidian? Once you click "Apply" all of your current data will be moved')
      .addText(text => text
        .setPlaceholder('Enter location')
        .setValue(newDataDir)
        .onChange(async (value) => {
          value = value.replace(/^\/+|\/+$/g, '');
          newDataDir = normalizePath(value)
        })
      )
      .addButton(button => button
        .setButtonText('Apply')
        .setClass('matter-folder-button')
        .onClick(async () => {
          const vault = this.plugin.app.vault;
          const oldDataDir = this.plugin.settings.dataDir;

          if (newDataDir === oldDataDir) {
            return;
          }

          if (this.plugin.settings.isSyncing) {
            new Notice("Wait for the current sync to end and try again.")
            return;
          }

          // Temporarily disable sync
          this.plugin.settings.isSyncing = true;
          await this.plugin.saveSettings();

          // Copy over the current data to the new vault location
          try {
            button.setButtonText('Migrating...')
            button.setDisabled(true);

            if (!vault.getAbstractFileByPath(newDataDir)) {
              await vault.createFolder(newDataDir);
            }

            const contentKeys = Object.keys(this.plugin.settings.contentMap);
            const files = this.plugin.app.vault.getFiles().filter(f => f.parent.path === oldDataDir && contentKeys.includes(f.name));
            const copies = files.map(file => vault.copy(file, `${newDataDir}/${file.name}`));
            await Promise.all(copies);

            const deletes = files.map(file => vault.delete(file));
            await Promise.all(deletes);

            // If the old data folder is empty, go ahead and remove it as well
            const oldFolder = vault.getAbstractFileByPath(oldDataDir) as TFolder;
            if (oldFolder.children.length === 0) {
              await vault.delete(oldFolder);
            }
          } catch(e) {
            console.error(e);
            new Notice(e.message);
            this.plugin.settings.isSyncing = false;
            await this.plugin.saveSettings();
            button.setButtonText('Apply')
            button.setDisabled(false);
            return;
          }

          // Re-enable sync and persist setting
          this.plugin.settings.dataDir = newDataDir;
          this.plugin.settings.isSyncing = false;
          await this.plugin.saveSettings();
          new Notice("Sync folder updated")
          button.setButtonText('Apply')
          button.setDisabled(false);
        })
      );

    new Setting(containerEl)
      .setName('Sync Frequency')
      .setDesc('How often should Obsidian sync with Matter?')
      .addDropdown(dropdown => dropdown
        .addOption("30", "Every half hour")
        .addOption("60", "Every hour")
        .addOption("720", "Every 12 hours")
        .addOption("1440", "Every 24 hours")
        .setValue(this.plugin.settings.syncInterval.toString())
        .onChange(async (val) => {
          this.plugin.settings.syncInterval = parseInt(val, 10);
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
        .setName('Always Recreate Missing Files')
        .setDesc('If enabled, a sync will re-create missing entries in your vault')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.recreateIfMissing)
          .onChange(async (val) => {
            this.plugin.settings.recreateIfMissing = val;
            await this.plugin.saveSettings();
          })
        )

    new Setting(containerEl)
      .setName('Sync Now')
      .setDesc('Manually start a sync with Matter')
      .addButton(button => button
        .setButtonText('Sync Now')
        .onClick(async () => {
          await this.plugin.sync()
        }));
  }

  private async _pollQRLoginExchange() {
    if (!this.plugin.settings.qrSessionToken) {
      return;
    }

    let attempts = 0;
    while (attempts < 600) {
      try {
        const loginSession = await this._qrLoginExchange(this.plugin.settings.qrSessionToken);
        if (loginSession?.access_token) {
          return {
            access_token: loginSession.access_token,
            refresh_token: loginSession.refresh_token,
          };
        }
      } finally {
        attempts++;
        await sleep(1000);
      }
    }
  }

  private async _qrLoginExchange(sessionToken: string): Promise<QRLoginExchangeResponse> {
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const response = await fetch(ENDPOINTS.QR_LOGIN_EXCHANGE, {
      method: "POST",
      body: JSON.stringify({
        session_token: sessionToken
      }),
      headers,
    });
    return response.json();
  }
}
