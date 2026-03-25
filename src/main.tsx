import { install } from "@twind/core";
import presetAutoprefix from "@twind/preset-autoprefix";
import presetTailwind from "@twind/preset-tailwind";
import { createRoot } from "react-dom/client";
import App from "./App";

install({
  presets: [presetAutoprefix(), presetTailwind()],
  theme: {
    extend: {
      colors: {
        "game-bg": "#1a1a2e",
        "game-dark": "#0a0a23",
        "game-panel": "#16213e",
        "player-a": "#4cc9f0",
        "player-b": "#f72585",
        gold: "#ffd700",
      },
    },
  },
});

createRoot(document.getElementById("root")!).render(<App />);
