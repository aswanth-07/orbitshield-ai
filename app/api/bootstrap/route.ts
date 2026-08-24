import { NextResponse } from 'next/server';

import { getBundledScreening } from '../../lib/server-data';

export const runtime = 'edge';

export async function GET() {
  return NextResponse.json(getBundledScreening(), {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=86400' },
  });
}
