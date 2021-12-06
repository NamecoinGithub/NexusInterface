import Form from 'components/Form';
import ControlledModal from 'components/ControlledModal';
import FormField from 'components/FormField';
import Spinner from 'components/Spinner';
import { formSubmit, checkAll, required } from 'lib/form';
import { callApi } from 'lib/tritiumApi';
import { openSuccessDialog, confirmPasswordPin } from 'lib/dialog';

__ = __context('ChangePassword&PIN');

const initialValues = {
  password: '',
  pin: '',
  newPassword: '',
  newPin: '',
};

const minChars = (min) => (value) =>
  value.length < min
    ? __('Must be at least %{min} characters', { min })
    : undefined;

export default function ChangePasswordPinModal() {
  return (
    <ControlledModal maxWidth={500}>
      {(closeModal) => {
        <>
          <ControlledModal.Header>
            {__('Change password and PIN')}
          </ControlledModal.Header>
          <ControlledModal.Body>
            <Form
              name="change-password"
              initialValues={initialValues}
              onSubmit={formSubmit({
                submit: async ({ password, pin, newPassword, newPin }) => {
                  const correct = await confirmPasswordPin({
                    isNew: true,
                    password: newPassword,
                    pin: newPin,
                  });

                  if (correct) {
                    return await callApi('users/update/user', {
                      password,
                      pin,
                      new_password: newPassword,
                      new_pin: newPin,
                    });
                  }
                },
                onSuccess: async (result, values, form) => {
                  if (!result) return;
                  closeModal();
                  form.restart();
                  openSuccessDialog({
                    message: __('Password & PIN have been updated'),
                  });
                },
                errorMessage: __('Error updating password & PIN'),
              })}
            >
              <FormField label={__('Current password')}>
                <Form.TextFieldWithKeyboard
                  name="password"
                  maskable
                  placeholder={__('Your current password')}
                  autoFocus
                  validate={required()}
                />
              </FormField>

              <FormField label={__('Current PIN')}>
                <Form.TextFieldWithKeyboard
                  name="pin"
                  maskable
                  placeholder={__('Your current PIN')}
                  validate={required()}
                />
              </FormField>

              <div className="mt2">
                <FormField connectLabel label={__('New Password')}>
                  <Form.TextFieldWithKeyboard
                    maskable
                    name="newPassword"
                    placeholder={__('Enter your new password')}
                    validate={checkAll(required(), minChars(8))}
                  />
                </FormField>

                <FormField connectLabel label={__('New PIN')}>
                  <Form.TextFieldWithKeyboard
                    maskable
                    name="newPin"
                    placeholder={__('Enter your new PIN')}
                    validate={checkAll(required(), minChars(4))}
                  />
                </FormField>
              </div>

              <div className="mt2">
                <Form.SubmitButton skin="primary" wide>
                  {({ submitting }) =>
                    submitting ? (
                      <span>
                        <Spinner className="mr0_4" />
                        <span className="v-align">{__('Updating')}...</span>
                      </span>
                    ) : (
                      __('Update')
                    )
                  }
                </Form.SubmitButton>
              </div>
            </Form>
          </ControlledModal.Body>
        </>;
      }}
    </ControlledModal>
  );
}
