export type ExternalChainPilotId = 'litecoin';

export type ExternalChainPilotProfile = {
  readonly id: ExternalChainPilotId;
  readonly name: string;
  readonly ticker: string;
  readonly daemonExecutable: string;
  readonly cliExecutable: string;
  readonly mainnet: {
    readonly p2pPort: number;
    readonly rpcPort: number;
  };
  readonly defaultDataDirectories: {
    readonly linux: string;
    readonly darwin: string;
    readonly win32: string;
  };
  readonly integrationBoundary: {
    readonly stage: 'research';
    readonly managedByWallet: false;
    readonly handlesCredentials: false;
    readonly handlesWalletMaterial: false;
  };
};

export const externalChainPilotProfiles: readonly ExternalChainPilotProfile[] = [
  {
    id: 'litecoin',
    name: 'Litecoin',
    ticker: 'LTC',
    daemonExecutable: 'litecoind',
    cliExecutable: 'litecoin-cli',
    mainnet: {
      p2pPort: 9333,
      rpcPort: 9332,
    },
    defaultDataDirectories: {
      linux: '~/.litecoin',
      darwin: '~/Library/Application Support/Litecoin',
      win32: '%APPDATA%\\Litecoin',
    },
    integrationBoundary: {
      stage: 'research',
      managedByWallet: false,
      handlesCredentials: false,
      handlesWalletMaterial: false,
    },
  },
];
