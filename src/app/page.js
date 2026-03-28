"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const ConferencePage = dynamic(() => import("@/components/ConferencePage"), {
  ssr: false,
});
import { CircleUser, Settings, Bot, Loader2 } from "lucide-react";
import { doc, onSnapshot, setDoc, updateDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "@/context/firebase";

export default function Home() {
  const [setupStep, setSetupStep] = useState(0); // 0=hospitalId, 1=selectBot, 2=online
  const [hospitalId, setHospitalId] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [availableBotIds, setAvailableBotIds] = useState([]);
  const [selectedBotId, setSelectedBotId] = useState("");
  const [botName, setBotName] = useState("");
  const [existingBotName, setExistingBotName] = useState(""); // name already in DB
  const [loadingHospital, setLoadingHospital] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [sessionId] = useState(() => (typeof window !== 'undefined' ? Math.random().toString(36).substring(7) : ""));
  const [isRestoring, setIsRestoring] = useState(true);

  const [botStatus, setBotStatus] = useState("");
  const [activeDoctorName, setActiveDoctorName] = useState(null);
  const [activeDoctorPhotoUrl, setActiveDoctorPhotoUrl] = useState(null);
  const [joined, setJoined] = useState(false);
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [countdown, setCountdown] = useState("");

  // Countdown timer effect
  useEffect(() => {
    if (upcomingBookings.length === 0) {
      setCountdown("");
      return;
    }

    const interval = setInterval(() => {
      const next = upcomingBookings[0];
      const [sH, sM] = (next.start_time || "00:00").split(':').map(Number);
      const startDate = new Date(next.date);
      startDate.setHours(sH, sM, 0, 0);
      
      const now = new Date();
      const diff = startDate - now;

      if (diff <= 0) {
        setCountdown("Now");
      } else {
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        
        const hStr = h > 0 ? `${h}h ` : "";
        const mStr = (m > 0 || h > 0) ? `${m}m ` : "";
        const sStr = `${s}s`;
        setCountdown(`${hStr}${mStr}${sStr}`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [upcomingBookings]);

  // Load saved setup from localStorage
  useEffect(() => {
    const savedBotId = localStorage.getItem("navatar_botId");
    const savedHospitalId = localStorage.getItem("navatar_hospitalId");
    const savedBotName = localStorage.getItem("navatar_botName");

    if (savedBotId && savedHospitalId) {
      setSetupStep(2);
      setHospitalId(savedHospitalId);
      setSelectedBotId(savedBotId);
      setBotName(savedBotName || "");

      // Fetch hospital name from DB since we skip Step 1 & 2
      getDoc(doc(db, "hospitals", savedHospitalId)).then(snap => {
        if (snap.exists()) setHospitalName(snap.data().hospitalName || "Hospital");
      }).catch(() => {});

      goOnline(savedBotId, savedHospitalId, savedBotName || "").finally(() => {
        setIsRestoring(false);
      });
    } else {
      setIsRestoring(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 1: Fetch hospital document to get botIds
  const handleFetchHospital = async () => {
    if (!hospitalId.trim()) {
      setSetupError("Please enter a Hospital ID.");
      return;
    }
    setLoadingHospital(true);
    setSetupError("");

    try {
      const hDoc = await getDoc(doc(db, "hospitals", hospitalId.trim()));
      if (hDoc.exists()) {
        const data = hDoc.data();
        setHospitalName(data.hospitalName || "Hospital");
        const bots = data.botIds || [];
        if (bots.length === 0) {
          setSetupError("This hospital has no Navatars assigned.");
          setLoadingHospital(false);
          return;
        }
        setAvailableBotIds(bots);
        setSelectedBotId(bots[0]);
        await loadExistingBotName(bots[0]);
        setSetupStep(1);
      } else {
        setSetupError("Hospital not found. Check the Hospital ID.");
      }
    } catch (err) {
      console.error("Error fetching hospital:", err);
      setSetupError("Failed to fetch hospital.");
    } finally {
      setLoadingHospital(false);
    }
  };

  const loadExistingBotName = async (botId) => {
    try {
      const botSnap = await getDoc(doc(db, "navatars", botId));
      if (botSnap.exists() && botSnap.data().name) {
        setExistingBotName(botSnap.data().name);
        setBotName(botSnap.data().name);
      } else {
        setExistingBotName("");
        setBotName("");
      }
    } catch (e) {
      setExistingBotName("");
      setBotName("");
    }
  };

  const handleBotSelectionChange = async (newBotId) => {
    setSelectedBotId(newBotId);
    setSetupError("");
    await loadExistingBotName(newBotId);
  };

  const goOnline = async (botId, hId, name) => {
    const id = botId || selectedBotId;
    const hospId = hId || hospitalId;
    const bName = name || botName || `Navatar-${id}`;
    const sid = sessionId;

    if (!id || !hospId) return;

    localStorage.setItem("navatar_botId", id);
    localStorage.setItem("navatar_hospitalId", hospId);
    localStorage.setItem("navatar_botName", bName);

    // Skip duplicate name check if it's the SAME name as what's already in the DB for this bot
    // This happens during refresh restoration
    let nameChanged = true;
    try {
      if (existingBotName && bName === existingBotName) {
        nameChanged = false;
      } else {
        const botSnap = await getDoc(doc(db, "navatars", id));
        if (botSnap.exists() && botSnap.data().name === bName) {
          nameChanged = false;
          setExistingBotName(bName);
        }
      }
    } catch (e) {}

    if (nameChanged && bName) {
      try {
        const q = query(collection(db, "navatars"), where("hospitalId", "==", hospId));
        const snap = await getDocs(q);
        const duplicate = snap.docs.find(d => d.id !== id && d.data().name === bName);
        if (duplicate) {
          setSetupError(`Another bot in this hospital already has the name "${bName}". Please choose a different name.`);
          return;
        }
      } catch (e) { }
    }

    try {
      const botRef = doc(db, "navatars", id);
      
      let currentStatus = "Available";
      let activeDocId = null;
      let activeDocName = null;

      try {
        const botSnap = await getDoc(botRef);
        if (botSnap.exists()) {
          const data = botSnap.data();
          // If status is Engaged (case-insensitive) OR if there's an active doctor (meaning a call was interrupted)
          if (
            (data.status && data.status.toLowerCase() === "engaged") || 
            data.activeDoctorId
          ) {
            currentStatus = "Engaged";
            activeDocId = data.activeDoctorId || null;
            activeDocName = data.activeDoctorName || null;
          }
        }
      } catch (e) {
        console.warn("Failed to fetch existing bot status:", e);
      }

      await setDoc(botRef, {
        name: bName,
        hospitalId: hospId,
        status: currentStatus,
        activeDoctorId: activeDocId,
        activeDoctorName: activeDocName,
        lastSessionId: sid,
        totalAccesses: 0,
        totalSecondsUsed: 0
      }, { merge: true });

      setBotStatus(currentStatus);
      setSetupStep(2);
    } catch (err) {
      console.error("Failed to register bot:", err);
      setSetupError("Failed to go online.");
    }
  };

  // Set status to Offline when tab is closed
  useEffect(() => {
    if (setupStep !== 2 || !selectedBotId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // We could set it to offline here, but visibility change also happens when switching tabs.
        // The user specifically asked for "when site gets closed".
      }
    };

    const handleUnload = () => {
      if (selectedBotId) {
        // Use fetch with keepalive: true to ensure the request finishes after the tab is closed.
        // Direct Firestore updates are async and often cancelled during tab closure.
        fetch('/api/bot-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            botId: selectedBotId, 
            status: 'Offline',
            sessionId: sessionId
          }),
          keepalive: true
        }).catch(() => {});
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [setupStep, selectedBotId, sessionId]);

  useEffect(() => {
    if (setupStep !== 2 || !selectedBotId) return;

    const botRef = doc(db, "navatars", selectedBotId);
    const unsubscribe = onSnapshot(botRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setBotStatus(data.status);

        if (data.status && data.status.toLowerCase() === "engaged") {
          setActiveDoctorName(data.activeDoctorName || "Doctor");
          if (data.activeDoctorId) {
            getDoc(doc(db, "doctors", data.activeDoctorId)).then(snap => {
              if (snap.exists()) setActiveDoctorPhotoUrl(snap.data().photoUrl);
            }).catch(() => {});
          }
          setJoined(true);
        } else {
          setActiveDoctorName(null);
          setActiveDoctorPhotoUrl(null);
          setJoined(false);
        }
      }
    }, (error) => {
      console.error("Firestore Listen Error:", error);
    });

    return () => unsubscribe();
  }, [setupStep, selectedBotId]);

  useEffect(() => {
    if (setupStep !== 2 || !selectedBotId) return;

    const q = query(
      collection(db, "bookings"),
      where("botId", "==", selectedBotId),
      where("status", "==", "Booked")
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const now = new Date();
      const rawSessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // Fetch doctor photos for all unique doctors in these bookings
      const uniqueDoctorIds = [...new Set(rawSessions.map(s => s.doctorId).filter(id => !!id))];
      const doctorMeta = {};
      
      try {
        await Promise.all(uniqueDoctorIds.map(async (id) => {
          const dSnap = await getDoc(doc(db, "doctors", id));
          if (dSnap.exists()) {
            doctorMeta[id] = dSnap.data().photoUrl;
          }
        }));
      } catch (err) {
        console.warn("Error fetching doctor metadata:", err);
      }

      const sessions = rawSessions
        .filter(b => {
          const [eH, eM] = (b.end_time || "23:59:00").split(':').map(Number);
          const endDate = new Date(b.date);
          endDate.setHours(eH, eM, 0, 0);
          return endDate > now;
        })
        .map(b => ({ ...b, doctorPhotoUrl: doctorMeta[b.doctorId] || null }))
        .sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return a.start_time.localeCompare(b.start_time);
        });

      setUpcomingBookings(sessions);
    }, (err) => {
      console.error("Booking listener error:", err);
    });

    return () => unsubscribe();
  }, [setupStep, selectedBotId]);

  const handleLeaveCall = async () => {
    setJoined(false);
    if (selectedBotId) {
      try {
        await updateDoc(doc(db, "navatars", selectedBotId), {
          status: "Available",
          activeDoctorId: null,
          activeDoctorName: null
        });
      } catch (e) {
        console.error("Error clearing call status:", e);
      }
    }
  };

  const handleResetSetup = async () => {
    if (selectedBotId) {
      try {
        await updateDoc(doc(db, "navatars", selectedBotId), { status: "Offline" });
      } catch (e) { }
    }
    localStorage.removeItem("navatar_botId");
    localStorage.removeItem("navatar_hospitalId");
    localStorage.removeItem("navatar_botName");
    setSetupStep(0);
    setJoined(false);
    setHospitalId("");
    setSelectedBotId("");
    setBotName("");
    setExistingBotName("");
    setAvailableBotIds([]);
    setSetupError("");
  };

  if (isRestoring) {
    return (
      <div style={styles.container}>
        <Loader2 size={48} className="animate-spin" style={{ marginBottom: '20px', color: '#3b82f6' }} />
        <p style={{ color: '#94a3b8' }}>Restoring Navatar Session...</p>
        <style jsx>{`
          .animate-spin {
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (setupStep === 0) {
    return (
      <div style={styles.container}>
        <Bot size={64} style={{ marginBottom: '20px', color: '#3b82f6' }} />
        <h1>Navatar Configuration</h1>
        <p style={styles.subtitle}>Step 1: Enter your Hospital ID</p>
        <div style={styles.form}>
          <label style={styles.label}>Hospital ID</label>
          <input value={hospitalId} onChange={e => setHospitalId(e.target.value)} placeholder="e.g. JPyr8waXL6fosGXtmzLP" style={styles.input} />
          {setupError && <p style={styles.error}>{setupError}</p>}
          <button onClick={handleFetchHospital} disabled={loadingHospital} style={styles.button}>{loadingHospital ? "Loading..." : "Next →"}</button>
        </div>
      </div>
    );
  }

  if (setupStep === 1) {
    return (
      <div style={styles.container}>
        <Bot size={64} style={{ marginBottom: '20px', color: '#3b82f6' }} />
        <h1>Navatar Configuration</h1>
        <p style={styles.subtitle}>Step 2: Select Bot for <span style={{ color: '#3b82f6' }}>{hospitalName}</span></p>
        <div style={styles.form}>
          <label style={styles.label}>Select Bot ID</label>
          <select value={selectedBotId} onChange={e => handleBotSelectionChange(e.target.value)} style={styles.input}>
            {availableBotIds.map(id => (<option key={id} value={id}>{id}</option>))}
          </select>
          <label style={styles.label}>Bot Name {existingBotName ? "(already set — edit if needed)" : "(optional)"}</label>
          <input value={botName} onChange={e => setBotName(e.target.value)} placeholder={existingBotName || "e.g. Emergency Ward Bot"} style={styles.input} />
          {existingBotName && (
            <p style={{ color: '#22c55e', fontSize: '0.8rem', marginTop: '4px' }}>
              Current name: {existingBotName}
            </p>
          )}
          {setupError && <p style={styles.error}>{setupError}</p>}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setSetupStep(0)} style={{ ...styles.button, backgroundColor: '#475569' }}>← Back</button>
            <button onClick={() => goOnline()} style={styles.button}>Go Online 🟢</button>
          </div>
        </div>
      </div>
    );
  }

  if (joined && selectedBotId) {
    const user = { 
      name: botName || `Navatar-${selectedBotId}`, 
      email: `${selectedBotId}@navatar.com`, 
      isVideoOn: true, 
      isAudioOn: true,
      activeDoctorName,
      activeDoctorPhotoUrl
    };
    return <ConferencePage user={user} room={selectedBotId} onLeave={handleLeaveCall} />;
  }

  if (botStatus && botStatus.toLowerCase() === "offline" && setupStep === 2) {
    return (
      <div style={styles.container}>
        <Bot size={80} style={{ marginBottom: '20px', color: '#64748b', opacity: 0.5 }} />
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }}>Bot is Under Maintenance</h1>
        <p style={{ color: '#94a3b8', fontSize: '1.2rem', marginBottom: '40px' }}>
          This Navatar is currently offline for service.
        </p>
        <button onClick={handleResetSetup} style={{ ...styles.button, backgroundColor: '#475569' }}>
          Reconnect / Configure
        </button>
      </div>
    );
  }

  return (
    <div style={{ ...styles.container, position: 'relative' }}>
      <button onClick={handleResetSetup} style={styles.configBtn}><Settings size={18} /> Configure</button>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }}>{botName || `Navatar-${selectedBotId}`}</h1>
      <p style={{ color: '#94a3b8', marginBottom: '40px' }}>ID: {selectedBotId} | {hospitalName}</p>
      
      {upcomingBookings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          {/* Featured Next Doctor Card */}
          <div style={styles.nextDoctorCard}>
            {upcomingBookings[0].doctorPhotoUrl ? (
              <img src={upcomingBookings[0].doctorPhotoUrl} alt={upcomingBookings[0].doctorName} style={styles.nextDoctorPhoto} />
            ) : (
              <div style={styles.photoPlaceholder}><CircleUser size={32} /></div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
              <span style={{ color: '#3b82f6', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {countdown && countdown !== "Now" ? `Starts in ${countdown}` : "Starting Soon"}
              </span>
              <h2 style={{ margin: 0, fontSize: '1.4rem' }}>Dr. {upcomingBookings[0].doctorName}</h2>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>{upcomingBookings[0].date} at {upcomingBookings[0].start_time}</p>
            </div>
            
            {/* Manual Join / Fallback Button */}
            <button
              onClick={async () => {
                const nextBooking = upcomingBookings[0];
                setActiveDoctorName(nextBooking.doctorName);
                if (nextBooking.doctorPhotoUrl) {
                  setActiveDoctorPhotoUrl(nextBooking.doctorPhotoUrl);
                }
                setJoined(true);
                try {
                  await updateDoc(doc(db, "navatars", selectedBotId), { 
                    status: "Engaged",
                    activeDoctorId: nextBooking.doctorId || null,
                    activeDoctorName: nextBooking.doctorName || null 
                  });
                } catch(e) {}
              }}
              style={{ ...styles.button, backgroundColor: '#10b981', padding: '10px 16px', fontSize: '0.9rem', borderRadius: '8px' }}
            >
              Join 📞
            </button>
          </div>

          {/* List of Other Bookings */}
          <div style={{ width: '400px' }}>
            <h4 style={{ color: '#94a3b8', marginBottom: '12px' }}>📅 Upcoming Sessions ({upcomingBookings.length - 1 < 0 ? 0 : upcomingBookings.length - 1})</h4>
            {upcomingBookings.slice(1, 6).map((b) => (
              <div key={b.id} style={styles.sessionItem}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {b.doctorPhotoUrl ? (
                    <img src={b.doctorPhotoUrl} alt={b.doctorName} style={styles.smallPhoto} />
                  ) : (
                    <div style={styles.smallPhotoPlaceholder}><CircleUser size={16} /></div>
                  )}
                  <div>
                    <b style={{ fontSize: '1rem' }}>Dr. {b.doctorName}</b>
                    <br/>
                    <small style={{ color: '#64748b' }}>{b.date}</small>
                  </div>
                </div>
                <div style={{ color: '#3b82f6', fontWeight: '600' }}>{b.start_time}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#0f172a', color: 'white', fontFamily: 'sans-serif' },
  subtitle: { color: '#94a3b8', marginBottom: '30px' },
  form: { display: 'flex', flexDirection: 'column', gap: '15px', width: '340px' },
  label: { fontSize: '0.9rem', color: '#94a3b8' },
  input: { width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #334155', backgroundColor: '#1e293b', color: 'white' },
  button: { padding: '12px', borderRadius: '5px', border: 'none', backgroundColor: '#3b82f6', color: 'white', fontWeight: 'bold', cursor: 'pointer' },
  error: { color: '#ef4444', fontSize: '0.85rem' },
  configBtn: { position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', gap: '5px' },
  
  // New Styles for Doctor Photos
  nextDoctorCard: { 
    width: '400px', 
    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', 
    padding: '20px', 
    borderRadius: '16px', 
    border: '1px solid #334155', 
    display: 'flex', 
    alignItems: 'center', 
    gap: '20px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)'
  },
  nextDoctorPhoto: { 
    width: '70px', 
    height: '70px', 
    borderRadius: '50%', 
    objectFit: 'cover', 
    border: '3px solid #3b82f6' 
  },
  photoPlaceholder: { 
    width: '70px', 
    height: '70px', 
    borderRadius: '50%', 
    backgroundColor: '#334155', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    color: '#64748b' 
  },
  sessionItem: { 
    background: '#1e293b', 
    padding: '14px', 
    borderRadius: '12px', 
    marginTop: '10px', 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    border: '1px solid #334155'
  },
  smallPhoto: { 
    width: '40px', 
    height: '40px', 
    borderRadius: '50%', 
    objectFit: 'cover' 
  },
  smallPhotoPlaceholder: { 
    width: '40px', 
    height: '40px', 
    borderRadius: '50%', 
    backgroundColor: '#334155', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    color: '#64748b' 
  }
};
