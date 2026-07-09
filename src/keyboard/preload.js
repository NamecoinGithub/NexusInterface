import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('virtualKeyboard', {
  onOptions(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Keyboard options listener must be a function');
    }
    ipcRenderer.once('options', (_event, options) => listener(options));
  },
  inputChanged(text) {
    if (typeof text !== 'string') {
      throw new Error('Keyboard input must be a string');
    }
    ipcRenderer.send('keyboard-input-change', text);
  },
  close() {
    ipcRenderer.send('close-keyboard');
  },
});
