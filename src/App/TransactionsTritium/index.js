import { createRef, useEffect } from 'react';
import { useSelector } from 'react-redux';
import GA from 'lib/googleAnalytics';
import styled from '@emotion/styled';

import Panel from 'components/Panel';
import WaitingMessage from 'components/WaitingMessage';
import Button from 'components/Button';
import TextField from 'components/TextField';
import RequireLoggedIn from 'components/RequireLoggedIn';
import Spinner from 'components/Spinner';
import Icon from 'components/Icon';
import Tooltip from 'components/Tooltip';
import { loadTransactions, updateFilter } from 'lib/tritiumTransactions';
import { observeStore } from 'store';
import transactionIcon from 'icons/transaction.svg';
import warningIcon from 'icons/warning.svg';

import {
  getTransactionsList,
  getFilteredTransactions,
  paginateTransactions,
  txPerPage,
} from './selectors';
import Transaction from './Transaction';
import Balances from './Balances';
import Filters from './Filters';

__ = __context('Transactions');

const PageLayout = styled.div({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'grid',
  gridTemplateAreas: '"balances filters" "balances list" "balances pagination"',
  gridTemplateRows: 'min-content 1fr min-content',
  gridTemplateColumns: '1fr 2.7fr',
});

const TransactionsList = styled.div({
  gridArea: 'list',
  overflowY: 'auto',
  padding: '0 20px',
});

const Pagination = styled.div(({ morePadding }) => ({
  gridArea: 'pagination',
  fontSize: '.9em',
  padding: `10px ${morePadding ? '26px' : '20px'} 20px 20px`,
}));

const Container = styled.div({
  position: 'relative',
  maxWidth: 650,
  margin: '0 auto',
});

const PageInput = styled(TextField)({
  width: 40,
  '& > input': {
    textAlign: 'center',
  },
});

const PaginationButton = styled(Button)({
  minWidth: 150,
});

const TransactionLoadingWarningSpinner = styled(Spinner)(({ theme }) => ({
  color: theme.mixer(0.5),
  width: '1.4em',
  height: '1.4em',
  position: 'absolute',
  left: '100%',
  marginLeft: '1em',
}));

const ErrorMessage = styled.div(({ theme }) => ({
  textAlign: 'center',
  padding: '30px 0',
  color: theme.danger,
}));

// listRef = createRef();

// state = {
//   // Whether transaction list is having a scrollbar
//   hasScroll: false,
// };

// /**
//    * Component Mount Callback
//    *
//    * @memberof TransactionsTritium
//    */
//  componentDidMount() {

//   this.checkScrollbar();
// }

// componentDidUpdate(prevProps) {
//   if (prevProps.transactions !== this.props.transaction) {
//     this.checkScrollbar();
//   }
// }

// // When transactions list has a scrollbar, the alignment of elements
// // will be affected, so set a state to adjust the paddings accordingly
// checkScrollbar = () => {
//   const listEl = this.listRef.current;
//   if (listEl) {
//     // If transactions list has a scrollbar
//     if (listEl.clientHeight < listEl.scrollHeight && !this.state.hasScroll) {
//       this.setState({ hasScroll: true });
//     }
//     if (listEl.clientHeight >= listEl.scrollHeight && this.state.hasScroll) {
//       this.setState({ hasScroll: false });
//     }
//   }
// };

const totalPages = 10;

/**
 * TransactionsTritium Page
 *
 * @class TransactionsTritium
 * @extends {Component}
 */
export default function TransactionsTritium() {
  const { status, transactions, lastPage } = useSelector(
    (state) => state.user.transactions
  );
  const { page } = useSelector((state) => state.ui.transactionsFilter);
  const genesis = useSelector((state) => state.user.status?.genesis);

  useEffect(() => {
    GA.SendScreen('TransactionsTritium');
  }, []);
  // Reload transactions when user genesis changes, such as when user
  // is logged in or switched to another user
  useEffect(() => {
    if (genesis && (status === 'notLoaded' || status === 'error')) {
      loadTransactions();
    }
  }, [genesis]);

  return (
    <Panel icon={transactionIcon} title={__('Transactions')}>
      <RequireLoggedIn>
        <PageLayout>
          <Balances />
          <Filters /> {/*morePadding={this.state.hasScroll} */}
          <TransactionsList>
            {' '}
            {/*ref={this.listRef} */}
            {status === 'loading' && (
              <WaitingMessage>{__('Loading transactions...')}</WaitingMessage>
            )}
            {status === 'error' && (
              <ErrorMessage>
                <div className="text-center">
                  <Icon icon={warningIcon} size={32} />
                </div>
                <div className="mt0_4">{__('Failed to load transactions')}</div>
              </ErrorMessage>
            )}
            {status === 'loaded' && (
              <Container>
                {transactions &&
                  transactions.map((tx) => (
                    <Transaction key={tx.txid} transaction={tx} />
                  ))}
              </Container>
            )}
          </TransactionsList>
          <Pagination>
            {' '}
            {/*morePadding={this.state.hasScroll}*/}
            <Container className="flex center space-between">
              <PaginationButton
                skin="filled-inverted"
                disabled={page <= 1}
                onClick={
                  page > 1
                    ? () => {
                        updateFilter({ page: page - 1 });
                      }
                    : undefined
                }
              >
                &lt; {__('Previous')}
              </PaginationButton>
              <div className="flex center relative">
                {__(
                  'Page <page></page> of %{total}',
                  {
                    total: totalPages,
                  },
                  {
                    page: () => (
                      <>
                        &nbsp;
                        <PageInput
                          type="number"
                          min={1}
                          max={totalPages}
                          value={page}
                          onChange={(e) => {
                            updateFilter({ page: e.target.value });
                          }}
                        />
                        &nbsp;
                      </>
                    ),
                  }
                )}
              </div>
              <PaginationButton
                skin="filled-inverted"
                disabled={page >= totalPages}
                onClick={
                  page < totalPages
                    ? () => {
                        updateFilter({ page: page + 1 });
                      }
                    : undefined
                }
              >
                {__('Next')} &gt;
              </PaginationButton>
            </Container>
          </Pagination>
        </PageLayout>
      </RequireLoggedIn>
    </Panel>
  );
}
