import React, { JSX, useCallback, useEffect, useRef, useState } from 'react';
import browser from 'webextension-polyfill';

const LOGO_PATH = 'src/assets/images/logo.png';

const FLOATING_SIZE = 64;
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
        className='flex h-16 w-16 items-center justify-center rounded-full border-none bg-primary text-primary-content shadow-lg transition-shadow hover:shadow-xl'
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
        <img
          src={browser.runtime.getURL(LOGO_PATH)}
          alt='Extension'
          className='h-10 w-10 object-contain'
        />
      </button>
    </div>
  );
}
