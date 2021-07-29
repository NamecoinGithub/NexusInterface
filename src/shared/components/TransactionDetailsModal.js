import { useEffect, useState } from 'react';

import Modal from 'components/Modal';
import InfoField from 'components/InfoField';
import WaitingMessage from 'components/WaitingMessage';
import { callApi } from 'lib/tritiumApi';
import { openErrorDialog } from 'lib/dialog';
import { formatDateTime } from 'lib/intl';

__ = __context('TransactionDetails');

const timeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

export default function TransactionDetailsModal({ txid }) {
  const [transaction, setTransaction] = useState(null);
  useEffect(() => {
    callApi('ledger/get/transaction', {
      txid,
      verbose: 'summary',
    })
      .then((tx) => {
        setTransaction(tx);
      })
      .catch((err) => {
        openErrorDialog({
          message: __('Error loading transaction'),
          note: err?.message,
        });
      });
  }, []);

  return (
    <Modal>
      <Modal.Header>{__('Transaction Details')}</Modal.Header>
      <Modal.Body>
        {transaction ? (
          <>
            <InfoField label={__('Time')}>
              {formatDateTime(transaction.timestamp * 1000, timeFormatOptions)}
            </InfoField>
            <InfoField label={__('Sequence')}>{transaction.sequence}</InfoField>
            <InfoField label={__('Type')}>{transaction.type}</InfoField>
            <InfoField label={__('Confirmations')}>
              {transaction.confirmations}
            </InfoField>
            <InfoField label={__('Transaction ID')}>
              <span className="monospace">{transaction.txid}</span>
            </InfoField>
          </>
        ) : (
          <WaitingMessage>
            {__('Loading transaction details...')}
          </WaitingMessage>
        )}
      </Modal.Body>
    </Modal>
  );
}
