import { NextRequest, NextResponse } from 'next/server';

import type { SatelliteMedia } from '../../lib/types';

export const runtime = 'edge';

const USER_AGENT = 'OrbitShield-AI/1.0 college prototype (github.com/aswanth-07/orbitshield-ai)';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const MEDIA_ALIASES: Record<number, string> = {
  41877: 'Resourcesat-2A satellite',
  44804: 'Cartosat-3 satellite',
  44233: 'RISAT-2B satellite',
  54361: 'Oceansat-3 satellite',
  43111: 'Cartosat-2F satellite',
  37387: 'Resourcesat-2 satellite',
};

type CommonsMetadata = { value?: string };
type CommonsImage = {
  thumburl?: string;
  descriptionurl?: string;
  mime?: string;
  extmetadata?: Record<string, CommonsMetadata>;
};
type CommonsPage = { title?: string; index?: number; imageinfo?: CommonsImage[] };
type CommonsResponse = { query?: { pages?: Record<string, CommonsPage> } };

function plainText(value?: string) {
  return value?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function cleanObjectName(value: string) {
  return value
    .replace(/\s*\[[+?−-]\]\s*$/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export async function GET(request: NextRequest) {
  const catalogId = Number(request.nextUrl.searchParams.get('catnr'));
  const suppliedName = cleanObjectName(request.nextUrl.searchParams.get('name') ?? '');
  const searchName = MEDIA_ALIASES[catalogId] ?? `${suppliedName} satellite`.trim();
  if (!searchName || searchName === 'satellite') {
    return NextResponse.json<SatelliteMedia>({
      status: 'unavailable',
      source: 'Wikimedia Commons',
      message: 'A satellite name is required to search for verified public media.',
    }, { status: 400 });
  }

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: searchName,
    gsrnamespace: '6',
    gsrlimit: '6',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '960',
    format: 'json',
    origin: '*',
  });

  try {
    const response = await fetch(`${COMMONS_API}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Wikimedia returned HTTP ${response.status}`);
    const payload = await response.json() as CommonsResponse;
    const page = Object.values(payload.query?.pages ?? {})
      .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
      .find((candidate) => {
        const mime = candidate.imageinfo?.[0]?.mime ?? '';
        return mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
      });
    const image = page?.imageinfo?.[0];
    if (!page?.title || !image?.thumburl) throw new Error('No verified raster image was found');
    const metadata = image.extmetadata ?? {};
    return NextResponse.json<SatelliteMedia>({
      status: 'available',
      title: page.title.replace(/^File:/, ''),
      imageUrl: image.thumburl,
      description: plainText(metadata.ImageDescription?.value)?.slice(0, 320),
      license: plainText(metadata.LicenseShortName?.value) || plainText(metadata.License?.value) || 'See source',
      author: plainText(metadata.Artist?.value)?.slice(0, 120),
      pageUrl: image.descriptionurl,
      source: 'Wikimedia Commons',
    }, {
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000' },
    });
  } catch (error) {
    return NextResponse.json<SatelliteMedia>({
      status: 'unavailable',
      source: 'Wikimedia Commons',
      message: error instanceof Error ? error.message : 'No verified public image was found.',
    }, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    });
  }
}
