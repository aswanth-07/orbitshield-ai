import type { FleetDefinition } from './types';

export const INDIA_EO_FLEET: FleetDefinition = {
  id: 'india-eo',
  name: 'India Earth Observation Fleet',
  description: 'A judge-ready watchlist of six active Indian Earth-observation missions.',
  objects: [
    { catalogId: 41877, name: 'RESOURCESAT-2A', shortName: 'Resourcesat-2A', mission: 'Land and resource monitoring' },
    { catalogId: 44804, name: 'CARTOSAT-3', shortName: 'Cartosat-3', mission: 'High-resolution Earth imaging' },
    { catalogId: 44233, name: 'RISAT-2B', shortName: 'RISAT-2B', mission: 'Radar Earth observation' },
    { catalogId: 54361, name: 'EOS-6 (OCEANSAT-3)', shortName: 'EOS-6', mission: 'Ocean and climate observation' },
    { catalogId: 43111, name: 'CARTOSAT-2F', shortName: 'Cartosat-2F', mission: 'Cartographic imaging' },
    { catalogId: 37387, name: 'RESOURCESAT-2', shortName: 'Resourcesat-2', mission: 'Natural-resource monitoring' },
  ],
};

export const INDIA_EO_IDS = new Set(INDIA_EO_FLEET.objects.map((item) => item.catalogId));
