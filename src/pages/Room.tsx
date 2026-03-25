export default function Room({ roomCode: _roomCode, nickname: _nickname, playerId: _playerId, onLeave: _onLeave }: {
  roomCode: string; nickname: string; playerId: string; onLeave: () => void;
}) {
  return <div className="h-screen bg-[#1a1a2e] text-white flex items-center justify-center">Loading room...</div>;
}
