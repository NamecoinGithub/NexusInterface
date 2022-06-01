// External
import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import styled from '@emotion/styled';
import { shell } from 'electron';

// Internal
import { switchSettingsTab } from 'lib/ui';
import { timing } from 'styles';
import Tooltip from 'components/Tooltip';

import Module from './Module';
import AddModule from './AddModule';
import AddDevModule from './AddDevModule';
import featuredModules from './featuredModules';

__ = __context('Settings.Modules');

const FailedModules = styled.div(({ theme }) => ({
  borderTop: `1px solid ${theme.mixer(0.125)}`,
  marginTop: '2em',
}));

const FailedModule = styled.div(({ theme }) => ({
  padding: '1em 0',
  fontSize: '.9em',
  color: theme.mixer(0.75),
  cursor: 'pointer',
  opacity: 0.8,
  transition: `opacity ${timing.normal}`,
  '&:hover': {
    opacity: 1,
  },
}));

const SectionSeparator = styled.span(({ theme, label }) => ({
  position: 'relative',
  display: 'flex',
  justifyContent: 'center',
  marginTop: '2em',

  '&::before': {
    content: '""',
    borderBottom: `1px solid ${theme.mixer(0.5)}`,
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
  },

  '&::after': {
    content: `"${label}"`,
    position: 'relative',
    display: 'block',
    padding: '0 1em',
    background: theme.lower(theme.background, 0.3),
    // color: theme.mixer(0.75),
  },
}));

const FeaturedModules = styled.div({
  opacity: 0.7,
});

export default function SettingsModules() {
  const modules = useSelector((state) => state.modules);
  const failedModules = useSelector((state) => state.failedModules);
  const devMode = useSelector((state) => state.settings.devMode);
  const moduleList = Object.values(modules);

  const notInstalledFeaturedModules = featuredModules.filter(
    (m) => !modules[m.name]
  );

  useEffect(() => {
    switchSettingsTab('Modules');
  }, []);

  return (
    <>
      <AddModule />
      {devMode && <AddDevModule />}
      {moduleList.map((module, i) => (
        <Module
          key={module.info.name}
          module={module}
          last={i === moduleList.length - 1}
        />
      ))}
      {failedModules?.length > 0 && (
        <FailedModules>
          {failedModules.map(({ name, path, message }) => (
            <FailedModule
              key={name}
              onClick={() => {
                shell.openPath(path);
              }}
            >
              <Tooltip.Trigger tooltip={message}>
                <span>
                  {__('Failed to load %{moduleName}', { moduleName: name })}
                </span>
              </Tooltip.Trigger>
            </FailedModule>
          ))}
        </FailedModules>
      )}
      {!moduleList.length && !failedModules.length && (
        <div className="text-center dim mt3 mb3">
          <em>{__('No modules have been installed')}</em>
        </div>
      )}
      {!!notInstalledFeaturedModules?.length && (
        <>
          <SectionSeparator label={__('Developed by Nexus')} />
          <FeaturedModules>
            {notInstalledFeaturedModules.map((featuredModule) => (
              <Module.FeaturedModule
                key={featuredModule.name}
                featuredModule={featuredModule}
              />
            ))}
          </FeaturedModules>
        </>
      )}
    </>
  );
}
