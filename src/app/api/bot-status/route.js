import { db } from "@/context/firebase";
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { botId, status, sessionId } = await request.json();
    if (!botId) {
      return NextResponse.json({ error: "Bot ID is required" }, { status: 400 });
    }

    const botRef = doc(db, "navatars", botId);

    // If setting to Offline, verify it's from the same session to prevent race conditions during refresh
    if (status === "Offline" && sessionId) {
      const botSnap = await getDoc(botRef);
      if (botSnap.exists()) {
        const currentData = botSnap.data();
        if (currentData.lastSessionId && currentData.lastSessionId !== sessionId) {
          console.log(`[API] Skipping Offline update for ${botId}: Session ID mismatch (got ${sessionId}, current ${currentData.lastSessionId})`);
          return NextResponse.json({ success: true, message: "Ignored stale session cleanup" });
        }
      }
    }

    await updateDoc(botRef, { 
      status: status || "Offline" 
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating bot status via API:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
