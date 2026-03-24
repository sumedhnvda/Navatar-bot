class PeerManager {
  constructor() {
    this.peerConnections = new Map();
    this.onRemoteStream = null;
    this.onICECandidate = null;
  }

  async createPeerConnection(peerId, localStream = null) {
    // Close existing connection if any
    if (this.peerConnections.has(peerId)) {
      this.peerConnections.get(peerId).close();
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:global.stun.twilio.com:3478",
          ],
        },
      ],
    });

    // Handle remote stream
    peerConnection.ontrack = (event) => {
      console.log("Received remote track from:", peerId);
      if (this.onRemoteStream && event.streams[0]) {
        this.onRemoteStream(peerId, event.streams[0]);
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onICECandidate) {
        this.onICECandidate(peerId, event.candidate);
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log(
        `Peer ${peerId} connection state:`,
        peerConnection.connectionState
      );

      if (
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "disconnected"
      ) {
        console.log(
          `Peer ${peerId} connection failed, attempting to reconnect...`
        );
        // Could implement reconnection logic here
      }
    };

    // Handle signaling state changes
    peerConnection.onsignalingstatechange = () => {
      console.log(
        `Peer ${peerId} signaling state:`,
        peerConnection.signalingState
      );
    };

    // Handle ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      console.log(
        `Peer ${peerId} ICE connection state:`,
        peerConnection.iceConnectionState
      );
    };

    this.peerConnections.set(peerId, peerConnection);

    // Set up negotiation handling
    peerConnection.onnegotiationneeded = async () => {
      try {
        if (peerConnection.signalingState !== "stable") {
          console.log("Signaling state not stable, skipping negotiation");
          return;
        }

        console.log("Negotiation needed for peer:", peerId);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // You can emit renegotiation signal here if needed
        // socket.emit('webrtc:renegotiate', { to: peerId, offer });
      } catch (error) {
        console.error("Error during negotiation:", error);
      }
    };

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });
    }

    return peerConnection;
  }

  getPeerConnection(peerId) {
    return this.peerConnections.get(peerId);
  }

  async replaceTrackForAllPeers(kind, newTrack) {
    const promises = [];
    for (const [, peerConnection] of this.peerConnections) {
      const sender = peerConnection
        .getSenders()
        .find((s) => s.track && s.track.kind === kind);

      if (sender) {
        promises.push(sender.replaceTrack(newTrack));
      }
    }
    return Promise.all(promises);
  }

  removePeerConnection(peerId) {
    const peerConnection = this.peerConnections.get(peerId);
    if (peerConnection) {
      peerConnection.close();
      this.peerConnections.delete(peerId);
      console.log(`Removed peer connection for: ${peerId}`);
    }
  }

  closeAllConnections() {
    for (const [peerId, peerConnection] of this.peerConnections) {
      peerConnection.close();
    }
    this.peerConnections.clear();
    console.log("Closed all peer connections");
  }
}

export default PeerManager;
