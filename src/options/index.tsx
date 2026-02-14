import '@assets/styles/pages.css';

import { createRoot } from 'react-dom/client';

import Options from './Options';

const container = document.getElementById('my-ext-options-page');
if (!container) {
  throw new Error('Options page mount root not found.');
}

createRoot(container).render(<Options />);
