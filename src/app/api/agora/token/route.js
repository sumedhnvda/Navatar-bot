import { NextResponse } from 'next/server';
import { RtcTokenBuilder, RtcRole } from 'agora-token';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const channelName = searchParams.get('channelName');
  const uid = searchParams.get('uid') || '0';

  if (!channelName) {
    return NextResponse.json({ error: 'channelName is required' }, { status: 400 });
  }

  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;

  if (!appId || !appCertificate) {
    return NextResponse.json({ 
      error: 'Agora credentials missing on server context.',
      tip: 'Ensure NEXT_PUBLIC_AGORA_APP_ID and AGORA_APP_CERTIFICATE are in .env.local or Vercel dashboard.' 
    }, { status: 500 });
  }

  const role = RtcRole.PUBLISHER;
  const expirationTimeInSeconds = 3600; // 1 hour
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpireTime = currentTimestamp + expirationTimeInSeconds;

  try {
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      parseInt(uid),
      role,
      privilegeExpireTime
    );
    return NextResponse.json({ token, appId });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to build token', details: err.message }, { status: 500 });
  }
}
