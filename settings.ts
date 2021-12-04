import {
  App,
  ButtonComponent,
  PluginSettingTab,
  Setting,
} from 'obsidian';
import QRious from 'qrious';
import {
  CLIENT_TYPE,
  ENDPOINTS,
  QRLoginExchangeResponse,
} from './api';
import MatterPlugin from './main';
import { sleep } from './utils';

export interface MatterSettings {
  accessToken: string | null;
  refreshToken: string | null;
  qrSessionToken: string | null;
  dataDir: string | null;
  syncInterval: number;
  hasCompletedInitialSetup: boolean;
  lastSync: Date | null;
  isSyncing: boolean;
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
}

export class MatterSettingsTab extends PluginSettingTab {
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

    const qrSetting = new Setting(containerEl)
      .setName('Scan this QR code in the Matter app')
      .setDesc('Go to Profile > Settings > Connected Accounts > Obsidian');

    const canvas = document.createElement('canvas');
    canvas.className = 'matter-qr';
    qrSetting.settingEl.appendChild(canvas);

    /* tslint:disable-next-line */
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
          this.plugin.settings.dataDir = value;
          await this.plugin.saveSettings();
        }));

    const startBtn = new ButtonComponent(containerEl)
      .setButtonText('Start Syncing')
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
          // TODO: move all data to the new directory
          value = value.replace(/^\/+|\/+$/g, '');
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
          this.plugin.settings.syncInterval = parseInt(val, 10);
          await this.plugin.saveSettings();
        })
      );
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
      } catch (e) {
        // TODO: handle
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
