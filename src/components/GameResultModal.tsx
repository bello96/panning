interface GameResultModalProps {
  winnerId: string | null;
  winnerName: string;
  myId: string;
  reason: "gold" | "timeout" | "disconnect" | "surrender";
  isOwner: boolean;
  gameDuration: number; // 秒
  onPlayAgain: () => void;
  onLeave: () => void;
  onClose: () => void;
}

function reasonText(reason: string): string {
  if (reason === "gold") { return "找到金子"; }
  if (reason === "timeout") { return "时间到"; }
  if (reason === "surrender") { return "投降"; }
  return "对手断线";
}

export default function GameResultModal({
  winnerId,
  winnerName,
  myId,
  reason,
  isOwner,
  onPlayAgain,
  onLeave,
  onClose,
  gameDuration,
}: GameResultModalProps) {
  const isDraw = winnerId === null;
  const isWinner = !isDraw && winnerId === myId;

  const resultText = isDraw ? "平局!" : isWinner ? "你赢了!" : "你输了!";
  const resultColor = isDraw ? "#f59e0b" : isWinner ? "#10b981" : "#ef4444";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      <div
        style={{
          position: "relative",
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          padding: "40px 48px",
          minWidth: "320px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
          textAlign: "center",
        }}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "12px",
            right: "12px",
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            border: "none",
            backgroundColor: "#f3f4f6",
            color: "#6b7280",
            fontSize: "16px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#e5e7eb")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#f3f4f6")}
        >
          &times;
        </button>

        {/* 结果标题 */}
        <div
          style={{
            fontSize: "48px",
            fontWeight: "900",
            color: resultColor,
            lineHeight: 1,
          }}
        >
          {resultText}
        </div>

        {/* 原因 + 用时 */}
        <div style={{ color: "#6b7280", fontSize: "16px" }}>
          {reasonText(reason)}
        </div>
        <div style={{ color: "#9ca3af", fontSize: "13px" }}>
          用时 {String(Math.floor(gameDuration / 60)).padStart(2, "0")}:{String(gameDuration % 60).padStart(2, "0")}
        </div>

        {/* 获胜者信息（非平局时显示） */}
        {!isDraw && (
          <div
            style={{
              color: "#374151",
              fontSize: "14px",
              backgroundColor: "#f3f4f6",
              padding: "8px 16px",
              borderRadius: "8px",
            }}
          >
            {isWinner ? "恭喜你击败了对手!" : (
              <>
                获胜者：
                <span style={{ color: "#6366f1", fontWeight: "bold" }}>
                  {winnerName}
                </span>
              </>
            )}
          </div>
        )}

        {/* 按钮区域 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            marginTop: "8px",
            width: "100%",
          }}
        >
          {isOwner ? (
            <>
              <button
                onClick={onPlayAgain}
                style={{
                  padding: "12px 24px",
                  fontSize: "16px",
                  fontWeight: "bold",
                  backgroundColor: "#6366f1",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                再来一局
              </button>
              <button
                onClick={onLeave}
                style={{
                  padding: "10px 24px",
                  fontSize: "14px",
                  fontWeight: "bold",
                  backgroundColor: "#f3f4f6",
                  color: "#4b5563",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                离开房间
              </button>
            </>
          ) : (
            <>
              <div
                style={{
                  color: "#6b7280",
                  fontSize: "14px",
                  padding: "10px",
                  backgroundColor: "#f3f4f6",
                  borderRadius: "8px",
                }}
              >
                等待房主操作...
              </div>
              <button
                onClick={onLeave}
                style={{
                  padding: "10px 24px",
                  fontSize: "14px",
                  fontWeight: "bold",
                  backgroundColor: "#f3f4f6",
                  color: "#4b5563",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  cursor: "pointer",
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                离开房间
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
