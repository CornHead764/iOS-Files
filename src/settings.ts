import {App, PluginSettingTab, Setting} from 'obsidian';
import type IOSFilesBridge from './main';

export class FileBridgeSettingTab extends PluginSettingTab {
	plugin: IOSFilesBridge;

	constructor(app: App, plugin: IOSFilesBridge) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl).setName('File import and export').setHeading();
		containerEl.createEl('p', {
			text: 'Import and export files between your vault and any storage provider in the files app (OneDrive, iCloud Drive, Google Drive, Dropbox, etc.).',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Import folder')
			.setDesc('Vault folder where imported files are saved. Created automatically if it does not exist.')
			.addText(text => text
				.setPlaceholder('iOS files')
				.setValue(this.plugin.settings.importFolder)
				.onChange(async (value) => {
					this.plugin.settings.importFolder = value.trim() || 'iOS Files';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show notices')
			.setDesc('Show notification banners when files are imported or exported.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showNotices)
				.onChange(async (value) => {
					this.plugin.settings.showNotices = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Confirm before overwrite')
			.setDesc('Ask for confirmation before overwriting an existing file in the vault during import.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.confirmOverwrite)
				.onChange(async (value) => {
					this.plugin.settings.confirmOverwrite = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('Vault sync').setHeading();

		const manifest = this.plugin.syncManifest;
		if (manifest) {
			const lastSync = new Date(manifest.lastSyncTime);
			const fileCount = Object.keys(manifest.files).length;
			containerEl.createEl('p', {
				text: `Sync active — tracking ${fileCount} files. Last synced: ${lastSync.toLocaleString()}.`,
				cls: 'setting-item-description',
			});
		} else {
			containerEl.createEl('p', {
				text: 'No sync configured. Use the "set up vault sync" command to get started.',
				cls: 'setting-item-description',
			});
		}

		new Setting(containerEl)
			.setName('Delete removed files on pull')
			.setDesc('When pulling updates, delete vault files that no longer exist in the remote folder.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncDeleteRemovedFiles)
				.onChange(async (value) => {
					this.plugin.settings.syncDeleteRemovedFiles = value;
					await this.plugin.saveSettings();
				}));
	}
}
