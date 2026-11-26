import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateSimulado } from './store.mjs';

const filename = process.argv[2];
if (!filename || process.argv.length !== 3) {
  console.error('Uso: node Backend/Code/validar-simulado.mjs CAMINHO/simulado.json');
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse((await fs.readFile(path.resolve(filename), 'utf8')).replace(/^\uFEFF/, ''));
    const simulado = validateSimulado(input);
    console.log(`Simulado válido: ${simulado.id} — ${simulado.questoes.length} questões.`);
  } catch (error) {
    console.error(`Simulado inválido: ${error instanceof SyntaxError ? 'o arquivo não contém JSON válido.' : error.message}`);
    process.exitCode = 2;
  }
}
