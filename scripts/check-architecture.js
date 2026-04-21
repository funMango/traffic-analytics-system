'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const JS_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

const LAYERS = ['domain', 'application', 'infrastructure', 'presentation', 'bootstrap'];

const FORBIDDEN_IMPORTS = {
  domain: new Set(['application', 'infrastructure', 'presentation', 'bootstrap']),
  application: new Set(['infrastructure', 'presentation', 'bootstrap']),
  infrastructure: new Set(['presentation']),
  presentation: new Set(['infrastructure']),
  bootstrap: new Set([]),
};

function collectFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(entryPath));
      continue;
    }
    if (JS_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(entryPath);
    }
  }
  return results;
}

function detectLayerByPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  for (const layer of LAYERS) {
    if (normalized.includes(`/${layer}/`)) {
      return layer;
    }
  }
  if (normalized.includes('/bootstrap/')) {
    return 'bootstrap';
  }
  return null;
}

function parseRequireTargets(source) {
  const targets = [];
  const requireRegex = /require\((['"])([^'"]+)\1\)/g;
  let match;
  while ((match = requireRegex.exec(source)) !== null) {
    targets.push(match[2]);
  }
  return targets;
}

function resolveLayer(fromFile, target) {
  if (!target.startsWith('.')) {
    return null;
  }

  const resolvedPath = path.resolve(path.dirname(fromFile), target);
  const withJs = `${resolvedPath}.js`;
  const withIndexJs = path.join(resolvedPath, 'index.js');

  let finalPath = null;
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    finalPath = resolvedPath;
  } else if (fs.existsSync(withJs)) {
    finalPath = withJs;
  } else if (fs.existsSync(withIndexJs)) {
    finalPath = withIndexJs;
  } else {
    return null;
  }

  const rel = path.relative(SRC_DIR, finalPath);
  if (rel.startsWith('..')) {
    return null;
  }

  return detectLayerByPath(finalPath);
}

function run() {
  if (!fs.existsSync(SRC_DIR)) {
    console.log('[architecture-check] skip: src directory does not exist');
    return;
  }

  const files = collectFiles(SRC_DIR);
  const violations = [];

  for (const file of files) {
    const layer = detectLayerByPath(file);
    if (!layer) continue;

    const forbidden = FORBIDDEN_IMPORTS[layer];
    if (!forbidden || forbidden.size === 0) continue;

    const source = fs.readFileSync(file, 'utf8');
    const targets = parseRequireTargets(source);
    for (const target of targets) {
      const importedLayer = resolveLayer(file, target);
      if (!importedLayer) continue;
      if (forbidden.has(importedLayer)) {
        violations.push({
          file: path.relative(ROOT_DIR, file),
          target,
          layer,
          importedLayer,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error('[architecture-check] failed');
    for (const violation of violations) {
      console.error(
        ` - ${violation.file}: ${violation.layer} -> ${violation.importedLayer} import is forbidden (${violation.target})`
      );
    }
    process.exit(1);
  }

  console.log('[architecture-check] passed');
}

run();

