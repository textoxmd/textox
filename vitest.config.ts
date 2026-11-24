import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'scripts/**/*.test.{ts,mjs}',
      'src/plugins/**/*.test.ts',
      'src/editor/**/*.test.ts',
      'src/agent/**/*.test.{ts,tsx}',
      'packages/*/src/**/*.test.ts',
      'official-plugins/*/src/**/*.test.ts',
      'official-v1-plugins/*/src/**/*.test.ts',
      'plugin-samples/*/src/**/*.test.ts',
      'src/components/Onboarding/**/*.test.{ts,tsx}',
      'src/components/EditorToolbar/**/*.test.ts',
      'src/components/sidebar/**/*.test.{ts,tsx}',
      'src/components/icons/**/*.test.{ts,tsx}',
      'src/hooks/**/*.test.{ts,tsx}',
      'src/components/__tests__/PluginSettingsPanel.test.tsx',
      'src/components/settings/**/*.test.{ts,tsx}',
      'src/components/__tests__/AiConsentPage.test.tsx',
      'src/components/__tests__/AiModelSettings.test.tsx',
      'src/components/__tests__/titleBarFileInfo.test.tsx',
      'src/utils/__tests__/windowManager.test.ts',
      'src/utils/__tests__/appConfig.test.ts',
      'src/utils/__tests__/imageStoragePath.test.ts',
      'src/utils/__tests__/imagePath.test.ts',
      'src/utils/__tests__/workspacePath.test.ts',
    ],
  },
});
