import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../types/protocol";

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}

const PLAYER_COLORS = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#f97316",
  "#8b5cf6",
];

function getPlayerColor(playerId: string, messages: ChatMessage[]): string {
  const playerIds: string[] = [];
  for (const msg of messages) {
    if (msg.kind === "chat" && !playerIds.includes(msg.playerId)) {
      playerIds.push(msg.playerId);
    }
  }
  const idx = playerIds.indexOf(playerId);
  return PLAYER_COLORS[(idx >= 0 ? idx : 0) % PLAYER_COLORS.length]!;
}

export default function ChatPanel({ messages, onSend, onFocus, onBlur }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = () => {
    if (!input.trim()) {
      return;
    }
    onSend(input.trim());
    setInput("");
  };

  return (
    <div
      style={{
        width: "288px",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "#ffffff",
        borderLeft: "1px solid #e5e7eb",
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid #e5e7eb",
          flexShrink: 0,
        }}
      >
        <h3 style={{ color: "#4f46e5", fontWeight: "bold", fontSize: "14px", margin: 0 }}>
          聊天
        </h3>
      </div>

      {/* 消息列表 */}
      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px",
          backgroundColor: "#f9fafb",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.kind === "system" ? (
              <div
                style={{
                  textAlign: "center",
                  fontSize: "12px",
                  color: "#9ca3af",
                  fontStyle: "italic",
                  padding: "2px 0",
                }}
              >
                {msg.text}
              </div>
            ) : (
              <div style={{ fontSize: "13px", lineHeight: "1.4" }}>
                <span
                  style={{
                    color: getPlayerColor(msg.playerId, messages),
                    fontWeight: "bold",
                  }}
                >
                  {msg.playerName}
                </span>
                <span style={{ color: "#9ca3af", margin: "0 4px" }}>:</span>
                <span style={{ color: "#374151" }}>{msg.text}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 输入区域 */}
      <div
        style={{
          padding: "8px 10px",
          borderTop: "1px solid #e5e7eb",
          display: "flex",
          gap: "6px",
          flexShrink: 0,
          backgroundColor: "#ffffff",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="发送消息..."
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSubmit();
            } else if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={{
            flex: 1,
            padding: "6px 10px",
            fontSize: "13px",
            backgroundColor: "#ffffff",
            color: "#374151",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            outline: "none",
          }}
        />
        <button
          onClick={handleSubmit}
          style={{
            padding: "6px 12px",
            fontSize: "13px",
            backgroundColor: "#6366f1",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold",
            flexShrink: 0,
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
