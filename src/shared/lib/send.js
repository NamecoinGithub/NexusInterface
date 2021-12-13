import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import qs from 'querystring';
import { useSelector } from 'react-redux';

import { history } from 'lib/wallet';
import { useFieldValue, selectFormInstance } from 'lib/form';
import { timeToObject } from 'utils/misc';
import store from 'store';
import memoize from 'utils/memoize';

export const formName = 'send';

export function getDefaultRecipient({ txExpiry } = {}) {
  const recipient = {
    address: null,
    amount: '',
    fiatAmount: '',
    reference: null,
    expireDays: 7,
    expireHours: 0,
    expireMinutes: 0,
    expireSeconds: 0,
  };
  if (txExpiry) {
    const { days, hours, minutes, seconds } = timeToObject(txExpiry);
    recipient.expireDays = days;
    recipient.expireHours = hours;
    recipient.expireMinutes = minutes;
    recipient.expireSeconds = seconds;
  }
  return recipient;
}

function getFormValues(customValues = {}) {
  const state = store.getState();
  const txExpiry = state.core.config?.txExpiry;
  const defaultRecipient = getDefaultRecipient({ txExpiry });
  return {
    sendFrom: customValues.sendFrom || null,
    // not accepting fiatAmount
    recipients: customValues.recipients?.map(
      ({
        address,
        amount,
        reference,
        expireDays,
        expireHours,
        expireMinutes,
        expireSeconds,
      }) => ({
        ...defaultRecipient,
        address,
        amount,
        reference,
        expireDays,
        expireHours,
        expireMinutes,
        expireSeconds,
      })
    ) || [defaultRecipient],
    advancedOptions: customValues.advancedOptions || false,
  };
}

export function goToSend(customValues) {
  history.push('/Send?state=' + JSON.stringify(customValues));
}

export function useInitialValues() {
  const location = useLocation();
  // React-router's search field has a leading ? mark but
  // qs.parse will consider it invalid, so remove it
  const queryParams = qs.parse(location.search.substring(1));

  const stateJson = queryParams?.state;
  let customValues = null;
  try {
    customValues = stateJson && JSON.parse(stateJson);
  } catch (err) {}
  const initialValues = getFormValues(customValues);

  // Reset the form when a new specific Send state is passed through the query string
  // Otherwise, always keep the form's current state
  useEffect(() => {
    if (customValues) {
      const state = store.getState();
      const form = selectFormInstance(formName)(state);
      form.restart(initialValues);
    }
  }, [stateJson]);
  return initialValues;
}

export const selectAddressNameMap = memoize(
  (addressBook, myAccounts) => {
    const map = {};
    if (addressBook) {
      Object.values(addressBook).forEach((contact) => {
        if (contact.addresses) {
          contact.addresses.forEach(({ address, label }) => {
            map[address] = contact.name + (label ? ' - ' + label : '');
          });
        }
      });
    }
    if (myAccounts) {
      myAccounts.forEach((element) => {
        map[element.address] = element.name;
      });
    }
    return map;
  },
  (state) => [state.addressBook, state.user.accounts]
);

export const getSource = memoize(
  (sendFrom, myAccounts, myTokens) => {
    const matches = /^(account|token):(.+)/.exec(sendFrom);
    const [_, type, address] = matches || [];

    if (type === 'account') {
      const account = myAccounts?.find((acc) => acc.address === address);
      if (account) return { account };
    }

    if (type === 'token') {
      const token = myTokens?.find((tkn) => tkn.address === address);
      if (token) return { token };
    }

    return null;
  },
  (state, sendFrom) => [sendFrom, state.user.accounts, state.user.tokens]
);

export const selectSource = () => {
  const sendFrom = useFieldValue('sendFrom');
  const source = useSelector((state) => getSource(state, sendFrom));
  return source;
};
