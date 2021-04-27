// External
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { ipcRenderer } from 'electron';

// Internal
import Button from 'components/Button';
import {
  starryNightBackground,
  cosmicLightBackground,
  updateTheme,
} from 'lib/theme';
import { newUID } from 'utils/misc';

__ = __context('Settings.Style');

async function handleFilePick(e) {
  const files = await ipcRenderer.invoke('show-open-dialog', {
    title: __('Select wallpaper'),
    properties: ['openFile'],
    filters: [
      {
        name: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'],
      },
    ],
  });
  let path = files?.[0];
  if (path) {
    if (process.platform === 'win32') {
      path = path.replace(/\\/g, '/');
    }
    updateTheme({ wallpaper: path });
  }
}

export default function BackgroundPicker() {
  const wallpaper = useSelector((state) => state.theme.wallpaper);
  const fileInputID = useMemo(newUID, []);
  const customWallpaper =
    wallpaper !== starryNightBackground && wallpaper !== cosmicLightBackground;

  return (
    <div>
      <Button
        skin={wallpaper === starryNightBackground ? 'filled-primary' : 'plain'}
        className="mr1"
        onClick={() => updateTheme({ wallpaper: starryNightBackground })}
        selected={wallpaper === starryNightBackground}
        style={{ display: 'inline', marginBottom: '.5em' }}
      >
        {__('Starry night')}
      </Button>
      <Button
        skin={wallpaper === cosmicLightBackground ? 'filled-primary' : 'plain'}
        className="mr1"
        onClick={() => updateTheme({ wallpaper: cosmicLightBackground })}
        selected={wallpaper === cosmicLightBackground}
        style={{ display: 'inline', marginBottom: '.5em' }}
      >
        {__('Cosmic light')}
      </Button>
      <Button
        skin={customWallpaper ? 'filled-primary' : 'plain'}
        className="mr1"
        selected={customWallpaper}
        onClick={handleFilePick}
      >
        {customWallpaper ? (
          <span>
            {__('Custom wallpaper')}: {wallpaper}
          </span>
        ) : (
          __('Select a custom wallpaper')
        )}
      </Button>
    </div>
  );
}
