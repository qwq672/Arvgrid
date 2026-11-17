import zh from './zh.js';
import en from './en.js';
import ja from './ja.js';
import ko from './ko.js';

const translations = { zh, en, ja, ko };

// 纯函数版本：供非组件场景（如 DialogProvider 回调）使用。
// useTranslation 只是对它的简单包装，保持既有导入不变。
export function getTranslation(lang) {
  return translations[lang] || translations.zh;
}

export function useTranslation(lang) {
  return getTranslation(lang);
}
