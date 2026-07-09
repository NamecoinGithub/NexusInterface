type ElectronBridgeListener = (event: unknown, ...args: any[]) => void;

export interface MenuItemConstructorOptions {
  label?: string;
  accelerator?: string;
  role?: string;
  type?: string;
  id?: string;
  enabled?: boolean;
  click?: (...args: any[]) => void;
  submenu?: MenuItemConstructorOptions[];
}

const bridge = (window as any).nexusElectron;

if (!bridge) {
  throw new Error('Nexus Electron bridge is not available');
}

const subscriptionsByChannel = new Map<
  string,
  Map<ElectronBridgeListener, () => void>
>();

export const ipcRenderer = {
  invoke: (channel: string, ...args: any[]) => {
    assertChannel(channel);
    return bridge.ipc.invoke(channel, ...args);
  },
  sendSync: (channel: string, ...args: any[]) => {
    assertChannel(channel);
    return bridge.ipc.sendSync(channel, ...args);
  },
  on: (channel: string, listener: ElectronBridgeListener) => {
    assertChannel(channel);
    assertListener(listener);

    const unsubscribe = bridge.ipc.on(channel, listener);

    let byListener = subscriptionsByChannel.get(channel);
    if (!byListener) {
      byListener = new Map();
      subscriptionsByChannel.set(channel, byListener);
    }

    // Avoid stacking duplicate listeners for the same (channel, listener)
    byListener.get(listener)?.();
    byListener.set(listener, unsubscribe);

    return { channel, listener, unsubscribe };
  },
  once: (channel: string, listener: ElectronBridgeListener) => {
    assertChannel(channel);
    assertListener(listener);
    return bridge.ipc.once(channel, listener);
  },
  off: (channel: string, listenerOrSubscription: any) => {
    if (
      typeof channel === 'string' &&
      channel &&
      typeof listenerOrSubscription === 'function'
    ) {
      const byListener = subscriptionsByChannel.get(channel);
      const unsubscribe = byListener?.get(listenerOrSubscription);
      if (unsubscribe) {
        unsubscribe();
        byListener?.delete(listenerOrSubscription);
        if (byListener && byListener.size === 0) {
          subscriptionsByChannel.delete(channel);
        }
      }
      return;
    }

    if (
      listenerOrSubscription &&
      typeof listenerOrSubscription.unsubscribe === 'function'
    ) {
      listenerOrSubscription.unsubscribe();
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

function assertChannel(channel: string) {
  if (typeof channel !== 'string' || !channel) {
    throw new Error('IPC channel must be a non-empty string');
  }
}

function assertListener(listener: ElectronBridgeListener) {
  if (typeof listener !== 'function') {
    throw new Error('IPC listener must be a function');
  }
}
