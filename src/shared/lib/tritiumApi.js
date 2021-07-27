import http from 'http';
import https from 'https';

import store from 'store';
import { getActiveCoreConfig } from 'lib/coreConfig';

const getDefaultOptions = ({
  apiSSL,
  ip,
  apiPortSSL,
  apiPort,
  apiUser,
  apiPassword,
}) => ({
  portocol: apiSSL ? 'https:' : 'http:',
  host: ip,
  port: apiSSL ? apiPortSSL : apiPort,
  headers: {
    'Content-Type': 'application/json',
  },
  auth: apiUser && apiPassword ? `${apiUser}:${apiPassword}` : undefined,
  rejectUnauthorized: false,
});

function sendRequest({ params, options, ssl }) {
  return new Promise((resolve, reject) => {
    try {
      const content = params && JSON.stringify(params);
      if (content) {
        options.headers = {
          ...options?.headers,
          'Content-Length': Buffer.byteLength(content),
        };
      }

      const { request } = ssl ? https : http;
      const req = request(options, (res) => {
        let data = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          let result = undefined;
          if (data) {
            try {
              result = JSON.parse(data);
            } catch (err) {
              console.error('Response data is not valid JSON', data);
            }
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result?.result);
          } else {
            reject(result?.error);
          }
        });

        res.on('aborted', () => {
          reject(new Error('Aborted'));
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('abort', () => {
        reject(new Error('Aborted'));
      });

      if (params) {
        req.write(content);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Send a Tritium API request in POST method
 *
 * @export
 * @param {*} endpoint
 * @param {*} params
 * @returns
 */
export async function callApi(endpoint, customParams) {
  const conf = await getActiveCoreConfig();
  const {
    user: { session },
    core: { systemInfo },
  } = store.getState();

  const params = systemInfo?.multiuser
    ? { session, ...customParams }
    : customParams || {};
  const options = {
    method: 'POST',
    path: `/${endpoint}`,
    ...getDefaultOptions(conf),
  };
  return await sendRequest({ params, options, ssl: conf.apiSSL });
}

/**
 * Send a Tritium API request in GET method
 *
 * @export
 * @param {*} url
 * @returns
 */
export async function callApiByUrl(url) {
  const conf = await getActiveCoreConfig();
  return await sendRequest({
    options: {
      method: 'GET',
      path: `/${url}`,
      ...getDefaultOptions(conf),
    },
    ssl: conf.apiSSL,
  });
}
