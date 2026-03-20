import {Notice, Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, type FileBridgeSettings, type SyncManifest} from './types';
import {FileBridgeSettingTab} from './settings';
import {FileBridge} from './file-bridge';
import {ImportModal} from './import-modal';
import {ExportModal, ExportCurrentFileCommand, BulkExportModal} from './export-modal';
import {SyncEngine} from './sync-engine';
import {SyncSetupModal, SyncPullModal, SyncPushModal} from './sync-modal';

export default class IOSFilesBridge extends Plugin {
	settings: FileBridgeSettings;
	bridge: FileBridge;
	syncEngine: SyncEngine;
	syncManifest: SyncManifest | null = null;

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<FileBridgeSettings>);
		this.bridge = new FileBridge(this.app, this.settings);
		this.syncEngine = new SyncEngine(this.app, this.settings);

		// Load sync manifest if it exists
		this.syncManifest = await this.syncEngine.loadManifest(
			() => this.loadData() as Promise<Record<string, unknown> | null>,
		);

		// Ribbon icon: import files from iOS Files app
		this.addRibbonIcon('download', 'Import from files app', () => {
			new ImportModal(this.app, this.bridge, this.settings).open();
		});

		// Ribbon icon: sync pull
		this.addRibbonIcon('refresh-cw', 'Sync: pull from files app', () => {
			this.openSyncPull();
		});

		// Command: import files
		this.addCommand({
			id: 'import-files',
			name: 'Import files from files app',
			callback: () => {
				new ImportModal(this.app, this.bridge, this.settings).open();
			},
		});

		// Command: export current file
		this.addCommand({
			id: 'export-current-file',
			name: 'Export current file to files app',
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return false;
				if (!checking) {
					void ExportCurrentFileCommand.run(this.app, this.bridge, this.settings);
				}
				return true;
			},
		});

		// Command: export by search
		this.addCommand({
			id: 'export-file-search',
			name: 'Export a vault file to files app',
			callback: () => {
				new ExportModal(this.app, this.bridge, this.settings).open();
			},
		});

		// Command: bulk export a folder
		this.addCommand({
			id: 'export-folder',
			name: 'Export folder to files app',
			callback: () => {
				new BulkExportModal(this.app, this.bridge, this.settings).open();
			},
		});

		// Sync commands
		this.addCommand({
			id: 'sync-setup',
			name: 'Set up vault sync with files app',
			callback: () => {
				this.openSyncSetup();
			},
		});

		this.addCommand({
			id: 'sync-pull',
			name: 'Pull updates from files app',
			callback: () => {
				this.openSyncPull();
			},
		});

		this.addCommand({
			id: 'sync-push',
			name: 'Push changes to files app',
			callback: () => {
				this.openSyncPush();
			},
		});

		// Settings tab
		this.addSettingTab(new FileBridgeSettingTab(this.app, this));
	}

	private getManifestIO() {
		return {
			loadData: () => this.loadData() as Promise<Record<string, unknown> | null>,
			saveData: (data: Record<string, unknown>) => this.saveData(data),
			onSyncComplete: (manifest: SyncManifest) => {
				this.syncManifest = manifest;
			},
		};
	}

	private openSyncSetup() {
		new SyncSetupModal(this.app, this.syncEngine, this.settings, this.getManifestIO()).open();
	}

	private openSyncPull() {
		if (!this.syncManifest) {
			new Notice('No sync configured yet. Use "set up vault sync" first.');
			this.openSyncSetup();
			return;
		}
		new SyncPullModal(this.app, this.syncEngine, this.settings, this.syncManifest, this.getManifestIO()).open();
	}

	private openSyncPush() {
		if (!this.syncManifest) {
			new Notice('No sync configured yet. Use "set up vault sync" first.');
			this.openSyncSetup();
			return;
		}
		new SyncPushModal(this.app, this.syncEngine, this.settings, this.syncManifest, this.getManifestIO()).open();
	}

	async saveSettings() {
		this.bridge.updateSettings(this.settings);
		this.syncEngine.updateSettings(this.settings);
		await this.saveData(this.settings);
	}
}
