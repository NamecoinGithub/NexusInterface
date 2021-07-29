import Button from 'components/Button';
import Modal from 'components/Modal';
import { alphaRelease } from 'consts/misc';
import { shell } from 'electron';

const PreReleaseWarningModal = () => {
  const versionRunning = APP_VERSION.toString();
  const releaseType = alphaRelease ? 'Alpha' : 'Beta';
  return (
    <Modal maxWidth={600}>
      {(closeModal) => (
        <>
          <Modal.Header>{__('Pre-Release Active')}</Modal.Header>
          <Modal.Body>
            <div className="text-center">{versionRunning}</div>

            <div className="mt1 text-center">
              {__(
                `You are currenctly running a ${releaseType} version of the wallet. `
              )}
            </div>
            <div className="mt1 text-center">
              {__('Thank you for testing our wallet, please ')}
              <Button
                skin="plain-link-primary"
                onClick={() =>
                  shell.openExternal(
                    'https://github.com/Nexusoft/NexusInterface/issues'
                  )
                }
              >
                {__('Click here')}
              </Button>
              {__(' To send feedback to the developers. ')}
              {__('Or join us on the offical ')}
              <Button
                skin="plain-link-primary"
                onClick={() => shell.openExternal('https://t.me/NexusOfficial')}
              >
                Nexus Testing Telegram group
              </Button>
              {' .'}
            </div>
            <div className="mt3 flex center">
              <Button
                skin="filled-primary"
                style={{ width: '100%' }}
                onClick={closeModal}
              >
                {__('Ok')}
              </Button>
            </div>
          </Modal.Body>
        </>
      )}
    </Modal>
  );
};

export default PreReleaseWarningModal;
