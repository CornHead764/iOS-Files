export interface FileBridgeSettings {
	importFolder: string;
	exportFormat: 'original' | 'markdown';
	showNotices: boolean;
	confirmOverwrite: boolean;
	lastImportPath: string;
	syncEnabled: boolean;
	syncDeleteRemovedFiles: boolean;
}

export const DEFAULT_SETTINGS: FileBridgeSettings = {
	importFolder: 'iOS Files',
	exportFormat: 'original',
	showNotices: true,
	confirmOverwrite: true,
	lastImportPath: '',
	syncEnabled: false,
	syncDeleteRemovedFiles: false,
};

export interface ImportedFileInfo {
	name: string;
	size: number;
	type: string;
	lastModified: number;
}

export interface SyncFileEntry {
	/** Relative path within the vault (e.g. "notes/daily/2024-01-01.md") */
	path: string;
	/** SHA-256 hex hash of file contents at last sync */
	hash: string;
	/** File size in bytes at last sync */
	size: number;
}

export interface SyncManifest {
	/** Timestamp of last successful sync */
	lastSyncTime: number;
	/** Name of the root folder selected from Files app */
	rootFolderName: string;
	/** Map of relative path → file entry */
	files: Record<string, SyncFileEntry>;
}
