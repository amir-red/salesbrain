import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSession } from '@/lib/auth';
import { kernelCall } from '@/lib/mcp/kernel-rpc';

/**
 * Brand & Voice (core 079). GET ?brand=zeami → the list of brands (direct read) and one brand in full through the
 * kernel (crm_brand_get): fields, products, competitors, templates, what is missing.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('brand') || 'zeami';
  try {
    const { rows: brands } = await pool.query('SELECT key, name FROM brands ORDER BY key');
    const out = await kernelCall('crm_brand_get', { brand: key }, session.userId);
    return NextResponse.json({ brands, ...out }, { status: out.error ? 404 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
