import React, { useState, useEffect, useCallback, useRef } from "react";
import ParticipantGrid from "./ParticipantGrid";
import ControlPanel from "./ControlPanel";
import AgoraRTC from "agora-rtc-sdk-ng";

const ConferencePage = ({ user, room, onLeave }) => {
  const [participants, setParticipants] = useState(new Map());
  const [isVideoOn, setIsVideoOn] = useState(user.isVideoOn);
  const [isAudioOn, setIsAudioOn] = useState(user.isAudioOn);
  const [fullScreen, setFullScreen] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [isJoining, setIsJoining] = useState(true);
  const [forceNoToken, setForceNoToken] = useState(false); // DEBUG BYPASS

  const clientRef = useRef(null);
  const localTracksRef = useRef({ videoTrack: null, audioTrack: null });
  const containerRef = useRef(null);

  // Initialize Agora and media streams
  useEffect(() => {
    let isMounted = true;

    const initAgora = async () => {
      const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
      if (!isMounted) return;
      clientRef.current = client;

      // Monitor connection state
      client.on("connection-state-change", (curState, revState) => {
        console.log(`[Agora] Connection state changed from ${revState} to ${curState}`);
        if (curState === "FAILED") {
          console.error("[Agora] Connection FAILED. Check network or token validity.");
        }
      });

      // Monitor exceptions
      client.on("exception", (event) => {
        console.warn("[Agora] Exception event:", event.code, event.msg, event.uid);
      });

      // Handle remote users joining
      client.on("user-published", async (remoteUser, mediaType) => {
        console.log(`[Agora] User published: ${remoteUser.uid}, type: ${mediaType}`);
        await client.subscribe(remoteUser, mediaType);
        if (!isMounted) return;

        if (mediaType === "video") {
          const remoteVideoTrack = remoteUser.videoTrack;
          // Add to participants list
          setParticipants((prev) => {
            const updated = new Map(prev);
            updated.set(remoteUser.uid, {
              id: remoteUser.uid,
              name: "Remote Doctor", // We don't have metadata over pure Agora usually, fallback
              stream: new MediaStream([remoteVideoTrack.getMediaStreamTrack()]),
              isVideoOn: true,
              isAudioOn: true,
              isMe: false,
              videoTrack: remoteVideoTrack
            });
            return updated;
          });
        }

        if (mediaType === "audio") {
          remoteUser.audioTrack.play();
        }
      });

      client.on("user-unpublished", (remoteUser) => {
        setParticipants((prev) => {
          const updated = new Map(prev);
          updated.delete(remoteUser.uid);
          return updated;
        });
      });

      try {
        const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
        if (!appId) throw new Error("NEXT_PUBLIC_AGORA_APP_ID is not defined in environment variables");

        // Fetch token from Next.js backend
        const backendUrl = "";
        let token = null;
        let fetchedAppId = appId;
        const uidToJoin = user?.uid || Math.floor(Math.random() * 100000); // Need a positive integer for token generation

        try {
          if (forceNoToken) {
            console.log("[Agora] Bypassing token fetch due to debug toggle");
          } else {
            const res = await fetch(`${backendUrl}/api/agora/token?channelName=${room}&uid=${uidToJoin}`);
            if (res.ok) {
              const data = await res.json();
              token = data.token;
              if (data.appId) fetchedAppId = data.appId;
              console.log("Successfully fetched token from backend:", { token: token ? "PRESENT" : "NULL", appId: fetchedAppId });
            } else {
              console.error("Failed to fetch Agora token", await res.text());
            }
          }
        } catch (fetchErr) {
          console.error("Error fetching Agora token:", fetchErr);
        }

        console.log("Joining Agora channel with params:", { appId: fetchedAppId, room, hasToken: !!token, uidToJoin });
        // Join the channel with appId, room name, fetched token, and uid
        const uid = await client.join(fetchedAppId, room, token, uidToJoin);
        if (!isMounted) { client.leave(); return; }
        console.log("Successfully joined Agora channel!", uid);
        setIsJoining(false);

        // Try to get local tracks, but don't crash if we are on HTTP or denied permissions
        try {
          const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
          if (!isMounted) {
            audioTrack.stop(); audioTrack.close();
            videoTrack.stop(); videoTrack.close();
            return;
          }
          localTracksRef.current = { audioTrack, videoTrack };
          
          if (!isVideoOn) await videoTrack.setEnabled(false);
          if (!isAudioOn) await audioTrack.setEnabled(false);

          await client.publish([audioTrack, videoTrack]);
          console.log("[Agora] Successfully published local audio and video tracks!");

          setParticipants((prev) => {
            const updated = new Map(prev);
            updated.set("local", {
              id: "local",
              name: user.name,
              stream: new MediaStream([videoTrack.getMediaStreamTrack()]),
              isVideoOn: isVideoOn,
              isAudioOn: isAudioOn,
              isMe: true,
              videoTrack: videoTrack
            });
            return updated;
          });
        } catch (mediaErr) {
          console.warn("Could not access camera/mic (likely due to HTTP on mobile). Joining as viewer only.", mediaErr);
          // Set a dummy local participant so the UI doesn't break
          setParticipants((prev) => {
            const updated = new Map(prev);
            updated.set("local", {
              id: "local",
              name: user.name + " (Viewer)",
              stream: null,
              isVideoOn: false,
              isAudioOn: false,
              isMe: true,
              videoTrack: null
            });
            return updated;
          });
        }

      } catch (error) {
        console.error("Agora Error:", error);
        setJoinError(error.message || "Unknown Agora Error");
        setIsJoining(false);
      }
    };

    initAgora();

    // Cleanup
    const forceCleanupLocalHardware = () => {
      if (localTracksRef.current?.audioTrack) {
        localTracksRef.current.audioTrack.stop();
        localTracksRef.current.audioTrack.close();
      }
      if (localTracksRef.current?.videoTrack) {
        localTracksRef.current.videoTrack.stop();
        localTracksRef.current.videoTrack.close();
      }
    };
    
    window.addEventListener('beforeunload', forceCleanupLocalHardware);

    return () => {
      isMounted = false;
      window.removeEventListener('beforeunload', forceCleanupLocalHardware);
      const cleanup = async () => {
        forceCleanupLocalHardware();
        if (clientRef.current) {
          clientRef.current.removeAllListeners();
          await clientRef.current.leave();
        }
      };
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, user.name, forceNoToken]);

  const toggleVideo = useCallback(async () => {
    const { videoTrack } = localTracksRef.current || {};
    if (videoTrack) {
      await videoTrack.setEnabled(!isVideoOn);
      setIsVideoOn(!isVideoOn);

      setParticipants((prev) => {
        const updated = new Map(prev);
        const me = updated.get("local");
        if (me) {
          me.isVideoOn = !isVideoOn;
          updated.set("local", me);
        }
        return updated;
      });
    }
  }, [isVideoOn]);

  const toggleAudio = useCallback(async () => {
    const { audioTrack } = localTracksRef.current || {};
    if (audioTrack) {
      await audioTrack.setEnabled(!isAudioOn);
      setIsAudioOn(!isAudioOn);

      setParticipants((prev) => {
        const updated = new Map(prev);
        const me = updated.get("local");
        if (me) {
          me.isAudioOn = !isAudioOn;
          updated.set("local", me);
        }
        return updated;
      });
    }
  }, [isAudioOn]);

  const leaveConference = useCallback(() => {
    onLeave();
    
    // Force aggressive hardware shutdown immediately on button click
    if (localTracksRef.current?.audioTrack) {
      localTracksRef.current.audioTrack.stop();
      localTracksRef.current.audioTrack.close();
    }
    if (localTracksRef.current?.videoTrack) {
      localTracksRef.current.videoTrack.stop();
      localTracksRef.current.videoTrack.close();
    }
    if (clientRef.current) {
      clientRef.current.leave();
    }

    setTimeout(() => {
      window.location.reload();
    }, 100);
  }, [onLeave]);

  const toggleFullScreen = () => {
    const el = containerRef.current;

    if (!document.fullscreenElement) {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (el.msRequestFullscreen) el.msRequestFullscreen();
      setFullScreen(true);
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.msExitFullscreen) document.msExitFullscreen();
      setFullScreen(false);
    }
  };

  // Enforce strictly 1 local and 1 remote user for 1-to-1 layout
  const getRenderedParticipants = () => {
    const list = Array.from(participants.values());
    const local = list.find(p => p.isMe);
    const remotes = list.filter(p => !p.isMe);

    const result = [];
    if (local) result.push(local);
    if (remotes.length > 0) {
      result.push(remotes[0]); // Take only the first remote doctor
    }
    return result;
  };

  return (
    <div ref={containerRef} className="conference-container">
      {isJoining && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <p style={{ color: 'white', fontSize: '1.5rem' }}>🔄 Connecting to Video Room...</p>
        </div>
      )}
      {joinError && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: 1001, gap: '15px' }}>
          <h2 style={{ color: '#f44336', fontSize: '2rem' }}>Connection Failed</h2>
          <p style={{ color: '#ccc', maxWidth: '80%', textAlign: 'center' }}>{joinError}</p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => window.location.reload()} style={{ padding: '12px 24px', background: '#3b82f6', border: 'none', borderRadius: '5px', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>Retry</button>
            <button onClick={() => { setJoinError(null); setForceNoToken(true); }} style={{ padding: '12px 24px', background: '#e11d48', border: 'none', borderRadius: '5px', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>Try without Token</button>
          </div>
        </div>
      )}
      <div className="conference-header" style={{ opacity: 1, display: 'flex', alignItems: 'center', gap: '15px' }}>
        {user.activeDoctorPhotoUrl && (
          <img src={user.activeDoctorPhotoUrl} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #3b82f6' }} />
        )}
        <h1 className="conference-title">
          {user.activeDoctorName ? `Meeting with Dr. ${user.activeDoctorName}` : `Conference Room: ${room}`}
        </h1>
      </div>

      <div className="conference-main">
        <div className="video-section">
          {/* Note: In Agora, playing tracks is usually done by track.play("element_id")
              ParticipantGrid currently uses standard <video> tags and srcObject.
              We created raw MediaStreams out of Agora tracks in the state so it still works,
              but if ParticipantGrid breaks, we need to map over participants and call .play() */}
          <ParticipantGrid participants={getRenderedParticipants()} />
        </div>
      </div>

      <ControlPanel
        isVideoOn={isVideoOn}
        isAudioOn={isAudioOn}
        showChat={false}
        onToggleVideo={toggleVideo}
        onToggleAudio={toggleAudio}
        onToggleChat={() => {}}
        onLeave={leaveConference}
        participantCount={participants.size}
        fullScreen={fullScreen}
        onToggleFullScreen={toggleFullScreen}
      />
    </div>
  );
};

export default ConferencePage;
