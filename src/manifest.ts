import { defineManifest } from '@crxjs/vite-plugin';

import packageData from '../package.json';

const isDev = process.env.NODE_ENV === 'development';

export default defineManifest({
  manifest_version: 3,
  name: `${packageData.displayName || packageData.name}${
    isDev ? ` ➡️ Dev` : ''
  }`,
  version: packageData.version,
  description: packageData.description,
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'src/assets/images/logo.png',
      32: 'src/assets/images/logo.png',
      48: 'src/assets/images/logo.png',
      128: 'src/assets/images/logo.png',
    },
  },
  icons: {
    16: 'src/assets/images/logo.png',
    32: 'src/assets/images/logo.png',
    48: 'src/assets/images/logo.png',
    128: 'src/assets/images/logo.png',
  },
  permissions: ['activeTab', 'history', 'storage'],
  host_permissions: ['http://localhost:8000/*'],
  content_scripts: [
    {
      js: isDev
        ? ['src/content/index.dev.tsx']
        : ['src/content/index.prod.tsx'],
      matches: ['<all_urls>'],
    },
  ],
  web_accessible_resources: [
    {
      resources: ['*.js', '*.css', 'public/*', 'src/assets/images/logo.png'],
      matches: ['<all_urls>'],
    },
  ],
});
