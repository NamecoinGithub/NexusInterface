// External
import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import styled from '@emotion/styled';
import * as AutoLaunch from 'auto-launch';

// Internal Global
import { updateSettings } from 'lib/settings';
import { switchSettingsTab, showNotification } from 'lib/ui';
import { backupWallet } from 'lib/wallet';
import SettingsField from 'components/SettingsField';
import Button from 'components/Button';
import TextField from 'components/TextField';
import Select from 'components/Select';
import Switch from 'components/Switch';
import Icon from 'components/Icon';
import { confirm, openErrorDialog } from 'lib/dialog';
import * as form from 'utils/form';
import { legacyMode } from 'consts/misc';
import { isCoreConnected } from 'selectors';
import warningIcon from 'icons/warning.svg';
import {
  checkForUpdates,
  stopAutoUpdate,
  setAllowPrerelease,
} from 'lib/updater';

// Internal Local
import LanguageSetting from './LanguageSetting';
import BackupDirSetting from './BackupDirSetting';

__ = __context('Settings.Application');

const WarningIcon = styled(Icon)(({ theme }) => ({
  color: theme.raise(theme.danger, 0.3),
  fontSize: '1.1em',
}));

/**
 * List of the Fiat Currencies the wallet supports. Corresponds to the data taken from our server.
 * @memberof SettingsApp
 */
const fiatCurrencies = [
  { value: 'AUD', display: 'Australian Dollar (AUD)' },
  { value: 'BTC', display: 'Bitcoin (BTC)' },
  { value: 'BRL', display: 'Brazilian Real (BRL)' },
  { value: 'GBP', display: 'British Pound (GBP)' },
  { value: 'MMK', display: 'Burmese Kyat (MMK)' },
  { value: 'CAD', display: 'Canadian Dollar (CAD)' },
  { value: 'CLP', display: 'Chilean Peso (CLP)' },
  { value: 'CNY', display: 'Chinese Yuan (CNY)' },
  { value: 'CZK', display: 'Czeck Koruna (CZK)' },
  { value: 'EUR', display: 'Euro (EUR)' },
  { value: 'HKD', display: 'Hong Kong Dollar (HKD)' },
  { value: 'ILS', display: 'Israeli Shekel (ILS)' },
  { value: 'INR', display: 'Indian Rupee (INR)' },
  { value: 'IDR', display: 'Indonesian Rupiah (IDR)' },
  { value: 'JPY', display: 'Japanese Yen (JPY)' },
  { value: 'KRW', display: 'Korean Won (KRW)' },
  { value: 'MYR', display: 'Malaysian Ringgit (MYR)' },
  { value: 'MXN', display: 'Mexican Peso (MXN)' },
  { value: 'NZD', display: 'New Zealand Dollar (NZD)' },
  { value: 'PKR', display: 'Pakistan Rupee (PKR)' },
  { value: 'PHP', display: 'Philippine Peso (PHP)' },
  { value: 'PLN', display: 'Polish Złoty (PLN)' },
  { value: 'RUB', display: 'Russian Ruble (RUB)' },
  { value: 'SAR', display: 'Saudi Riyal (SAR)' },
  { value: 'SGD', display: 'Singapore Dollar (SGD)' },
  { value: 'ZAR', display: 'South African Rand (ZAR)' },
  { value: 'CHF', display: 'Swiss Franc (CHF)' },
  { value: 'TWD', display: 'Taiwan Dollar (TWD)' },
  { value: 'THB', display: 'Thai Baht (THB)' },
  { value: 'AED', display: 'United Arab Emirates Dirham (AED)' },
  { value: 'USD', display: 'United States Dollar (USD)' },
  { value: 'VND', display: 'Vietnamese Dong (VND)' },
];

/**
 * Handles setting the auto launch function.
 * @param {element} e Attached element
 */
async function toggleOpenOnStart(e) {
  const { checked } = e.target;
  const nexusAutoLaunch = new AutoLaunch({
    name: 'Nexus Wallet',
  });
  if (checked) {
    nexusAutoLaunch.enabled();
    updateSettings({ openOnStart: true });
  } else {
    nexusAutoLaunch.disabled();
    updateSettings({ openOnStart: false });
  }
}

/**
 * Toggles if modules should be verified or not.
 */
async function toggleVerifyModuleSource(e) {
  if (e.target.checked) {
    const confirmed = await confirm({
      question: __('Turn module open source policy on?'),
      note: __(
        'All modules without open source verifications, possibly including your own under-development modules, will become invalid. Wallet must be refreshed for the change to take effect.'
      ),
    });
    if (confirmed) {
      updateSettings({ verifyModuleSource: true });
      location.reload();
    }
  } else {
    const confirmed = await confirm({
      question: __('Turn module open source policy off?'),
      note: (
        <div>
          <p>
            {__(`This is only for module developers and can be dangerous for
            regular users. Please make sure you know what you are doing!`)}
          </p>
          <p>
            {__(`It would be much easier for a closed source module to hide
            malicious code than for an open source one. Therefore, in case you
            still want to disable this setting, it is highly recommended that
            you only install and run closed source modules that you are
            developing yourself.`)}
          </p>
        </div>
      ),
      labelYes: __('Turn policy off'),
      skinYes: 'danger',
      labelNo: __('Keep policy on'),
      skinNo: 'primary',
      style: { width: 600 },
    });
    if (confirmed) {
      updateSettings({ verifyModuleSource: false });
      location.reload();
    }
  }
}

/**
 * Handles update Change
 */
async function handleAutoUpdateChange(e) {
  if (!e.target.checked) {
    const confirmed = await confirm({
      question: __('Are you sure you want to disable auto update?'),
      note: __(
        'Keeping your wallet up-to-date is important for your security and will ensure that you get the best possible user experience.'
      ),
      labelYes: __('Keep auto update On'),
      labelNo: __('Turn auto update Off'),
      skinNo: 'danger',
      style: { width: 580 },
    });
    if (!confirmed) {
      updateSettings({ autoUpdate: false });
      stopAutoUpdate();
    }
  } else {
    updateSettings({ autoUpdate: true });
    checkForUpdates();
  }
}

export default function SettingsApp() {
  const coreConnected = useSelector(isCoreConnected);
  const settings = useSelector((state) => state.settings);
  useEffect(() => {
    switchSettingsTab('App');
  }, []);

  const confirmBackupWallet = async () => {
    const confirmed = await confirm({
      question: __('Backup wallet'),
    });
    if (confirmed) {
      if (coreConnected) {
        backupWallet(settings.backupDirectory);
        showNotification(__('Wallet has been backed up'), 'success');
      } else {
        openErrorDialog({
          message: __('Connecting to Nexus Core'),
        });
      }
    }
  };

  const updateHandlers = (settingName) => (input) =>
    updateSettings({
      [settingName]: form.resolveValue(input),
    });

  return (
    <>
      <LanguageSetting />

      <SettingsField
        connectLabel
        label={__('Minimize on close')}
        subLabel={__(
          'Minimize the wallet when closing the window instead of closing it.'
        )}
      >
        <Switch
          checked={settings.minimizeOnClose}
          onChange={updateHandlers('minimizeOnClose')}
        />
      </SettingsField>

      <SettingsField
        connectLabel
        label={__('Open on startup')}
        subLabel={__('Open the wallet when ever the OS starts.')}
      >
        <Switch checked={settings.openOnStart} onChange={toggleOpenOnStart} />
      </SettingsField>

      <SettingsField
        connectLabel
        label={
          <span>
            <span className="v-align">
              {__('Auto update (Recommended)')}{' '}
              {!settings.autoUpdate && (
                <WarningIcon spaceLeft icon={warningIcon} />
              )}
            </span>
          </span>
        }
        subLabel={
          <div>
            {__(
              'Automatically check for new versions and notify if a new version is available.'
            )}
          </div>
        }
      >
        <Switch
          checked={settings.autoUpdate}
          onChange={handleAutoUpdateChange}
        />
      </SettingsField>

      <SettingsField
        connectLabel
        label={__('Allow Pre-releases')}
        subLabel={
          <div>
            {__(
              'Accept pre-release versions (e.g. alpha, beta) when checking for updates.'
            )}
          </div>
        }
      >
        <Switch
          checked={settings.allowPrerelease}
          onChange={(evt) => setAllowPrerelease(evt.target.checked)}
        />
      </SettingsField>

      <SettingsField
        connectLabel
        label={__('Send anonymous usage data')}
        subLabel={__(
          'Send anonymous usage data to allow the Nexus developers to improve the wallet.'
        )}
      >
        <Switch
          checked={settings.sendUsageData}
          onChange={updateHandlers('sendUsageData')}
        />
      </SettingsField>

      <SettingsField label={__('Base currency')}>
        <Select
          value={settings.fiatCurrency}
          onChange={updateHandlers('fiatCurrency')}
          options={fiatCurrencies}
          style={{ maxWidth: 260 }}
        />
      </SettingsField>

      {legacyMode && (
        <SettingsField
          connectLabel
          label={__('Minimum confirmations')}
          subLabel={__(
            'Minimum amount of confirmations before a block is accepted. Local only.'
          )}
        >
          <TextField
            type="number"
            value={settings.minConfirmations}
            step="1"
            min="1"
            onChange={updateHandlers('minConfirmations')}
            onKeyPress={(e) => {
              e.preventDefault();
            }}
            style={{ width: 75 }}
          />
        </SettingsField>
      )}

      {legacyMode && <BackupDirSetting />}

      <SettingsField
        connectLabel
        label={__('Developer mode')}
        subLabel={__(
          'Development mode enables advanced features to aid in development. After enabling the wallet must be closed and reopened to enable those features.'
        )}
      >
        <Switch
          checked={settings.devMode}
          onChange={updateHandlers('devMode')}
        />
      </SettingsField>

      <div style={{ display: settings.devMode ? 'block' : 'none' }}>
        <SettingsField
          indent={1}
          connectLabel
          label={__('Module open source policy')}
          subLabel={__(
            "Only modules which have valid open source repositories are allowed to be installed and run. You can disable this option to test run the modules that you're developing"
          )}
        >
          <Switch
            checked={settings.verifyModuleSource}
            onChange={toggleVerifyModuleSource}
          />
        </SettingsField>
        <SettingsField
          indent={1}
          connectLabel
          label={__('Allow SymLink')}
          subLabel={__(
            'Allow the presence of SymLinks in the module directory'
          )}
        >
          <Switch
            checked={settings.allowSymLink}
            onChange={updateHandlers('allowSymLink')}
          />
        </SettingsField>

        {legacyMode && (
          <SettingsField
            indent={1}
            connectLabel
            label={__('Fake Test Transactions')}
            subLabel={__('Display Test Transactions on the Transactions page')}
          >
            <Switch
              checked={settings.fakeTransactions}
              onChange={updateHandlers('fakeTransactions')}
            />
          </SettingsField>
        )}
      </div>

      {legacyMode && (
        <Button
          disabled={!coreConnected}
          style={{ marginTop: '2em' }}
          onClick={confirmBackupWallet}
        >
          {__('Backup wallet')}
        </Button>
      )}
    </>
  );
}
