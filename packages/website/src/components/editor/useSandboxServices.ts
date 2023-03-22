import { useColorMode } from '@docusaurus/theme-common';
import type Monaco from 'monaco-editor';
import { useEffect, useState } from 'react';

import type {
  createTypeScriptSandbox,
  SandboxConfig,
} from '../../vendor/sandbox';
import { WebLinter } from '../linter/WebLinter';
import type { RuleDetails } from '../types';
import { createCompilerOptions } from './config';
import { editorEmbedId } from './EditorEmbed';
import { sandboxSingleton } from './loadSandbox';
import type { CommonEditorProps } from './types';

export interface SandboxServicesProps {
  readonly jsx?: boolean;
  readonly onLoaded: (
    ruleDetails: RuleDetails[],
    tsVersions: readonly string[],
  ) => void;
  readonly ts: string;
}

export type SandboxInstance = ReturnType<typeof createTypeScriptSandbox>;

export interface SandboxServices {
  main: typeof Monaco;
  sandboxInstance: SandboxInstance;
  webLinter: WebLinter;
}

export const useSandboxServices = (
  props: CommonEditorProps & SandboxServicesProps,
): Error | SandboxServices | undefined => {
  const { onLoaded } = props;
  const [services, setServices] = useState<Error | SandboxServices>();
  const [loadedTs, setLoadedTs] = useState<string>(props.ts);
  const { colorMode } = useColorMode();

  useEffect(() => {
    if (props.ts !== loadedTs) {
      window.location.reload();
    }
  }, [props.ts, loadedTs]);

  useEffect(() => {
    let sandboxInstance: SandboxInstance | undefined;
    setLoadedTs(props.ts);

    sandboxSingleton(props.ts)
      .then(async ({ main, sandboxFactory, ts, lintUtils }) => {
        const compilerOptions = createCompilerOptions(props.jsx);

        const sandboxConfig: Partial<SandboxConfig> = {
          text: props.code,
          monacoSettings: {
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: 'off',
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            autoIndent: 'full',
            formatOnPaste: true,
            formatOnType: true,
            wrappingIndent: 'same',
            hover: { above: false },
          },
          acquireTypes: false,
          compilerOptions: compilerOptions,
          domID: editorEmbedId,
        };

        sandboxInstance = sandboxFactory.createTypeScriptSandbox(
          sandboxConfig,
          main,
          ts,
        );
        sandboxInstance.monaco.editor.setTheme(
          colorMode === 'dark' ? 'vs-dark' : 'vs-light',
        );

        let libEntries: Map<string, string> | undefined;
        const worker = await sandboxInstance.getWorkerProcess();
        if ('getLibFiles' in worker && worker.getLibFiles) {
          libEntries = new Map(
            Object.entries(
              (await (
                worker.getLibFiles as () => Promise<Record<string, string>>
              )()) ?? {},
            ).map(item => ['/' + item[0], item[1]]),
          );
        } else {
          // for some older version of playground we do not have definitions available
          libEntries = await sandboxInstance.tsvfs.createDefaultMapFromCDN(
            {
              lib: Array.from(window.ts.libMap.keys()),
            },
            props.ts,
            true,
            window.ts,
          );
          for (const pair of libEntries) {
            sandboxInstance.languageServiceDefaults.addExtraLib(
              pair[1],
              'ts:' + pair[0],
            );
          }
        }

        const system = sandboxInstance.tsvfs.createSystem(libEntries);
        window.esquery = lintUtils.esquery;

        const webLinter = new WebLinter(system, compilerOptions, lintUtils);

        onLoaded(
          webLinter.ruleNames,
          Array.from(
            new Set([...sandboxInstance.supportedVersions, window.ts.version]),
          )
            .filter(item => parseFloat(item) >= 3.3)
            .sort((a, b) => b.localeCompare(a)),
        );

        setServices({
          main,
          sandboxInstance,
          webLinter,
        });
      })
      .catch(setServices);

    return (): void => {
      if (!sandboxInstance) {
        return;
      }

      const editorModel = sandboxInstance.editor.getModel()!;
      sandboxInstance.monaco.editor.setModelMarkers(
        editorModel,
        sandboxInstance.editor.getId(),
        [],
      );
      sandboxInstance.editor.dispose();
      editorModel.dispose();
      const models = sandboxInstance.monaco.editor.getModels();
      for (const model of models) {
        model.dispose();
      }
    };
    // colorMode and jsx can't be reactive here because we don't want to force a recreation
    // updating of colorMode and jsx is handled in LoadedEditor
  }, [props.ts, onLoaded]);

  return services;
};
