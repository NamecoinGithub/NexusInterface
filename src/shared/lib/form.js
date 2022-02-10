import { FORM_ERROR } from 'final-form';
import { useField } from 'react-final-form';

import { UPDATE_FORM_INSTANCE } from 'consts/actionTypes';
import store from 'store';
import { openErrorDialog } from 'lib/dialog';

export function updateFormInstance(formName, instance) {
  store.dispatch({
    type: UPDATE_FORM_INSTANCE,
    payload: { formName, instance },
  });
}

export const selectFormInstance = (formName) => (state) =>
  state.forms[formName];

const defaultOnFail = (err, errorMessage) => {
  openErrorDialog({
    message: errorMessage || __('Error'),
    note: err?.message || (typeof err === 'string' ? err : __('Unknown error')),
  });
  return {
    [FORM_ERROR]: err,
  };
};

export const formSubmit =
  ({ submit, onSuccess, onFail = defaultOnFail, errorMessage }) =>
  async (values, form) => {
    let result;
    try {
      result = await Promise.resolve(submit(values, form));
    } catch (err) {
      return onFail(err, errorMessage);
    }
    onSuccess?.(result, values, form);
  };

export function useFieldValue(name) {
  const {
    input: { value },
  } = useField(name, { subscription: { value: true } });
  return value;
}

export const numericOnly = (value) =>
  (value ? String(value) : '').replace(/\D/g, '');

export const trimText = (text) => text && text.trim();

/**
 * VALIDATE FUNCTIONS
 */

export const checkAll =
  (...validations) =>
  (value, allValues, meta) => {
    for (const validation of validations) {
      const result = validation(value, allValues, meta);
      if (result) return result;
    }
  };

export const required =
  (message = __('Required!')) =>
  (value) =>
    !value && value !== 0 ? message : undefined;

export const regex =
  (regexp, message = __('Invalid!')) =>
  (value) =>
    typeof value !== 'string' || !regexp.test(value) ? message : undefined;

export const range =
  (min, max, message = __('Out of range!')) =>
  (value) =>
    ((min || min === 0) && value < min) || ((max || max === 0) && value > max)
      ? message
      : undefined;

export const oneOf = (list, message) => (value) =>
  !list.includes(value) ? message : undefined;

export const notOneOf = (list, message) => (value) =>
  list.includes(value) ? message : undefined;

export const minChars = (min) => (value) =>
  value.length < min
    ? __('Must be at least %{min} characters', { min })
    : undefined;
