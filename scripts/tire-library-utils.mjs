import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');
export const tireLibrarySrcPath = path.join(root, 'src', 'assets', 'tire-library.json');
export const tireLibraryPublicPath = path.join(root, 'public', 'data', 'tire-library.json');

function createError(message, sourcePath) {
  return new Error(sourcePath ? `${message} (${sourcePath})` : message);
}

function assertString(value, fieldName, sourcePath) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createError(`Expected non-empty string for "${fieldName}"`, sourcePath);
  }
  return value.trim();
}

function assertOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function normalizeTireRecord(record, sourcePath = '') {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw createError('Expected tire record object', sourcePath);
  }

  return {
    id: assertString(record.id, 'id', sourcePath),
    label: assertString(record.label, 'label', sourcePath),
    url: assertString(record.url, 'url', sourcePath),
    sourceLabel: assertOptionalString(record.sourceLabel) || `public${assertString(record.url, 'url', sourcePath)}`,
    notes: assertOptionalString(record.notes)
  };
}

export function compareTireRecords(left, right) {
  return String(left.label || left.id).localeCompare(String(right.label || right.id));
}

export function loadTireLibrary() {
  const payload = readJsonFile(tireLibrarySrcPath);
  const tires = Array.isArray(payload?.tires) ? payload.tires : [];
  return tires.map((record) => normalizeTireRecord(record, tireLibrarySrcPath)).sort(compareTireRecords);
}

export function createTireLibraryPayload() {
  return {
    tires: loadTireLibrary()
  };
}

export function writeTireLibrary(tires) {
  const normalized = tires.map((record) => normalizeTireRecord(record)).sort(compareTireRecords);
  const payload = { tires: normalized };
  writeJsonFile(tireLibrarySrcPath, payload);
  writeJsonFile(tireLibraryPublicPath, payload);
  return payload;
}
