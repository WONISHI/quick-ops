import React, { useEffect, useMemo, useRef, useState } from 'react';
import spriteSheet from '../../assets/pets/spritesheet.webp';
import styles from './index.module.css';

type PetAction = 'idle' | 'walk' | 'wave' | 'sleep';

interface SpriteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FloatingPetProps {
  visible?: boolean;
  scale?: number;
}

const SPRITE_FRAMES: Record<PetAction, SpriteFrame[]> = {
  idle: [
    { x: 0, y: 0, w: 120, h: 140 },
    { x: 150, y: 0, w: 120, h: 140 },
    { x: 300, y: 0, w: 120, h: 140 },
    { x: 450, y: 0, w: 120, h: 140 },
    { x: 600, y: 0, w: 120, h: 140 },
    { x: 750, y: 0, w: 120, h: 140 },
  ],

  walk: [
    { x: 0, y: 150, w: 120, h: 140 },
    { x: 150, y: 150, w: 120, h: 140 },
    { x: 300, y: 150, w: 120, h: 140 },
    { x: 450, y: 150, w: 120, h: 140 },
    { x: 600, y: 150, w: 120, h: 140 },
    { x: 750, y: 150, w: 120, h: 140 },
    { x: 900, y: 150, w: 120, h: 140 },
  ],

  wave: [
    { x: 0, y: 450, w: 120, h: 140 },
    { x: 150, y: 450, w: 120, h: 140 },
    { x: 300, y: 450, w: 120, h: 140 },
    { x: 450, y: 450, w: 120, h: 140 },
  ],

  sleep: [
    { x: 600, y: 750, w: 120, h: 140 },
    { x: 750, y: 750, w: 120, h: 140 },
    { x: 900, y: 750, w: 120, h: 140 },
  ],
};

const ACTION_TEXT: Record<PetAction, string> = {
  idle: '待机中',
  walk: '巡逻中',
  wave: '你好呀',
  sleep: '休息一下',
};

const ACTION_DURATION: Record<PetAction, number> = {
  idle: 180,
  walk: 120,
  wave: 140,
  sleep: 220,
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

export default function FloatingPet(props: FloatingPetProps) {
  const { visible = true, scale = 0.7 } = props;

  const [hidden, setHidden] = useState(false);
  const [action, setAction] = useState<PetAction>('idle');
  const [frameIndex, setFrameIndex] = useState(0);
  const [showBubble, setShowBubble] = useState(false);
  const [facingLeft, setFacingLeft] = useState(true);

  const frames = SPRITE_FRAMES[action];
  const frame = frames[frameIndex % frames.length];

  const width = frame.w * scale;
  const height = frame.h * scale;

  const [position, setPosition] = useState(() => ({
    x: Math.max(16, window.innerWidth - width - 24),
    y: Math.max(16, window.innerHeight - height - 24),
  }));

  const dragRef = useRef({
    dragging: false,
    moved: false,
    offsetX: 0,
    offsetY: 0,
  });

  const actionTimerRef = useRef<number | null>(null);

  const clearActionTimer = () => {
    if (actionTimerRef.current) {
      window.clearTimeout(actionTimerRef.current);
      actionTimerRef.current = null;
    }
  };

  const playAction = (nextAction: PetAction, duration = 1800) => {
    clearActionTimer();

    setAction(nextAction);
    setFrameIndex(0);
    setShowBubble(true);

    actionTimerRef.current = window.setTimeout(() => {
      setAction('idle');
      setFrameIndex(0);
    }, duration);
  };

  useEffect(() => {
    if (!visible || hidden) return;

    const timer = window.setInterval(() => {
      setFrameIndex((prev) => prev + 1);
    }, ACTION_DURATION[action]);

    return () => {
      window.clearInterval(timer);
    };
  }, [action, visible, hidden]);

  useEffect(() => {
    if (!visible || hidden) return;

    const timer = window.setInterval(() => {
      const random = Math.random();

      if (random < 0.55) {
        playAction('idle', 1400);
      } else if (random < 0.8) {
        setFacingLeft((prev) => !prev);

        setPosition((prev) => ({
          ...prev,
          x: clamp(prev.x + (Math.random() > 0.5 ? 80 : -80), 12, window.innerWidth - width - 12),
        }));

        playAction('walk', 1600);
      } else if (random < 0.94) {
        playAction('wave', 1600);
      } else {
        playAction('sleep', 2200);
      }
    }, 6000);

    return () => {
      window.clearInterval(timer);
      clearActionTimer();
    };
  }, [visible, hidden, width]);

  useEffect(() => {
    if (!showBubble) return;

    const timer = window.setTimeout(() => {
      setShowBubble(false);
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showBubble, action]);

  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => ({
        x: clamp(prev.x, 12, window.innerWidth - width - 12),
        y: clamp(prev.y, 12, window.innerHeight - height - 12),
      }));
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [width, height]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;

    dragRef.current.dragging = true;
    dragRef.current.moved = false;
    dragRef.current.offsetX = event.clientX - position.x;
    dragRef.current.offsetY = event.clientY - position.y;

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;

    dragRef.current.moved = true;

    setPosition({
      x: clamp(event.clientX - dragRef.current.offsetX, 12, window.innerWidth - width - 12),
      y: clamp(event.clientY - dragRef.current.offsetY, 12, window.innerHeight - height - 12),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.dragging = false;

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePetClick = () => {
    if (dragRef.current.moved) return;

    playAction('wave', 1600);
  };

  const spriteStyle = useMemo<React.CSSProperties>(() => {
    return {
      width: `${width}px`,
      height: `${height}px`,
      backgroundImage: `url(${spriteSheet})`,
      backgroundPosition: `-${frame.x * scale}px -${frame.y * scale}px`,
      backgroundSize: `auto`,
      transform: facingLeft ? 'scaleX(1)' : 'scaleX(-1)',
    };
  }, [frame.x, frame.y, width, height, scale, facingLeft]);

  if (!visible || hidden) return null;

  return (
    <div
      className={styles['floating-pet']}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handlePetClick}
    >
      {showBubble && <div className={styles['pet-bubble']}>{ACTION_TEXT[action]}</div>}

      <button
        className={styles['pet-close-btn']}
        title="隐藏小助手"
        onClick={(event) => {
          event.stopPropagation();
          setHidden(true);
        }}
      >
        ×
      </button>

      <div className={styles['pet-sprite-window']}>
        <div className={styles['pet-sprite']} style={spriteStyle} />
      </div>
    </div>
  );
}