/**
 * WebRTC mesh manager. All processing client-side.
 * Uses server-side long-polling signaling from signaling.functions.ts.
 */

export type QualityPreset = "low" | "medium" | "high" | "hd" | "auto" | "custom";

export interface QualityConfig {
  width: number;
  height: number;
  frameRate: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
}

export const QUALITY_PRESETS: Record<Exclude<QualityPreset, "custom" | "auto">, QualityConfig> = {
  low: { width: 320, height: 240, frameRate: 15, videoBitrateKbps: 150, audioBitrateKbps: 32 },
  medium: { width: 640, height: 480, frameRate: 24, videoBitrateKbps: 400, audioBitrateKbps: 64 },
  high: { width: 1280, height: 720, frameRate: 30, videoBitrateKbps: 1200, audioBitrateKbps: 96 },
  hd: { width: 1920, height: 1080, frameRate: 30, videoBitrateKbps: 2500, audioBitrateKbps: 128 },
};

export interface PeerEvents {
  onRemoteStream: (userId: number, stream: MediaStream) => void;
  onPeerLeft: (userId: number) => void;
  onChatMessage: (userId: number, message: string) => void;
  onFile: (userId: number, name: string, blob: Blob) => void;
  onStatus: (userId: number, state: string) => void;
}

interface PeerBundle {
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  makingOffer: boolean;
  polite: boolean;
  ignoreOffer: boolean;
  pendingFiles: Map<string, { name: string; chunks: Uint8Array[]; size: number; received: number }>;
}

export class MeshManager {
  private peers = new Map<number, PeerBundle>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  public myId: number;
  private roomCode: string;
  private iceServers: RTCIceServer[];
  private events: PeerEvents;
  private send: (toUser: number, payload: unknown) => Promise<void>;
  private currentQuality: QualityConfig = QUALITY_PRESETS.medium;

  constructor(opts: {
    myId: number;
    roomCode: string;
    iceServers: RTCIceServer[];
    send: (toUser: number, payload: unknown) => Promise<void>;
    events: PeerEvents;
  }) {
    this.myId = opts.myId;
    this.roomCode = opts.roomCode;
    this.iceServers = opts.iceServers;
    this.events = opts.events;
    this.send = opts.send;
  }

  async initMedia(quality: QualityConfig, enableVideo = true, enableAudio = true) {
    this.currentQuality = quality;
    const constraints: MediaStreamConstraints = {
      audio: enableAudio
        ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : false,
      video: enableVideo
        ? {
            width: { ideal: quality.width },
            height: { ideal: quality.height },
            frameRate: { ideal: quality.frameRate },
          }
        : false,
    };
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      // fallback audio only
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    return this.localStream;
  }

  getLocalStream() {
    return this.localStream;
  }

  private createPeer(remoteId: number, polite: boolean): PeerBundle {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const bundle: PeerBundle = {
      pc,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      pendingFiles: new Map(),
    };

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.send(remoteId, { type: "ice", candidate: ev.candidate }).catch(() => {});
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        bundle.makingOffer = true;
        await pc.setLocalDescription();
        this.send(remoteId, { type: "sdp", sdp: pc.localDescription }).catch(() => {});
      } catch (e) {
        console.error("negotiationneeded", e);
      } finally {
        bundle.makingOffer = false;
      }
    };
    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (stream) this.events.onRemoteStream(remoteId, stream);
    };
    pc.onconnectionstatechange = () => {
      this.events.onStatus(remoteId, pc.connectionState);
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.removePeer(remoteId);
      }
    };
    pc.ondatachannel = (ev) => {
      this.setupDataChannel(remoteId, ev.channel, bundle);
    };

    // creator opens data channel (higher id side)
    if (this.myId > remoteId) {
      const dc = pc.createDataChannel("chat", { ordered: true });
      this.setupDataChannel(remoteId, dc, bundle);
    }

    this.peers.set(remoteId, bundle);
    this.applyBitrateLimits(pc);
    return bundle;
  }

  private setupDataChannel(remoteId: number, dc: RTCDataChannel, bundle: PeerBundle) {
    bundle.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.onmessage = (ev) => this.handleDataMessage(remoteId, ev.data, bundle);
  }

  private handleDataMessage(
    remoteId: number,
    data: string | ArrayBuffer,
    bundle: PeerBundle,
  ) {
    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data);
        if (msg.t === "chat") this.events.onChatMessage(remoteId, msg.text);
        else if (msg.t === "file-start") {
          bundle.pendingFiles.set(msg.id, {
            name: msg.name,
            chunks: [],
            size: msg.size,
            received: 0,
          });
        } else if (msg.t === "file-end") {
          const f = bundle.pendingFiles.get(msg.id);
          if (f) {
            const blob = new Blob(f.chunks as BlobPart[]);
            this.events.onFile(remoteId, f.name, blob);
            bundle.pendingFiles.delete(msg.id);
          }
        }
      } catch {}
    } else {
      // binary chunk: first 8 bytes = file id length + id string, then rest = data
      const view = new DataView(data);
      const idLen = view.getUint16(0);
      const dec = new TextDecoder();
      const id = dec.decode(new Uint8Array(data, 2, idLen));
      const chunk = new Uint8Array(data, 2 + idLen);
      const f = bundle.pendingFiles.get(id);
      if (f) {
        f.chunks.push(chunk);
        f.received += chunk.byteLength;
      }
    }
  }

  private applyBitrateLimits(pc: RTCPeerConnection) {
    const senders = pc.getSenders();
    for (const s of senders) {
      if (!s.track) continue;
      const params = s.getParameters();
      if (!params.encodings) params.encodings = [{}];
      const target =
        s.track.kind === "video"
          ? this.currentQuality.videoBitrateKbps
          : this.currentQuality.audioBitrateKbps;
      params.encodings[0].maxBitrate = target * 1000;
      if (s.track.kind === "video") {
        params.encodings[0].maxFramerate = this.currentQuality.frameRate;
      }
      s.setParameters(params).catch(() => {});
    }
  }

  removePeer(id: number) {
    const p = this.peers.get(id);
    if (!p) return;
    try {
      p.pc.close();
    } catch {}
    this.peers.delete(id);
    this.events.onPeerLeft(id);
  }

  getPeerIds() {
    return Array.from(this.peers.keys());
  }

  hasPeer(id: number) {
    return this.peers.has(id);
  }

  async connectTo(remoteId: number) {
    if (this.peers.has(remoteId)) return;
    const polite = this.myId < remoteId;
    this.createPeer(remoteId, polite);
    // The higher id side creates the data channel which triggers negotiationneeded.
  }

  /** Perfect negotiation pattern to handle incoming signal */
  async handleSignal(fromId: number, payload: unknown) {
    let bundle = this.peers.get(fromId);
    if (!bundle) {
      const polite = this.myId < fromId;
      bundle = this.createPeer(fromId, polite);
    }
    const { pc } = bundle;
    const msg = payload as { type: "sdp" | "ice"; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    try {
      if (msg.type === "sdp" && msg.sdp) {
        const offerCollision =
          msg.sdp.type === "offer" && (bundle.makingOffer || pc.signalingState !== "stable");
        bundle.ignoreOffer = !bundle.polite && offerCollision;
        if (bundle.ignoreOffer) return;
        await pc.setRemoteDescription(msg.sdp);
        if (msg.sdp.type === "offer") {
          await pc.setLocalDescription();
          this.send(fromId, { type: "sdp", sdp: pc.localDescription }).catch(() => {});
        }
        this.applyBitrateLimits(pc);
      } else if (msg.type === "ice" && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch (e) {
          if (!bundle.ignoreOffer) throw e;
        }
      }
    } catch (e) {
      console.error("handleSignal", e);
    }
  }

  updateQuality(q: QualityConfig) {
    this.currentQuality = q;
    // update sender constraints for video track
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      videoTrack
        ?.applyConstraints({
          width: { ideal: q.width },
          height: { ideal: q.height },
          frameRate: { ideal: q.frameRate },
        })
        .catch(() => {});
    }
    for (const [, bundle] of this.peers) {
      this.applyBitrateLimits(bundle.pc);
    }
  }

  toggleMic(on: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
  }
  toggleCam(on: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
  }

  async startScreenShare() {
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = this.screenStream.getVideoTracks()[0];
    for (const [, b] of this.peers) {
      const sender = b.pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender) await sender.replaceTrack(track);
    }
    track.onended = () => this.stopScreenShare();
  }
  async stopScreenShare() {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    const camTrack = this.localStream?.getVideoTracks()[0];
    if (camTrack) {
      for (const [, b] of this.peers) {
        const sender = b.pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) await sender.replaceTrack(camTrack);
      }
    }
  }

  sendChat(text: string) {
    const msg = JSON.stringify({ t: "chat", text });
    for (const [, b] of this.peers) {
      if (b.dc?.readyState === "open") b.dc.send(msg);
    }
  }

  async sendFile(file: File) {
    const id = crypto.randomUUID();
    const chunkSize = 16 * 1024;
    const idBytes = new TextEncoder().encode(id);
    const header = JSON.stringify({ t: "file-start", id, name: file.name, size: file.size });
    const footer = JSON.stringify({ t: "file-end", id });
    for (const [, b] of this.peers) {
      if (b.dc?.readyState === "open") b.dc.send(header);
    }
    let offset = 0;
    while (offset < file.size) {
      const slice = await file.slice(offset, offset + chunkSize).arrayBuffer();
      const buf = new ArrayBuffer(2 + idBytes.byteLength + slice.byteLength);
      const view = new DataView(buf);
      view.setUint16(0, idBytes.byteLength);
      new Uint8Array(buf, 2, idBytes.byteLength).set(idBytes);
      new Uint8Array(buf, 2 + idBytes.byteLength).set(new Uint8Array(slice));
      for (const [, b] of this.peers) {
        if (b.dc?.readyState === "open") {
          // wait for buffer
          while (b.dc.bufferedAmount > 8 * 1024 * 1024) {
            await new Promise((r) => setTimeout(r, 20));
          }
          b.dc.send(buf);
        }
      }
      offset += chunkSize;
    }
    for (const [, b] of this.peers) {
      if (b.dc?.readyState === "open") b.dc.send(footer);
    }
  }

  destroy() {
    for (const [id] of this.peers) this.removePeer(id);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.screenStream = null;
  }
}
