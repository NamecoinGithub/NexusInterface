import { HTMLAttributes, useEffect, useRef, useState } from 'react';

import { Module, setActiveAppModule, unsetActiveAppModule } from 'lib/modules';

type WebviewTag = HTMLWebViewElement & {
  send(channel: string, ...args: unknown[]): void;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getWebContentsId(): number;
};

export interface WebViewProps extends HTMLAttributes<HTMLWebViewElement> {
  module: Module;
}

export default function WebView({ module, ...rest }: WebViewProps) {
  const webviewRef = useRef<HTMLWebViewElement>(null);
  const [entryUrl, setEntryUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      try {
        if (!module.development) {
          await window.nexusElectron.modules.prepareFiles(
            module.info.name,
            module.info.files
          );
        }
        const entry = await window.nexusElectron.modules.getEntry(module.info.name);
        if (active && typeof entry === 'string') setEntryUrl(entry);
      } catch (error) {
        console.error('Unable to prepare module WebView', error);
        if (active) setEntryUrl(undefined);
      }
    };
    prepare();
    return () => {
      active = false;
    };
  }, [module]);

  useEffect(() => {
    if (!webviewRef.current) return;
    setActiveAppModule(webviewRef.current as WebviewTag, module.info.name);
    return () => {
      unsetActiveAppModule();
    };
  }, [module.info.name, entryUrl]);

  if (!entryUrl) return null;

  return (
    <webview
      {...rest}
      ref={webviewRef}
      src={entryUrl}
      /* Can't enable contextIsolation because it will
      mess with react-dom and emotion */
      webpreferences={`contextIsolation=no${
        module.development ? ', nodeIntegration=yes' : ''
      }`}
    />
  );
}
