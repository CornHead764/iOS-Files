import {App, Notice, TFile, normalizePath} from 'obsidian';
import type {FileBridgeSettings} from './types';

export class FileBridge {
	private app: App;
	private settings: FileBridgeSettings;

	constructor(app: App, settings: FileBridgeSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: FileBridgeSettings) {
		this.settings = settings;
	}

	async ensureImportFolder(): Promise<void> {
		const folderPath = normalizePath(this.settings.importFolder);
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	async importFiles(fileList: FileList): Promise<number> {
		await this.ensureImportFolder();

		let imported = 0;

		for (let i = 0; i < fileList.length; i++) {
			const file = fileList.item(i);
			if (!file) continue;
			const success = await this.importSingleFile(file);
			if (success) imported++;
		}

		if (this.settings.showNotices) {
			new Notice(`Imported ${imported} file${imported !== 1 ? 's' : ''} to ${this.settings.importFolder}`);
		}

		return imported;
	}

	private async importSingleFile(file: File): Promise<boolean> {
		const targetPath = normalizePath(`${this.settings.importFolder}/${file.name}`);

		const existing = this.app.vault.getAbstractFileByPath(targetPath);
		if (existing && this.settings.confirmOverwrite) {
			// Overwrite confirmation is handled by the modal before calling import
		}

		try {
			const buffer = await file.arrayBuffer();

			if (existing instanceof TFile) {
				await this.app.vault.modifyBinary(existing, buffer);
			} else {
				await this.app.vault.createBinary(targetPath, buffer);
			}

			return true;
		} catch (e) {
			console.error(`iOS Files Bridge: failed to import ${file.name}`, e);
			if (this.settings.showNotices) {
				new Notice(`Failed to import ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
			}
			return false;
		}
	}

	async exportFile(file: TFile): Promise<boolean> {
		try {
			const content = await this.app.vault.readBinary(file);
			const blob = new Blob([content], {type: this.getMimeType(file.extension)});
			const webFile = new File([blob], file.name, {type: blob.type});

			// Try Web Share API first (best iOS experience - opens share sheet)
			if (navigator.share && this.canShareFiles()) {
				await navigator.share({
					files: [webFile],
				});
				if (this.settings.showNotices) {
					new Notice(`Shared ${file.name} via share sheet`);
				}
				return true;
			}

			// Fallback: trigger a download (will use iOS download manager)
			this.downloadBlob(blob, file.name);
			if (this.settings.showNotices) {
				new Notice(`Exported ${file.name} via download`);
			}
			return true;
		} catch (e) {
			// User cancelling the share sheet throws an AbortError - don't show error for that
			if (e instanceof DOMException && e.name === 'AbortError') {
				return false;
			}
			console.error(`iOS Files Bridge: failed to export ${file.name}`, e);
			if (this.settings.showNotices) {
				new Notice(`Failed to export ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
			}
			return false;
		}
	}

	async exportMultipleFiles(files: TFile[]): Promise<number> {
		let exported = 0;
		for (const file of files) {
			const success = await this.exportFile(file);
			if (success) exported++;
		}
		if (files.length > 1 && this.settings.showNotices) {
			new Notice(`Exported ${exported} of ${files.length} file${files.length !== 1 ? 's' : ''}`);
		}
		return exported;
	}

	private canShareFiles(): boolean {
		// navigator.canShare is not available in all environments
		if (!navigator.canShare) return true;
		try {
			return navigator.canShare({files: [new File([''], 'test.txt', {type: 'text/plain'})]});
		} catch {
			return false;
		}
	}

	private downloadBlob(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.style.display = 'none';
		document.body.appendChild(a);
		a.click();
		// Clean up after a brief delay
		setTimeout(() => {
			URL.revokeObjectURL(url);
			a.remove();
		}, 1000);
	}

	private getMimeType(extension: string): string {
		const mimeTypes: Record<string, string> = {
			md: 'text/markdown',
			txt: 'text/plain',
			json: 'application/json',
			csv: 'text/csv',
			html: 'text/html',
			css: 'text/css',
			js: 'application/javascript',
			ts: 'application/typescript',
			xml: 'application/xml',
			yaml: 'application/x-yaml',
			yml: 'application/x-yaml',
			pdf: 'application/pdf',
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			svg: 'image/svg+xml',
			webp: 'image/webp',
			mp3: 'audio/mpeg',
			mp4: 'video/mp4',
			wav: 'audio/wav',
			zip: 'application/zip',
		};
		return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
	}

	getVaultFiles(folder?: string): TFile[] {
		const files = this.app.vault.getFiles();
		if (!folder) return files;
		const prefix = normalizePath(folder) + '/';
		return files.filter(f => f.path.startsWith(prefix));
	}
}
