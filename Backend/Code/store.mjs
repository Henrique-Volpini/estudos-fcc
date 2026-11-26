import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const CLASSIFICATIONS = ['sabia', 'chutei', 'deduzi'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireValue(condition, message, status = 422) {
  if (!condition) throw new AppError(status, message);
}

export function validateId(value, label = 'Identificador') {
  requireValue(typeof value === 'string' && ID.test(value), `${label} inválido.`, 400);
  return value;
}

export function validateSimulado(data, expectedId) {
  requireValue(object(data), 'O simulado precisa ser um objeto JSON.');
  requireValue(data.schemaVersao === 1, 'schemaVersao deve ser 1.');
  validateId(data.id, 'ID do simulado');
  requireValue(!expectedId || data.id === expectedId, 'O ID do simulado deve corresponder ao nome de sua pasta.');
  requireValue(text(data.titulo), 'Preencha o título do simulado.');
  requireValue(data.descricao === undefined || typeof data.descricao === 'string', 'descricao deve ser texto.');
  requireValue(data.criadoEm === undefined || (text(data.criadoEm) && Number.isFinite(Date.parse(data.criadoEm))), 'criadoEm deve ser uma data válida.');
  requireValue(Array.isArray(data.questoes) && data.questoes.length > 0 && data.questoes.length <= 1000, 'O simulado deve conter entre 1 e 1000 questões.');
  const ids = new Set();
  const numbers = new Set();
  const questions = data.questoes.map((question, index) => {
    const label = `Questão ${index + 1}`;
    requireValue(object(question), `${label}: registro inválido.`);
    validateId(question.id, `${label}: ID`);
    requireValue(!ids.has(question.id), `${label}: ID duplicado.`);
    ids.add(question.id);
    requireValue(Number.isInteger(question.numero) && question.numero >= 1 && question.numero <= data.questoes.length && !numbers.has(question.numero), `${label}: numero deve ser único e sequencial de 1 até o total.`);
    numbers.add(question.numero);
    for (const key of ['materia', 'topico', 'versao', 'enunciado', 'resolucao']) {
      requireValue(text(question[key]), `${label}: preencha ${key}.`);
    }
    for (const key of ['alternativas', 'justificativas']) {
      requireValue(object(question[key]) && Object.keys(question[key]).length === 5 && LETTERS.every(letter => text(question[key][letter])), `${label}: ${key} deve conter exatamente A, B, C, D e E com textos preenchidos.`);
    }
    requireValue(LETTERS.includes(question.gabarito), `${label}: gabarito deve ser A, B, C, D ou E.`);
    requireValue(question.fontes === undefined || Array.isArray(question.fontes), `${label}: fontes deve ser uma lista.`);
    const fontes = (question.fontes ?? []).map(source => {
      requireValue(object(source) && text(source.titulo), `${label}: cada fonte precisa de título.`);
      requireValue(source.url === undefined || (typeof source.url === 'string' && /^https?:\/\//i.test(source.url)), `${label}: URL de fonte inválida.`);
      requireValue(source.localizador === undefined || typeof source.localizador === 'string', `${label}: localizador de fonte inválido.`);
      return { titulo: source.titulo, ...(source.url ? { url: source.url } : {}), ...(source.localizador ? { localizador: source.localizador } : {}) };
    });
    return {
      id: question.id, numero: question.numero, materia: question.materia,
      topico: question.topico, versao: question.versao, enunciado: question.enunciado,
      alternativas: Object.fromEntries(LETTERS.map(letter => [letter, question.alternativas[letter]])),
      gabarito: question.gabarito,
      justificativas: Object.fromEntries(LETTERS.map(letter => [letter, question.justificativas[letter]])),
      resolucao: question.resolucao, fontes,
    };
  }).sort((first, second) => first.numero - second.numero);
  return { schemaVersao: 1, id: data.id, titulo: data.titulo, descricao: data.descricao ?? '', ...(data.criadoEm ? { criadoEm: data.criadoEm } : {}), questoes: questions };
}

function contentHash(simulado) {
  return createHash('sha256').update(JSON.stringify(simulado)).digest('hex');
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function statOptional(target) {
  try { return await fs.lstat(target); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJson(target, optional = false) {
  const stat = await statOptional(target);
  if (!stat && optional) return null;
  requireValue(stat && stat.isFile() && !stat.isSymbolicLink(), `Arquivo de dados ausente ou inválido: ${path.basename(target)}.`);
  requireValue(stat.size <= MAX_FILE_BYTES, 'O arquivo de dados ultrapassa o tamanho permitido.');
  try {
    return JSON.parse((await fs.readFile(target, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error instanceof SyntaxError) throw new AppError(422, `JSON inválido em ${path.basename(target)}.`);
    throw error;
  }
}

async function atomicJson(target, value) {
  const previous = await statOptional(target);
  requireValue(!previous || (previous.isFile() && !previous.isSymbolicLink()), 'O arquivo de destino não é um arquivo de dados regular.');
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function emptyProgress(simulado) {
  return { schemaVersao: 1, simuladoId: simulado.id, simuladoHash: contentHash(simulado), indiceAtual: 0, iniciadoEm: null, atualizadoEm: null, finalizadoEm: null, respostas: {} };
}

function validateProgress(progress, simulado) {
  requireValue(object(progress) && progress.schemaVersao === 1 && progress.simuladoId === simulado.id && object(progress.respostas), 'O progresso salvo não corresponde ao simulado.');
  requireValue(progress.simuladoHash === contentHash(simulado), 'O conteúdo deste simulado mudou depois do início. Preserve a versão original para continuar.', 409);
  requireValue(Number.isInteger(progress.indiceAtual) && progress.indiceAtual >= 0 && progress.indiceAtual < simulado.questoes.length, 'A posição salva da questão é inválida.');
  const ids = new Set(simulado.questoes.map(question => question.id));
  for (const [id, response] of Object.entries(progress.respostas)) {
    requireValue(ids.has(id) && object(response) && LETTERS.includes(response.alternativa), 'O progresso contém resposta inválida.');
    requireValue(response.classificacao === null || CLASSIFICATIONS.includes(response.classificacao), 'O progresso contém classificação inválida.');
    requireValue(text(response.respondidaEm), 'O progresso contém resposta sem data.');
  }
  return progress;
}

function outcome(question, response) {
  return {
    alternativa: response.alternativa, classificacao: response.classificacao,
    respondidaEm: response.respondidaEm, acertou: response.alternativa === question.gabarito,
    gabarito: question.gabarito, justificativas: question.justificativas,
    resolucao: question.resolucao, fontes: question.fontes,
  };
}

function summaryResult(simulado, progress) {
  const summary = { total: simulado.questoes.length, respondidas: 0, acertos: 0, erros: 0, percentualAcertos: 0, classificacoes: { sabia: 0, chutei: 0, deduzi: 0, naoInformado: 0 }, porMateria: [] };
  const subjects = new Map();
  for (const question of simulado.questoes) {
    if (!subjects.has(question.materia)) subjects.set(question.materia, { materia: question.materia, total: 0, respondidas: 0, acertos: 0, erros: 0, percentualAcertos: 0 });
    const subject = subjects.get(question.materia);
    subject.total++;
    if (!Object.hasOwn(progress.respostas, question.id)) continue;
    const response = progress.respostas[question.id];
    summary.respondidas++;
    subject.respondidas++;
    const correct = response.alternativa === question.gabarito;
    summary[correct ? 'acertos' : 'erros']++;
    subject[correct ? 'acertos' : 'erros']++;
    summary.classificacoes[response.classificacao ?? 'naoInformado']++;
  }
  summary.percentualAcertos = Math.round(10000 * summary.acertos / summary.total) / 100;
  summary.porMateria = [...subjects.values()].map(subject => ({ ...subject, percentualAcertos: Math.round(10000 * subject.acertos / subject.total) / 100 }));
  return summary;
}

function toDetail(loaded) {
  const { simulado, progress, status } = loaded;
  const responses = Object.fromEntries(simulado.questoes.filter(question => Object.hasOwn(progress.respostas, question.id)).map(question => [question.id, outcome(question, progress.respostas[question.id])]));
  return {
    simulado: {
      id: simulado.id, titulo: simulado.titulo, descricao: simulado.descricao,
      questoes: simulado.questoes.map(({ id, numero, materia, topico, versao, enunciado, alternativas }) => ({ id, numero, materia, topico, versao, enunciado, alternativas })),
    },
    progresso: { indiceAtual: progress.indiceAtual, iniciadoEm: progress.iniciadoEm, atualizadoEm: progress.atualizadoEm, finalizadoEm: progress.finalizadoEm, respostas: responses },
    status, resumo: summaryResult(simulado, progress),
  };
}

export class SimuladoStore {
  constructor(dataRoot) {
    this.root = path.resolve(dataRoot);
    this.categories = { pendente: path.join(this.root, 'simulados pendentes'), resolvido: path.join(this.root, 'simulados resolvidos') };
    this.queues = new Map();
    this.ready = this.initialize();
  }

  async initialize() {
    await fs.mkdir(this.root, { recursive: true });
    const rootStat = await fs.lstat(this.root);
    requireValue(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'A raiz dos simulados precisa ser uma pasta regular.');
    this.realRoot = await fs.realpath(this.root);
    for (const directory of Object.values(this.categories)) {
      await fs.mkdir(directory, { recursive: true });
      const stat = await fs.lstat(directory);
      requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'A pasta de simulados não pode ser um link.');
      const real = await fs.realpath(directory);
      requireValue(isInside(this.realRoot, real), 'Pasta de simulados fora da raiz permitida.');
    }
  }

  async directoryFor(category, id) {
    await this.checkCategory(category);
    const base = this.categories[category];
    const target = path.resolve(base, id);
    requireValue(isInside(base, target), 'Caminho de simulado inválido.', 400);
    const stat = await statOptional(target);
    if (!stat) return null;
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), `A pasta ${id} não é uma pasta regular.`);
    const real = await fs.realpath(target);
    const realBase = await fs.realpath(base);
    requireValue(isInside(realBase, real) && path.dirname(real) === realBase, 'Caminho de simulado fora da pasta permitida.');
    return target;
  }

  async checkCategory(category) {
    const rootStat = await fs.lstat(this.root);
    requireValue(rootStat.isDirectory() && !rootStat.isSymbolicLink() && await fs.realpath(this.root) === this.realRoot, 'A raiz de dados foi alterada durante a execução.');
    const base = this.categories[category];
    const stat = await fs.lstat(base);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'A pasta de simulados não pode ser um link.');
    const real = await fs.realpath(base);
    requireValue(isInside(this.realRoot, real) && path.dirname(real) === this.realRoot, 'Pasta de simulados fora da raiz permitida.');
  }

  async load(id) {
    await this.ready;
    validateId(id, 'ID do simulado');
    const [pending, solved] = await Promise.all([this.directoryFor('pendente', id), this.directoryFor('resolvido', id)]);
    requireValue(!(pending && solved), 'Existe um simulado com este ID nas duas pastas. Resolva a duplicação antes de continuar.', 409);
    requireValue(pending || solved, 'Simulado não encontrado.', 404);
    const directory = pending || solved;
    const status = solved ? 'resolvido' : 'pendente';
    const simulado = validateSimulado(await readJson(path.join(directory, 'simulado.json')), id);
    const saved = await readJson(path.join(directory, 'progresso.json'), true);
    const progress = saved ? validateProgress(saved, simulado) : emptyProgress(simulado);
    if (status === 'resolvido') {
      requireValue(saved && summaryResult(simulado, progress).respondidas === simulado.questoes.length, 'O simulado resolvido não possui todas as respostas salvas.');
      const result = await readJson(path.join(directory, 'resultado.json'), true);
      if (!progress.finalizadoEm && result && result.simuladoHash === progress.simuladoHash && text(result.finalizadoEm)) {
        progress.finalizadoEm = result.finalizadoEm;
        progress.atualizadoEm = result.finalizadoEm;
      }
    }
    return { directory, status, simulado, progress };
  }

  async list() {
    await this.ready;
    const result = { pendentes: [], resolvidos: [], avisos: [] };
    const names = new Set();
    for (const [category, directory] of Object.entries(this.categories)) {
      await this.checkCategory(category);
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) names.add(entry.name);
      }
    }
    for (const id of [...names].sort()) {
      try {
        const loaded = await this.load(id);
        const totals = summaryResult(loaded.simulado, loaded.progress);
        result[loaded.status === 'pendente' ? 'pendentes' : 'resolvidos'].push({
          id, titulo: loaded.simulado.titulo, descricao: loaded.simulado.descricao,
          totalQuestoes: totals.total, respondidas: totals.respondidas, acertos: totals.acertos,
          status: loaded.status, iniciadoEm: loaded.progress.iniciadoEm, finalizadoEm: loaded.progress.finalizadoEm,
        });
      } catch (error) {
        result.avisos.push({ id, mensagem: error instanceof AppError ? error.message : 'Não foi possível carregar este simulado.' });
      }
    }
    return result;
  }

  async get(id) {
    return toDetail(await this.load(id));
  }

  async serialized(id, action) {
    validateId(id, 'ID do simulado');
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    this.queues.set(id, next);
    try { return await next; } finally {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }
  }

  async save(loaded) {
    loaded.progress.atualizadoEm = new Date().toISOString();
    await atomicJson(path.join(loaded.directory, 'progresso.json'), loaded.progress);
  }

  async start(id) {
    return this.serialized(id, async () => {
      const loaded = await this.load(id);
      if (loaded.status === 'pendente' && !loaded.progress.iniciadoEm) {
        loaded.progress.iniciadoEm = new Date().toISOString();
        await this.save(loaded);
      }
      return toDetail(loaded);
    });
  }

  async answer(id, body) {
    return this.serialized(id, async () => {
      const loaded = await this.load(id);
      requireValue(loaded.status === 'pendente', 'Este simulado já foi finalizado.', 409);
      requireValue(object(body) && typeof body.questaoId === 'string' && LETTERS.includes(body.alternativa), 'Informe questaoId e uma alternativa entre A e E.', 400);
      const question = loaded.simulado.questoes.find(item => item.id === body.questaoId);
      requireValue(question, 'Questão não encontrada neste simulado.', 404);
      if (Object.hasOwn(loaded.progress.respostas, question.id)) {
        requireValue(loaded.progress.respostas[question.id].alternativa === body.alternativa, 'A primeira resposta já foi corrigida e não pode ser alterada.', 409);
        return toDetail(loaded);
      }
      const now = new Date().toISOString();
      loaded.progress.iniciadoEm ??= now;
      loaded.progress.respostas[question.id] = { alternativa: body.alternativa, classificacao: null, respondidaEm: now };
      await this.save(loaded);
      return toDetail(loaded);
    });
  }

  async classify(id, body) {
    return this.serialized(id, async () => {
      const loaded = await this.load(id);
      requireValue(loaded.status === 'pendente', 'Este simulado já foi finalizado.', 409);
      requireValue(object(body) && typeof body.questaoId === 'string' && (body.classificacao === null || CLASSIFICATIONS.includes(body.classificacao)), 'A classificação deve ser sabia, chutei, deduzi ou null.', 400);
      requireValue(Object.hasOwn(loaded.progress.respostas, body.questaoId), 'Responda à questão antes de classificá-la.', 409);
      loaded.progress.respostas[body.questaoId].classificacao = body.classificacao;
      await this.save(loaded);
      return toDetail(loaded);
    });
  }

  async navigate(id, body) {
    return this.serialized(id, async () => {
      const loaded = await this.load(id);
      requireValue(object(body) && Number.isInteger(body.indiceAtual) && body.indiceAtual >= 0 && body.indiceAtual < loaded.simulado.questoes.length, 'Posição de questão inválida.', 400);
      loaded.progress.indiceAtual = body.indiceAtual;
      if (loaded.status === 'pendente') await this.save(loaded);
      return toDetail(loaded);
    });
  }

  async reset(id, body) {
    return this.serialized(id, async () => {
      requireValue(object(body) && body.confirmar === true, 'Confirme o reinício do simulado com confirmar: true.', 400);
      const loaded = await this.load(id);
      const originalStatus = loaded.status;
      const previousProgress = loaded.progress;
      const progress = emptyProgress(loaded.simulado);
      const backupName = `.resultado.json.${randomUUID()}.reset`;
      let resultBackedUp = false;
      let progressWritten = false;
      const checkDirectory = async () => {
        requireValue(await this.directoryFor(loaded.status, id) === loaded.directory, 'A pasta do simulado foi alterada durante o reinício.', 409);
      };
      const dataPath = name => {
        const target = path.resolve(loaded.directory, name);
        requireValue(path.isAbsolute(target) && isInside(this.categories[loaded.status], target) && path.dirname(target) === loaded.directory, 'Caminho de dados fora da pasta permitida.', 400);
        return target;
      };
      const checkedFile = async name => {
        await checkDirectory();
        const target = dataPath(name);
        const stat = await statOptional(target);
        requireValue(!stat || (stat.isFile() && !stat.isSymbolicLink()), 'O arquivo de dados não é um arquivo regular.');
        return { target, exists: !!stat };
      };
      const moveTo = async status => {
        await checkDirectory();
        await this.checkCategory(status);
        const destination = path.resolve(this.categories[status], id);
        requireValue(path.isAbsolute(destination) && isInside(this.categories[status], destination) && path.dirname(destination) === this.categories[status], 'Destino do simulado inválido.', 400);
        requireValue(!(await statOptional(destination)), 'Já existe um simulado com este ID na pasta de destino.', 409);
        await fs.rename(loaded.directory, destination);
        loaded.directory = destination;
        loaded.status = status;
      };
      try {
        // Keep the completed attempt intact until it is safely back in pendentes.
        if (loaded.status === 'resolvido') await moveTo('pendente');
        const result = await checkedFile('resultado.json');
        if (result.exists) {
          const backup = await checkedFile(backupName);
          requireValue(!backup.exists, 'Já existe um arquivo de recuperação para este reinício.', 409);
          await fs.rename(result.target, backup.target);
          resultBackedUp = true;
        }
        await checkDirectory();
        await atomicJson(dataPath('progresso.json'), progress);
        progressWritten = true;
        if (resultBackedUp) {
          const backup = await checkedFile(backupName);
          requireValue(backup.exists, 'O arquivo de recuperação do resultado foi alterado.', 409);
          await fs.unlink(backup.target);
          resultBackedUp = false;
        }
        loaded.progress = progress;
        return toDetail(loaded);
      } catch (error) {
        let rollbackFailed = false;
        if (progressWritten) {
          try {
            await checkDirectory();
            await atomicJson(dataPath('progresso.json'), previousProgress);
          } catch { rollbackFailed = true; }
        }
        if (resultBackedUp) {
          try {
            const backup = await checkedFile(backupName);
            const result = await checkedFile('resultado.json');
            requireValue(backup.exists && !result.exists, 'Não foi possível restaurar o resultado anterior.', 409);
            await fs.rename(backup.target, result.target);
          } catch { rollbackFailed = true; }
        }
        if (!rollbackFailed && loaded.status !== originalStatus) {
          try { await moveTo(originalStatus); } catch { rollbackFailed = true; }
        }
        if (rollbackFailed) {
          throw new AppError(500, 'Não foi possível concluir nem desfazer o reinício. O simulado permanece em simulados pendentes; preserve os arquivos de recuperação ocultos e verifique a pasta antes de tentar novamente.');
        }
        throw error;
      }
    });
  }

  async finish(id) {
    return this.serialized(id, async () => {
      const loaded = await this.load(id);
      if (loaded.status === 'resolvido') return toDetail(loaded);
      const summary = summaryResult(loaded.simulado, loaded.progress);
      requireValue(summary.respondidas === summary.total, 'Responda a todas as questões antes de finalizar.', 409);
      const destination = path.resolve(this.categories.resolvido, id);
      requireValue(isInside(this.categories.resolvido, destination), 'Destino do simulado inválido.', 400);
      requireValue(!(await statOptional(destination)), 'Já existe um simulado resolvido com este ID.', 409);
      const finalized = new Date().toISOString();
      const responseDetails = toDetail(loaded).progresso.respostas;
      const result = {
        schemaVersao: 1, simuladoId: id, titulo: loaded.simulado.titulo,
        simuladoHash: loaded.progress.simuladoHash, iniciadoEm: loaded.progress.iniciadoEm,
        finalizadoEm: finalized, ...summary, respostas: responseDetails,
      };
      // All answers are already durable; persist the result before the atomic directory move.
      await atomicJson(path.join(loaded.directory, 'resultado.json'), result);
      await this.checkCategory('pendente');
      await this.checkCategory('resolvido');
      requireValue(!(await statOptional(destination)), 'Já existe um simulado resolvido com este ID.', 409);
      await fs.rename(loaded.directory, destination);
      loaded.directory = destination;
      loaded.status = 'resolvido';
      loaded.progress.finalizadoEm = finalized;
      loaded.progress.atualizadoEm = finalized;
      // resultado.json allows recovery if updating this redundant final timestamp fails.
      await atomicJson(path.join(destination, 'progresso.json'), loaded.progress).catch(() => {});
      return toDetail(loaded);
    });
  }
}
