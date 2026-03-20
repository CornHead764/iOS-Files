import {App, FuzzySuggestModal, TFile, Notice} from 'obsidian';
import type {FileBridge} from './file-bridge';
import type {FileBridgeSettings} from './types';

export class ExportModal extends FuzzySuggestModal<TFile> {
	private bridge: FileBridge;
	private settings: FileBridgeSettings;
	private files: TFile[];

	constructor(app: App, bridge: FileBridge, settings: FileBridgeSettings, folder?: string) {
		super(app);
		this.bridge = bridge;
		this.settings = settings;
		this.files = this.bridge.getVaultFiles(folder);
		this.setPlaceholder('Search for a file to export...');
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile): void {
		void this.bridge.exportFile(item);
	}
}

export class ExportCurrentFileCommand {
	static async run(app: App, bridge: FileBridge, settings: FileBridgeSettings): Promise<void> {
		const activeFile = app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice('No active file to export');
			return;
		}
		await bridge.exportFile(activeFile);
	}
}

export class BulkExportModal extends FuzzySuggestModal<string> {
	private bridge: FileBridge;
	private settings: FileBridgeSettings;
	private folders: string[];

	constructor(app: App, bridge: FileBridge, settings: FileBridgeSettings) {
		super(app);
		this.bridge = bridge;
		this.settings = settings;

		// Collect unique folder paths
		const folderSet = new Set<string>();
		folderSet.add('/  (entire vault)');
		for (const file of app.vault.getFiles()) {
			const parts = file.path.split('/');
			if (parts.length > 1) {
				folderSet.add(parts.slice(0, -1).join('/'));
			}
		}
		this.folders = Array.from(folderSet).sort();
		this.setPlaceholder('Select a folder to export all its files...');
	}

	getItems(): string[] {
		return this.folders;
	}

	getItemText(item: string): string {
		return item;
	}

	onChooseItem(item: string): void {
		const folder = item === '/  (entire vault)' ? undefined : item;
		const files = this.bridge.getVaultFiles(folder);

		if (files.length === 0) {
			new Notice('No files found in the selected folder');
			return;
		}

		new Notice(`Exporting ${files.length} file${files.length !== 1 ? 's' : ''}...`);
		void this.bridge.exportMultipleFiles(files);
	}
}
