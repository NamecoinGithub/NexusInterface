// External
import { useRef, useEffect } from 'react';
import { existsSync } from 'fs';
import { URL } from 'url';
import { join } from 'path';
import { ipcRenderer } from 'electron';

// Internal Global
import { setActiveWebView, unsetActiveWebView } from 'lib/modules';

const domain = ipcRenderer.sendSync('get-file-server-domain');

const getEntryUrl = (module) => {
  if (module.development) {
    try {
      // Check if entry is a URL itself
      new URL(module.info.entry);
      return module.info.entry;
    } catch (err) {}
  }

  const entry = module.info.entry || 'index.html';
  const entryPath = join(module.path, entry);
  if (!existsSync(entryPath)) return null;
  if (module.development) {
    return `file://${entryPath}`;
  } else {
    return `${domain}/modules/${module.info.name}/${entry}`;
  }
};

export default function WebView({ module, className, style }) {
  const webviewRef = useRef();

  useEffect(() => {
    if (!module.development) {
      const moduleFiles = module.info.files.map((file) =>
        join(module.info.name, file)
      );
      ipcRenderer.invoke('serve-module-files', moduleFiles);
    }
  }, []);

  useEffect(() => {
    const {
      info: { name, displayName },
    } = module;
    setActiveWebView(webviewRef.current, name, displayName);

    return () => {
      unsetActiveWebView();
    };
  }, []);

  const entryUrl = getEntryUrl(module);

  const preloadUrl =
    process.env.NODE_ENV === 'development'
      ? `file://${process.cwd()}/build/module_preload.dev.js`
      : 'module_preload.prod.js';

  return (
    <webview
      className={className}
      style={style}
      ref={this.webviewRef}
      src={entryUrl}
      preload={preloadUrl}
      webpreferences="contextIsolation=no"
    />
  );
}
