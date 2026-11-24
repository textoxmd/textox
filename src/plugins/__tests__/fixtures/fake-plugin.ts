import { APP_COMMAND, APP_EXPORTER, APP_FILE_EDITOR, APP_IMAGE_UPLOADER } from '@texto/app-api';
import type { ImageUploaderContribution } from '@texto/app-api';
import { definePlugin } from '@texto/plugin-sdk';
import type {
  CommandContribution,
  ExporterContribution,
  FileEditorContribution,
  TextoPlugin,
} from '../../types';

export const fakeFileEditor: FileEditorContribution = {
  id: 'fake.editor',
  extensions: ['.fake'],
  load: async () => ({ default: () => null }),
  capabilities: { customSave: true, externalModify: true, exportable: false },
};

export const fakeExporter: ExporterContribution = {
  id: 'fake-export',
  labelKey: 'fake.export',
  extension: 'fake',
  kind: 'text',
  run: async () => ({ data: 'x', suggestedName: 'x.fake' }),
};

export const fakeCommand: CommandContribution = {
  id: 'fake.command',
  titleKey: 'fake.command',
  category: 'plugin',
  menuAction: 'fake_action',
  run: () => {},
};

export const fakeUploader: ImageUploaderContribution = {
  id: 'fake.uploader',
  upload: async () => 'https://cdn.example/img.png',
};

export const fakePlugin: TextoPlugin = definePlugin({
  id: 'fake',
  version: '0.0.1',
  contributes: {
    [APP_FILE_EDITOR]: [fakeFileEditor],
    [APP_EXPORTER]: [fakeExporter],
    [APP_COMMAND]: [fakeCommand],
    [APP_IMAGE_UPLOADER]: [fakeUploader],
  },
});
