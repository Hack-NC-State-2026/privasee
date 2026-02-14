export type DashboardTheme = 'dark' | 'light';

export const DEFAULT_DASHBOARD_THEME: DashboardTheme = 'dark';
export const DASHBOARD_THEME_STORAGE_KEY = 'privaseeDashboardTheme';

const normalizeTheme = (value: unknown): DashboardTheme =>
  value === 'light' ? 'light' : DEFAULT_DASHBOARD_THEME;

export const loadDashboardTheme = (): Promise<DashboardTheme> => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve(DEFAULT_DASHBOARD_THEME);
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([DASHBOARD_THEME_STORAGE_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        resolve(DEFAULT_DASHBOARD_THEME);
        return;
      }

      resolve(normalizeTheme(result[DASHBOARD_THEME_STORAGE_KEY]));
    });
  });
};

export const saveDashboardTheme = (
  theme: DashboardTheme
): Promise<void> => {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ [DASHBOARD_THEME_STORAGE_KEY]: theme }, () => {
      resolve();
    });
  });
};
