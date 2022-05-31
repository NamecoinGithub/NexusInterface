import { combineReducers } from 'redux';

import session from './session';
import status from './status';
import stakeInfo from './stakeInfo';
import balances from './balances';
import accounts from './accounts';
import transactions from './transactions';
import tokens from './tokens';
import nameRecords from './nameRecords';
import namespaces from './namespaces';
import assets from './assets';
import startStakingAsked from './startStakingAsked';
import username from './username';

export default combineReducers({
  username,
  session,
  status,
  stakeInfo,
  balances,
  accounts,
  transactions,
  tokens,
  nameRecords,
  namespaces,
  assets,
  startStakingAsked,
});
