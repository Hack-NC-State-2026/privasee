import React, { JSX, useCallback, useEffect, useRef, useState } from 'react';

const FLOATING_SIZE = 48;
const VIEWPORT_MARGIN = 16;
const DEFAULT_X = window.innerWidth - FLOATING_SIZE - VIEWPORT_MARGIN;
const DEFAULT_Y = 16;
const DRAG_THRESHOLD = 12;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const getMaxX = (): number =>
  window.innerWidth - FLOATING_SIZE - VIEWPORT_MARGIN;
const getMaxY = (): number =>
  window.innerHeight - FLOATING_SIZE - VIEWPORT_MARGIN;

export default function Content(): JSX.Element {
  const [position, setPosition] = useState({ x: DEFAULT_X, y: DEFAULT_Y });
  const [isDragging, setIsDragging] = useState(false);
  const didDragRef = useRef(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    pointerId: number;
  } | null>(null);

  const openBrowserSidePanel = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  }, []);

  const finalizePointerInteraction = useCallback(
    (pointerId: number) => {
      const dragSession = dragRef.current;
      if (!dragSession || dragSession.pointerId !== pointerId) return;

      const didDrag = didDragRef.current;
      dragRef.current = null;
      didDragRef.current = false;
      setIsDragging(false);

      if (!didDrag) {
        openBrowserSidePanel();
      }
    },
    [openBrowserSidePanel]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const dragSession = dragRef.current;
      if (!dragSession || dragSession.pointerId !== e.pointerId) return;

      const dx = e.clientX - dragSession.startX;
      const dy = e.clientY - dragSession.startY;
      const overThreshold =
        Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD;
      if (overThreshold) {
        didDragRef.current = true;
        setIsDragging(true);
      }
      if (didDragRef.current) {
        setPosition({
          x: clamp(dragSession.originX + dx, VIEWPORT_MARGIN, getMaxX()),
          y: clamp(dragSession.originY + dy, VIEWPORT_MARGIN, getMaxY()),
        });
      }
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      didDragRef.current = false;
      setIsDragging(false);

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: position.x,
        originY: position.y,
        pointerId: e.pointerId,
      };
    },
    [position]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      finalizePointerInteraction(e.pointerId);
    },
    [finalizePointerInteraction]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      finalizePointerInteraction(e.pointerId);
    },
    [finalizePointerInteraction]
  );

  const handleLostPointerCapture = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      finalizePointerInteraction(e.pointerId);
    },
    [finalizePointerInteraction]
  );

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => ({
        x: clamp(current.x, VIEWPORT_MARGIN, getMaxX()),
        y: clamp(current.y, VIEWPORT_MARGIN, getMaxY()),
      }));
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      dragRef.current = null;
      didDragRef.current = false;
    };
  }, []);

  return (
    <div id='my-ext' data-theme='light'>
      <button
        type='button'
        aria-label='Open extension side panel'
        className='flex h-12 w-12 items-center justify-center rounded-full border-none bg-primary text-primary-content shadow-lg transition-shadow hover:shadow-xl'
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          pointerEvents: 'auto',
          zIndex: 2147483647,
          cursor: isDragging ? 'grabbing' : 'pointer',
          touchAction: 'none',
          userSelect: 'none',
        }}
        draggable={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
        title='Click to open side panel'
      >
        <svg
          xmlns='http://www.w3.org/2000/svg'
          viewBox='0 0 24 24'
          fill='currentColor'
          className='h-6 w-6'
        >
          <path d='M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z' />
        </svg>
      </button>
    </div>
  );
}
