import { db } from "@/context/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const { botId, status } = await request.json();
    if (!botId) {
      return NextResponse.json({ error: "Bot ID is required" }, { status: 400 });
    }

    const botRef = doc(db, "navatars", botId);
    await updateDoc(botRef, { 
      status: status || "Offline" 
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating bot status via API:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
