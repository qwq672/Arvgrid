import zh from './zh.js';
import en from './en.js';
import ja from './ja.js';
import ko from './ko.js';

const translations = { zh, en, ja, ko };

export function useTranslation(lang) {
  return translations[lang] || translations.zh;
}
