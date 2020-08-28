import React from 'react';
import styled from '@emotion/styled';

import Button from 'components/Button';
import Icon from 'components/Icon';
import QRModal from 'components/QRModal';
import Tooltip from 'components/Tooltip';
import { openModal } from 'lib/ui';
import QRIcon from 'icons/qr.svg';

const QRButtonComponent = styled(Button)({
  display: 'inline-block',
  verticalAlign: 'middle',
  marginLeft: 10,
  padding: 0,
  height: 'auto',
});

export default function QRButton({ address, ...rest }) {
  return (
    <Tooltip.Trigger tooltip={__('Show QR code')}>
      <QRButtonComponent
        skin="plain"
        {...rest}
        onClick={() => {
          openModal(QRModal, { address });
        }}
      >
        <Icon icon={QRIcon} />
      </QRButtonComponent>
    </Tooltip.Trigger>
  );
}
