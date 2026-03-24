import React from "react";
import ParticipantVideo from "./ParticipantVideo";

const ParticipantGrid = ({ participants }) => {
  return (
    <div className={`participant-grid`}>
      {participants.map((participant) => (
        <ParticipantVideo key={participant.id} participant={participant} />
      ))}
    </div>
  );
};

export default ParticipantGrid;
