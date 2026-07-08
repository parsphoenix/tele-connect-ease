import { createServerFn } from "@tanstack/react-start";

export const getIceServers = createServerFn({ method: "GET" }).handler(async () => {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
});
