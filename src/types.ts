export interface FileBridgeSettings {
	importFolder: string;
	exportFormat: 'original' | 'markdown';
	showNotices: boolean;
	confirmOverwrite: boolean;
	lastImportPath: string;
}

export const DEFAULT_SETTINGS: FileBridgeSettings = {
	importFolder: 'iOS Files',
	exportFormat: 'original',
	showNotices: true,
	confirmOverwrite: true,
	lastImportPath: '',
};

export interface ImportedFileInfo {
	name: string;
	size: number;
	type: string;
	lastModified: number;
}
