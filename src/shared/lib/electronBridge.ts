type Listener = (event: unknown, ...args: any[]) => void;

const bridge = (window as any).nexusElectron;

if (!bridge) {
  throw new Error('Nexus Electron bridge is not available');
}

export const ipcRenderer = {
  invoke: (channel: string, ...args: any[]) => bridge.ipc.invoke(channel, ...args),
  sendSync: (channel: string, ...args: any[]) =>
    bridge.ipc.sendSync(channel, ...args),
  on: (channel: string, listener: Listener) => {
    const unsubscribe = bridge.ipc.on(channel, listener);
    return { channel, listener, unsubscribe };
  },
  once: (channel: string, listener: Listener) => bridge.ipc.once(channel, listener),
  off: (_channel: string, subscription: any) => {
    if (subscription && typeof subscription.unsubscribe === 'function') {
      subscription.unsubscribe();
    }
  },
};

export const clipboard = bridge.clipboard;
export const shell = bridge.shell;

export type WebviewTag = HTMLWebViewElement & {
  send(channel: string, ...args: any[]): void;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
};

export type IpcMessageEvent = {
  target: WebviewTag;
  channel: string;
  args: any[];
};

export type MenuItemConstructorOptions = any;
