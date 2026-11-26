const app = document.querySelector('#app');
const announcements = document.querySelector('#announcements');
const letters = ['A', 'B', 'C', 'D', 'E'];
const confidenceOptions = [
  { value: 'sabia', label: 'Sabia', icon: 'check' },
  { value: 'chutei', label: 'Chutei', icon: 'shuffle' },
  { value: 'deduzi', label: 'Deduzi', icon: 'bulb' },
];
const state = {
  view: 'library', tab: 'pendentes', library: null, detail: null, index: 0,
  loading: true, busy: false, error: '', saveStatus: '', request: 0,
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

const iconPaths = {
  book: ['M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V3Z', 'M4 17a3 3 0 0 1 3-3h13', 'M9 6h6'],
  stack: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5', 'm3 16 9 5 9-5'],
  check: ['m5 12 4 4L19 6'],
  cross: ['m6 6 12 12', 'M18 6 6 18'],
  history: ['M3 11a9 9 0 1 1 2.4 7', 'M3 4v7h7', 'M12 7v5l3 2'],
  circleCheck: ['M21 11a9 9 0 1 1-5-8', 'm9 10 3 3 9-9'],
  clock: ['M12 8v5l3 2'],
  refresh: ['M20 8a8 8 0 0 0-14-3L3 8', 'M3 3v5h5', 'M4 16a8 8 0 0 0 14 3l3-3', 'M16 16h5v5'],
  chevronLeft: ['m14 6-6 6 6 6'],
  chevronRight: ['m10 6 6 6-6 6'],
  warning: ['m12 3 10 18H2L12 3Z', 'M12 9v4', 'M12 17h.01'],
  bulb: ['M9 18h6', 'M10 21h4', 'M9 15c0-2-3-3-3-6a6 6 0 1 1 12 0c0 3-3 4-3 6'],
  shuffle: ['M3 6h3c5 0 7 12 12 12h3', 'm18 15 3 3-3 3', 'M3 18h3c2 0 3-2 5-5', 'M14 8c1-1 2-2 4-2h3', 'm18 3 3 3-3 3'],
  chart: ['M4 20h16', 'M7 16V9', 'M12 16V4', 'M17 16v-5'],
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  if (name === 'clock') {
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9');
    svg.append(circle);
  }
  for (const d of iconPaths[name] || iconPaths.book) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}

function button(label, { action, kind = 'secondary', iconName, trailingIcon, testId, disabled = false, className = '', ariaLabel } = {}) {
  const element = node('button', `button button-${kind} ${className}`.trim());
  element.type = 'button';
  element.disabled = disabled;
  if (testId) element.dataset.testid = testId;
  if (ariaLabel) element.setAttribute('aria-label', ariaLabel);
  if (iconName) element.append(icon(iconName));
  element.append(node('span', '', label));
  if (trailingIcon) element.append(icon(trailingIcon));
  if (action) element.addEventListener('click', action);
  return element;
}

function announce(message) { announcements.textContent = message; }
function formatNumber(value) { return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(value) || 0); }
function dateLabel(value, includeTime = false) {
  if (!value || Number.isNaN(Date.parse(value))) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value));
}

async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: method === 'GET' ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', 'X-Estudos-FCC': '1' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Não foi possível conectar. Verifique a conexão com o aplicativo e tente novamente.');
  }
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Não foi possível ler a resposta do aplicativo. Tente novamente.'); }
  if (!response.ok) throw new Error(data.erro || 'Não foi possível concluir esta ação. Tente novamente.');
  return data;
}

function endpoint(suffix = '') { return `/api/simulados/${encodeURIComponent(state.detail.simulado.id)}${suffix}`; }

async function loadLibrary() {
  const data = await api('/api/simulados');
  state.library = { pendentes: data.pendentes || [], resolvidos: data.resolvidos || [], avisos: data.avisos || [] };
}

async function refreshLibrary() {
  if (state.loading || state.busy) return;
  state.loading = true; state.error = ''; render();
  try { await loadLibrary(); }
  catch (error) { state.error = error.message; }
  state.loading = false; render();
}

function showLibrary(tab = state.tab) {
  if (state.busy) return;
  state.request += 1;
  state.view = 'library'; state.tab = tab; state.error = ''; state.loading = false;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  render();
  refreshLibrary();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function openExam(id, status) {
  if (state.busy || state.loading) return;
  const request = ++state.request;
  state.error = ''; state.loading = true; render();
  try {
    let detail;
    if (status === 'pendente') detail = await api(`/api/simulados/${encodeURIComponent(id)}/iniciar`, { method: 'POST' });
    else {
      detail = await api(`/api/simulados/${encodeURIComponent(id)}`);
      if (detail.status === 'pendente') detail = await api(`/api/simulados/${encodeURIComponent(id)}/iniciar`, { method: 'POST' });
    }
    if (request !== state.request) return;
    state.detail = detail;
    state.index = Math.min(Math.max(detail.progresso?.indiceAtual || 0, 0), detail.simulado.questoes.length - 1);
    state.view = detail.status === 'resolvido' ? 'summary' : 'quiz';
    state.saveStatus = '';
    history.replaceState(null, '', `#simulado/${encodeURIComponent(id)}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (error) {
    if (request === state.request) state.error = error.message;
  }
  if (request === state.request) { state.loading = false; render(); }
}

async function mutate(path, method, body, { feedbackFocus = false } = {}) {
  if (state.busy) return false;
  state.busy = true; state.error = ''; state.saveStatus = 'Salvando…'; render();
  try {
    state.detail = await api(path, { method, body });
    state.index = Math.min(Math.max(state.detail.progresso.indiceAtual || 0, 0), state.detail.simulado.questoes.length - 1);
    state.saveStatus = '';
    state.busy = false; render();
    if (feedbackFocus) document.querySelector('[data-testid="feedback"]')?.focus({ preventScroll: true });
    return true;
  } catch (error) {
    state.error = error.message; state.saveStatus = 'Alteração não salva'; state.busy = false;
    render(); announce(error.message); return false;
  }
}

async function answerQuestion(letter) {
  const question = state.detail.simulado.questoes[state.index];
  if (state.detail.status === 'resolvido' || state.detail.progresso.respostas[question.id] || state.busy) return;
  const success = await mutate(endpoint('/respostas'), 'POST', { questaoId: question.id, alternativa: letter }, { feedbackFocus: true });
  if (success) {
    const answer = state.detail.progresso.respostas[question.id];
    announce(answer.acertou ? 'Você acertou. Os comentários da questão estão disponíveis.' : `Você errou. A resposta correta é ${answer.gabarito}. Os comentários estão disponíveis.`);
  }
}

async function classifyQuestion(value) {
  const question = state.detail.simulado.questoes[state.index];
  const response = state.detail.progresso.respostas[question.id];
  if (!response || state.detail.status === 'resolvido' || state.busy) return;
  const classificacao = response.classificacao === value ? null : value;
  const success = await mutate(endpoint('/classificacao'), 'PATCH', { questaoId: question.id, classificacao });
  if (success) announce(classificacao ? 'Marcação salva.' : 'Marcação removida.');
}

async function navigateQuestion(index) {
  if (state.busy || index < 0 || index >= state.detail.simulado.questoes.length || index === state.index) return;
  if (state.detail.status === 'resolvido') {
    state.index = index; state.error = ''; render();
  } else if (!(await mutate(endpoint('/navegacao'), 'PATCH', { indiceAtual: index }))) return;
  document.querySelector('[data-testid="question-card"]')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
  announce(`Questão ${index + 1} de ${state.detail.simulado.questoes.length}.`);
}

async function finishExam() {
  if (state.busy || state.detail.resumo.respondidas !== state.detail.resumo.total) return;
  if (!(await mutate(endpoint('/finalizar'), 'POST', {}))) return;
  state.view = 'summary'; state.tab = 'resolvidos'; render();
  announce('Simulado concluído. Todas as respostas e marcações foram salvas.');
  window.scrollTo({ top: 0, behavior: 'instant' });
  try { await loadLibrary(); render(); } catch { /* The completed result remains available even if refreshing the list fails. */ }
}

function renderSidebar() {
  const sidebar = node('aside', 'sidebar');
  const brand = node('div', 'brand');
  const mark = node('div', 'brand-mark'); mark.append(icon('stack'));
  const name = node('div'); name.append(node('p', 'brand-name', 'estudos fcc'), node('span', 'brand-subtitle', 'Um passo de cada vez'));
  brand.append(mark, name); sidebar.append(brand, node('div', 'nav-label', 'SEUS ESTUDOS'));
  const nav = node('nav', 'sidebar-nav'); nav.setAttribute('aria-label', 'Simulados');
  for (const [tab, label, iconName] of [['pendentes', 'Para resolver', 'book'], ['resolvidos', 'Resolvidos', 'circleCheck']]) {
    const active = state.view === 'library' ? state.tab === tab : state.detail?.status === (tab === 'resolvidos' ? 'resolvido' : 'pendente');
    const item = node('button', `nav-button${active ? ' active' : ''}`);
    item.type = 'button'; item.disabled = state.busy;
    item.dataset.testid = `tab-${tab}`;
    if (active) item.setAttribute('aria-current', 'page');
    item.append(icon(iconName), node('span', '', label), node('span', 'nav-count', state.library?.[tab]?.length || 0));
    item.addEventListener('click', () => showLibrary(tab)); nav.append(item);
  }
  const note = node('div', 'sidebar-note');
  note.append(node('strong', '', 'Pratique. Entenda. Avance.'), node('span', '', 'Questões comentadas para transformar cada resposta em aprendizado.'));
  sidebar.append(nav, note); return sidebar;
}

function renderTopbar() {
  const header = node('header', 'topbar');
  const breadcrumb = node('div', 'breadcrumb');
  breadcrumb.append(icon('book'), node('span', '', 'Seu espaço de estudo'), node('span', '', '/'), node('strong', '', state.view === 'library' ? 'Simulados' : state.view === 'summary' ? 'Resultado' : 'Em prática'));
  const badge = node('div', 'workspace-badge'); badge.append(icon('circleCheck'), node('span', '', 'Preparação para FCC'));
  header.append(breadcrumb, badge); return header;
}

function renderError() {
  if (!state.error) return null;
  const error = node('div', 'alert'); error.setAttribute('role', 'alert');
  error.append(icon('warning'), node('span', '', state.error)); return error;
}

function pageHeading(eyebrow, title, subtitle) {
  const heading = node('div', 'page-heading');
  const text = node('div');
  if (eyebrow) text.append(node('p', 'eyebrow', eyebrow));
  text.append(node('h1', '', title));
  if (subtitle) text.append(node('p', 'subtitle', subtitle));
  heading.append(text); return heading;
}

function loading() {
  const element = node('div', 'loading'); element.setAttribute('role', 'status');
  element.append(node('span', 'spinner'), node('span', '', 'Carregando seus simulados…')); return element;
}

function renderLibrary() {
  const fragment = document.createDocumentFragment();
  const pending = state.tab === 'pendentes';
  const heading = pageHeading('CADERNOS DE ESTUDO', pending ? 'Vamos praticar?' : 'Seu caminho até aqui', pending ? 'Escolha um simulado para começar ou continuar de onde parou.' : 'Reveja suas respostas e acompanhe o que aprendeu.');
  heading.append(button('Atualizar', { action: refreshLibrary, iconName: 'refresh', disabled: state.loading, testId: 'refresh-list' }));
  fragment.append(heading);
  const error = renderError(); if (error) fragment.append(error);
  if (state.loading) { fragment.append(loading()); return fragment; }
  if (!state.library && state.error) {
    const unavailable = node('section', 'empty-state');
    const mark = node('div', 'empty-icon'); mark.append(icon('refresh'));
    unavailable.append(mark, node('h2', '', 'Vamos tentar de novo?'), node('p', '', 'Seus simulados não puderam ser carregados agora. Atualize a lista para continuar.'), button('Tentar novamente', { action: refreshLibrary, iconName: 'refresh' }));
    fragment.append(unavailable); return fragment;
  }
  const library = state.library || { pendentes: [], resolvidos: [], avisos: [] };
  const overview = node('div', 'overview');
  for (const [value, label, iconName] of [
    [library.pendentes.length, 'Para resolver', 'book'],
    [library.resolvidos.length, 'Concluídos', 'circleCheck'],
    [library.resolvidos.reduce((sum, exam) => sum + (exam.totalQuestoes || 0), 0), 'Questões praticadas', 'chart'],
  ]) {
    const metric = node('div', 'metric');
    const mark = node('div', 'metric-icon'); mark.append(icon(iconName));
    const text = node('div'); text.append(node('strong', 'metric-value', value), node('span', 'metric-label', label));
    metric.append(mark, text); overview.append(metric);
  }
  fragment.append(overview);
  if (library.avisos.length) {
    const warning = node('div', 'alert alert-warning');
    warning.append(icon('warning'), node('span', '', `${library.avisos.length === 1 ? 'Um simulado não pôde' : `${library.avisos.length} simulados não puderam`} ser carregado. Os demais continuam disponíveis.`));
    fragment.append(warning);
  }
  const entries = library[state.tab];
  const sectionHeading = node('div', 'section-heading');
  sectionHeading.append(node('h2', '', pending ? 'Seus próximos simulados' : 'Simulados resolvidos'), node('span', 'section-count', `${entries.length} ${entries.length === 1 ? 'simulado' : 'simulados'}`));
  fragment.append(sectionHeading);
  if (!entries.length) {
    const empty = node('section', 'empty-state'); empty.dataset.testid = 'empty-state';
    const mark = node('div', 'empty-icon'); mark.append(icon(pending ? 'book' : 'circleCheck'));
    empty.append(mark, node('h2', '', pending ? 'Seu próximo simulado vem aí' : 'Cada simulado conta uma história'), node('p', '', pending ? 'Quando um novo simulado estiver pronto, ele aparecerá aqui. Suas respostas serão salvas enquanto você pratica.' : 'Os simulados que você concluir ficarão aqui, com suas respostas, comentários e marcações.'), button('Atualizar lista', { action: refreshLibrary, iconName: 'refresh' }));
    fragment.append(empty); return fragment;
  }
  const grid = node('div', 'exam-grid');
  entries.forEach(exam => grid.append(renderExamCard(exam)));
  fragment.append(grid); return fragment;
}

function renderExamCard(exam) {
  const resolved = exam.status === 'resolvido';
  const count = Number(exam.respondidas) || 0;
  const total = Number(exam.totalQuestoes) || 0;
  const card = node('article', 'exam-card'); card.dataset.testid = 'exam-card'; card.dataset.examId = exam.id;
  const top = node('div', 'card-topline');
  const mark = node('span', 'card-icon'); mark.append(icon('book'));
  top.append(mark, node('span', `badge ${resolved ? 'badge-teal' : count ? 'badge-blue' : ''}`, resolved ? 'Concluído' : count ? 'Em andamento' : 'Pronto para começar'));
  card.append(top, node('h3', '', exam.titulo));
  if (exam.descricao) card.append(node('p', 'exam-description', exam.descricao));
  else card.append(node('p', 'exam-description', 'Uma questão por vez, com correção e comentários após cada resposta.'));
  const meta = node('div', 'exam-meta');
  const questionCount = node('span'); questionCount.append(icon('stack'), document.createTextNode(`${total} questões`));
  meta.append(questionCount);
  if (resolved) {
    const score = node('span'); score.append(icon('check'), document.createTextNode(`${Number(exam.acertos) || 0} acertos`)); meta.append(score);
  }
  card.append(meta);
  if (!resolved) {
    const progressBlock = node('div', 'card-progress');
    const label = node('div', 'progress-label'); label.append(node('span', '', 'Seu progresso'), node('span', '', `${count} de ${total}`));
    const progress = node('progress'); progress.max = total || 1; progress.value = count; progress.setAttribute('aria-label', `${count} de ${total} questões respondidas`);
    progressBlock.append(label, progress); card.append(progressBlock);
  }
  const footer = node('div', 'card-footer');
  footer.append(node('span', 'small-note', resolved ? `Concluído em ${dateLabel(exam.finalizadoEm) || 'data registrada'}` : count ? 'Seu progresso está guardado' : 'No seu ritmo'));
  footer.append(button(resolved ? 'Ver resultado' : count ? 'Continuar' : 'Fazer simulado', { kind: 'primary', action: () => openExam(exam.id, exam.status), testId: `open-${exam.id}`, disabled: state.loading || state.busy }));
  card.append(footer); return card;
}

function renderSaveState() {
  const save = node('span', 'save-state'); save.setAttribute('role', 'status');
  const timestamp = state.detail?.progresso?.atualizadoEm;
  const time = timestamp ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)) : '';
  const label = state.saveStatus || (state.detail?.status === 'resolvido' ? 'Resultado salvo' : time ? `Salvo às ${time}` : 'Pronto para começar');
  if (state.busy) save.append(node('span', 'spinner'));
  else save.append(icon(state.saveStatus ? 'warning' : 'circleCheck'));
  save.append(node('span', '', label)); return save;
}

function renderQuiz() {
  const fragment = document.createDocumentFragment();
  const detail = state.detail;
  const resolved = detail.status === 'resolvido';
  const questions = detail.simulado.questoes;
  const question = questions[state.index];
  const answer = detail.progresso.respostas[question.id];
  const top = node('div', 'quiz-topline');
  top.append(button(resolved ? 'Ver resultado' : 'Meus simulados', { kind: 'text', iconName: 'chevronLeft', testId: 'back-to-list', disabled: state.busy, action: () => {
    if (resolved) { state.view = 'summary'; state.error = ''; render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
    else showLibrary('pendentes');
  } }), renderSaveState());
  fragment.append(top);
  const heading = pageHeading(resolved ? 'REVISÃO DO SIMULADO' : 'UM PASSO DE CADA VEZ', detail.simulado.titulo, resolved ? 'Reveja suas escolhas e os comentários de cada alternativa.' : `${detail.resumo.respondidas} de ${detail.resumo.total} questões respondidas. Seu progresso é salvo a cada ação.`);
  if (!resolved && detail.resumo.respondidas === detail.resumo.total && state.index !== questions.length - 1) heading.append(button('Finalizar simulado', { kind: 'primary', action: finishExam, disabled: state.busy, testId: 'finish-exam' }));
  fragment.append(heading);
  const error = renderError(); if (error) fragment.append(error);
  const layout = node('div', 'quiz-layout');
  const primary = node('div', 'quiz-primary');
  const card = node('section', 'question-card'); card.dataset.testid = 'question-card'; card.tabIndex = -1; card.setAttribute('aria-label', `Questão ${question.numero}`);
  const questionHeading = node('div', 'question-heading');
  questionHeading.append(node('span', 'question-number', `QUESTÃO ${question.numero} DE ${questions.length}`), node('span', 'question-subject', question.materia));
  card.append(questionHeading, node('div', 'question-text', question.enunciado));
  const alternatives = node('div', 'alternatives'); alternatives.setAttribute('role', 'group'); alternatives.setAttribute('aria-label', 'Alternativas da questão');
  for (const letter of letters) {
    const correct = answer && answer.gabarito === letter;
    const selected = answer && answer.alternativa === letter;
    const option = node('button', `alternative${correct ? ' correct' : selected ? ' incorrect' : ''}`);
    option.type = 'button'; option.disabled = Boolean(answer) || state.busy || resolved;
    option.dataset.testid = `alternative-${letter}`;
    option.setAttribute('aria-pressed', String(Boolean(selected)));
    option.setAttribute('aria-label', `${letter}) ${question.alternativas[letter]}${correct ? '. Resposta correta' : selected ? '. Sua resposta' : ''}`);
    option.append(node('span', 'alternative-letter', letter), node('span', 'alternative-text', question.alternativas[letter]));
    if (correct || selected) { const status = node('span', 'alternative-trailing'); status.append(icon(correct ? 'check' : 'cross')); option.append(status); }
    option.addEventListener('click', () => answerQuestion(letter)); alternatives.append(option);
  }
  card.append(alternatives, node('p', 'answer-hint', answer ? 'Resposta registrada. Você pode voltar a esta questão para consultar os comentários.' : 'Ao marcar uma alternativa, você verá a correção. A primeira resposta ficará registrada.'));
  primary.append(card);
  if (answer) primary.append(renderFeedback(answer), renderConfidence(answer, resolved));
  primary.append(renderNavigation(questions.length, resolved));
  layout.append(primary, renderProgress(detail)); fragment.append(layout); return fragment;
}

function renderProgress(detail) {
  const card = node('aside', 'progress-card');
  card.append(node('h2', '', 'Seu progresso'));
  const count = node('div', 'progress-count', detail.resumo.respondidas);
  count.append(node('span', '', ` / ${detail.resumo.total}`));
  const progress = node('progress'); progress.value = detail.resumo.respondidas; progress.max = detail.resumo.total || 1;
  progress.setAttribute('aria-label', `${detail.resumo.respondidas} de ${detail.resumo.total} respondidas`);
  card.append(count, node('p', 'progress-description', 'questões respondidas'), progress);
  const breakdown = node('div', 'progress-breakdown');
  for (const [name, value, className] of [['Acertos', detail.resumo.acertos, 'success'], ['Erros', detail.resumo.erros, 'failure'], ['Restantes', detail.resumo.total - detail.resumo.respondidas, '']]) {
    const row = node('div', `progress-row ${className}`); row.append(node('span', '', name), node('strong', '', value)); breakdown.append(row);
  }
  card.append(breakdown, node('p', 'progress-tip', detail.status === 'resolvido' ? 'Seu resultado está salvo. Revise as questões no seu ritmo.' : detail.resumo.respondidas === detail.resumo.total ? 'Tudo respondido. Finalize para guardar o resultado deste simulado.' : 'Leia os comentários e marque como chegou à resposta. Cada escolha ajuda na sua revisão.'));
  return card;
}

function renderFeedback(answer) {
  const section = node('section', `feedback${answer.acertou ? '' : ' wrong'}`); section.dataset.testid = 'feedback'; section.tabIndex = -1;
  section.setAttribute('aria-label', answer.acertou ? 'Resposta correta e comentários' : 'Resposta incorreta e comentários');
  const heading = node('div', 'feedback-heading');
  const mark = node('div', 'feedback-status-icon'); mark.append(icon(answer.acertou ? 'check' : 'cross'));
  const headingText = node('div'); headingText.append(node('h2', '', answer.acertou ? 'Você acertou!' : 'Você errou esta questão'), node('p', '', `Resposta correta: alternativa ${answer.gabarito}`));
  heading.append(mark, headingText);
  const body = node('div', 'feedback-body');
  body.append(node('h3', '', 'Entenda a resposta'), node('p', 'resolution', answer.resolucao));
  body.append(node('h3', '', 'Comentário de cada alternativa'));
  const explanations = node('div', 'explanation-list');
  letters.forEach(letter => {
    const correct = answer.gabarito === letter;
    const explanation = node('div', `explanation${correct ? ' correct' : ''}`); explanation.dataset.testid = `explanation-${letter}`;
    const text = node('div');
    if (correct) text.append(node('span', 'explanation-label', 'RESPOSTA CORRETA'));
    text.append(node('p', '', answer.justificativas?.[letter] || 'Comentário não disponível.'));
    explanation.append(node('span', 'explanation-letter', letter), text); explanations.append(explanation);
  });
  body.append(explanations);
  if (Array.isArray(answer.fontes) && answer.fontes.length) {
    const sources = node('details', 'sources'); sources.append(node('summary', '', 'Referências da questão'));
    const list = node('ul');
    for (const source of answer.fontes) {
      const item = node('li');
      let url;
      try { url = new URL(source.url); } catch { /* Sources without public URLs are rendered as plain text. */ }
      if (url && ['http:', 'https:'].includes(url.protocol)) {
        const link = node('a', '', source.titulo || 'Referência'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link);
      } else item.append(document.createTextNode(source.titulo || 'Referência'));
      if (source.localizador) item.append(document.createTextNode(` · ${source.localizador}`));
      list.append(item);
    }
    sources.append(list); body.append(sources);
  }
  section.append(heading, body); return section;
}

function renderConfidence(answer, resolved) {
  const card = node('section', 'confidence-card');
  card.append(node('h3', '', 'Como você chegou à resposta?'), node('p', '', resolved ? 'Sua marcação registrada neste simulado.' : 'Marcação opcional. Você pode ajustar até finalizar o simulado.'));
  const options = node('div', 'confidence-options'); options.setAttribute('role', 'group'); options.setAttribute('aria-label', 'Como chegou à resposta');
  confidenceOptions.forEach(option => {
    const selected = answer.classificacao === option.value;
    const control = node('button', `confidence-button${selected ? ' selected' : ''}`);
    control.type = 'button'; control.disabled = resolved || state.busy; control.dataset.testid = `confidence-${option.value}`;
    control.setAttribute('aria-pressed', String(selected)); control.append(icon(option.icon), node('span', '', option.label));
    control.addEventListener('click', () => classifyQuestion(option.value)); options.append(control);
  });
  card.append(options);
  if (resolved && !answer.classificacao) card.append(node('p', 'small-note', 'Você não informou uma marcação nesta questão.'));
  return card;
}

function renderNavigation(total, resolved) {
  const nav = node('nav', 'quiz-navigation'); nav.setAttribute('aria-label', 'Navegação entre questões');
  nav.append(button('Anterior', { iconName: 'chevronLeft', testId: 'previous-question', disabled: state.busy || state.index === 0, action: () => navigateQuestion(state.index - 1) }));
  nav.append(node('span', 'navigation-position', `${state.index + 1} de ${total}`));
  if (state.index === total - 1 && !resolved) nav.append(button('Finalizar simulado', { kind: 'primary', testId: 'finish-exam', disabled: state.busy || state.detail.resumo.respondidas !== total, action: finishExam }));
  else nav.append(button('Próxima', { kind: 'primary', trailingIcon: 'chevronRight', testId: 'next-question', disabled: state.busy || state.index === total - 1, action: () => navigateQuestion(state.index + 1) }));
  return nav;
}

function renderSummary() {
  const fragment = document.createDocumentFragment();
  const detail = state.detail;
  const summary = detail.resumo;
  fragment.append(button('Meus simulados', { kind: 'text', iconName: 'chevronLeft', testId: 'back-to-list', action: () => showLibrary('resolvidos') }));
  const heading = pageHeading('SIMULADO CONCLUÍDO', detail.simulado.titulo, detail.progresso.finalizadoEm ? `Concluído em ${dateLabel(detail.progresso.finalizadoEm, true)}. Suas respostas e marcações estão guardadas.` : 'Suas respostas e marcações estão guardadas.');
  heading.style.marginTop = '18px'; fragment.append(heading);
  const error = renderError(); if (error) fragment.append(error);
  const hero = node('section', 'summary-hero'); hero.dataset.testid = 'result-summary';
  const circle = node('div', 'score-circle'); circle.append(node('strong', 'score-value', `${formatNumber(summary.percentualAcertos)}%`), node('span', 'score-caption', 'de acertos'));
  const text = node('div'); text.append(node('h2', '', 'Mais um passo no seu preparo'), node('p', '', 'Reveja os comentários e use suas marcações para orientar a próxima revisão.'));
  const counts = node('div', 'summary-counts');
  for (const [value, label] of [[summary.acertos, 'acertos'], [summary.erros, 'erros'], [summary.total, 'questões']]) {
    const item = node('span'); item.append(node('strong', '', value), document.createTextNode(` ${label}`)); counts.append(item);
  }
  text.append(counts, button('Revisar respostas', { kind: 'primary', iconName: 'history', testId: 'review-exam', action: () => { state.view = 'quiz'; state.index = 0; state.error = ''; render(); window.scrollTo({ top: 0, behavior: 'instant' }); } }));
  hero.append(circle, text); fragment.append(hero);
  const columns = node('div', 'summary-columns');
  const subjects = node('section', 'summary-card'); subjects.append(node('h2', '', 'Desempenho por matéria'));
  const wrap = node('div', 'table-wrap'); const table = node('table');
  const thead = node('thead'); const headRow = node('tr');
  ['Matéria', 'Acertos', 'Aproveitamento'].forEach(label => { const th = node('th', '', label); th.scope = 'col'; headRow.append(th); });
  thead.append(headRow); table.append(thead);
  const tbody = node('tbody');
  for (const subject of summary.porMateria || []) {
    const row = node('tr'); row.append(node('td', '', subject.materia), node('td', '', `${subject.acertos} / ${subject.total}`), node('td', '', `${formatNumber(subject.percentualAcertos)}%`)); tbody.append(row);
  }
  table.append(tbody); wrap.append(table); subjects.append(wrap);
  const confidence = node('section', 'summary-card'); confidence.append(node('h2', '', 'Como você respondeu'));
  for (const [key, label] of [['sabia', 'Sabia'], ['chutei', 'Chutei'], ['deduzi', 'Deduzi'], ['naoInformado', 'Sem marcação']]) {
    const row = node('div', 'tag-stat'); row.append(node('span', '', label), node('strong', '', summary.classificacoes?.[key] || 0)); confidence.append(row);
  }
  columns.append(subjects, confidence); fragment.append(columns, node('p', 'summary-footnote', 'O aproveitamento mostra o percentual de acertos deste treino, sem aplicação dos pesos da nota oficial do concurso.'));
  return fragment;
}

function render() {
  const focused = document.activeElement?.dataset?.testid;
  const shell = node('div', 'app-shell'); shell.append(renderSidebar());
  const content = node('div', 'content-shell'); content.append(renderTopbar());
  const main = node('main', 'main-content'); main.id = 'main-content';
  if (state.view === 'library') main.append(renderLibrary());
  else if (state.loading) main.append(loading());
  else if (state.view === 'summary') main.append(renderSummary());
  else main.append(renderQuiz());
  content.append(main); shell.append(content); app.replaceChildren(shell);
  document.title = state.detail && state.view !== 'library' ? `${state.detail.simulado.titulo} · Estudos FCC` : 'Estudos FCC · Simulados';
  if (focused) {
    const match = [...document.querySelectorAll('[data-testid]')].find(item => item.dataset.testid === focused && !item.disabled);
    match?.focus({ preventScroll: true });
  }
}

document.addEventListener('keydown', event => {
  if (state.view !== 'quiz' || state.busy || state.loading || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); navigateQuestion(state.index - 1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); navigateQuestion(state.index + 1); }
});

async function boot() {
  render();
  try { await loadLibrary(); }
  catch (error) { state.error = error.message; }
  state.loading = false; render();
  const match = location.hash.match(/^#simulado\/(.+)$/);
  if (match) {
    try { await openExam(decodeURIComponent(match[1])); }
    catch { state.error = 'Não foi possível abrir este simulado.'; render(); }
  }
}

boot();
