import {Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, type FileBridgeSettings} from './types';
import {FileBridgeSettingTab} from './settings';
import {FileBridge} from './file-bridge';
import {ImportModal} from './import-modal';
import {ExportModal, ExportCurrentFileCommand, BulkExportModal} from './export-modal';

export default class IOSFilesBridge extends Plugin {
	settings: FileBridgeSettings;
	bridge: FileBridge;

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<FileBridgeSettings>);
		this.bridge = new FileBridge(this.app, this.settings);

		// Ribbon icon: import files from iOS Files app
		this.addRibbonIcon('download', 'Import from Files app', () => {
			new ImportModal(this.app, this.bridge, this.settings).open();
		});

		// Command: import files
		this.addCommand({
			id: 'import-files',
			name: 'Import files from Files app',
			callback: () => {
				new ImportModal(this.app, this.bridge, this.settings).open();
			},
		});

		// Command: export current file
		this.addCommand({
			id: 'export-current-file',
			name: 'Export current file to Files app',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return false;
				if (!checking) {
					ExportCurrentFileCommand.run(this.app, this.bridge, this.settings);
				}
				return true;
			},
		});

		// Command: export by search
		this.addCommand({
			id: 'export-file-search',
			name: 'Export a vault file to Files app',
			callback: () => {
				new ExportModal(this.app, this.bridge, this.settings).open();
			},
		});

		// Command: bulk export a folder
		this.addCommand({
			id: 'export-folder',
			name: 'Export folder to Files app',
			callback: () => {
				new BulkExportModal(this.app, this.bridge, this.settings).open();
			},
		});

		// Settings tab
		this.addSettingTab(new FileBridgeSettingTab(this.app, this));
	}

	async saveSettings() {
		this.bridge.updateSettings(this.settings);
		await this.saveData(this.settings);
	}
}
