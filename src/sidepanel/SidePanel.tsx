import { JSX } from 'react';

export default function SidePanel(): JSX.Element {
  return (
    <div id='my-ext' className='container p-4' data-theme='light'>
      <h1 className='text-xl font-bold'>Extension Side Panel</h1>
      <p className='mt-2 text-sm'>This is the initial side panel page.</p>
    </div>
  );
}
