import styled from '@emotion/styled';

import ControlledModal from 'components/ControlledModal';
import Form from 'components/Form';
import Button from 'components/Button';
import { formSubmit } from 'lib/form';

__ = __context('PinDialog');

const PinInput = styled(Form.TextFieldWithKeyboard)({
  margin: '1em auto 2.5em',
  fontSize: 18,
});

const Note = styled.div({
  marginTop: '-1.5em',
  marginBottom: '1.5em',
});

export default function PinDialog({
  submitPin,
  note = null,
  confirmLabel = __('Confirm'),
  onClose,
}) {
  return (
    <ControlledModal maxWidth={350} onClose={onClose}>
      {(closeModal) => {
        const formOptions = {
          name: 'pin',
          initialValues: {
            pin: '',
          },
          validate: ({ pin }) => {
            const errors = {};
            if (!pin || pin.length < 4) {
              errors.pin = __('Pin must be at least 4 characters');
            }
            return errors;
          },
          onSubmit: formSubmit({
            submit: ({ pin }) => {
              submitPin?.(pin);
            },
            onSuccess: closeModal,
          }),
        };

        return (
          <>
            <ControlledModal.Header>{__('Enter PIN')}</ControlledModal.Header>
            <ControlledModal.Body>
              <Form {...formOptions}>
                <PinInput
                  name="pin"
                  maskable
                  autoFocus
                  skin="filled-inverted"
                  placeholder={__('Your PIN')}
                />
                {!!note && <Note>{note}</Note>}
                <div className="flex space-between">
                  <Button onClick={closeModal}>{__('Cancel')}</Button>
                  <Form.SubmitButton skin="primary">
                    {confirmLabel}
                  </Form.SubmitButton>
                </div>
              </Form>
            </ControlledModal.Body>
          </>
        );
      }}
    </ControlledModal>
  );
}
