import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { exec_send_outreach_message } from '@/lib/prospect-executors';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await exec_send_outreach_message({ message_id: params.id });
  if (result.error) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
