import { CATALOG_DISTRICT_LABELS, CATALOG_DISTRICT_ORDER } from './config.js';

const SAN_VERDE_CATALOG_MODULES = import.meta.glob('../../game/bloomville/catalogs/*.json', {
  eager: true,
  import: 'default'
});

function toTitleCase(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function loadCatalogEntries() {
  const entries = Object.values(SAN_VERDE_CATALOG_MODULES)
    .flatMap((pack) => Array.isArray(pack?.entries) ? pack.entries : [])
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string');

  return entries
    .map((entry) => ({
      id: entry.id,
      label: entry.label || toTitleCase(entry.id),
      districts: Array.isArray(entry.districts) ? entry.districts.slice() : [],
      lot: entry.lot || null
    }))
    .sort((a, b) => {
      const districtA = a.districts[0] || '';
      const districtB = b.districts[0] || '';
      const districtIndexA = Math.max(0, CATALOG_DISTRICT_ORDER.indexOf(districtA));
      const districtIndexB = Math.max(0, CATALOG_DISTRICT_ORDER.indexOf(districtB));
      if (districtIndexA !== districtIndexB) {
        return districtIndexA - districtIndexB;
      }
      return a.label.localeCompare(b.label);
    });
}

export function fillZoneTypeOptions(select) {
  if (!select) return;
  select.innerHTML = '';
  for (const district of CATALOG_DISTRICT_ORDER) {
    const option = document.createElement('option');
    option.value = district;
    option.textContent = CATALOG_DISTRICT_LABELS[district] || district;
    if (district === 'residential_mid') {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

export function fillCatalogEntryOptions(select, entries, { district = '', includeAuto = true } = {}) {
  if (!select) return;

  const previousValue = select.value;
  const fragment = document.createDocumentFragment();

  if (includeAuto) {
    const autoOption = document.createElement('option');
    autoOption.value = '';
    autoOption.textContent = 'Auto / Zone Default';
    fragment.appendChild(autoOption);
  }

  const filteredEntries = entries.filter((entry) => {
    if (!district) return true;
    return entry.districts.includes(district);
  });

  for (const entry of filteredEntries) {
    const option = document.createElement('option');
    const districtLabel = entry.districts[0] ? (CATALOG_DISTRICT_LABELS[entry.districts[0]] || entry.districts[0]) : 'Unassigned';
    option.value = entry.id;
    option.textContent = `${entry.label} (${districtLabel})`;
    fragment.appendChild(option);
  }

  select.innerHTML = '';
  select.appendChild(fragment);
  if (previousValue && [...select.options].some((option) => option.value === previousValue)) {
    select.value = previousValue;
  }
}

export function findCatalogEntry(entries, entryId) {
  return entries.find((entry) => entry.id === entryId) || null;
}
