const { contextBridge, ipcRenderer } = require('electron');

function sanitizeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {
      theme: undefined,
      defaultText: '',
      maskable: false,
      placeholder: '',
    };
  }

  return {
    ...options,
    defaultText:
      typeof options.defaultText === 'string' ? options.defaultText : '',
    maskable: !!options.maskable,
    placeholder:
      typeof options.placeholder === 'string' ? options.placeholder : '',
  };
}

contextBridge.exposeInMainWorld('virtualKeyboard', {
  onOptions(callback) {
    ipcRenderer.once('options', (_event, options) =>
      callback(sanitizeOptions(options))
    );
  },
  sendInputChange(text) {
    ipcRenderer.send(
      'keyboard-input-change',
      typeof text === 'string' ? text : ''
    );
  },
  close() {
    ipcRenderer.send('close-keyboard');
  },
});
