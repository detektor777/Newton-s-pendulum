import { useEffect, useMemo, useRef, useState } from "react";

const RADIUS = 26;
const DEFAULT_ROPE_LENGTH = 170;
const MIN_ROPE_LENGTH = 120;
const MAX_ROPE_LENGTH = 240;
const DEFAULT_GAP = 0;
const MIN_GAP = 0;
const MAX_GAP = 40;
const TOP_Y = 90;
const DEFAULT_GRAVITY = 2000;
const MIN_GRAVITY = 900;
const MAX_GRAVITY = 3400;
const DAMPING = 0.9988;

type BallState = {
  angle: number;
  angularVelocity: number;
  isDragging: boolean;
  dragAngle: number;
};

type Size = {
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const createInitialBalls = (count: number): BallState[] =>
  Array.from({ length: count }, () => ({
    angle: 0,
    angularVelocity: 0,
    isDragging: false,
    dragAngle: 0,
  }));

const COLOR_PALETTE = ["#f25f5c", "#70c1b3", "#247ba0", "#ffe066", "#b388eb"];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const ballsRef = useRef<BallState[]>(createInitialBalls(5));
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastHitRef = useRef(0);
  const [size, setSize] = useState<Size>({ width: window.innerWidth, height: window.innerHeight });
  const [ballCount, setBallCount] = useState(5);
  const [ropeLength, setRopeLength] = useState(DEFAULT_ROPE_LENGTH);
  const [gap, setGap] = useState(DEFAULT_GAP);
  const [gravity, setGravity] = useState(DEFAULT_GRAVITY);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const draggingIndexRef = useRef<number | null>(null);
  const collisionDistance = useMemo(() => RADIUS * 2, []);
  const spacing = useMemo(() => RADIUS * 2 + gap, [gap]);
  const HOLDER_OFFSET_X = 120; 

  const resetBalls = (count = ballCount) => {
    ballsRef.current = createInitialBalls(count);
    draggingIndexRef.current = null;
  };

  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const playCollisionSound = (intensity: number) => {
    if (!soundEnabled) return;
    const now = performance.now();
    if (now - lastHitRef.current < 28) return;
    lastHitRef.current = now;

    const audioContext = ensureAudioContext();
    const currentTime = audioContext.currentTime;

    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0.0001, currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.08 + intensity * 0.1, currentTime + 0.008);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, currentTime + 0.07);

    const noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.04, audioContext.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i += 1) {
      noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseData.length);
    }

    const noiseSource = audioContext.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 880 + intensity * 220;
    bandpass.Q.value = 2.8;

    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 2600;

    noiseSource.connect(bandpass).connect(lowpass).connect(gainNode).connect(audioContext.destination);

    noiseSource.start(currentTime);
    noiseSource.stop(currentTime + 0.07);
  };

  useEffect(() => {
    const handleResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    resetBalls(ballCount);
  }, [ballCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const centerX = size.width / 2 +HOLDER_OFFSET_X;
    const floorY = TOP_Y + ropeLength + RADIUS + 50;
    const fixedStep = 1 / 120;
    let lastTime = performance.now();
    let accumulator = 0;

    const drawBall = (x: number, y: number, color: string) => {
      context.save();
      context.translate(x, y);

      context.fillStyle = color;
      context.beginPath();
      context.arc(0, 0, RADIUS, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "rgba(255, 255, 255, 0.4)";
      context.beginPath();
      context.arc(-RADIUS * 0.3, -RADIUS * 0.35, RADIUS * 0.45, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = "#a2a4a8";
      context.lineWidth = 1.4;
      context.beginPath();
      context.arc(0, 0, RADIUS - 0.4, 0, Math.PI * 2);
      context.stroke();

      context.restore();
    };

    const stepPhysics = (dt: number) => {
      const balls = ballsRef.current.map((ball) => ({ ...ball }));
      const anchorX = (index: number) => centerX + (index - (ballCount - 1) / 2) * spacing;
      const dragIndex = balls.findIndex((ball) => ball.isDragging);
      const hasDragging = dragIndex >= 0;

      for (let i = 0; i < balls.length; i += 1) {
        const ball = balls[i];
        if (ball.isDragging) {
          ball.angle = ball.dragAngle;
          ball.angularVelocity = 0;
          continue;
        }
        if (hasDragging) {
          ball.angularVelocity = 0;
          continue;
        }
        const angularAcceleration = -(gravity / ropeLength) * Math.sin(ball.angle);
        ball.angularVelocity += angularAcceleration * dt;
        ball.angularVelocity *= DAMPING;
        ball.angle += ball.angularVelocity * dt;
      }

      const xPositions = balls.map((ball, index) => {
        const angle = ball.isDragging ? ball.dragAngle : ball.angle;
        return anchorX(index) + Math.sin(angle) * ropeLength;
      });

      if (dragIndex >= 0) {
        const sinValue = clamp((xPositions[dragIndex] - anchorX(dragIndex)) / ropeLength, -1, 1);
        balls[dragIndex].dragAngle = Math.asin(sinValue);
        balls[dragIndex].angle = balls[dragIndex].dragAngle;
      }

      const velocities = balls.map((ball) => {
        if (ball.isDragging || hasDragging) return 0;
        return ball.angularVelocity * ropeLength * Math.cos(ball.angle);
      });

      if (!hasDragging) {
        for (let pass = 0; pass < 3; pass += 1) {
          for (let i = 0; i < ballCount - 1; i += 1) {
            const dx = xPositions[i + 1] - xPositions[i];
            if (dx < collisionDistance) {
              const overlap = collisionDistance - dx;
              xPositions[i] -= overlap * 0.5;
              xPositions[i + 1] += overlap * 0.5;

              if (velocities[i] > velocities[i + 1]) {
                const intensity = Math.min(Math.abs(velocities[i] - velocities[i + 1]) / 500, 1);
                const temp = velocities[i];
                velocities[i] = velocities[i + 1];
                velocities[i + 1] = temp;
                playCollisionSound(intensity);
              }
            }
          }
        }
      }

      const constraintPasses = hasDragging ? 12 : 4;
      for (let pass = 0; pass < constraintPasses; pass += 1) {
        for (let i = 0; i < ballCount - 1; i += 1) {
          const dx = xPositions[i + 1] - xPositions[i];
          if (dx < collisionDistance) {
            const overlap = collisionDistance - dx;
            if (i === dragIndex) {
              xPositions[i + 1] += overlap;
            } else if (i + 1 === dragIndex) {
              xPositions[i] -= overlap;
            } else {
              xPositions[i] -= overlap * 0.5;
              xPositions[i + 1] += overlap * 0.5;
            }
          }
        }
      }

      for (let i = 0; i < ballCount; i += 1) {
        const ball = balls[i];
        const sinValue = clamp((xPositions[i] - anchorX(i)) / ropeLength, -1, 1);
        const newAngle = Math.asin(sinValue);
        if (!ball.isDragging) {
          if (hasDragging) {
            ball.angularVelocity = 0;
          } else {
            const cosValue = Math.cos(newAngle);
            const safeCos = Math.abs(cosValue) < 0.08 ? 0.08 * Math.sign(cosValue || 1) : cosValue;
            ball.angularVelocity = velocities[i] / (ropeLength * safeCos);
          }
        }
        ball.angle = newAngle;
      }

      ballsRef.current = balls;
    };

    const render = (time: number) => {
      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      accumulator += delta;
      while (accumulator >= fixedStep) {
        stepPhysics(fixedStep);
        accumulator -= fixedStep;
      }

      const balls = ballsRef.current;
      context.clearRect(0, 0, size.width, size.height);

      context.fillStyle = "#f5f5ef";
      context.fillRect(0, 0, size.width, size.height);

      context.fillStyle = "#e7e5df";
      context.fillRect(0, size.height * 0.65, size.width, size.height * 0.35);

      context.strokeStyle = "#a2a4a8";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(centerX - spacing * 2.6, TOP_Y);
      context.lineTo(centerX + spacing * 2.6, TOP_Y);
      context.stroke();

      context.strokeStyle = "#a2a4a8";
      context.lineWidth = 6;
      context.beginPath();
      context.moveTo(centerX - spacing * 2.8, TOP_Y - 16);
      context.lineTo(centerX + spacing * 2.8, TOP_Y - 16);
      context.stroke();

      context.fillStyle = "rgba(120, 122, 124, 0.22)";
      context.beginPath();
      context.ellipse(centerX, floorY, spacing * 3.1, RADIUS * 1.05, 0, 0, Math.PI * 2);
      context.fill();

      const positions = balls.map((ball, index) => {
        const anchorX = centerX + (index - (ballCount - 1) / 2) * spacing;
        const anchorY = TOP_Y;
        const angle = ball.isDragging ? ball.dragAngle : ball.angle;
        const x = anchorX + Math.sin(angle) * ropeLength;
        const y = anchorY + Math.cos(angle) * ropeLength;
        return { x, y, anchorX, anchorY, angle };
      });

      positions.forEach((pos) => {
        context.strokeStyle = "#a2a4a8";
        context.lineWidth = 0.9;
        context.beginPath();
        context.moveTo(pos.anchorX, pos.anchorY);
        context.lineTo(pos.x, pos.y);
        context.stroke();
      });

      positions.forEach((pos, index) => {
        const shadowAlpha = 0.18 - Math.abs(Math.sin(pos.angle)) * 0.08;
        context.fillStyle = `rgba(120, 122, 124, ${shadowAlpha})`;
        context.beginPath();
        context.ellipse(pos.x, floorY, RADIUS * 0.9, RADIUS * 0.35, 0, 0, Math.PI * 2);
        context.fill();
        drawBall(pos.x, pos.y, COLOR_PALETTE[index % COLOR_PALETTE.length]);
      });

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [size, ballCount, collisionDistance, spacing, ropeLength, soundEnabled, gravity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handlePointerDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      const centerX = size.width / 2+HOLDER_OFFSET_X;

      let closestIndex: number | null = null;
      let closestDistance = Infinity;

      ballsRef.current.forEach((ball, index) => {
        const anchorX = centerX + (index - (ballCount - 1) / 2) * spacing;
        const angle = ball.isDragging ? ball.dragAngle : ball.angle;
        const x = anchorX + Math.sin(angle) * ropeLength;
        const y = TOP_Y + Math.cos(angle) * ropeLength;
        const distance = Math.hypot(pointerX - x, pointerY - y);
        if (distance < RADIUS * 1.2 && distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      if (closestIndex !== null) {
        draggingIndexRef.current = closestIndex;
        ballsRef.current = ballsRef.current.map((ball, index) =>
          index === closestIndex
            ? {
                ...ball,
                isDragging: true,
                dragAngle: ball.angle,
                angularVelocity: 0,
              }
            : ball
        );
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (draggingIndexRef.current === null) return;
      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      const centerX = size.width / 2+HOLDER_OFFSET_X;
      const index = draggingIndexRef.current;
      const anchorX = centerX + (index - (ballCount - 1) / 2) * spacing;
      const anchorY = TOP_Y;
      const dx = pointerX - anchorX;
      const dy = pointerY - anchorY;
      const angle = Math.atan2(dx, dy);
      const clampedAngle = clamp(angle, -1.2, 1.2);

      ballsRef.current = ballsRef.current.map((ball, idx) =>
        idx === index
          ? {
              ...ball,
              isDragging: true,
              dragAngle: clampedAngle,
              angularVelocity: 0,
            }
          : ball
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (draggingIndexRef.current === null) return;
      const index = draggingIndexRef.current;
      draggingIndexRef.current = null;
      ballsRef.current = ballsRef.current.map((ball, idx) =>
        idx === index
          ? {
              ...ball,
              isDragging: false,
              angle: ball.dragAngle,
              angularVelocity: 0,
            }
          : ball
      );
      canvas.releasePointerCapture?.(event.pointerId);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [size.width, ballCount, spacing, ropeLength]);

  useEffect(() => {
    ballsRef.current = ballsRef.current.map((ball) => ({ ...ball, isDragging: false }));
  }, [size.width]);

  return (
    <div className="relative min-h-screen w-full bg-[#f5f5ef]">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      <div className="pointer-events-auto absolute left-6 top-6 flex w-[250px] flex-col gap-4 rounded-2xl border border-[#c4c7cc] bg-white p-4 text-sm text-[#2b2f33] shadow-[0_14px_28px_rgba(64,74,82,0.12)]">
        <div className="text-[11px] uppercase tracking-[0.3em] text-[#7a7f85]">Controls</div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Ball count</span>
          <select
            className="rounded-lg border border-[#c4c7cc] bg-white px-3 py-1.5 text-sm text-[#2b2f33] focus:outline-none"
            value={ballCount}
            onChange={(event) => setBallCount(Number(event.target.value))}
          >
            {[2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">String length</span>
            <span className="text-xs text-[#7a7f85]">{ropeLength}px</span>
          </div>
          <input
            type="range"
            min={MIN_ROPE_LENGTH}
            max={MAX_ROPE_LENGTH}
            value={ropeLength}
            onChange={(event) => setRopeLength(Number(event.target.value))}
            className="h-2 w-full cursor-pointer accent-[#247ba0]"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Initial spacing</span>
            <span className="text-xs text-[#7a7f85]">{gap}px</span>
          </div>
          <input
            type="range"
            min={MIN_GAP}
            max={MAX_GAP}
            value={gap}
            onChange={(event) => setGap(Number(event.target.value))}
            className="h-2 w-full cursor-pointer accent-[#247ba0]"
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Gravity</span>
            <span className="text-xs text-[#7a7f85]">{gravity} px/s²</span>
          </div>
          <input
            type="range"
            min={MIN_GRAVITY}
            max={MAX_GRAVITY}
            step={50}
            value={gravity}
            onChange={(event) => setGravity(Number(event.target.value))}
            className="h-2 w-full cursor-pointer accent-[#247ba0]"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Collision sound</span>
          <button
            type="button"
            className="rounded-lg border border-[#c4c7cc] bg-white px-3 py-1.5 text-sm font-medium text-[#2b2f33]"
            onClick={() => setSoundEnabled((prev) => !prev)}
          >
            {soundEnabled ? "On" : "Off"}
          </button>
        </div>
        <button
          type="button"
          className="rounded-xl border border-[#c4c7cc] bg-[#f2d782] px-4 py-2 text-sm font-semibold text-[#2b2f33] transition hover:translate-y-0.5 hover:bg-[#f0c964]"
          onClick={() => resetBalls(ballCount)}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
