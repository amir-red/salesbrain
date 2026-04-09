import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pool from '@/lib/db';
import { verifyPassword, setSession } from '@/lib/auth';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const { rows } = await pool.query(
    'SELECT id, email, name, password_hash FROM users WHERE email = $1',
    [email]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const user = rows[0];
  const valid = await verifyPassword(password, user.password_hash);

  if (!valid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  await setSession({ userId: user.id, email: user.email, name: user.name });

  return NextResponse.json({ id: user.id, email: user.email, name: user.name });
}
