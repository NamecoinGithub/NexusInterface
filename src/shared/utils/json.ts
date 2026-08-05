import log from 'electron-log';

export function tryParsingJson(json: string) {
  try {
    return JSON.parse(json);
  } catch (err) {
    log.warn('Error parsing JSON', json);
    return null;
  }
}
