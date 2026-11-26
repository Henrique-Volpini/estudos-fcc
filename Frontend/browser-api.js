const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const CLASSIFICATIONS = ['sabia', 'chutei', 'deduzi'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function requireValue(condition, message, status = 422) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
}

function validateSimulado(value, entry) {
  requireValue(object(value) && value.schemaVersao === 1 && value.id === entry.id && text(value.titulo)
    && typeof value.descricao === 'string', 'Os dados deste simulado são inválidos.');
  requireValue(Array.isArray(value.questoes) && value.questoes.length > 0 && value.questoes.length <= 1000,
    'O simulado deve conter entre 1 e 1000 questões.');
  requireValue(value.titulo === entry.titulo && value.descricao === entry.descricao
    && value.questoes.length === entry.totalQuestoes, 'O catálogo e o simulado não correspondem. Atualize a lista.');
  const ids = new Set();
  for (const [index, question] of value.questoes.entries()) {
    requireValue(object(question) && ID.test(question.id) && typeof question.id === 'string'
      && !ids.has(question.id) && question.numero === index + 1, 'O simulado contém uma questão inválida.');
    ids.add(question.id);
    for (const key of ['materia', 'topico', 'versao', 'enunciado', 'resolucao']) {
      requireValue(text(question[key]), 'O simulado contém uma questão incompleta.');
    }
    for (const key of ['alternativas', 'justificativas']) {
      requireValue(object(question[key]) && Object.keys(question[key]).length === 5
        && LETTERS.every(letter => text(question[key][letter])), 'As alternativas ou justificativas são inválidas.');
    }
    requireValue(LETTERS.includes(question.gabarito) && Array.isArray(question.fontes), 'A correção desta questão é inválida.');
    for (const source of question.fontes) {
      requireValue(object(source) && text(source.titulo)
        && (source.url === undefined || (typeof source.url === 'string' && /^https?:\/\//i.test(source.url)))
        && (source.localizador === undefined || typeof source.localizador === 'string'), 'A questão contém uma referência inválida.');
    }
  }
  return value;
}

function emptyProgress(simulado, hash) {
  return { schemaVersao: 1, simuladoId: simulado.id, simuladoHash: hash, indiceAtual: 0,
    iniciadoEm: null, atualizadoEm: null, finalizadoEm: null, respostas: {} };
}

function validateProgress(value, simulado, hash) {
  requireValue(object(value) && value.schemaVersao === 1 && value.simuladoId === simulado.id
    && object(value.respostas), 'O progresso salvo não corresponde ao simulado.');
  requireValue(typeof value.simuladoHash === 'string' && HASH.test(value.simuladoHash)
    && value.simuladoHash === hash, 'O conteúdo deste simulado mudou. O progresso anterior foi preservado.', 409);
  requireValue(Number.isInteger(value.indiceAtual) && value.indiceAtual >= 0 && value.indiceAtual < simulado.questoes.length,
    'A posição salva da questão é inválida.');
  for (const key of ['iniciadoEm', 'atualizadoEm', 'finalizadoEm']) {
    requireValue(value[key] === null || validDate(value[key]), `O progresso contém uma data inválida: ${key}.`);
  }
  const ids = new Set(simulado.questoes.map(question => question.id));
  const respostas = Object.fromEntries(Object.entries(value.respostas).map(([id, response]) => {
    requireValue(ids.has(id) && object(response) && LETTERS.includes(response.alternativa), 'O progresso contém resposta inválida.');
    requireValue(response.classificacao === null || CLASSIFICATIONS.includes(response.classificacao), 'O progresso contém classificação inválida.');
    requireValue(validDate(response.respondidaEm), 'O progresso contém resposta com data inválida.');
    return [id, { alternativa: response.alternativa, classificacao: response.classificacao, respondidaEm: response.respondidaEm }];
  }));
  const count = Object.keys(respostas).length;
  requireValue((count === 0 && value.finalizadoEm === null) || value.iniciadoEm !== null,
    'O progresso contém respostas ou conclusão sem data de início.');
  requireValue((value.iniciadoEm === null && count === 0 && value.finalizadoEm === null) || value.atualizadoEm !== null,
    'O progresso não contém uma data de atualização.');
  requireValue(value.finalizadoEm === null || count === simulado.questoes.length,
    'O simulado concluído precisa conter todas as respostas.');
  return { schemaVersao: 1, simuladoId: simulado.id, simuladoHash: hash, indiceAtual: value.indiceAtual,
    iniciadoEm: value.iniciadoEm, atualizadoEm: value.atualizadoEm, finalizadoEm: value.finalizadoEm, respostas };
}

function summaryResult(simulado, progress) {
  const summary = { total: simulado.questoes.length, respondidas: 0, acertos: 0, erros: 0, percentualAcertos: 0,
    classificacoes: { sabia: 0, chutei: 0, deduzi: 0, naoInformado: 0 }, porMateria: [] };
  const subjects = new Map();
  for (const question of simulado.questoes) {
    if (!subjects.has(question.materia)) subjects.set(question.materia,
      { materia: question.materia, total: 0, respondidas: 0, acertos: 0, erros: 0, percentualAcertos: 0 });
    const subject = subjects.get(question.materia);
    subject.total++;
    if (!has(progress.respostas, question.id)) continue;
    const response = progress.respostas[question.id];
    const result = response.alternativa === question.gabarito ? 'acertos' : 'erros';
    summary.respondidas++; subject.respondidas++; summary[result]++; subject[result]++;
    summary.classificacoes[response.classificacao ?? 'naoInformado']++;
  }
  summary.percentualAcertos = Math.round(10000 * summary.acertos / summary.total) / 100;
  summary.porMateria = [...subjects.values()].map(subject => ({ ...subject,
    percentualAcertos: Math.round(10000 * subject.acertos / subject.total) / 100 }));
  return summary;
}

function toDetail(simulado, progress) {
  const respostas = Object.fromEntries(simulado.questoes.filter(question => has(progress.respostas, question.id)).map(question => {
    const response = progress.respostas[question.id];
    return [question.id, { ...response, acertou: response.alternativa === question.gabarito, gabarito: question.gabarito,
      justificativas: { ...question.justificativas }, resolucao: question.resolucao, fontes: question.fontes.map(source => ({ ...source })) }];
  }));
  return { simulado: { id: simulado.id, titulo: simulado.titulo, descricao: simulado.descricao,
    questoes: simulado.questoes.map(({ id, numero, materia, topico, versao, enunciado, alternativas }) =>
      ({ id, numero, materia, topico, versao, enunciado, alternativas: { ...alternativas } })) },
    progresso: { indiceAtual: progress.indiceAtual, iniciadoEm: progress.iniciadoEm, atualizadoEm: progress.atualizadoEm,
      finalizadoEm: progress.finalizadoEm, respostas },
    status: progress.finalizadoEm !== null ? 'resolvido' : 'pendente', resumo: summaryResult(simulado, progress) };
}

export function createBrowserApi({ baseUrl = new URL('./', import.meta.url) } = {}) {
  const base = new URL(baseUrl, import.meta.url);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  base.search = ''; base.hash = '';
  const storageKey = `estudos-fcc:${base.pathname}:progresso:v1`;
  const assets = new Map();
  let catalog;
  let queue = Promise.resolve();

  function serialized(action) {
    const result = queue.catch(() => {}).then(action);
    queue = result;
    return result;
  }

  function readDocument() {
    let raw;
    try { raw = globalThis.localStorage.getItem(storageKey); }
    catch { throw new Error('Não foi possível acessar o progresso neste navegador. Habilite o armazenamento local para continuar.'); }
    if (raw === null) return { schemaVersao: 1, simulados: {} };
    let value;
    try { value = JSON.parse(raw); }
    catch { throw new Error('O progresso deste navegador contém JSON inválido. Os dados foram preservados.'); }
    requireValue(object(value) && value.schemaVersao === 1 && object(value.simulados),
      'O formato do progresso deste navegador é inválido. Os dados foram preservados.');
    return { schemaVersao: 1, simulados: { ...value.simulados } };
  }

  function writeDocument(value) {
    try { globalThis.localStorage.setItem(storageKey, JSON.stringify(value)); }
    catch { throw new Error('Não foi possível salvar o progresso neste navegador. Verifique o espaço e a permissão de armazenamento e tente novamente.'); }
  }

  async function fetchJson(relative) {
    let response;
    try { response = await fetch(new URL(relative, base), { cache: 'no-store', headers: { Accept: 'application/json' } }); }
    catch { throw new Error('Não foi possível carregar os simulados. Verifique sua conexão e tente novamente.'); }
    requireValue(response.ok, 'Não foi possível carregar os dados deste simulado. Atualize a lista e tente novamente.', response.status);
    try { return await response.json(); }
    catch { throw new Error('O arquivo do simulado não contém JSON válido.'); }
  }

  async function getCatalog(refresh = false) {
    if (catalog && !refresh) return catalog;
    const value = await fetchJson('catalogo.json');
    requireValue(object(value) && value.schemaVersao === 1 && Array.isArray(value.simulados), 'O catálogo de simulados é inválido.');
    const next = new Map();
    for (const entry of value.simulados) {
      requireValue(object(entry) && typeof entry.id === 'string' && ID.test(entry.id) && !next.has(entry.id)
        && text(entry.titulo) && typeof entry.descricao === 'string' && Number.isInteger(entry.totalQuestoes)
        && entry.totalQuestoes > 0 && entry.totalQuestoes <= 1000 && typeof entry.hash === 'string' && HASH.test(entry.hash),
      'O catálogo contém um simulado inválido ou duplicado.');
      next.set(entry.id, { id: entry.id, titulo: entry.titulo, descricao: entry.descricao,
        totalQuestoes: entry.totalQuestoes, hash: entry.hash });
    }
    catalog = next;
    return next;
  }

  async function getExam(id, entries = null) {
    requireValue(typeof id === 'string' && ID.test(id), 'ID do simulado inválido.', 400);
    const entry = (entries ?? await getCatalog()).get(id);
    requireValue(entry, 'Simulado não encontrado no catálogo.', 404);
    const key = `${id}:${entry.hash}`;
    if (!assets.has(key)) {
      const pending = (async () => {
        const value = await fetchJson(`data/${encodeURIComponent(id)}.json`);
        requireValue(object(value) && value.schemaVersao === 1 && value.hash === entry.hash && object(value.simulado),
          'Os dados deste simulado não correspondem ao catálogo. Atualize a lista.');
        requireValue(globalThis.crypto?.subtle, 'Este navegador não permite verificar os dados. Abra o site por HTTPS em um navegador atualizado.');
        const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value.simulado)));
        const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        requireValue(hash === entry.hash, 'A integridade do simulado não pôde ser verificada. Atualize a lista.');
        return validateSimulado(value.simulado, entry);
      })();
      assets.set(key, pending);
      pending.catch(() => { if (assets.get(key) === pending) assets.delete(key); });
    }
    return { simulado: await assets.get(key), hash: entry.hash };
  }

  function progressFor(document, simulado, hash) {
    return has(document.simulados, simulado.id)
      ? validateProgress(document.simulados[simulado.id], simulado, hash) : emptyProgress(simulado, hash);
  }

  async function list() {
    const entries = await getCatalog(true);
    const document = readDocument();
    const result = { pendentes: [], resolvidos: [], avisos: [] };
    const loaded = await Promise.allSettled([...entries.keys()].map(async id => {
      const { simulado, hash } = await getExam(id, entries);
      const progress = progressFor(document, simulado, hash);
      const summary = summaryResult(simulado, progress);
      const status = progress.finalizadoEm !== null ? 'resolvido' : 'pendente';
      return { id, titulo: simulado.titulo, descricao: simulado.descricao, totalQuestoes: summary.total,
        respondidas: summary.respondidas, acertos: summary.acertos, status,
        iniciadoEm: progress.iniciadoEm, finalizadoEm: progress.finalizadoEm };
    }));
    [...entries.keys()].forEach((id, index) => {
      const item = loaded[index];
      if (item.status === 'fulfilled') result[item.value.status === 'resolvido' ? 'resolvidos' : 'pendentes'].push(item.value);
      else result.avisos.push({ id, mensagem: item.reason?.message || 'Não foi possível carregar este simulado.' });
    });
    for (const id of Object.keys(document.simulados)) {
      if (!entries.has(id)) result.avisos.push({ id, mensagem: 'Há progresso salvo para um simulado ausente do catálogo. Os dados foram preservados.' });
    }
    return result;
  }

  async function mutate(id, action, body) {
    const { simulado, hash } = await getExam(id);
    const document = readDocument();
    let progress = progressFor(document, simulado, hash);
    const finished = progress.finalizadoEm !== null;
    let save = true;
    const now = new Date().toISOString();
    if (action === 'reiniciar') {
      requireValue(object(body) && body.confirmar === true, 'Confirme o reinício do simulado com confirmar: true.', 400);
      progress = emptyProgress(simulado, hash);
    } else if (action === 'iniciar') {
      if (finished || progress.iniciadoEm !== null) save = false;
      else { progress.iniciadoEm = now; progress.atualizadoEm = now; }
    } else if (action === 'respostas') {
      requireValue(!finished, 'Este simulado já foi finalizado.', 409);
      requireValue(object(body) && typeof body.questaoId === 'string' && LETTERS.includes(body.alternativa),
        'Informe questaoId e uma alternativa entre A e E.', 400);
      requireValue(simulado.questoes.some(question => question.id === body.questaoId), 'Questão não encontrada neste simulado.', 404);
      if (has(progress.respostas, body.questaoId)) {
        requireValue(progress.respostas[body.questaoId].alternativa === body.alternativa,
          'A primeira resposta já foi corrigida e não pode ser alterada.', 409);
        save = false;
      } else {
        progress.iniciadoEm ??= now;
        progress.respostas[body.questaoId] = { alternativa: body.alternativa, classificacao: null, respondidaEm: now };
        progress.atualizadoEm = now;
      }
    } else if (action === 'classificacao') {
      requireValue(!finished, 'Este simulado já foi finalizado.', 409);
      requireValue(object(body) && typeof body.questaoId === 'string'
        && (body.classificacao === null || CLASSIFICATIONS.includes(body.classificacao)),
      'A classificação deve ser sabia, chutei, deduzi ou null.', 400);
      requireValue(has(progress.respostas, body.questaoId), 'Responda à questão antes de classificá-la.', 409);
      progress.respostas[body.questaoId].classificacao = body.classificacao;
      progress.atualizadoEm = now;
    } else if (action === 'navegacao') {
      requireValue(object(body) && Number.isInteger(body.indiceAtual) && body.indiceAtual >= 0
        && body.indiceAtual < simulado.questoes.length, 'Posição de questão inválida.', 400);
      progress.indiceAtual = body.indiceAtual;
      if (finished) save = false;
      else progress.atualizadoEm = now;
    } else if (action === 'finalizar') {
      if (finished) save = false;
      else {
        requireValue(Object.keys(progress.respostas).length === simulado.questoes.length,
          'Responda a todas as questões antes de finalizar.', 409);
        progress.finalizadoEm = now; progress.atualizadoEm = now;
      }
    }
    if (save) {
      document.simulados[id] = validateProgress(progress, simulado, hash);
      writeDocument(document);
    }
    return toDetail(simulado, progress);
  }

  async function prepareImport(data) {
    requireValue(object(data), 'Selecione um arquivo JSON de progresso válido.');
    let values;
    if (has(data, 'tipo') || has(data, 'simulados')) {
      requireValue(data.schemaVersao === 1 && data.tipo === 'estudos-fcc-progresso'
        && validDate(data.exportadoEm) && Array.isArray(data.simulados), 'O arquivo de transferência de progresso é inválido.');
      values = data.simulados;
    } else values = [data];
    const entries = await getCatalog(true);
    const ids = new Set();
    const prepared = [];
    for (const value of values) {
      requireValue(object(value) && typeof value.simuladoId === 'string' && ID.test(value.simuladoId), 'O arquivo contém um ID de simulado inválido.');
      requireValue(!ids.has(value.simuladoId), 'O arquivo contém progressos duplicados para o mesmo simulado.');
      ids.add(value.simuladoId);
      const { simulado, hash } = await getExam(value.simuladoId, entries);
      const progress = validateProgress(value, simulado, hash);
      prepared.push({ progress, info: { id: simulado.id, titulo: simulado.titulo,
        respondidas: Object.keys(progress.respostas).length, totalQuestoes: simulado.questoes.length,
        status: progress.finalizadoEm !== null ? 'resolvido' : 'pendente' } });
    }
    const document = readDocument();
    const preview = { simulados: prepared.map(item => item.info), substituicoes: prepared
      .filter(item => has(document.simulados, item.info.id)).map(item => ({ id: item.info.id, titulo: item.info.titulo })) };
    return { document, prepared, preview };
  }

  async function api(path, { method = 'GET', body } = {}) {
    requireValue(typeof method === 'string' && typeof path === 'string', 'Requisição inválida.', 400);
    method = method.toUpperCase();
    const match = path.match(/^\/api\/simulados(?:\/([^/]+)(?:\/(iniciar|respostas|classificacao|navegacao|finalizar|reiniciar))?)?\/?$/);
    requireValue(match, 'Ação não encontrada.', 404);
    if (!match[1]) {
      requireValue(method === 'GET', 'Método não permitido.', 405);
      return list();
    }
    let id;
    try { id = decodeURIComponent(match[1]); }
    catch { throw new Error('ID do simulado inválido.'); }
    const action = match[2];
    if (!action) {
      requireValue(method === 'GET', 'Método não permitido.', 405);
      const { simulado, hash } = await getExam(id);
      return toDetail(simulado, progressFor(readDocument(), simulado, hash));
    }
    requireValue(method === (['classificacao', 'navegacao'].includes(action) ? 'PATCH' : 'POST'), 'Método não permitido.', 405);
    return serialized(() => mutate(id, action, body));
  }

  api.exportProgress = () => serialized(async () => {
    const document = readDocument();
    const simulados = [];
    for (const id of Object.keys(document.simulados).sort()) {
      const progress = document.simulados[id];
      requireValue(ID.test(id) && object(progress) && progress.schemaVersao === 1
        && progress.simuladoId === id && typeof progress.simuladoHash === 'string'
        && HASH.test(progress.simuladoHash) && object(progress.respostas),
      'O formato de um progresso salvo é inválido. Os dados foram preservados.');
      // Backups must remain available even if a caderno is temporarily absent or updated.
      // The import path still validates every record against its matching caderno and hash.
      simulados.push(progress);
    }
    return { schemaVersao: 1, tipo: 'estudos-fcc-progresso', exportadoEm: new Date().toISOString(), simulados };
  });
  api.previewImport = async data => (await prepareImport(data)).preview;
  api.importProgress = (data, { confirmar = false } = {}) => serialized(async () => {
    const { document, prepared, preview } = await prepareImport(data);
    if (confirmar !== true) return preview;
    for (const item of prepared) document.simulados[item.progress.simuladoId] = item.progress;
    if (prepared.length) writeDocument(document);
    return { ...preview, importados: prepared.length };
  });
  return api;
}
