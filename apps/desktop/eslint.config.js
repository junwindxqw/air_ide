import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // 3.3 模块边界：ui/ 与 ipc/ 不得依赖 features
    files: ['src/ui/**', 'src/ipc/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features', '@/features/**'],
              message: 'ui/ipc 层禁止依赖 features（3.3 模块边界）',
            },
          ],
        },
      ],
    },
  },
  {
    // 3.3 模块边界：跨 feature 只能走 index.ts 出口，禁止深引用
    files: ['src/features/**', 'src/app/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '!@/features/command/**',
                '@/features/*/{components,hooks,lib,store}*',
              ],
              message: '跨 feature 禁止深引用（3.3），请走 feature 入口',
            },
          ],
        },
      ],
    },
  },
)
