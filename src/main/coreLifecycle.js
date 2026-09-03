'use strict';

function createCoreLifecycleCoordinator() {
  let tail = Promise.resolve();
  let activeOperation = null;

  return Object.freeze({
    run(label, operation) {
      if (typeof label !== 'string' || !label || typeof operation !== 'function') {
        throw new TypeError('A labeled Core lifecycle operation is required');
      }

      const scheduled = tail.then(async () => {
        activeOperation = label;
        try {
          return await operation();
        } finally {
          activeOperation = null;
        }
      });
      tail = scheduled.catch(() => undefined);
      return scheduled;
    },
    getActiveOperation() {
      return activeOperation;
    },
  });
}

module.exports = {
  createCoreLifecycleCoordinator,
};
