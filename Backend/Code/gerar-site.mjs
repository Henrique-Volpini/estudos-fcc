import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateSimulado } from './store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'dist');
const MARKER = '<!-- estudos-fcc-static-build:v1 -->';
const ASSETS = ['index.html', 'styles.css', 'app.js', 'browser-api.js'];
const OUTPUT_NAMES = new Set([...ASSETS, 'catalogo.json', 'data']);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const TRANSIENT = /^\.estudos-fcc-dist-(?:staging|backup)-[0-9a-f-]{36}$/;
const MAX_JSON_BYTES = 20 * 1024 * 1024;
let realRoot;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function statOptional(target) {
  try { return await fs.lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function regularDirectory(target) {
  const stat = await fs.lstat(target);
  requireValue(stat.isDirectory() && !stat.isSymbolicLink(), `Pasta inválida ou link: ${target}`);
  return fs.realpath(target);
}

async function regularFile(target) {
  const stat = await fs.lstat(target);
  requireValue(stat.isFile() && !stat.isSymbolicLink(), `Arquivo inválido ou link: ${target}`);
  return stat;
}

async function checkOutputLocation(target) {
  requireValue(path.isAbsolute(target) && path.dirname(target) === ROOT, 'Destino fora da raiz do projeto.');
  requireValue(path.basename(target) === 'dist' || TRANSIENT.test(path.basename(target)), 'Destino de geração não permitido.');
  requireValue(await regularDirectory(ROOT) === realRoot, 'A raiz do projeto foi alterada durante a geração.');
  const stat = await statOptional(target);
  if (stat) {
    const realTarget = await regularDirectory(target);
    requireValue(path.dirname(realTarget) === realRoot, 'A pasta de saída está fora da raiz do projeto.');
  }
  return stat;
}

async function checkOutputTree(target, { complete = true, marker = true } = {}) {
  requireValue(await checkOutputLocation(target), `Pasta de saída ausente: ${target}`);
  const entries = await fs.readdir(target, { withFileTypes: true });
  requireValue(!complete || entries.length === OUTPUT_NAMES.size, `A pasta ${target} não contém somente uma geração completa do site.`);
  for (const entry of entries) {
    requireValue(OUTPUT_NAMES.has(entry.name), `A pasta ${target} contém conteúdo desconhecido: ${entry.name}. Nada foi apagado.`);
    const item = path.join(target, entry.name);
    if (entry.name === 'data') {
      requireValue(path.dirname(await regularDirectory(item)) === await fs.realpath(target), 'A pasta data está fora da saída permitida.');
      for (const dataEntry of await fs.readdir(item, { withFileTypes: true })) {
        requireValue(dataEntry.name.endsWith('.json') && ID.test(dataEntry.name.slice(0, -5)), `Arquivo desconhecido na pasta data: ${dataEntry.name}`);
        await regularFile(path.join(item, dataEntry.name));
      }
    } else await regularFile(item);
  }
  if (marker) {
    requireValue(entries.some(entry => entry.name === 'index.html'), `Falta o marcador de propriedade em ${target}.`);
    const html = await fs.readFile(path.join(target, 'index.html'), 'utf8');
    requireValue(html.includes(MARKER), `A pasta ${target} não pertence ao gerador. Preserve ou renomeie essa pasta antes de gerar o site.`);
  }
}

async function removeOwnedTree(target, options) {
  // Revalidate the absolute location, regular directories and every filename before deletion.
  await checkOutputTree(target, options);
  await fs.rm(target, { recursive: true });
}

async function readSimulados() {
  const simulados = [];
  const ids = new Set();
  const realBackend = await regularDirectory(path.join(ROOT, 'Backend'));
  requireValue(path.dirname(realBackend) === realRoot, 'A pasta Backend está fora da raiz do projeto.');
  const dataRoot = path.join(ROOT, 'Backend', 'simulados');
  const realDataRoot = await regularDirectory(dataRoot);
  requireValue(path.dirname(realDataRoot) === realBackend, 'A origem dos simulados está fora de Backend.');
  for (const category of ['simulados pendentes', 'simulados resolvidos']) {
    const categoryPath = path.join(dataRoot, category);
    const realCategory = await regularDirectory(categoryPath);
    requireValue(path.dirname(realCategory) === realDataRoot, `Pasta de origem fora dos simulados: ${category}`);
    const entries = await fs.readdir(categoryPath, { withFileTypes: true });
    for (const entry of entries) {
      requireValue(!entry.isSymbolicLink(), `Link não permitido na origem: ${entry.name}`);
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      requireValue(ID.test(entry.name), `ID de pasta inválido: ${entry.name}`);
      const directory = path.join(categoryPath, entry.name);
      requireValue(path.dirname(await regularDirectory(directory)) === realCategory, `Pasta de simulado fora da origem: ${entry.name}`);
      const source = path.join(directory, 'simulado.json');
      const stat = await regularFile(source);
      requireValue(stat.size <= MAX_JSON_BYTES, `O simulado ${entry.name} ultrapassa 20 MiB.`);
      let parsed;
      try { parsed = JSON.parse((await fs.readFile(source, 'utf8')).replace(/^\uFEFF/, '')); }
      catch (error) {
        if (error instanceof SyntaxError) throw new Error(`JSON inválido em ${category}/${entry.name}/simulado.json.`);
        throw error;
      }
      const simulado = validateSimulado(parsed, entry.name);
      const portableId = simulado.id.toLowerCase();
      requireValue(!ids.has(portableId), `ID de simulado duplicado entre as pastas, inclusive maiúsculas/minúsculas: ${simulado.id}`);
      ids.add(portableId);
      const hash = createHash('sha256').update(JSON.stringify(simulado)).digest('hex');
      simulados.push({ hash, simulado });
    }
  }
  return simulados.sort((first, second) => first.simulado.id < second.simulado.id ? -1 : first.simulado.id > second.simulado.id ? 1 : 0);
}

async function readAssets() {
  const frontend = path.join(ROOT, 'Frontend');
  requireValue(path.dirname(await regularDirectory(frontend)) === realRoot, 'A pasta Frontend está fora da raiz do projeto.');
  const assets = new Map();
  for (const name of ASSETS) {
    const source = path.join(frontend, name);
    await regularFile(source);
    assets.set(name, await fs.readFile(source));
  }
  let html = assets.get('index.html').toString('utf8');
  requireValue(/<head(?:\s[^>]*)?>/i.test(html), 'O index.html precisa de uma seção head.');
  html = html.replace(/<meta\b(?=[^>]*\bname\s*=\s*["']estudos-fcc-mode["'])[^>]*>\s*/gi, '');
  html = html.replace(/<head(?:\s[^>]*)?>/i, match => `${match}\n    ${MARKER}\n    <meta name="estudos-fcc-mode" content="browser" />`);
  assets.set('index.html', html);
  return assets;
}

async function writeSite(staging, assets, simulados) {
  await fs.mkdir(path.join(staging, 'data'));
  for (const [name, content] of assets) await fs.writeFile(path.join(staging, name), content, { flag: 'wx' });
  const catalogo = {
    schemaVersao: 1,
    simulados: simulados.map(({ hash, simulado }) => ({
      id: simulado.id, titulo: simulado.titulo, descricao: simulado.descricao,
      totalQuestoes: simulado.questoes.length, hash,
    })),
  };
  await fs.writeFile(path.join(staging, 'catalogo.json'), `${JSON.stringify(catalogo, null, 2)}\n`, { flag: 'wx' });
  for (const { hash, simulado } of simulados) {
    const data = { schemaVersao: 1, hash, simulado };
    await fs.writeFile(path.join(staging, 'data', `${simulado.id}.json`), `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
  }
}

async function generate() {
  realRoot = await regularDirectory(ROOT);
  if (await checkOutputLocation(DIST)) await checkOutputTree(DIST);
  // Validate every source before creating or replacing the output; no progress/result files are read.
  const simulados = await readSimulados();
  const assets = await readAssets();
  const staging = path.join(ROOT, `.estudos-fcc-dist-staging-${randomUUID()}`);
  const backup = path.join(ROOT, `.estudos-fcc-dist-backup-${randomUUID()}`);
  let stagingCreated = false;
  let backedUp = false;
  let installed = false;
  try {
    requireValue(!(await checkOutputLocation(staging)), 'A pasta temporária já existe.');
    await fs.mkdir(staging);
    stagingCreated = true;
    await writeSite(staging, assets, simulados);
    await checkOutputTree(staging);
    if (await checkOutputLocation(DIST)) {
      await checkOutputTree(DIST);
      requireValue(!(await checkOutputLocation(backup)), 'A pasta de recuperação já existe.');
      await fs.rename(DIST, backup);
      backedUp = true;
    }
    requireValue(!(await checkOutputLocation(DIST)), 'A pasta dist reapareceu durante a geração; seus arquivos foram preservados.');
    await checkOutputTree(staging);
    await fs.rename(staging, DIST);
    stagingCreated = false;
    installed = true;
    if (backedUp) {
      await removeOwnedTree(backup);
      backedUp = false;
    }
    console.log(`Site gerado em dist: ${simulados.length} simulado(s), sem progresso ou resultados locais.`);
  } catch (error) {
    if (backedUp && !installed) {
      try {
        requireValue(!(await checkOutputLocation(DIST)), 'A pasta dist está ocupada.');
        await checkOutputTree(backup);
        await fs.rename(backup, DIST);
        backedUp = false;
      } catch (restoreError) {
        console.error(`A saída anterior foi preservada em ${backup}. ${restoreError.message}`);
      }
    }
    throw error;
  } finally {
    if (stagingCreated) {
      try { await removeOwnedTree(staging, { complete: false, marker: false }); }
      catch (cleanupError) { console.error(`Pasta temporária preservada em ${staging}: ${cleanupError.message}`); }
    }
    if (backedUp && installed) console.error(`A geração anterior permanece em ${backup}; nenhuma pasta desconhecida foi apagada.`);
  }
}

generate().catch(error => {
  console.error(`Não foi possível gerar o site: ${error.message}`);
  process.exitCode = 1;
});
