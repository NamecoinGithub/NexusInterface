import styled from '@emotion/styled';
import { useSelector } from 'react-redux';

import Form from 'components/Form';
import ControlledModal from 'components/ControlledModal';
import FormField from 'components/FormField';
import Button from 'components/Button';
import NewUserModal from 'components/NewUserModal';
import RecoverPasswordPinModal from 'components/RecoverPasswordPinModal';
import Spinner from 'components/Spinner';
import { showNotification, openModal } from 'lib/ui';
import { openErrorDialog } from 'lib/dialog';
import { formSubmit, required } from 'lib/form';
import { logIn } from 'lib/user';

__ = __context('Login');

const Buttons = styled.div({
  marginTop: '2em',
});

const ExtraSection = styled.div({
  marginTop: '2em',
  display: 'flex',
  justifyContent: 'space-between',
  opacity: 0.9,
});

export default function LoginModal() {
  const syncing = useSelector((state) => state.core.systemInfo?.synchronizing);

  return (
    <ControlledModal maxWidth={500}>
      {(closeModal) => (
        <>
          <ControlledModal.Header>{__('Log in')}</ControlledModal.Header>
          <ControlledModal.Body>
            <Form
              name="login_tritium"
              initialValues={{
                username: '',
                password: '',
                pin: '',
              }}
              onSubmit={formSubmit({
                submit: ({ username, password, pin }) =>
                  logIn({ username, password, pin }),
                onSuccess: async (result, { username }) => {
                  closeModal();
                  showNotification(
                    __('Logged in as %{username}', { username }),
                    'success'
                  );
                },
                onFail: (err) => {
                  const message =
                    syncing && err?.code === -139
                      ? `${err?.message}. ${__(
                          'Not being fully synced may have caused this error.'
                        )}`
                      : err?.message;
                  openErrorDialog({
                    message: __('Error logging in'),
                    note: message,
                  });
                },
              })}
            >
              <FormField
                connectLabel
                label={__('Username')}
                style={{ marginTop: 0 }}
              >
                <Form.TextFieldWithKeyboard
                  name="username"
                  validate={required()}
                  placeholder={__('Enter your username')}
                  autoFocus
                />
              </FormField>

              <FormField connectLabel label={__('Password')}>
                <Form.TextFieldWithKeyboard
                  name="password"
                  validate={required()}
                  maskable
                  placeholder={__('Enter your password')}
                />
              </FormField>

              <FormField connectLabel label={__('PIN')}>
                <Form.TextFieldWithKeyboard
                  name="pin"
                  validate={required()}
                  maskable
                  placeholder={__('Enter your PIN')}
                />
              </FormField>

              <Buttons>
                <Form.SubmitButton wide uppercase skin="primary">
                  {({ submitting }) =>
                    submitting ? (
                      <span>
                        <Spinner className="mr0_4" />
                        <span className="v-align">{__('Logging in')}...</span>
                      </span>
                    ) : (
                      __('Log in')
                    )
                  }
                </Form.SubmitButton>
              </Buttons>

              <ExtraSection>
                <Button
                  skin="hyperlink"
                  onClick={() => {
                    closeModal();
                    openModal(RecoverPasswordPinModal);
                  }}
                >
                  {__('Forgot password?')}
                </Button>
                <Button
                  skin="hyperlink"
                  onClick={() => {
                    closeModal();
                    openModal(NewUserModal);
                  }}
                >
                  {__('Create new user')}
                </Button>
              </ExtraSection>
            </Form>
          </ControlledModal.Body>
        </>
      )}
    </ControlledModal>
  );
}
