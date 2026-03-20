import {App, Modal, Notice, Setting} from 'obsidian';
import type {FileBridge} from './file-bridge';
import type {FileBridgeSettings} from './types';

export class ImportModal extends Modal {
	private bridge: FileBridge;
	private settings: FileBridgeSettings;
	private selectedFiles: FileList | null = null;
	private fileListEl: HTMLElement;
	private importBtn: HTMLButtonElement;

	constructor(app: App, bridge: FileBridge, settings: FileBridgeSettings) {
		super(app);
		this.bridge = bridge;
		this.settings = settings;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('ios-files-bridge-modal');

		new Setting(contentEl).setName('Import from files app').setHeading();
		contentEl.createEl('p', {
			text: 'Select files from any storage provider in the files app (OneDrive, iCloud Drive, Google Drive, Dropbox, etc.). Files will be saved to your vault.',
			cls: 'ios-files-bridge-desc',
		});

		// Destination folder display
		new Setting(contentEl)
			.setName('Destination')
			.setDesc(`Files will be imported to: ${this.settings.importFolder}/`);

		// Hidden file input that triggers iOS document picker
		const fileInput = contentEl.createEl('input', {
			type: 'file',
			attr: {multiple: 'true'},
		});
		fileInput.addClass('ios-files-bridge-hidden');
		fileInput.addEventListener('change', () => {
			this.selectedFiles = fileInput.files;
			this.renderFileList();
		});

		// Browse button
		const browseContainer = contentEl.createDiv({cls: 'ios-files-bridge-browse'});
		const browseBtn = browseContainer.createEl('button', {
			text: 'Browse files',
			cls: 'mod-cta',
		});
		browseBtn.addEventListener('click', () => fileInput.click());

		// File list preview area
		this.fileListEl = contentEl.createDiv({cls: 'ios-files-bridge-file-list'});
		this.fileListEl.createEl('p', {
			text: 'No files selected',
			cls: 'ios-files-bridge-empty',
		});

		// Import button
		const buttonContainer = contentEl.createDiv({cls: 'ios-files-bridge-buttons'});
		this.importBtn = buttonContainer.createEl('button', {
			text: 'Import selected files',
			cls: 'mod-cta',
		});
		this.importBtn.disabled = true;
		this.importBtn.addEventListener('click', () => { void this.doImport(); });
	}

	private renderFileList() {
		this.fileListEl.empty();

		if (!this.selectedFiles || this.selectedFiles.length === 0) {
			this.fileListEl.createEl('p', {
				text: 'No files selected',
				cls: 'ios-files-bridge-empty',
			});
			this.importBtn.disabled = true;
			return;
		}

		this.importBtn.disabled = false;

		const list = this.fileListEl.createEl('ul', {cls: 'ios-files-bridge-ul'});
		for (let i = 0; i < this.selectedFiles.length; i++) {
			const file = this.selectedFiles.item(i);
			if (!file) continue;
			const li = list.createEl('li');
			li.createEl('span', {text: file.name, cls: 'ios-files-bridge-filename'});
			li.createEl('span', {
				text: this.formatSize(file.size),
				cls: 'ios-files-bridge-filesize',
			});
		}

		this.fileListEl.createEl('p', {
			text: `${this.selectedFiles.length} file${this.selectedFiles.length !== 1 ? 's' : ''} selected`,
			cls: 'ios-files-bridge-count',
		});
	}

	private async doImport() {
		if (!this.selectedFiles || this.selectedFiles.length === 0) return;

		this.importBtn.disabled = true;
		this.importBtn.setText('Importing...');

		try {
			const count = await this.bridge.importFiles(this.selectedFiles);
			if (count > 0) {
				this.close();
			}
		} catch (e) {
			console.error('iOS Files Bridge: import error', e);
			new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			this.importBtn.disabled = false;
			this.importBtn.setText('Import selected files');
		}
	}

	private formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	onClose() {
		this.contentEl.empty();
	}
}
