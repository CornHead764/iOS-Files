import {App, TFile, TFolder, normalizePath} from 'obsidian';
import type {FileBridgeSettings, SyncManifest, SyncFileEntry} from './types';

export interface SyncResult {
	added: string[];
	updated: string[];
	deleted: string[];
	conflicts: string[];
	errors: string[];
}

/**
 * Compute a SHA-256 hex digest of an ArrayBuffer.
 */
async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, '0');
	}
	return hex;
}

/**
 * Derive the relative vault path from a File's webkitRelativePath.
 * webkitRelativePath looks like "FolderName/sub/file.md" — we strip the root
 * folder prefix so we get "sub/file.md".
 */
function fileToVaultPath(file: File): string | null {
	const rel = (file as File & {webkitRelativePath?: string}).webkitRelativePath;
	if (!rel) return file.name;

	// Strip the first path segment (the selected folder name)
	const idx = rel.indexOf('/');
	if (idx === -1) return rel;
	return rel.substring(idx + 1);
}

export class SyncEngine {
	private app: App;
	private settings: FileBridgeSettings;

	constructor(app: App, settings: FileBridgeSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: FileBridgeSettings) {
		this.settings = settings;
	}

	/**
	 * Load the stored sync manifest from plugin data.
	 */
	async loadManifest(loadData: () => Promise<Record<string, unknown> | null>): Promise<SyncManifest | null> {
		const data = await loadData();
		if (!data || !data['syncManifest']) return null;
		return data['syncManifest'] as SyncManifest;
	}

	/**
	 * Save the sync manifest to plugin data.
	 */
	async saveManifest(
		manifest: SyncManifest,
		loadData: () => Promise<Record<string, unknown> | null>,
		saveData: (data: Record<string, unknown>) => Promise<void>,
	): Promise<void> {
		const data = (await loadData()) ?? {};
		data['syncManifest'] = manifest;
		await saveData(data);
	}

	/**
	 * Initial sync setup: import all files from the selected folder into the vault.
	 * Returns the created manifest.
	 */
	async initialSync(
		files: FileList,
		onProgress?: (current: number, total: number, fileName: string) => void,
	): Promise<{manifest: SyncManifest; result: SyncResult}> {
		const result: SyncResult = {added: [], updated: [], deleted: [], conflicts: [], errors: []};
		const manifestFiles: Record<string, SyncFileEntry> = {};

		// Determine root folder name from the first file's webkitRelativePath
		let rootFolderName = '';
		if (files.length > 0) {
			const first = files[0] as File & {webkitRelativePath?: string};
			if (first.webkitRelativePath) {
				const idx = first.webkitRelativePath.indexOf('/');
				rootFolderName = idx !== -1 ? first.webkitRelativePath.substring(0, idx) : first.webkitRelativePath;
			}
		}

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (!file) continue;

			const vaultPath = fileToVaultPath(file);
			if (!vaultPath) continue;

			// Skip hidden files and system files
			if (this.shouldSkipFile(vaultPath)) continue;

			onProgress?.(i + 1, files.length, vaultPath);

			try {
				const buffer = await file.arrayBuffer();
				const hash = await hashBuffer(buffer);
				const normalizedPath = normalizePath(vaultPath);

				await this.ensureParentFolder(normalizedPath);

				const existing = this.app.vault.getAbstractFileByPath(normalizedPath);
				if (existing instanceof TFile) {
					await this.app.vault.modifyBinary(existing, buffer);
					result.updated.push(normalizedPath);
				} else {
					await this.app.vault.createBinary(normalizedPath, buffer);
					result.added.push(normalizedPath);
				}

				manifestFiles[normalizedPath] = {
					path: normalizedPath,
					hash,
					size: buffer.byteLength,
				};
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				result.errors.push(`${vaultPath}: ${msg}`);
			}
		}

		const manifest: SyncManifest = {
			lastSyncTime: Date.now(),
			rootFolderName,
			files: manifestFiles,
		};

		return {manifest, result};
	}

	/**
	 * Pull: import updated files from the Files app folder.
	 * Compares against the stored manifest to only update changed files.
	 */
	async pull(
		files: FileList,
		manifest: SyncManifest,
		onProgress?: (current: number, total: number, fileName: string) => void,
	): Promise<{manifest: SyncManifest; result: SyncResult}> {
		const result: SyncResult = {added: [], updated: [], deleted: [], conflicts: [], errors: []};
		const newManifestFiles: Record<string, SyncFileEntry> = {};
		const remotePaths = new Set<string>();

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (!file) continue;

			const vaultPath = fileToVaultPath(file);
			if (!vaultPath) continue;
			if (this.shouldSkipFile(vaultPath)) continue;

			const normalizedPath = normalizePath(vaultPath);
			remotePaths.add(normalizedPath);

			onProgress?.(i + 1, files.length, normalizedPath);

			try {
				const buffer = await file.arrayBuffer();
				const remoteHash = await hashBuffer(buffer);

				const knownEntry = manifest.files[normalizedPath];
				const existingFile = this.app.vault.getAbstractFileByPath(normalizedPath);

				if (!knownEntry) {
					// New file from remote — add to vault
					await this.ensureParentFolder(normalizedPath);
					if (existingFile instanceof TFile) {
						// File exists locally but wasn't in manifest (created on both sides)
						const localBuffer = await this.app.vault.readBinary(existingFile);
						const localHash = await hashBuffer(localBuffer);
						if (localHash !== remoteHash) {
							result.conflicts.push(normalizedPath);
							// Remote wins for conflicts during pull
						}
						await this.app.vault.modifyBinary(existingFile, buffer);
					} else {
						await this.app.vault.createBinary(normalizedPath, buffer);
					}
					result.added.push(normalizedPath);
				} else if (remoteHash !== knownEntry.hash) {
					// Remote file changed since last sync
					if (existingFile instanceof TFile) {
						const localBuffer = await this.app.vault.readBinary(existingFile);
						const localHash = await hashBuffer(localBuffer);

						if (localHash !== knownEntry.hash && localHash !== remoteHash) {
							// Both sides changed — conflict, remote wins on pull
							result.conflicts.push(normalizedPath);
						}
						await this.app.vault.modifyBinary(existingFile, buffer);
					} else {
						await this.ensureParentFolder(normalizedPath);
						await this.app.vault.createBinary(normalizedPath, buffer);
					}
					result.updated.push(normalizedPath);
				}
				// else: unchanged, no action needed

				newManifestFiles[normalizedPath] = {
					path: normalizedPath,
					hash: remoteHash,
					size: buffer.byteLength,
				};
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				result.errors.push(`${normalizedPath}: ${msg}`);
				// Preserve existing manifest entry on error
				if (manifest.files[normalizedPath]) {
					newManifestFiles[normalizedPath] = manifest.files[normalizedPath];
				}
			}
		}

		// Detect deleted files (in manifest but not in remote)
		if (this.settings.syncDeleteRemovedFiles) {
			for (const path of Object.keys(manifest.files)) {
				if (!remotePaths.has(path)) {
					const existing = this.app.vault.getAbstractFileByPath(path);
					if (existing instanceof TFile) {
						await this.app.fileManager.trashFile(existing);
						result.deleted.push(path);
					}
				}
			}
		}

		const newManifest: SyncManifest = {
			lastSyncTime: Date.now(),
			rootFolderName: manifest.rootFolderName,
			files: newManifestFiles,
		};

		return {manifest: newManifest, result};
	}

	/**
	 * Get list of locally changed files since last sync.
	 */
	async getLocalChanges(manifest: SyncManifest): Promise<{
		modified: TFile[];
		added: TFile[];
		deleted: string[];
	}> {
		const modified: TFile[] = [];
		const added: TFile[] = [];
		const deleted: string[] = [];

		// Find modified and new files
		const allFiles = this.app.vault.getFiles();
		for (const file of allFiles) {
			// Skip plugin config files
			if (this.shouldSkipFile(file.path)) continue;

			const entry = manifest.files[file.path];
			if (!entry) {
				added.push(file);
			} else {
				const buffer = await this.app.vault.readBinary(file);
				const hash = await hashBuffer(buffer);
				if (hash !== entry.hash) {
					modified.push(file);
				}
			}
		}

		// Find deleted files
		const vaultPaths = new Set(allFiles.map(f => f.path));
		for (const path of Object.keys(manifest.files)) {
			if (!vaultPaths.has(path)) {
				deleted.push(path);
			}
		}

		return {modified, added, deleted};
	}

	/**
	 * Push: export changed files via the share sheet.
	 * Returns the updated manifest after pushing.
	 */
	async push(
		manifest: SyncManifest,
		onProgress?: (current: number, total: number, fileName: string) => void,
	): Promise<{manifest: SyncManifest; result: SyncResult}> {
		const result: SyncResult = {added: [], updated: [], deleted: [], conflicts: [], errors: []};
		const changes = await this.getLocalChanges(manifest);
		const filesToExport = [...changes.modified, ...changes.added];

		if (filesToExport.length === 0 && changes.deleted.length === 0) {
			return {manifest, result};
		}

		const webFiles: File[] = [];
		const newManifestFiles = {...manifest.files};

		for (let i = 0; i < filesToExport.length; i++) {
			const file = filesToExport[i]!;
			onProgress?.(i + 1, filesToExport.length, file.path);

			try {
				const buffer = await this.app.vault.readBinary(file);
				const hash = await hashBuffer(buffer);
				const blob = new Blob([buffer], {type: this.getMimeType(file.extension)});

				// Preserve folder structure in the filename for share
				const shareName = file.path.replace(/\//g, '_');
				webFiles.push(new File([blob], shareName, {type: blob.type}));

				newManifestFiles[file.path] = {
					path: file.path,
					hash,
					size: buffer.byteLength,
				};

				if (changes.added.includes(file)) {
					result.added.push(file.path);
				} else {
					result.updated.push(file.path);
				}
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				result.errors.push(`${file.path}: ${msg}`);
			}
		}

		// Remove deleted files from manifest
		for (const path of changes.deleted) {
			delete newManifestFiles[path];
			result.deleted.push(path);
		}

		// Share all files at once via Web Share API
		if (webFiles.length > 0 && navigator.share && this.canShareFiles()) {
			try {
				await navigator.share({files: webFiles});
			} catch (e) {
				if (e instanceof DOMException && e.name === 'AbortError') {
					// User cancelled — don't update manifest
					return {manifest, result: {added: [], updated: [], deleted: [], conflicts: [], errors: []}};
				}
				throw e;
			}
		} else if (webFiles.length > 0) {
			// Fallback: download each file
			for (const file of webFiles) {
				this.downloadFile(file);
			}
		}

		const newManifest: SyncManifest = {
			...manifest,
			lastSyncTime: Date.now(),
			files: newManifestFiles,
		};

		return {manifest: newManifest, result};
	}

	private shouldSkipFile(path: string): boolean {
		const lower = path.toLowerCase();
		// Skip hidden files/folders and Obsidian config
		if (lower.startsWith('.') || lower.includes('/.')) return true;
		if (lower.startsWith(this.app.vault.configDir + '/')) return true;
		if (lower === '.ds_store' || lower.endsWith('/.ds_store')) return true;
		if (lower === 'thumbs.db' || lower.endsWith('/thumbs.db')) return true;
		return false;
	}

	private async ensureParentFolder(filePath: string): Promise<void> {
		const parts = filePath.split('/');
		if (parts.length <= 1) return;

		let current = '';
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i]!;
			current = current ? `${current}/${part}` : part;
			const normalized = normalizePath(current);
			const existing = this.app.vault.getAbstractFileByPath(normalized);
			if (!existing) {
				await this.app.vault.createFolder(normalized);
			} else if (!(existing instanceof TFolder)) {
				break;
			}
		}
	}

	private canShareFiles(): boolean {
		if (!navigator.canShare) return true;
		try {
			return navigator.canShare({files: [new File([''], 'test.txt', {type: 'text/plain'})]});
		} catch {
			return false;
		}
	}

	private downloadFile(file: File): void {
		const url = URL.createObjectURL(file);
		const a = document.createElement('a');
		a.href = url;
		a.download = file.name;
		a.addClass('ios-files-bridge-hidden');
		document.body.appendChild(a);
		a.click();
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
			pdf: 'application/pdf',
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			svg: 'image/svg+xml',
			webp: 'image/webp',
		};
		return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
	}
}
