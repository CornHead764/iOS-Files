import {App, Modal, Setting} from 'obsidian';
import type {FileBridgeSettings, SyncManifest} from './types';
import {SyncEngine, type SyncResult} from './sync-engine';

type ManifestIO = {
	loadData: () => Promise<Record<string, unknown> | null>;
	saveData: (data: Record<string, unknown>) => Promise<void>;
	onSyncComplete: (manifest: SyncManifest) => void;
};

/**
 * Modal for initial vault sync setup — pick a folder from the Files app.
 */
export class SyncSetupModal extends Modal {
	private engine: SyncEngine;
	private settings: FileBridgeSettings;
	private io: ManifestIO;
	private progressEl: HTMLElement;
	private statusEl: HTMLElement;

	constructor(app: App, engine: SyncEngine, settings: FileBridgeSettings, io: ManifestIO) {
		super(app);
		this.engine = engine;
		this.settings = settings;
		this.io = io;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('ios-files-bridge-modal');

		new Setting(contentEl).setName('Set up vault sync').setHeading();
		contentEl.createEl('p', {
			text: 'Select a folder from the files app to load as your vault. All files and subfolders will be imported and tracked for ongoing sync.',
			cls: 'ios-files-bridge-desc',
		});

		// Folder input (webkitdirectory for folder selection)
		const fileInput = contentEl.createEl('input', {
			type: 'file',
		});
		fileInput.setAttribute('webkitdirectory', '');
		fileInput.addClass('ios-files-bridge-hidden');

		const browseContainer = contentEl.createDiv({cls: 'ios-files-bridge-browse'});
		const browseBtn = browseContainer.createEl('button', {
			text: 'Choose folder',
			cls: 'mod-cta',
		});
		browseBtn.addEventListener('click', () => fileInput.click());

		fileInput.addEventListener('change', () => {
			if (fileInput.files && fileInput.files.length > 0) {
				void this.runInitialSync(fileInput.files);
			}
		});

		// Progress area
		this.statusEl = contentEl.createDiv({cls: 'ios-files-bridge-sync-status'});
		this.progressEl = contentEl.createDiv({cls: 'ios-files-bridge-progress'});
	}

	private async runInitialSync(files: FileList) {
		this.statusEl.setText(`Loading ${files.length} files...`);

		const progressBar = this.progressEl.createEl('progress', {
			attr: {max: String(files.length), value: '0'},
		});
		progressBar.addClass('ios-files-bridge-progress-bar');

		const fileNameEl = this.progressEl.createDiv({cls: 'ios-files-bridge-progress-file'});

		try {
			const {manifest, result} = await this.engine.initialSync(
				files,
				(current, total, fileName) => {
					progressBar.value = current;
					fileNameEl.setText(fileName);
				},
			);

			await this.engine.saveManifest(manifest, this.io.loadData, this.io.saveData);
			this.io.onSyncComplete(manifest);

			this.showResult(result, manifest);
		} catch (e) {
			this.statusEl.setText(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
			this.statusEl.addClass('ios-files-bridge-error');
		}
	}

	private showResult(result: SyncResult, manifest: SyncManifest) {
		this.progressEl.empty();
		this.statusEl.empty();
		this.statusEl.removeClass('ios-files-bridge-error');

		const summary = this.statusEl.createDiv({cls: 'ios-files-bridge-sync-summary'});
		summary.createEl('p', {
			text: `Sync complete — ${Object.keys(manifest.files).length} files tracked`,
			cls: 'ios-files-bridge-sync-done',
		});

		if (result.added.length > 0) {
			summary.createEl('p', {text: `Added: ${result.added.length}`});
		}
		if (result.updated.length > 0) {
			summary.createEl('p', {text: `Updated: ${result.updated.length}`});
		}
		if (result.errors.length > 0) {
			summary.createEl('p', {
				text: `Errors: ${result.errors.length}`,
				cls: 'ios-files-bridge-error',
			});
		}

		const closeBtn = this.statusEl.createEl('button', {
			text: 'Done',
			cls: 'mod-cta',
		});
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * Modal for pulling updates from the Files app.
 */
export class SyncPullModal extends Modal {
	private engine: SyncEngine;
	private settings: FileBridgeSettings;
	private manifest: SyncManifest;
	private io: ManifestIO;
	private progressEl: HTMLElement;
	private statusEl: HTMLElement;

	constructor(app: App, engine: SyncEngine, settings: FileBridgeSettings, manifest: SyncManifest, io: ManifestIO) {
		super(app);
		this.engine = engine;
		this.settings = settings;
		this.manifest = manifest;
		this.io = io;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('ios-files-bridge-modal');

		new Setting(contentEl).setName('Pull updates').setHeading();

		const lastSync = new Date(this.manifest.lastSyncTime);
		contentEl.createEl('p', {
			text: `Last synced: ${lastSync.toLocaleString()}. Tracking ${Object.keys(this.manifest.files).length} files.`,
			cls: 'ios-files-bridge-desc',
		});
		if (this.manifest.rootFolderName) {
			contentEl.createEl('p', {
				text: `Select the same folder "${this.manifest.rootFolderName}" to pull updates.`,
				cls: 'ios-files-bridge-desc',
			});
		}

		const fileInput = contentEl.createEl('input', {
			type: 'file',
		});
		fileInput.setAttribute('webkitdirectory', '');
		fileInput.addClass('ios-files-bridge-hidden');

		const browseContainer = contentEl.createDiv({cls: 'ios-files-bridge-browse'});
		const browseBtn = browseContainer.createEl('button', {
			text: 'Choose folder',
			cls: 'mod-cta',
		});
		browseBtn.addEventListener('click', () => fileInput.click());

		fileInput.addEventListener('change', () => {
			if (fileInput.files && fileInput.files.length > 0) {
				void this.runPull(fileInput.files);
			}
		});

		this.statusEl = contentEl.createDiv({cls: 'ios-files-bridge-sync-status'});
		this.progressEl = contentEl.createDiv({cls: 'ios-files-bridge-progress'});
	}

	private async runPull(files: FileList) {
		this.statusEl.setText(`Comparing ${files.length} files...`);

		const progressBar = this.progressEl.createEl('progress', {
			attr: {max: String(files.length), value: '0'},
		});
		progressBar.addClass('ios-files-bridge-progress-bar');

		const fileNameEl = this.progressEl.createDiv({cls: 'ios-files-bridge-progress-file'});

		try {
			const {manifest, result} = await this.engine.pull(
				files,
				this.manifest,
				(current, total, fileName) => {
					progressBar.value = current;
					fileNameEl.setText(fileName);
				},
			);

			await this.engine.saveManifest(manifest, this.io.loadData, this.io.saveData);
			this.io.onSyncComplete(manifest);

			this.showResult(result, manifest);
		} catch (e) {
			this.statusEl.setText(`Pull failed: ${e instanceof Error ? e.message : String(e)}`);
			this.statusEl.addClass('ios-files-bridge-error');
		}
	}

	private showResult(result: SyncResult, manifest: SyncManifest) {
		this.progressEl.empty();
		this.statusEl.empty();
		this.statusEl.removeClass('ios-files-bridge-error');

		const total = result.added.length + result.updated.length + result.deleted.length;
		const summary = this.statusEl.createDiv({cls: 'ios-files-bridge-sync-summary'});

		if (total === 0) {
			summary.createEl('p', {
				text: 'Everything is up to date',
				cls: 'ios-files-bridge-sync-done',
			});
		} else {
			summary.createEl('p', {
				text: `Pull complete — ${total} file${total !== 1 ? 's' : ''} changed`,
				cls: 'ios-files-bridge-sync-done',
			});

			if (result.added.length > 0) {
				summary.createEl('p', {text: `New files: ${result.added.length}`});
			}
			if (result.updated.length > 0) {
				summary.createEl('p', {text: `Updated: ${result.updated.length}`});
			}
			if (result.deleted.length > 0) {
				summary.createEl('p', {text: `Deleted: ${result.deleted.length}`});
			}
			if (result.conflicts.length > 0) {
				summary.createEl('p', {
					text: `Conflicts (remote version used): ${result.conflicts.length}`,
					cls: 'ios-files-bridge-warning',
				});
			}
		}

		if (result.errors.length > 0) {
			summary.createEl('p', {
				text: `Errors: ${result.errors.length}`,
				cls: 'ios-files-bridge-error',
			});
		}

		const closeBtn = this.statusEl.createEl('button', {
			text: 'Done',
			cls: 'mod-cta',
		});
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * Modal for pushing local changes to the Files app.
 */
export class SyncPushModal extends Modal {
	private engine: SyncEngine;
	private settings: FileBridgeSettings;
	private manifest: SyncManifest;
	private io: ManifestIO;
	private statusEl: HTMLElement;
	private progressEl: HTMLElement;

	constructor(app: App, engine: SyncEngine, settings: FileBridgeSettings, manifest: SyncManifest, io: ManifestIO) {
		super(app);
		this.engine = engine;
		this.settings = settings;
		this.manifest = manifest;
		this.io = io;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass('ios-files-bridge-modal');

		new Setting(contentEl).setName('Push changes').setHeading();

		this.statusEl = contentEl.createDiv({cls: 'ios-files-bridge-sync-status'});
		this.statusEl.setText('Scanning for local changes...');
		this.progressEl = contentEl.createDiv({cls: 'ios-files-bridge-progress'});

		void this.scanAndPush();
	}

	private async scanAndPush() {
		try {
			const changes = await this.engine.getLocalChanges(this.manifest);
			const totalChanges = changes.modified.length + changes.added.length + changes.deleted.length;

			if (totalChanges === 0) {
				this.statusEl.empty();
				this.statusEl.createEl('p', {
					text: 'No local changes to push',
					cls: 'ios-files-bridge-sync-done',
				});
				const closeBtn = this.statusEl.createEl('button', {
					text: 'Done',
					cls: 'mod-cta',
				});
				closeBtn.addEventListener('click', () => this.close());
				return;
			}

			this.statusEl.empty();
			const summary = this.statusEl.createDiv();

			summary.createEl('p', {
				text: `Found ${totalChanges} changed file${totalChanges !== 1 ? 's' : ''}:`,
			});

			if (changes.added.length > 0) {
				summary.createEl('p', {text: `New: ${changes.added.length}`});
			}
			if (changes.modified.length > 0) {
				summary.createEl('p', {text: `Modified: ${changes.modified.length}`});
			}
			if (changes.deleted.length > 0) {
				summary.createEl('p', {text: `Deleted locally: ${changes.deleted.length}`});
			}

			summary.createEl('p', {
				text: 'Files will be shared via the share sheet. Save them to the same folder in your files app.',
				cls: 'ios-files-bridge-desc',
			});

			const pushBtn = summary.createEl('button', {
				text: 'Push changes',
				cls: 'mod-cta',
			});
			pushBtn.addEventListener('click', () => {
				pushBtn.disabled = true;
				void this.runPush();
			});
		} catch (e) {
			this.statusEl.setText(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
			this.statusEl.addClass('ios-files-bridge-error');
		}
	}

	private async runPush() {
		this.statusEl.setText('Exporting changed files...');

		const progressBar = this.progressEl.createEl('progress');
		progressBar.addClass('ios-files-bridge-progress-bar');

		const fileNameEl = this.progressEl.createDiv({cls: 'ios-files-bridge-progress-file'});

		try {
			const {manifest, result} = await this.engine.push(
				this.manifest,
				(current, total, fileName) => {
					progressBar.max = total;
					progressBar.value = current;
					fileNameEl.setText(fileName);
				},
			);

			const total = result.added.length + result.updated.length;
			if (total > 0) {
				await this.engine.saveManifest(manifest, this.io.loadData, this.io.saveData);
				this.io.onSyncComplete(manifest);
			}

			this.showResult(result);
		} catch (e) {
			this.statusEl.setText(`Push failed: ${e instanceof Error ? e.message : String(e)}`);
			this.statusEl.addClass('ios-files-bridge-error');
		}
	}

	private showResult(result: SyncResult) {
		this.progressEl.empty();
		this.statusEl.empty();
		this.statusEl.removeClass('ios-files-bridge-error');

		const total = result.added.length + result.updated.length;
		const summary = this.statusEl.createDiv({cls: 'ios-files-bridge-sync-summary'});

		if (total === 0) {
			summary.createEl('p', {
				text: 'No changes were pushed',
				cls: 'ios-files-bridge-sync-done',
			});
		} else {
			summary.createEl('p', {
				text: `Pushed ${total} file${total !== 1 ? 's' : ''}`,
				cls: 'ios-files-bridge-sync-done',
			});
		}

		if (result.errors.length > 0) {
			summary.createEl('p', {
				text: `Errors: ${result.errors.length}`,
				cls: 'ios-files-bridge-error',
			});
		}

		const closeBtn = this.statusEl.createEl('button', {
			text: 'Done',
			cls: 'mod-cta',
		});
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}
