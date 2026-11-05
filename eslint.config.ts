import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['node_modules/', '.n8n-import/', 'docs/diagrams/', 'samples/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests read fixtures by computed path, index them by computed key, use
    // arrow-shorthand `expect`, and assert with `!` on values already checked.
    files: ['tests/**'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // The Code-node sandbox has no Node builtins or fetch, and Luxon must stay a global
    // (src/globals.d.ts) so esbuild doesn't bundle it. src/lib is bundled into Code nodes too.
    files: ['src/nodes/**', 'src/lib/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['luxon'], patterns: ['node:*'] }],
      'no-restricted-globals': ['error', 'process', 'fetch'],
    },
  },
  {
    // The scan rasterizer walks a Uint8ClampedArray pixel buffer by a bounded numeric loop
    // counter, never by a computed or external key.
    files: ['scripts/lib/invoice-pdf.ts'],
    rules: {
      'security/detect-object-injection': 'off',
    },
  },
]);
