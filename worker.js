export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] !== "room" || !parts[1]) {
      return new Response("Not found", { status: 404 });
    }

    const roomId = parts[1];
    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  }
};

export class Room {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    const name = url.searchParams.get("name") || "Anonymous";
    const userId = url.searchParams.get("userId") || crypto.randomUUID();

    for (const ws of this.state.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att && att.userId === userId) {
        try { ws.close(1000, "Reconnecting"); } catch {}
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ name, userId });

    this.broadcast({ type: "joined", user: name }, server);
    this.broadcastMembers();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    try {
      const msg = JSON.parse(message);
      this.broadcast(msg, ws);
    } catch {}
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    if (att) {
      this.broadcast({ type: "left", user: att.name }, ws);
    }
    this.broadcastMembers(ws);
  }

  async webSocketError(ws) {
    this.webSocketClose(ws);
  }

  broadcastMembers(excludeWs = null) {
    const members = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws === excludeWs || ws.readyState !== WebSocket.OPEN) continue;
      const att = ws.deserializeAttachment();
      if (att) members.push(att.name);
    }
    this.broadcast({ type: "members", members }, excludeWs);
  }

  broadcast(msg, excludeWs = null) {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === excludeWs) continue;
      try {
        ws.send(data);
      } catch {}
    }
  }
}
