import React, { useRef, useEffect, useState } from "react";
import { MicOff, VideoOff, Minimize2, Maximize2 } from "lucide-react";

const ParticipantVideo = ({ participant }) => {
  const videoRef = useRef(null);
  const [minimize, setMinimize] = useState(false);

  useEffect(() => {
    // Agora requires the DOM element to be fully mounted before calling .play()
    // It's safer to use an ID or the raw element, and clean it up properly.
    console.log(`[ParticipantVideo] Trying to render ${participant.name} (${participant.id})`);
    
    if (participant.videoTrack && videoRef.current) {
      console.log(`[ParticipantVideo] Playing video track for ${participant.id} onto `, videoRef.current);
      participant.videoTrack.play(videoRef.current);
    } else {
      console.warn(`[ParticipantVideo] Missing track or DOM ref for ${participant.id}`, { track: !!participant.videoTrack, ref: !!videoRef.current });
    }

    return () => {
      if (participant.videoTrack) {
        participant.videoTrack.stop();
      }
    };
  }, [participant.videoTrack]);

  const handleClose = () => {
    setMinimize((prev) => !prev);
  };

  return (
    <div
      className={`participant-video-container ${participant.isMe ? "me" : ""} ${minimize ? "other" : ""
        }`}
    >

      {!participant.isMe && <button className="minimize-btn" onClick={handleClose} title="minimize/Show">

        {minimize ? <Maximize2 /> : <Minimize2 />}
      </button>}

      <div className="video-wrapper">
        <div
          ref={videoRef}
          className={`participant-video ${!participant.isVideoOn ? "video-off" : ""}`}
          style={{ width: "100%", height: "100%" }}
        />

        {!participant.isVideoOn && (
          <div className="video-placeholder">
            <div className="participant-avatar">
              {participant.name?.charAt(0).toUpperCase() || "U"}
            </div>
          </div>
        )}

        <div className="participant-info">
          <span className="participant-name">
            {participant.name} {participant.isMe ? "(You)" : ""}
          </span>
          <div className="participant-status">
            {!participant.isAudioOn && (
              <span className="muted-icon">
                <MicOff />
              </span>
            )}
            {!participant.isVideoOn && (
              <span className="video-off-icon">
                <VideoOff />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParticipantVideo;
