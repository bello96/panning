import { useEffect, useState } from "react";

interface CountdownOverlayProps {
  gameStartsAt: number;
  onDone: () => void;
}

type CountdownLabel = "3" | "2" | "1" | "GO!";

export default function CountdownOverlay({ gameStartsAt, onDone }: CountdownOverlayProps) {
  const [label, setLabel] = useState<CountdownLabel | null>(null);
  const [key, setKey] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let rafId: number;
    let goShownAt: number | null = null;

    const tick = () => {
      const now = Date.now();
      const msLeft = gameStartsAt - now;

      if (msLeft > 3000) {
        setLabel("3");
      } else if (msLeft > 2000) {
        updateLabel("3");
      } else if (msLeft > 1000) {
        updateLabel("2");
      } else if (msLeft > 0) {
        updateLabel("1");
      } else {
        // msLeft <= 0: show GO! briefly then call onDone
        if (goShownAt === null) {
          goShownAt = now;
          setLabel((prev) => {
            if (prev !== "GO!") { setKey((k) => k + 1); }
            return "GO!";
          });
        } else if (now - goShownAt >= 800) {
          setDone(true);
          return;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    let prevLabel: CountdownLabel | null = null;

    function updateLabel(next: CountdownLabel) {
      if (prevLabel !== next) {
        prevLabel = next;
        setLabel(next);
        setKey((k) => k + 1);
      }
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [gameStartsAt]);

  useEffect(() => {
    if (done) {
      onDone();
    }
  }, [done, onDone]);

  if (done) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(10, 10, 35, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        key={key}
        style={{
          fontSize: label === "GO!" ? "96px" : "128px",
          fontWeight: "900",
          color: "#ffffff",
          textShadow:
            "0 0 40px #4cc9f0, 0 0 80px #4cc9f0, 0 4px 20px rgba(0,0,0,0.8)",
          animation: "countdown-pop 0.5s ease-out forwards",
          userSelect: "none",
        }}
      >
        {label}
      </div>

      <style>{`
        @keyframes countdown-pop {
          0% {
            transform: scale(0.3);
            opacity: 0;
          }
          40% {
            transform: scale(1.15);
            opacity: 1;
          }
          70% {
            transform: scale(0.95);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 0.9;
          }
        }
      `}</style>
    </div>
  );
}
