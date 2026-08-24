import { NextResponse } from 'next/server';

import { getConjunctions, getThreats } from '../../lib/server-data';

export const runtime = 'edge';

export async function GET() {
  const conjunctions = await getConjunctions();
  const threats = await getThreats();
  return NextResponse.json({ conjunctions, threats, refreshedAt: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=7200' },
  });
}
