import { NextResponse } from 'next/server';
import type { Built } from '@/lib/export/build';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function xlsxResponse(b: Built): NextResponse {
  return new NextResponse(new Uint8Array(b.buffer), {
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${b.filename}"`,
      'Content-Length': String(b.buffer.length),
      'Cache-Control': 'no-store',
      'X-Export-Rows': String(b.rows),
    },
  });
}
