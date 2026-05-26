// Type hints for the API exposed by preload.js via contextBridge.
// Lets the TS language server stop flagging `window.electronAPI.*` calls in
// the renderer without changing any runtime behavior.

interface AudioFileResult {
  name: string;
  buffer: ArrayBuffer;
  path: string;
}

interface AssignAudioFileArgs {
  sourcePath: string;
  type: 'sequence' | 'original' | string;
}

interface AssignDrumSampleArgs {
  sourcePath: string;
  padName: string;
  kitId: string;
}

interface ElectronAPI {
  openAudioFile(): Promise<AudioFileResult | null>;
  openAudioFiles(): Promise<AudioFileResult[] | null>;
  savePreset(data: any): Promise<string>;
  loadPresets(): Promise<any[]>;
  deletePreset(id: string): Promise<void>;
  windowAction(action: 'minimize' | 'maximize' | 'close' | 'fullscreen'): Promise<void>;
  assignAudioFile(data: AssignAudioFileArgs): Promise<string>;
  saveGiSetlist(songs: any[]): Promise<boolean>;
  loadGiSetlist(): Promise<any | null>;
  syncMongoSetlist(): Promise<any[]>;
  getAbsolutePath(relPath: string): Promise<string>;
  assignDrumSample(data: AssignDrumSampleArgs): Promise<string>;
  saveUserDrums(data: any): Promise<boolean>;
  loadUserDrums(): Promise<any | null>;
  loadMidiMap(): Promise<any | null>;
  saveMidiMap(data: any): Promise<boolean>;
  fetchChordUrl(url: string): Promise<string>;
  authSaveSession(s: any): Promise<boolean>;
  authLoadSession(): Promise<any | null>;
  authClearSession(): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
}

interface Window {
  electronAPI: ElectronAPI;
  showToast: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  loadAndPlayTrack: (song: any, type: 'sequence' | 'original') => void;
  closeMenu: () => void;
  previewBtn: HTMLElement;
}
