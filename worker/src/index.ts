import { MazeRoom } from "./room";

// Re-export the Durable Object class
export { MazeRoom };

interface Env {
  MAZE_ROOM: DurableObjectNamespace;
}

const ALLOWED_ORIGINS = [
  "https://panning.dengjiabei.cn",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
];

function corsHeaders(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]!;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function jsonResponse(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get("Origin");

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // POST /api/rooms — create room
    if (path === "/api/rooms" && request.method === "POST") {
      const roomCode = String(Math.floor(100000 + Math.random() * 900000));
      const id = env.MAZE_ROOM.idFromName(roomCode);
      const stub = env.MAZE_ROOM.get(id);
      // Initialize the room by sending a setup request
      const setupRes = await stub.fetch(new Request("https://dummy/setup", {
        method: "POST",
        body: JSON.stringify({ roomCode }),
      }));
      if (!setupRes.ok) {
        return jsonResponse({ error: "failed to create room" }, 500, origin);
      }
      return jsonResponse({ roomCode }, 200, origin);
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
        // 透传 DO 的 status（200 / 404），并 attach CORS 头
        const data = await res.json().catch(() => ({ error: "invalid response" }));
        return jsonResponse(data, res.status, origin);
      }

      // POST /api/rooms/:code/quickleave — quick leave (sendBeacon)
      if (subPath === "/quickleave" && request.method === "POST") {
        const body = await request.text();
        await stub.fetch(new Request("https://dummy/quickleave", {
          method: "POST",
          body,
        }));
        return jsonResponse({ ok: true }, 200, origin);
      }

      // GET /api/rooms/:code/ws — WebSocket upgrade
      if (subPath === "/ws" && request.headers.get("Upgrade") === "websocket") {
        return stub.fetch(request);
      }
    }

    return jsonResponse({ error: "Not found" }, 404, origin);
  },
};
