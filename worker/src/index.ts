import { MazeRoom } from "./room";

// Re-export the Durable Object class
export { MazeRoom };

interface Env {
  MAZE_ROOM: DurableObjectNamespace;
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // POST /api/rooms — create room
    if (path === "/api/rooms" && request.method === "POST") {
      const roomCode = String(Math.floor(100000 + Math.random() * 900000));
      const id = env.MAZE_ROOM.idFromName(roomCode);
      const stub = env.MAZE_ROOM.get(id);
      // Initialize the room by sending a setup request
      await stub.fetch(new Request("https://dummy/setup", {
        method: "POST",
        body: JSON.stringify({ roomCode }),
      }));
      return jsonResponse({ roomCode });
    }

    // Room-specific routes: /api/rooms/:code/...
    const roomMatch = path.match(/^\/api\/rooms\/(\d{6})(\/.*)?$/);
    if (roomMatch) {
      const roomCode = roomMatch[1]!;
      const subPath = roomMatch[2] || "";
      const id = env.MAZE_ROOM.idFromName(roomCode);
      const stub = env.MAZE_ROOM.get(id);

      // GET /api/rooms/:code — room info
      if (!subPath && request.method === "GET") {
        const res = await stub.fetch(new Request("https://dummy/info"));
        const data = await res.json();
        return jsonResponse(data);
      }

      // POST /api/rooms/:code/quickleave — quick leave (sendBeacon)
      if (subPath === "/quickleave" && request.method === "POST") {
        const body = await request.text();
        await stub.fetch(new Request("https://dummy/quickleave", {
          method: "POST",
          body,
        }));
        return jsonResponse({ ok: true });
      }

      // GET /api/rooms/:code/ws — WebSocket upgrade
      if (subPath === "/ws" && request.headers.get("Upgrade") === "websocket") {
        return stub.fetch(request);
      }
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};
