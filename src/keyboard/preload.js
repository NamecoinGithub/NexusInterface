const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('virtualKeyboard', {
  onOptions(callback) {
    ipcRenderer.once('options', (_event, options) => callback(options));
  },
  sendInputChange(text) {
    ipcRenderer.send('keyboard-input-change', text);
  },
  close() {
    ipcRenderer.send('close-keyboard');
  },
});
