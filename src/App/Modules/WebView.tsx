// External
import { useRef, useEffect, HTMLAttributes } from 'react';
import { existsSync } from 'fs';
import { URL } from 'url';
import { join } from 'path';
import { ipcRenderer, WebviewTag } from 'electron';

// Internal Global
import { Module, setActiveAppModule, unsetActiveAppModule } from 'lib/modules';

const domain = ipcRenderer.sendSync('get-file-server-domain');

const getEntryUrl = (module: Module) => {
  if (module.development) {
    try {
      // Check if entry is a URL itself
      new URL(module.info.entry || '');
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

export interface WebViewProps extends HTMLAttributes<HTMLWebViewElement> {
  module: Module;
}

export default function WebView({ module, ...rest }: WebViewProps) {
  const webviewRef = useRef<HTMLWebViewElement>(null);

  useEffect(() => {
    if (!module.development) {
      const moduleFiles = module.info.files.map((file) =>
        join(module.info.name, file)
      );
      ipcRenderer.invoke('serve-module-files', moduleFiles);
    }
  }, []);

  useEffect(() => {
    if (!webviewRef.current) return;
    const {
      info: { name },
    } = module;
    setActiveAppModule(webviewRef.current as WebviewTag, name);

    return () => {
      unsetActiveAppModule();
    };
  }, [webviewRef.current]);

  const entryUrl = getEntryUrl(module);
  if (!entryUrl) return null;

  const preloadUrl =
    process.env.NODE_ENV === 'development'
      ? `file://${process.cwd()}/build/module_preload.dev.js`
      : module.development
      ? 'module_preload.prod-dev.js '
      : 'module_preload.prod.js';

  module.development &&
    console.warn(
      'Node Intergration is disabled when modules are built for production.'
    );
  return (
    <webview
      {...rest}
      ref={webviewRef}
      src={entryUrl}
      preload={preloadUrl}
      /* Can't enable contextIsolation because it will
      mess with react-dom and emotion */
      webpreferences={`contextIsolation=no${
        module.development ? ', nodeIntegration=yes' : ''
      }`}
    />
  );
}
