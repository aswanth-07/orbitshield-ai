import { NextRequest, NextResponse } from 'next/server';

import { getCatalog } from '../../lib/server-data';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const catnr = request.nextUrl.searchParams.get('catnr');
  const ids = catnr
    ? catnr.split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : undefined;
  const result = await getCatalog(ids);
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=7200, stale-while-revalidate=86400' },
  });
}

