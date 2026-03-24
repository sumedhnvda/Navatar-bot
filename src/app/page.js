"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const ConferencePage = dynamic(() => import("@/components/ConferencePage"), {
  ssr: false,
});
import { CircleUser, Settings, Bot } from "lucide-react";
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

  const [botStatus, setBotStatus] = useState("Offline");
  const [activeDoctorName, setActiveDoctorName] = useState(null);
  const [joined, setJoined] = useState(false);
  const [upcomingBookings, setUpcomingBookings] = useState([]);

  // Load saved setup from localStorage
  useEffect(() => {
    const savedBotId = localStorage.getItem("navatar_botId");
    const savedHospitalId = localStorage.getItem("navatar_hospitalId");
    const savedBotName = localStorage.getItem("navatar_botName");

    if (savedBotId && savedHospitalId) {
      setHospitalId(savedHospitalId);
      setSelectedBotId(savedBotId);
      setBotName(savedBotName || "");

      // Fetch hospital name from DB since we skip Step 1
      getDoc(doc(db, "hospitals", savedHospitalId)).then(snap => {
        if (snap.exists()) setHospitalName(snap.data().hospitalName || "Hospital");
      }).catch(() => {});

      goOnline(savedBotId, savedHospitalId, savedBotName || "");
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

    if (!id || !hospId) return;

    localStorage.setItem("navatar_botId", id);
    localStorage.setItem("navatar_hospitalId", hospId);
    localStorage.setItem("navatar_botName", bName);

    // Check duplicate name within same hospital (only if name was changed / is new)
    if (bName && bName !== existingBotName) {
      try {
        const q = query(collection(db, "navatars"), where("hospitalId", "==", hospId));
        const snap = await getDocs(q);
        const duplicate = snap.docs.find(d => d.id !== id && d.data().name === bName);
        if (duplicate) {
          setSetupError(`Another bot in this hospital already has the name "${bName}". Please choose a different name.`);
          return;
        }
      } catch (e) {
        // Proceed anyway if check fails
      }
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
          if (data.status === "Engaged") {
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
        totalAccesses: 0,
        totalSecondsUsed: 0
      }, { merge: true });

      setSetupStep(2);
      setBotStatus(currentStatus);
    } catch (err) {
      console.error("Failed to register bot:", err);
      setSetupError("Failed to go online.");
    }
  };

  useEffect(() => {
    if (setupStep !== 2 || !selectedBotId) return;

    const botRef = doc(db, "navatars", selectedBotId);
    const unsubscribe = onSnapshot(botRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setBotStatus(data.status);

        if (data.status === "Engaged") {
          setActiveDoctorName(data.activeDoctorName || "Doctor");
          setJoined(true);
        } else {
          setActiveDoctorName(null);
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

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = new Date();
      const sessions = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => {
          const [eH, eM] = (b.end_time || "23:59:00").split(':').map(Number);
          const endDate = new Date(b.date);
          endDate.setHours(eH, eM, 0, 0);
          return endDate > now;
        })
        .sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return a.start_time.localeCompare(b.start_time);
        });

      setUpcomingBookings(sessions);

      const activeSession = sessions.find(b => {
        const [sH, sM] = (b.start_time || "00:00").split(':').map(Number);
        const [eH, eM] = (b.end_time || "23:59").split(':').map(Number);
        const startDate = new Date(b.date);
        startDate.setHours(sH, sM, 0, 0);
        const endDate = new Date(b.date);
        endDate.setHours(eH, eM, 0, 0);
        const isActive = now >= startDate && now <= endDate;
        return isActive;
      });

      if (activeSession) {
        console.log("[Auto-Join] Active session found:", activeSession.id);
        setActiveDoctorName(activeSession.doctorName || "Doctor");
        setJoined(true);
        updateDoc(doc(db, "navatars", selectedBotId), { 
          status: "Engaged",
          activeDoctorId: activeSession.doctorId || null,
          activeDoctorName: activeSession.doctorName || "Doctor"
        }).catch(() => {});
      }
    }, (err) => {
      console.error("Booking listener error:", err);
    });

    return () => unsubscribe();
  }, [setupStep, selectedBotId]);

  useEffect(() => {
    if (setupStep !== 2 || !selectedBotId || joined) return;

    const interval = setInterval(() => {
      const now = new Date();
      const active = upcomingBookings.find(b => {
        const [sH, sM] = (b.start_time || "00:00").split(':').map(Number);
        const [eH, eM] = (b.end_time || "23:59").split(':').map(Number);
        const startDate = new Date(b.date);
        startDate.setHours(sH, sM, 0, 0);
        const endDate = new Date(b.date);
        endDate.setHours(eH, eM, 0, 0);
        return now >= startDate && now <= endDate;
      });

      if (active) {
        console.log("[Auto-Join Timer] Found active session:", active.id);
        setActiveDoctorName(active.doctorName || "Doctor");
        setJoined(true);
        updateDoc(doc(db, "navatars", selectedBotId), { 
          status: "Engaged",
          activeDoctorId: active.doctorId || null,
          activeDoctorName: active.doctorName || "Doctor"
        }).catch(() => {});
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [setupStep, selectedBotId, joined, upcomingBookings]);

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
    const user = { name: botName || `Navatar-${selectedBotId}`, email: `${selectedBotId}@navatar.com`, isVideoOn: true, isAudioOn: true };
    return <ConferencePage user={user} room={selectedBotId} onLeave={() => setJoined(false)} />;
  }

  return (
    <div style={{ ...styles.container, position: 'relative' }}>
      <button onClick={handleResetSetup} style={styles.configBtn}><Settings size={18} /> Configure</button>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '10px' }}>{botName || `Navatar-${selectedBotId}`}</h1>
      <p style={{ color: '#94a3b8', marginBottom: '40px' }}>ID: {selectedBotId} | {hospitalName}</p>
      {upcomingBookings.length > 0 && (
        <div style={{ width: '400px' }}>
          <h4>📅 Upcoming Sessions ({upcomingBookings.length})</h4>
          {upcomingBookings.slice(0, 5).map((b) => (
            <div key={b.id} style={{ background: '#1e293b', padding: '12px', borderRadius: '10px', marginTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
              <div><b>Dr. {b.doctorName}</b><br/><small>{b.date}</small></div>
              <div style={{ color: '#3b82f6' }}>{b.start_time} – {b.end_time}</div>
            </div>
          ))}
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
  configBtn: { position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', display: 'flex', gap: '5px' }
};
