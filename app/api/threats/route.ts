import { NextResponse } from 'next/server';

import { getThreats } from '../../lib/server-data';

export const runtime = 'edge';

export async function GET() {
  const result = await getThreats();
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=43200' },
  });
}
