import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import {
  builtInVehiclesDir,
  createVehicleRegistry,
  loadVehicleManifests,
  normalizeVehicleManifest,
  publicVehicleRegistryPath,
  writeJsonFile
} from './scripts/vehicle-manifest-utils.mjs';
import {
  createTireLibraryPayload,
  loadTireLibrary,
  normalizeTireRecord,
  tireLibraryPublicPath,
  writeTireLibrary
} from './scripts/tire-library-utils.mjs';
import {
  createWeaponLibraryPayload,
  loadWeaponLibrary,
  normalizeWeaponRecord,
  weaponLibraryPublicPath,
  writeWeaponLibrary
} from './scripts/weapon-library-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PRODUCTION_BASE = '/san_verde/';
const SAN_VERDE_PUBLIC_PATH = path.join(__dirname, 'public/data/san-verde-map.json');
const SAN_VERDE_SRC_PATH = path.join(__dirname, 'src/game/san-verde-map.json');
const PUBLIC_MODELS_PATH = path.join(__dirname, 'public/models');
const TMP_ROOT = path.join(__dirname, '.tmp', 'vehicle-validator');
const MUSTANG_REFERENCE_PATH = path.join(__dirname, 'public/models/mustang.glb');
const AUTO_LOCATOR_SCRIPT_PATH = path.join(__dirname, 'scripts/auto_place_vehicle_locators.py');
const execFileAsync = promisify(execFile);

function normalizeBasePath(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

function jsonResponse(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body.length > 0 ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function readBinaryBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function getEditorFilename(req, fallback = '') {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const queryFilename = url.searchParams.get('filename');
  const headerFilename = req.headers['x-asset-filename'];
  return String(queryFilename || headerFilename || fallback || '');
}

function attachSanVerdeMapRoute(middlewares) {
  middlewares.use('/__editor/san-verde-map', async (req, res, next) => {
    if (req.method === 'GET') {
      try {
        const contents = await fs.readFile(SAN_VERDE_PUBLIC_PATH, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(contents);
      } catch (error) {
        jsonResponse(res, 500, {
          error: 'Failed to read San Verde map.',
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        const formatted = `${JSON.stringify(payload, null, 2)}\n`;
        await fs.writeFile(SAN_VERDE_PUBLIC_PATH, formatted, 'utf8');
        await fs.writeFile(SAN_VERDE_SRC_PATH, formatted, 'utf8');
        jsonResponse(res, 200, {
          ok: true,
          publicPath: 'public/data/san-verde-map.json',
          sourcePath: 'src/game/san-verde-map.json'
        });
      } catch (error) {
        jsonResponse(res, 500, {
          error: 'Failed to save San Verde map.',
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    next();
  });
}

async function rebuildVehicleRegistry() {
  const registry = createVehicleRegistry();
  writeJsonFile(publicVehicleRegistryPath, registry);
  return registry;
}

async function rebuildTireLibrary() {
  const payload = createTireLibraryPayload();
  writeJsonFile(tireLibraryPublicPath, payload);
  return payload;
}

async function rebuildWeaponLibrary() {
  const payload = createWeaponLibraryPayload();
  writeJsonFile(weaponLibraryPublicPath, payload);
  return payload;
}

async function saveVehicleManifest(payload) {
  const previousId = typeof payload.previousId === 'string' ? payload.previousId.trim() : '';
  const manifest = normalizeVehicleManifest(payload.manifest);
  const targetPath = path.join(builtInVehiclesDir, `${manifest.id}.json`);

  writeJsonFile(targetPath, manifest);

  if (previousId && previousId !== manifest.id) {
    const previousPath = path.join(builtInVehiclesDir, `${previousId}.json`);
    try {
      await fs.unlink(previousPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const registry = await rebuildVehicleRegistry();
  return {
    manifest,
    registry
  };
}

async function deleteVehicleManifest(payload) {
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!id) {
    throw new Error('Vehicle id is required.');
  }

  const targetPath = path.join(builtInVehiclesDir, `${id}.json`);
  await fs.unlink(targetPath);
  const registry = await rebuildVehicleRegistry();
  return registry;
}

async function saveTireRecord(payload) {
  const previousId = typeof payload.previousId === 'string' ? payload.previousId.trim() : '';
  const record = normalizeTireRecord(payload.record);
  const tires = loadTireLibrary().filter((entry) => entry.id !== previousId && entry.id !== record.id);
  tires.push(record);
  const library = writeTireLibrary(tires);
  return {
    record,
    library
  };
}

async function deleteTireRecord(payload) {
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!id) {
    throw new Error('Tire id is required.');
  }

  const tires = loadTireLibrary().filter((entry) => entry.id !== id);
  return writeTireLibrary(tires);
}

async function saveWeaponRecord(payload) {
  const previousId = typeof payload.previousId === 'string' ? payload.previousId.trim() : '';
  const record = normalizeWeaponRecord(payload.record);
  const weapons = loadWeaponLibrary().filter((entry) => entry.id !== previousId && entry.id !== record.id);
  weapons.push(record);
  const library = writeWeaponLibrary(weapons);
  return {
    record,
    library
  };
}

async function deleteWeaponRecord(payload) {
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!id) {
    throw new Error('Weapon id is required.');
  }

  const weapons = loadWeaponLibrary().filter((entry) => entry.id !== id);
  return writeWeaponLibrary(weapons);
}

function attachVehicleAssetRoutes(middlewares) {
  middlewares.use('/__editor/vehicles', async (req, res, next) => {
    if (req.method === 'GET') {
      try {
        jsonResponse(res, 200, {
          vehicles: loadVehicleManifests(),
          registryPath: 'public/data/vehicle-registry.json'
        });
      } catch (error) {
        jsonResponse(res, 500, {
          error: 'Failed to read vehicle manifests.',
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (req.method !== 'POST') {
      next();
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const action = typeof payload.action === 'string' ? payload.action.trim() : '';

      if (action === 'save') {
        const result = await saveVehicleManifest(payload);
        jsonResponse(res, 200, {
          ok: true,
          vehicle: result.manifest,
          vehicles: loadVehicleManifests(),
          registryPath: 'public/data/vehicle-registry.json',
          registry: result.registry
        });
        return;
      }

      if (action === 'delete') {
        const registry = await deleteVehicleManifest(payload);
        jsonResponse(res, 200, {
          ok: true,
          vehicles: loadVehicleManifests(),
          registryPath: 'public/data/vehicle-registry.json',
          registry
        });
        return;
      }

      if (action === 'rebuild') {
        const registry = await rebuildVehicleRegistry();
        jsonResponse(res, 200, {
          ok: true,
          vehicles: loadVehicleManifests(),
          registryPath: 'public/data/vehicle-registry.json',
          registry
        });
        return;
      }

      jsonResponse(res, 400, {
        error: 'Unknown vehicle action.',
        action
      });
    } catch (error) {
      jsonResponse(res, 500, {
        error: 'Failed to process vehicle asset request.',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function attachTireAssetRoutes(middlewares) {
  middlewares.use('/__editor/tires', async (req, res, next) => {
    if (req.method === 'GET') {
      try {
        jsonResponse(res, 200, {
          tires: loadTireLibrary(),
          libraryPath: 'public/data/tire-library.json'
        });
      } catch (error) {
        jsonResponse(res, 500, {
          error: 'Failed to read tire library.',
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (req.method !== 'POST') {
      next();
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const action = typeof payload.action === 'string' ? payload.action.trim() : '';

      if (action === 'save') {
        const result = await saveTireRecord(payload);
        jsonResponse(res, 200, {
          ok: true,
          tire: result.record,
          tires: loadTireLibrary(),
          libraryPath: 'public/data/tire-library.json',
          library: result.library
        });
        return;
      }

      if (action === 'delete') {
        const library = await deleteTireRecord(payload);
        jsonResponse(res, 200, {
          ok: true,
          tires: loadTireLibrary(),
          libraryPath: 'public/data/tire-library.json',
          library
        });
        return;
      }

      if (action === 'rebuild') {
        const library = await rebuildTireLibrary();
        jsonResponse(res, 200, {
          ok: true,
          tires: loadTireLibrary(),
          libraryPath: 'public/data/tire-library.json',
          library
        });
        return;
      }

      jsonResponse(res, 400, {
        error: 'Unknown tire action.',
        action
      });
    } catch (error) {
      jsonResponse(res, 500, {
        error: 'Failed to process tire asset request.',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function attachWeaponAssetRoutes(middlewares) {
  middlewares.use('/__editor/weapons', async (req, res, next) => {
    if (req.method === 'GET') {
      try {
        jsonResponse(res, 200, {
          weapons: loadWeaponLibrary(),
          libraryPath: 'public/data/weapon-library.json'
        });
      } catch (error) {
        jsonResponse(res, 500, {
          error: 'Failed to read weapon library.',
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    if (req.method !== 'POST') {
      next();
      return;
    }

    try {
      const payload = await readJsonBody(req);
      const action = typeof payload.action === 'string' ? payload.action.trim() : '';

      if (action === 'save') {
        const result = await saveWeaponRecord(payload);
        jsonResponse(res, 200, {
          ok: true,
          weapon: result.record,
          weapons: loadWeaponLibrary(),
          libraryPath: 'public/data/weapon-library.json',
          library: result.library
        });
        return;
      }

      if (action === 'delete') {
        const library = await deleteWeaponRecord(payload);
        jsonResponse(res, 200, {
          ok: true,
          weapons: loadWeaponLibrary(),
          libraryPath: 'public/data/weapon-library.json',
          library
        });
        return;
      }

      if (action === 'rebuild') {
        const library = await rebuildWeaponLibrary();
        jsonResponse(res, 200, {
          ok: true,
          weapons: loadWeaponLibrary(),
          libraryPath: 'public/data/weapon-library.json',
          library
        });
        return;
      }

      jsonResponse(res, 400, {
        error: 'Unknown weapon action.',
        action
      });
    } catch (error) {
      jsonResponse(res, 500, {
        error: 'Failed to process weapon asset request.',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function sanitizeModelFilename(filename) {
  const trimmed = typeof filename === 'string' ? filename.trim() : '';
  const base = path.basename(trimmed);

  if (!base || !base.toLowerCase().endsWith('.glb')) {
    throw new Error('Model filename must end with .glb');
  }

  return base.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function attachVehicleModelRoutes(middlewares) {
  middlewares.use('/__editor/vehicle-models', async (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    try {
      let filename = '';
      let buffer = null;
      const contentType = String(req.headers['content-type'] || '');

      if (contentType.includes('application/octet-stream')) {
        filename = sanitizeModelFilename(getEditorFilename(req));
        buffer = await readBinaryBody(req);
      } else {
        const payload = await readJsonBody(req);
        filename = sanitizeModelFilename(payload.filename);
        const glbBase64 = typeof payload.glbBase64 === 'string' ? payload.glbBase64.trim() : '';
        if (!glbBase64) {
          throw new Error('GLB payload is required.');
        }
        buffer = Buffer.from(glbBase64, 'base64');
      }

      if (!buffer?.length) {
        throw new Error('GLB payload is required.');
      }

      const outputPath = path.join(PUBLIC_MODELS_PATH, filename);
      await fs.mkdir(PUBLIC_MODELS_PATH, { recursive: true });
      await fs.writeFile(outputPath, buffer);

      jsonResponse(res, 200, {
        ok: true,
        url: `/models/${filename}`,
        sourceLabel: `public/models/${filename}`
      });
    } catch (error) {
      jsonResponse(res, 500, {
        error: 'Failed to save validated vehicle GLB.',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function attachTireModelRoutes(middlewares) {
  middlewares.use('/__editor/tire-models', async (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    try {
      let filename = '';
      let buffer = null;
      const contentType = String(req.headers['content-type'] || '');

      if (contentType.includes('application/octet-stream')) {
        filename = sanitizeModelFilename(getEditorFilename(req));
        buffer = await readBinaryBody(req);
      } else {
        const payload = await readJsonBody(req);
        filename = sanitizeModelFilename(payload.filename);
        const glbBase64 = typeof payload.glbBase64 === 'string' ? payload.glbBase64.trim() : '';
        if (!glbBase64) {
          throw new Error('GLB payload is required.');
        }
        buffer = Buffer.from(glbBase64, 'base64');
      }

      if (!buffer?.length) {
        throw new Error('GLB payload is required.');
      }

      const outputPath = path.join(PUBLIC_MODELS_PATH, filename);
      await fs.mkdir(PUBLIC_MODELS_PATH, { recursive: true });
      await fs.writeFile(outputPath, buffer);

      jsonResponse(res, 200, {
        ok: true,
        url: `/models/${filename}`,
        sourceLabel: `public/models/${filename}`
      });
    } catch (error) {
      jsonResponse(res, 500, {
        error: 'Failed to save tire GLB.',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function attachWeaponModelRoutes(middlewares) {
  middlewares.use('/__editor/weapon-models', async (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    try {
      let filename = '';
      let buffer = null;
      const contentType = String(req.headers['content-type'] || '');

      if (contentType.includes('application/octet-stream')) {
        filename = sanitizeModelFilename(getEditorFilename(req));
        buffer = await readBinaryBody(req);
      } else {
        const payload = await readJsonBody(req);
        filename = sanitizeModelFilename(payload.filename);
        const glbBase64 = typeof payload.glbBase64 === 'string' ? payload.glbBase64.trim() : '';
        if (!glbBase64) {
          throw new Error('GLB payload is required.');
        }
        buffer = Buffer.from(glbBase64, 'base64');
      }

      if (!buffer?.length) {
        throw new Error('GLB payload is required.');
      }

      const outputPath = path.join(PUBLIC_MODELS_PATH, filename);
      await fs.mkdir(PUBLIC_MODELS_PATH, { recursive: true });
      await fs.writeFile(outputPath, buffer);

      jsonResponse(res, 200, {
        ok: true,
        url: `/models/${filename}`,
        sourceLabel: `public/models/${filename}`
      });
    } catch (error) {
      jsonResponse(res, 500, {
        error: 'Failed to save weapon GLB.',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

async function runVehicleAutoLocator({ filename, glbBase64 }) {
  const safeFilename = sanitizeModelFilename(filename);
  const outputFilename = safeFilename.replace(/\.glb$/i, '-validated.glb');
  const workId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const workDir = path.join(TMP_ROOT, workId);
  const inputPath = path.join(workDir, safeFilename);
  const outputPath = path.join(PUBLIC_MODELS_PATH, outputFilename);
  const reportPath = path.join(workDir, 'report.json');

  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(PUBLIC_MODELS_PATH, { recursive: true });
  await fs.writeFile(inputPath, Buffer.from(glbBase64, 'base64'));

  const args = [
    AUTO_LOCATOR_SCRIPT_PATH,
    '--reference',
    MUSTANG_REFERENCE_PATH,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--report',
    reportPath
  ];

  const result = await execFileAsync('python3', args, {
    cwd: __dirname,
    maxBuffer: 20 * 1024 * 1024
  });

  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  return {
    url: `/models/${outputFilename}`,
    sourceLabel: `public/models/${outputFilename}`,
    stdout: result.stdout,
    stderr: result.stderr,
    report
  };
}

async function runVehicleAutoLocatorFromBuffer({ filename, buffer }) {
  const safeFilename = sanitizeModelFilename(filename);
  const outputFilename = safeFilename.replace(/\.glb$/i, '-validated.glb');
  const workId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const workDir = path.join(TMP_ROOT, workId);
  const inputPath = path.join(workDir, safeFilename);
  const outputPath = path.join(PUBLIC_MODELS_PATH, outputFilename);
  const reportPath = path.join(workDir, 'report.json');

  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(PUBLIC_MODELS_PATH, { recursive: true });
  await fs.writeFile(inputPath, buffer);

  const args = [
    AUTO_LOCATOR_SCRIPT_PATH,
    '--reference',
    MUSTANG_REFERENCE_PATH,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--report',
    reportPath
  ];

  const result = await execFileAsync('python3', args, {
    cwd: __dirname,
    maxBuffer: 20 * 1024 * 1024
  });

  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  return {
    url: `/models/${outputFilename}`,
    sourceLabel: `public/models/${outputFilename}`,
    stdout: result.stdout,
    stderr: result.stderr,
    report
  };
}

function attachVehicleAutoLocatorRoutes(middlewares) {
  middlewares.use('/__editor/vehicle-auto-locate', async (req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    try {
      let result = null;
      const contentType = String(req.headers['content-type'] || '');

      if (contentType.includes('application/octet-stream')) {
        const filename = sanitizeModelFilename(getEditorFilename(req));
        const buffer = await readBinaryBody(req);
        if (!buffer?.length) {
          throw new Error('GLB payload is required.');
        }
        result = await runVehicleAutoLocatorFromBuffer({
          filename,
          buffer
        });
      } else {
        const payload = await readJsonBody(req);
        const filename = sanitizeModelFilename(payload.filename);
        const glbBase64 = typeof payload.glbBase64 === 'string' ? payload.glbBase64.trim() : '';

        if (!glbBase64) {
          throw new Error('GLB payload is required.');
        }

        result = await runVehicleAutoLocator({
          filename,
          glbBase64
        });
      }

      jsonResponse(res, 200, {
        ok: true,
        url: result.url,
        sourceLabel: result.sourceLabel,
        report: result.report
      });
    } catch (error) {
      jsonResponse(res, 500, {
        error: 'Failed to auto-place vehicle locators.',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function editorPlugin() {
  return {
    name: 'editor-plugin',
    configureServer(server) {
      attachSanVerdeMapRoute(server.middlewares);
      attachVehicleAssetRoutes(server.middlewares);
      attachTireAssetRoutes(server.middlewares);
      attachWeaponAssetRoutes(server.middlewares);
      attachVehicleModelRoutes(server.middlewares);
      attachTireModelRoutes(server.middlewares);
      attachWeaponModelRoutes(server.middlewares);
      attachVehicleAutoLocatorRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      attachSanVerdeMapRoute(server.middlewares);
      attachVehicleAssetRoutes(server.middlewares);
      attachTireAssetRoutes(server.middlewares);
      attachWeaponAssetRoutes(server.middlewares);
      attachVehicleModelRoutes(server.middlewares);
      attachTireModelRoutes(server.middlewares);
      attachWeaponModelRoutes(server.middlewares);
      attachVehicleAutoLocatorRoutes(server.middlewares);
    }
  };
}

export default defineConfig(({ command }) => {
  const configuredBase = normalizeBasePath(process.env.VITE_BASE_PATH || '');
  const base = configuredBase === '/'
    ? (command === 'build' ? DEFAULT_PRODUCTION_BASE : '/')
    : configuredBase;

  return {
    base,
    plugins: [solid(), editorPlugin()],
    resolve: {
      alias: [{ find: /^three$/, replacement: 'three/webgpu' }]
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          assets: path.resolve(__dirname, 'asset-manager.html'),
          buildings: path.resolve(__dirname, 'building-manager.html')
        }
      }
    }
  };
});
