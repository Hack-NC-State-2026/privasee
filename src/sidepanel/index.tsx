import '@assets/styles/pages.css';

import { createRoot } from 'react-dom/client';

import SidePanel from './SidePanel';

const container = document.getElementById('my-ext-side-panel');
if (!container) {
  throw new Error('Side panel mount root not found.');
}

createRoot(container).render(<SidePanel />);
