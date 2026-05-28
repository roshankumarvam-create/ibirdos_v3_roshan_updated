"use client";
import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

const WS_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/^http/, "ws").replace(/:\d+$/, (m) => `:${Number(m.slice(1)) + 1}`);

/**
 * Subscribe to a server event emitted to this workspace.
 *
 *   useWorkspaceChannel("kitchen.update", (msg) => { ... });
 *
 * Connection is shared across hooks via a module-level Socket.
 */
let shared: Socket | null = null;
function getSocket(): Socket {
  if (!shared) {
    shared = io(WS_URL, { withCredentials: true, transports: ["websocket"] });
  }
  return shared;
}

export function useWorkspaceChannel<T = unknown>(event: string, handler: (msg: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const sock = getSocket();
    const cb = (msg: T) => handlerRef.current(msg);
    sock.on(event, cb);
    return () => { sock.off(event, cb); };
  }, [event]);
}
