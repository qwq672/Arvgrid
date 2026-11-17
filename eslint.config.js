// v17：ESLint 最小防线——react-hooks 两条规则
// 背景：v14（SettingsModal 黑屏）与 v15（PianoRoll 哑雷）两颗雷都是
// 'rules-of-hooks' 违规（早退守卫后调用 hook → React #310 → 整树卸载黑屏）。
// 此规则在 CI 阶段拦截整类问题，代价极低。
// exhaustive-deps 只开 warn：存量代码较多，不阻塞 CI；错误级只保留 rules-of-hooks。
import hooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': hooks },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'desktop/**', 'audio-core/**', 'scripts/**'],
  },
];
