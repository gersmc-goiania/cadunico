/* ==========================================================================
   Relatório de Atendimentos do Cadastro Único — lógica 100% client-side.
   Nenhum dado sai do navegador: tudo é lido, processado e exportado aqui.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Estado da aplicação
   * ------------------------------------------------------------------ */
  const state = {
    headers: [],
    rows: [],              // linhas cruas do CSV (objetos)
    fields: {},             // nomes de coluna detectados (data, cpf, cras, cadastrador, bairro)
    categoryCols: [],        // [{header, label, key}]
    crasCanonicalByRaw: new Map(), // raw (trim) -> nome final (sugestão automática)
    minISO: null,
    maxISO: null,
    lastReport: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, opts = {}) => Object.assign(document.createElement(tag), opts);

  /* ------------------------------------------------------------------ *
   * Utilitários de texto / data
   * ------------------------------------------------------------------ */
  function stripAccents(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function softKey(raw) {
    return stripAccents(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
  }
  function slug(s) {
    return stripAccents(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'campo';
  }
  function digitsOnly(s) {
    return (s || '').replace(/\D/g, '');
  }
  function parseDateFlexible(str) {
    if (!str) return null;
    const s = str.trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }
  function formatDateBR(iso) {
    if (!iso) return '';
    const [y, mo, d] = iso.split('-');
    return `${d}/${mo}/${y}`;
  }
  // Carimbo de data/hora do Google Forms costuma vir como "2025/11/17 4:33:39 PM GMT-3"
  // ou variações; aqui extraímos só a parte da data (ano-mês-dia), sem hora.
  function parseCarimboDate(str) {
    if (!str) return null;
    const s = str.trim();
    let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  }
  // Diferença em dias (inteiro, sempre positivo) entre duas datas ISO (YYYY-MM-DD).
  function diffDaysISO(isoA, isoB) {
    const a = new Date(isoA + 'T00:00:00Z');
    const b = new Date(isoB + 'T00:00:00Z');
    return Math.abs(Math.round((b - a) / 86400000));
  }
  function todayBR() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  }

  /* ------------------------------------------------------------------ *
   * Passo 0 — login com conta Google
   * ------------------------------------------------------------------ *
   * A verificação de quem está autorizado acontece no Apps Script
   * (servidor), nunca aqui. O token guardado no navegador só serve para
   * provar, a cada busca de dados, "eu sou esta conta Google" — quem
   * decide se essa conta pode ver os dados é sempre o backend.
   * ------------------------------------------------------------------ */
  const SESSION_KEY = 'cadunico_id_token';
  let idToken = sessionStorage.getItem(SESSION_KEY) || null;

  const loginError = $('#login-error');
  const mastheadSession = $('#masthead-session');
  const sessionEmail = $('#session-email');

  function decodeJwtPayload(token) {
    try {
      const payload = token.split('.')[1];
      const json = decodeURIComponent(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        .split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function showLoggedInUI(token) {
    const payload = decodeJwtPayload(token);
    $('#step-0').hidden = true;
    $('#step-1').hidden = false;
    mastheadSession.hidden = false;
    sessionEmail.textContent = payload?.email || '';
    $('#step-1').scrollIntoView({ behavior: 'smooth', block: 'start' });
    fetchFromSheet(); // busca os dados automaticamente assim que loga
  }

  function handleCredentialResponse(response) {
    idToken = response.credential;
    sessionStorage.setItem(SESSION_KEY, idToken);
    loginError.hidden = true;
    showLoggedInUI(idToken);
  }

  function logout() {
    idToken = null;
    sessionStorage.removeItem(SESSION_KEY);
    state.rows = [];
    state.lastReport = null;
    ['#step-1', '#step-2', '#step-3', '#step-4', '#step-5'].forEach(sel => { $(sel).hidden = true; });
    $('#step-1').hidden = true;
    mastheadSession.hidden = true;
    $('#step-0').hidden = false;
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    $('#step-0').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#btn-logout').addEventListener('click', logout);

  // A biblioteca de login do Google carrega em segundo plano (async) e pode
  // ainda não estar pronta quando este script roda — por isso esperamos de
  // verdade, em vez de checar só uma vez.
  function waitForGoogleIdentity(timeoutMs) {
    return new Promise(function (resolve, reject) {
      const start = Date.now();
      (function poll() {
        if (window.google?.accounts?.id) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
        setTimeout(poll, 100);
      })();
    });
  }

  if (!window.APP_CONFIG || APP_CONFIG.GOOGLE_CLIENT_ID.startsWith('COLOQUE_AQUI')) {
    loginError.textContent = 'Login não configurado: falta preencher config.js com o Client ID do Google.';
    loginError.hidden = false;
  } else {
    waitForGoogleIdentity(8000).then(function () {
      google.accounts.id.initialize({
        client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
      });
      google.accounts.id.renderButton($('#g_id_signin'), { theme: 'outline', size: 'large', locale: 'pt-BR' });
      if (idToken) showLoggedInUI(idToken); // já tinha uma sessão válida nesta aba
    }).catch(function () {
      loginError.textContent = 'Não foi possível carregar o login do Google. Verifique sua conexão e recarregue a página.';
      loginError.hidden = false;
    });
  }

  /* ------------------------------------------------------------------ *
   * Passo 1a — buscar dados direto da planilha (via Apps Script)
   * ------------------------------------------------------------------ */
  const fetchStatus = $('#fetch-status');
  const fetchError = $('#fetch-error');

  $('#btn-fetch-sheet').addEventListener('click', fetchFromSheet);

  async function fetchFromSheet() {
    fetchError.hidden = true;
    fetchStatus.hidden = true;
    if (!idToken) { logout(); return; }
    if (!APP_CONFIG.APPS_SCRIPT_URL || APP_CONFIG.APPS_SCRIPT_URL.startsWith('COLOQUE_AQUI')) {
      fetchError.textContent = 'Busca não configurada: falta preencher config.js com a URL do Apps Script.';
      fetchError.hidden = false;
      return;
    }
    showLoading('Buscando os dados atualizados da planilha…');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      let resp;
      try {
        resp = await fetch(APP_CONFIG.APPS_SCRIPT_URL, {
          method: 'POST',
          // text/plain evita o preflight CORS (o Apps Script não responde a OPTIONS).
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ idToken }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!resp.ok) throw new Error('O servidor respondeu com erro (' + resp.status + ').');
      const data = await resp.json();
      if (data.error) {
        if (/n.o autorizad/i.test(data.error) || /sess.o expirada/i.test(data.error)) {
          logout();
          fetchError.textContent = data.error + ' Faça login novamente.';
          fetchError.hidden = false;
          return;
        }
        throw new Error(data.error);
      }
      showLoading('Processando as linhas da planilha…');
      await new Promise(r => setTimeout(r, 30));
      parseCsvText(data.csv);
      fetchStatus.textContent = 'Dados buscados agora, ' + todayBR() + '.';
      fetchStatus.hidden = false;
      $('#dropzone-sub').textContent = '.zip ou .csv';
    } catch (err) {
      console.error(err);
      const msg = err.name === 'AbortError'
        ? 'O servidor demorou demais para responder (mais de 25s). Confira a URL do Apps Script em config.js e se a implantação está ativa.'
        : err.message;
      fetchError.textContent = 'Não foi possível buscar os dados: ' + msg;
      fetchError.hidden = false;
    } finally {
      hideLoading();
    }
  }

  /* ------------------------------------------------------------------ *
   * Passo 1 — upload e leitura do arquivo
   * ------------------------------------------------------------------ */
  const fileInput = $('#file-input');
  const dropzone = $('#dropzone');
  const fileStatus = $('#file-status');
  const fileError = $('#file-error');

  ['dragover', 'dragenter'].forEach(ev => dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-drag');
  }));
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-drag');
  }));
  dropzone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });

  function showLoading(text) {
    $('#loading-text').textContent = text;
    $('#loading-overlay').hidden = false;
  }
  function hideLoading() {
    $('#loading-overlay').hidden = true;
  }

  async function handleFile(file) {
    fileError.hidden = true;
    fileStatus.hidden = true;
    $('#dropzone-sub').textContent = file.name;

    const name = file.name.toLowerCase();
    showLoading('Lendo o arquivo…');
    try {
      let csvText;
      if (name.endsWith('.zip')) {
        csvText = await extractCsvFromZip(file);
      } else if (name.endsWith('.csv')) {
        csvText = await file.text();
      } else {
        throw new Error('Formato não reconhecido. Envie um .zip ou um .csv.');
      }
      showLoading('Processando as linhas do arquivo…');
      await new Promise(r => setTimeout(r, 30)); // deixa o overlay pintar antes do parse pesado
      parseCsvText(csvText);
    } catch (err) {
      console.error(err);
      fileError.textContent = 'Não foi possível ler o arquivo: ' + err.message;
      fileError.hidden = false;
    } finally {
      hideLoading();
    }
  }

  async function extractCsvFromZip(file) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    let target = null;
    zip.forEach((path, entry) => {
      if (!target && !entry.dir && /\.csv$/i.test(path) && !path.includes('__MACOSX')) {
        target = entry;
      }
    });
    if (!target) throw new Error('Não encontrei um .csv dentro do .zip.');
    return target.async('string');
  }

  function parseCsvText(csvText) {
    const result = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
    });
    if (!result.data.length) {
      throw new Error('O arquivo não tem linhas de dados.');
    }
    const headers = result.meta.fields;

    // detecta colunas de categoria: "Serviço ofertado [Algo]"
    const categoryCols = [];
    headers.forEach(h => {
      const m = h.match(/\[(.+)\]/);
      if (m) categoryCols.push({ header: h, label: m[1].trim(), key: slug(m[1]) });
    });

    const findHeader = (re, fallbackIndex) =>
      headers.find(h => re.test(h)) || headers[fallbackIndex] || null;

    const fields = {
      data: findHeader(/data de atendimento/i, 1),
      carimbo: findHeader(/carimbo/i, 0),
      cadastrador: findHeader(/cadastrador/i, 2),
      cpf: findHeader(/cpf/i, 3),
      bairro: findHeader(/bairro/i, headers.length - 2),
      cras: findHeader(/cras/i, headers.length - 1),
    };

    if (!fields.data || !fields.cras) {
      throw new Error('Não encontrei as colunas de "Data de Atendimento" e/ou "Nome do CRAS" no cabeçalho.');
    }

    // anota cada linha com id, data normalizada e data do carimbo (para conferência de datas)
    const rows = result.data.map((row, i) => {
      row.__rowId = i;
      row.__iso = parseDateFlexible(row[fields.data] || '');
      row.__carimboISO = fields.carimbo ? parseCarimboDate(row[fields.carimbo] || '') : null;
      row.__autoCorrigidoAno = false;

      // Caso muito comum de erro de digitação: dia e mês corretos, só o ano errado
      // (ex.: começo de ano, o usuário ainda "vive" no ano anterior). Quando dia e mês
      // da "Data de Atendimento" batem exatamente com os do carimbo e só o ano diverge,
      // corrige sozinho para o ano do carimbo — não precisa ir para a conferência manual.
      if (row.__iso && row.__carimboISO) {
        const diaMesAtendimento = row.__iso.slice(5);   // "MM-DD"
        const diaMesCarimbo = row.__carimboISO.slice(5); // "MM-DD"
        const anoAtendimento = row.__iso.slice(0, 4);
        const anoCarimbo = row.__carimboISO.slice(0, 4);
        if (diaMesAtendimento === diaMesCarimbo && anoAtendimento !== anoCarimbo) {
          row.__iso = anoCarimbo + row.__iso.slice(4); // troca só o ano, mantém "-MM-DD"
          row.__autoCorrigidoAno = true;
        }
      }
      return row;
    });

    state.headers = headers;
    state.rows = rows;
    state.fields = fields;
    state.categoryCols = categoryCols;

    fileStatus.hidden = false;
    fileStatus.textContent = `${rows.length.toLocaleString('pt-BR')} registros lidos, ${categoryCols.length} categorias de serviço encontradas.`;

    buildCrasClustering();
    buildCadastradorClustering();
    renderCrasReviewTable();
    renderCadastradorReviewTable();

    $('#step-2').hidden = false;
    $('#step-3').hidden = true;
    $('#step-4').hidden = true;
    $('#step-5').hidden = true;
    $('#step-2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------------------------------------------------ *
   * Passo 2 — agrupamento automático de unidades (CRAS)
   * ------------------------------------------------------------------ */
  // Junções confirmadas manualmente por quem conhece a rede de unidades —
  // o agrupamento automático por similaridade de texto não arrisca juntar
  // nomes muito diferentes entre si (ex.: "SEMAS" e "CENTRAL"), então essas
  // exceções entram aqui, à parte. Para adicionar uma nova junção confirmada,
  // acrescente um item: { canonical: 'NOME FINAL', match: ['VARIANTE 1', 'VARIANTE 2', ...] }.
  const MANUAL_MERGES = [
    { canonical: 'CENTRAL', match: ['CENTRAL', 'POSTO CENTRAL', 'SEMAS'] },
  ];

  // Nomes próprios compostos: quando a 2ª palavra do nome é continuação do
  // primeiro nome (não é sobrenome), o "primeiro sobrenome" de verdade é a
  // 3ª palavra. Sem essa lista, "Maria Aparecida Silva" e "Maria Aparecida
  // Souza" — duas pessoas diferentes — seriam agrupadas como se fossem uma
  // só. Edite/complete conforme os nomes da sua rede.
  const COMPOUND_FIRST_NAMES = new Set([
    'MARIA APARECIDA', 'MARIA JOSE', 'MARIA DE', 'MARIA CRISTINA', 'MARIA HELENA',
    'MARIA LUCIA', 'MARIA AUXILIADORA', 'MARIA EDUARDA', 'MARIA CLARA',
    'MARIA ANTONIA', 'MARIA DO', 'MARIA DAS', 'MARIA FERNANDA', 'MARIA ISABEL',
    'ANA PAULA', 'ANA CAROLINA', 'ANA CRISTINA', 'ANA CLAUDIA', 'ANA LUCIA',
    'ANA MARIA', 'ANA BEATRIZ', 'ANA FLAVIA', 'ANA LUIZA',
    'JOSE CARLOS', 'JOSE ROBERTO', 'JOSE MARIA', 'JOSE EDUARDO', 'JOSE ANTONIO',
    'JOAO PAULO', 'JOAO CARLOS', 'JOAO BATISTA', 'JOAO VICTOR', 'JOAO VITOR',
    'LUIZ CARLOS', 'LUIZ FERNANDO', 'LUIZ HENRIQUE', 'LUIZ ANTONIO', 'LUIS CARLOS',
    'CARLOS EDUARDO', 'CARLOS ALBERTO', 'CARLOS HENRIQUE',
    'PEDRO HENRIQUE', 'ANTONIO CARLOS', 'FRANCISCO DE',
  ]);

  // Agrupa pelo par "primeiro nome + primeiro sobrenome", ignorando os
  // sobrenomes seguintes (que na prática são os mais abreviados, esquecidos
  // ou digitados errado). Se as duas primeiras palavras formam um nome
  // composto conhecido, usa a 3ª palavra como sobrenome de verdade.
  function cadastradorNameKey(raw) {
    const words = softKey(raw).split(' ').filter(Boolean);
    if (words.length <= 1) return words.join(' ');
    const firstTwo = words.slice(0, 2).join(' ');
    const useThree = COMPOUND_FIRST_NAMES.has(firstTwo) && words.length >= 3;
    return words.slice(0, useThree ? 3 : 2).join(' ');
  }

  // Agrupamento "guloso por centróides": cada nome só é comparado com os
  // representantes JÁ CONSOLIDADOS (processados em ordem de frequência), nunca
  // encadeado através de outras variantes fracas. Isso evita o problema clássico
  // do agrupamento transitivo (union-find), em que A~B e B~C faz A e C se
  // juntarem mesmo sendo bem diferentes entre si (ex.: "MIRNA" e "MONICA" acabando
  // no mesmo grupo por causa de uma cadeia de erros de digitação de terceiros).
  // minLenForFuzzy: nomes mais curtos que isso nunca entram em comparação por
  // similaridade (siglas/nomes curtos têm alto risco de colisão por acaso).
  // maxDist: distância de Levenshtein máxima entre as chaves para considerar o mesmo nome.
  function clusterByTextSimilarity(displayCounts, manualMerges = [], opts = {}) {
    const minLenForFuzzy = opts.minLenForFuzzy ?? 4;
    const maxDist = opts.maxDist ?? 2;

    // 1) agrupa por chave "soft" (sem acento, maiúsculas, espaços únicos)
    const baseGroups = new Map(); // softKey -> {count, bestRaw, bestCount}
    displayCounts.forEach((count, raw) => {
      const key = softKey(raw);
      if (!baseGroups.has(key)) baseGroups.set(key, { count: 0, bestRaw: raw, bestCount: 0 });
      const g = baseGroups.get(key);
      g.count += count;
      if (count > g.bestCount) { g.bestCount = count; g.bestRaw = raw; }
    });

    // 2) processa da chave mais frequente para a menos frequente; cada uma tenta
    // "encaixar" num centróide já existente, senão vira um novo centróide
    const sorted = [...baseGroups.entries()].sort((a, b) => b[1].count - a[1].count);
    const centroids = []; // [{key, bestRaw, bestCount, count}]
    const keyToCentroid = new Map(); // softKey -> índice em centroids

    sorted.forEach(([key, g]) => {
      let bestIdx = -1, bestDist = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const c = centroids[i];
        if (Math.min(key.length, c.key.length) < minLenForFuzzy) continue; // nomes curtos: só igualdade exata
        if (Math.abs(key.length - c.key.length) > 3) continue; // corta comparação cara e improvável
        const d = levenshtein(key, c.key);
        if (d <= maxDist && d < bestDist) { bestIdx = i; bestDist = d; }
      }
      if (bestIdx === -1) {
        centroids.push({ key, bestRaw: g.bestRaw, bestCount: g.bestCount, count: g.count });
        keyToCentroid.set(key, centroids.length - 1);
      } else {
        const c = centroids[bestIdx];
        c.count += g.count;
        if (g.bestCount > c.bestCount) { c.bestCount = g.bestCount; c.bestRaw = g.bestRaw; }
        keyToCentroid.set(key, bestIdx);
      }
    });

    // 3) junções manuais confirmadas: força as variantes indicadas a apontar
    // para o mesmo centróide, com o nome canônico definido na regra
    manualMerges.forEach(rule => {
      const matchedKeys = rule.match.map(softKey).filter(k => keyToCentroid.has(k));
      if (matchedKeys.length < 2) return; // nada a unir se o arquivo não tem essas variantes
      const targetIdx = keyToCentroid.get(matchedKeys[0]);
      matchedKeys.forEach(k => {
        const idx = keyToCentroid.get(k);
        if (idx !== targetIdx) centroids[targetIdx].count += centroids[idx].count;
        keyToCentroid.set(k, targetIdx);
      });
      centroids[targetIdx].bestRaw = rule.canonical;
    });

    // 4) monta o mapa final raw -> nome canônico, e metadados para eventual tabela de revisão
    const rawToCanonical = new Map();
    const reviewRows = [];
    displayCounts.forEach((count, raw) => {
      const key = softKey(raw);
      const idx = keyToCentroid.get(key);
      const canonical = centroids[idx].bestRaw;
      rawToCanonical.set(raw, canonical);
      reviewRows.push({ raw, count, canonical, clusterId: idx });
    });

    return { rawToCanonical, reviewRows: reviewRows.sort((a, b) => b.count - a.count) };
  }

  function buildCrasClustering() {
    const crasHeader = state.fields.cras;
    const displayCounts = new Map();
    state.rows.forEach(row => {
      const raw = (row[crasHeader] || '').trim();
      if (!raw) return;
      displayCounts.set(raw, (displayCounts.get(raw) || 0) + 1);
    });
    // pool pequeno e conhecido (24 CRAS + algumas unidades administrativas):
    // pode usar limiar mais permissivo (nomes a partir de 4 letras, distância até 2)
    const { rawToCanonical, reviewRows } = clusterByTextSimilarity(displayCounts, MANUAL_MERGES, { minLenForFuzzy: 4, maxDist: 2 });
    state.crasCanonicalByRaw = rawToCanonical;
    state._crasReviewRows = reviewRows;
  }

  // Cadastradores também variam grafia entre um preenchimento e outro (acento,
  // caixa, sobrenome abreviado etc.), mas são ~1.800 nomes de pessoas reais — um
  // limiar permissivo aqui juntaria pessoas diferentes por acaso (ex.: nomes
  // curtos como "Mirna" e "Monica"). Por isso usa limiar mais conservador:
  // só considera parecidos nomes com pelo menos 6 letras e distância de 1.
  // Cadastradores variam grafia entre um preenchimento e outro — mas o padrão
  // mais comum não é erro de letra isolada, é sobrenome do meio abreviado,
  // esquecido ou trocado (ex.: "Aparecida Tertuliana Cintra Andrade" vira
  // "Aparecida Tertuliana C. Andrade" ou só "Aparecida Tertuliana"). Isso
  // muda muitos caracteres de uma vez, então comparar o nome inteiro por
  // distância de edição não pega esse caso. Por isso agrupa só pelo par
  // "primeiro nome + primeiro sobrenome" (função cadastradorNameKey acima) e
  // ignora o resto.
  // Cadastradores variam grafia de duas formas bem diferentes: (1) sobrenomes
  // do meio abreviados/esquecidos/errados — resolvido reduzindo para "primeiro
  // nome + primeiro sobrenome" e ignorando o resto; (2) erro de digitação no
  // próprio primeiro nome ou sobrenome ("andrea"→"andea", "maria"→"amria") —
  // resolvido com uma segunda passada de agrupamento por similaridade sobre
  // essa chave já reduzida. O limiar é mais apertado para nome único (sem
  // sobrenome) porque nomes curtos reais colidem fácil por acaso (Mirna vs.
  // Miriam, Monica vs. Monca) — juntar por engano é pior que deixar separado.
  function buildCadastradorClustering() {
    const col = state.fields.cadastrador;
    if (!col) { state.cadastradorCanonicalByRaw = new Map(); state._cadastradorReviewRows = []; return; }

    const displayCounts = new Map();
    state.rows.forEach(row => {
      const raw = (row[col] || '').trim();
      if (!raw) return;
      displayCounts.set(raw, (displayCounts.get(raw) || 0) + 1);
    });

    // etapa 1: reduz cada nome à chave "primeiro nome [+ primeiro sobrenome]"
    const reduced = new Map(); // nameKey -> {count, bestRaw, bestCount}
    displayCounts.forEach((count, raw) => {
      const key = cadastradorNameKey(raw);
      if (!reduced.has(key)) reduced.set(key, { count: 0, bestRaw: raw, bestCount: 0 });
      const g = reduced.get(key);
      g.count += count;
      if (count > g.bestCount) { g.bestCount = count; g.bestRaw = raw; }
    });

    // etapa 2: agrupamento guloso por centróide sobre as chaves reduzidas,
    // processando da mais frequente pra menos frequente; limiar depende de a
    // chave ter 1 palavra (nome sozinho) ou 2+ (nome + sobrenome)
    const items = [...reduced.entries()].sort((a, b) => b[1].count - a[1].count);
    const centroids = []; // [{key, bestRaw, bestCount, count}]
    const keyToCentroid = new Map();

    items.forEach(([key, g]) => {
      const isSingle = !key.includes(' ');
      const minLen = isSingle ? 7 : 5;
      const maxDist = isSingle ? 1 : 2;
      let bestIdx = -1, bestDist = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const c = centroids[i];
        if ((!c.key.includes(' ')) !== isSingle) continue; // não compara nome único com nome+sobrenome
        if (Math.min(key.length, c.key.length) < minLen) continue;
        if (Math.abs(key.length - c.key.length) > 3) continue;
        const d = levenshtein(key, c.key);
        if (d <= maxDist && d < bestDist) { bestIdx = i; bestDist = d; }
      }
      if (bestIdx === -1) {
        centroids.push({ key, bestRaw: g.bestRaw, bestCount: g.bestCount, count: g.count, rawKeys: [key] });
        keyToCentroid.set(key, centroids.length - 1);
      } else {
        const c = centroids[bestIdx];
        c.count += g.count;
        c.rawKeys.push(key);
        if (g.bestCount > c.bestCount) { c.bestCount = g.bestCount; c.bestRaw = g.bestRaw; }
        keyToCentroid.set(key, bestIdx);
      }
    });

    // monta o mapa final raw -> nome canônico e as linhas para a tela de conferência
    // (só entram na conferência os grupos que de fato juntaram mais de um nome
    // digitado diferente — a maioria dos ~1.800 nomes é só 1 variante, não precisa revisão)
    const rawToCanonical = new Map();
    const groupsMultiRaw = new Map(); // centroidIdx -> [{raw, count}]
    displayCounts.forEach((count, raw) => {
      const key = cadastradorNameKey(raw);
      const idx = keyToCentroid.get(key);
      const canonical = centroids[idx].bestRaw;
      rawToCanonical.set(raw, canonical);
      if (!groupsMultiRaw.has(idx)) groupsMultiRaw.set(idx, []);
      groupsMultiRaw.get(idx).push({ raw, count });
    });

    const reviewRows = [];
    groupsMultiRaw.forEach((entries, idx) => {
      if (entries.length < 2) return; // grupo com 1 variante só: não precisa revisão
      const canonical = centroids[idx].bestRaw;
      entries.sort((a, b) => b.count - a.count).forEach(e => {
        reviewRows.push({ raw: e.raw, count: e.count, canonical, clusterId: idx });
      });
    });

    state.cadastradorCanonicalByRaw = rawToCanonical;
    state._cadastradorReviewRows = reviewRows.sort((a, b) => b.count - a.count);
  }

  function renderCadastradorReviewTable() {
    const wrap = $('#cadastrador-review-wrap');
    if (!state.fields.cadastrador) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const rows = state._cadastradorReviewRows;
    const distinctCadastradores = new Set(state.cadastradorCanonicalByRaw.values()).size;
    const totalRaw = state.cadastradorCanonicalByRaw.size;
    $('#cadastrador-summary').innerHTML =
      `<span><strong>${totalRaw.toLocaleString('pt-BR')}</strong> nomes distintos no arquivo</span>` +
      `<span>agrupados automaticamente em <strong>${distinctCadastradores.toLocaleString('pt-BR')}</strong> cadastradores</span>` +
      `<span><strong>${rows.length.toLocaleString('pt-BR')}</strong> linhas envolvidas em algum agrupamento</span>`;

    const tbody = $('#cadastrador-table tbody');
    tbody.innerHTML = '';
    let altToggle = false, lastCluster = null;
    rows.forEach(r => {
      if (r.clusterId !== lastCluster) { altToggle = !altToggle; lastCluster = r.clusterId; }
      const tr = el('tr', { className: altToggle ? 'group-alt' : '' });
      const tdRaw = el('td'); tdRaw.textContent = r.raw;
      const tdCount = el('td', { className: 'count-cell' }); tdCount.textContent = r.count.toLocaleString('pt-BR');
      const tdFinal = el('td');
      const input = el('input', { type: 'text', value: r.canonical });
      input.dataset.raw = r.raw;
      tdFinal.appendChild(input);
      tr.append(tdRaw, tdCount, tdFinal);
      tbody.appendChild(tr);
    });
  }

  function currentCadastradorMap() {
    const map = new Map(state.cadastradorCanonicalByRaw); // parte do agrupamento automático...
    document.querySelectorAll('#cadastrador-table input[type=text]').forEach(input => {
      map.set(input.dataset.raw, input.value.trim() || input.dataset.raw); // ...e aplica por cima as correções manuais
    });
    return map;
  }

  $('#btn-toggle-cadastrador-table').addEventListener('click', (e) => {
    const tableWrap = $('#cadastrador-table-wrap');
    const nowHidden = !tableWrap.hidden;
    tableWrap.hidden = nowHidden;
    e.target.textContent = nowHidden ? 'Mostrar agrupamentos' : 'Ocultar agrupamentos';
  });

  function renderCrasReviewTable() {
    const tbody = $('#cras-table tbody');
    tbody.innerHTML = '';
    const clusterIndex = new Map();
    let altToggle = false, lastCluster = null;

    state._crasReviewRows.forEach(r => {
      if (r.clusterId !== lastCluster) { altToggle = !altToggle; lastCluster = r.clusterId; }
      const tr = el('tr', { className: altToggle ? 'group-alt' : '' });

      const tdRaw = el('td');
      tdRaw.textContent = r.raw;
      const tdCount = el('td', { className: 'count-cell' });
      tdCount.textContent = r.count.toLocaleString('pt-BR');
      const tdFinal = el('td');
      const input = el('input', { type: 'text', value: r.canonical });
      input.dataset.raw = r.raw;
      tdFinal.appendChild(input);

      tr.append(tdRaw, tdCount, tdFinal);
      tbody.appendChild(tr);
    });

    const uniqueCanonical = new Set(state._crasReviewRows.map(r => r.canonical)).size;
    $('#cras-summary').innerHTML =
      `<span><strong>${state._crasReviewRows.length}</strong> variações encontradas no arquivo</span>` +
      `<span>agrupadas automaticamente em <strong>${uniqueCanonical}</strong> unidades</span>`;
  }

  function currentCrasMap() {
    const map = new Map();
    document.querySelectorAll('#cras-table input[type=text]').forEach(input => {
      const final = input.value.trim() || input.dataset.raw;
      map.set(input.dataset.raw, final);
    });
    return map;
  }

  $('#btn-to-step3').addEventListener('click', () => {
    buildDatesReview();
    $('#step-3').hidden = false;
    $('#step-3').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ------------------------------------------------------------------ *
   * Passo 3 — conferência de datas (carimbo × data de atendimento)
   * ------------------------------------------------------------------ */
  // Só vale a pena revisar manualmente quando a distância entre o carimbo e a
  // data digitada é grande o bastante para indicar erro de digitação (não um
  // atendimento registrado com um dia ou dois de atraso, o que é normal).
  const DATE_REVIEW_THRESHOLD_DAYS = 180;

  function buildDatesReview() {
    const { fields } = state;
    const flagged = [];
    state.rows.forEach(row => {
      if (!fields.carimbo) return; // arquivo sem coluna de carimbo: não há o que comparar
      if (!row.__carimboISO) return; // carimbo ilegível: não dá para comparar, não bloqueia nada
      if (!row.__iso) {
        flagged.push({ row, reason: 'Data ilegível' });
      } else {
        const diff = diffDaysISO(row.__carimboISO, row.__iso);
        if (diff > DATE_REVIEW_THRESHOLD_DAYS) {
          flagged.push({ row, reason: `${diff.toLocaleString('pt-BR')} dias de diferença do carimbo` });
        }
      }
    });
    state._datesFlagged = flagged;

    const autoCorrigidos = state.rows.filter(r => r.__autoCorrigidoAno).length;
    const autoCorrigidosMsg = autoCorrigidos
      ? ` <span><strong>${autoCorrigidos.toLocaleString('pt-BR')}</strong> tiveram só o ano corrigido automaticamente (dia e mês já batiam com o carimbo)</span>`
      : '';

    $('#dates-summary').innerHTML = fields.carimbo
      ? `<span><strong>${flagged.length.toLocaleString('pt-BR')}</strong> de <strong>${state.rows.length.toLocaleString('pt-BR')}</strong> registros com possível problema de data</span>${autoCorrigidosMsg}`
      : `<span>Não encontrei a coluna "Carimbo de data/hora" neste arquivo — não foi possível conferir.</span>`;

    const wrap = $('#dates-table-wrap');
    const empty = $('#dates-empty');
    const toggleBtn = $('#btn-toggle-dates-table');
    const tbody = $('#dates-table tbody');
    tbody.innerHTML = '';
    wrap.hidden = true; // a tabela começa sempre oculta; só aparece se o usuário pedir

    if (!flagged.length) {
      empty.hidden = false;
      toggleBtn.hidden = true;
      return;
    }
    empty.hidden = true;
    toggleBtn.hidden = false;
    toggleBtn.textContent = `Mostrar detalhes das datas (${flagged.length.toLocaleString('pt-BR')})`;

    flagged.forEach(({ row, reason }) => {
      const tr = el('tr');
      const tdReason = el('td');
      tdReason.textContent = reason;
      const tdCarimbo = el('td');
      tdCarimbo.textContent = (row[fields.carimbo] || '').trim();
      const tdOriginal = el('td');
      tdOriginal.textContent = (row[fields.data] || '').trim();
      const tdCras = el('td');
      tdCras.textContent = (row[fields.cras] || '').trim();
      const tdCadastrador = el('td');
      tdCadastrador.textContent = (row[fields.cadastrador] || '').trim();
      const tdFix = el('td');
      const input = el('input', { type: 'date', value: row.__iso || '' });
      input.dataset.rowid = row.__rowId;
      tdFix.appendChild(input);

      tr.append(tdReason, tdCarimbo, tdOriginal, tdCras, tdCadastrador, tdFix);
      tbody.appendChild(tr);
    });
  }

  $('#btn-toggle-dates-table').addEventListener('click', () => {
    const wrap = $('#dates-table-wrap');
    const btn = $('#btn-toggle-dates-table');
    wrap.hidden = !wrap.hidden;
    const count = (state._datesFlagged || []).length.toLocaleString('pt-BR');
    btn.textContent = wrap.hidden ? `Mostrar detalhes das datas (${count})` : `Ocultar detalhes das datas (${count})`;
  });

  function goToStep4() {
    // aplica as correções feitas na tela de datas diretamente nas linhas
    // (se o usuário pulou a etapa sem mexer em nada, isso não muda nada)
    document.querySelectorAll('#dates-table input[type=date]').forEach(input => {
      const rowId = Number(input.dataset.rowid);
      const row = state.rows[rowId];
      if (!row) return;
      row.__iso = input.value || null; // vazio = mantém fora do relatório (data inválida)
    });
    setupDateRange();
    populateReportFilters();
    updateReportTypeUI();
    $('#step-4').hidden = false;
    $('#step-4').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#btn-to-step4').addEventListener('click', goToStep4);
  $('#btn-to-step4-top').addEventListener('click', goToStep4);

  /* ------------------------------------------------------------------ *
   * Passo 4 — tipo de relatório (Geral / por cadastrador / por unidade)
   * ------------------------------------------------------------------ */
  function fillSelect(select, values) {
    select.innerHTML = '';
    values.forEach(v => select.appendChild(el('option', { value: v, textContent: v })));
  }
  function populateReportFilters() {
    const crasMap = currentCrasMap();
    const unidades = [...new Set([...crasMap.values()])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const cadastradores = [...new Set(currentCadastradorMap().values())].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    fillSelect($('#report-unidade'), unidades);
    fillSelect($('#report-cadastrador'), cadastradores);
  }
  function updateReportTypeUI() {
    const type = $('#report-type').value;
    $('#cadastrador-select-wrap').hidden = type !== 'cadastrador';
    $('#unidade-select-wrap').hidden = type !== 'unidade';
    $('#cadastrador-review-wrap').hidden = type !== 'cadastrador' || !state.fields.cadastrador;
  }
  $('#report-type').addEventListener('change', updateReportTypeUI);
  // reflete correções feitas na tabela de conferência direto na lista de opções do select
  $('#cadastrador-table').addEventListener('input', () => {
    const current = $('#report-cadastrador').value;
    populateReportFilters();
    if ([...$('#report-cadastrador').options].some(o => o.value === current)) {
      $('#report-cadastrador').value = current;
    }
  });
  function setupDateRange() {
    let min = null, max = null;
    state.rows.forEach(r => {
      if (!r.__iso) return;
      if (!min || r.__iso < min) min = r.__iso;
      if (!max || r.__iso > max) max = r.__iso;
    });
    state.minISO = min;
    state.maxISO = max;
    $('#date-start').value = min || '';
    $('#date-end').value = max || '';
    $('#date-start').min = min || '';
    $('#date-start').max = max || '';
    $('#date-end').min = min || '';
    $('#date-end').max = max || '';
    $('#date-bounds-hint').textContent = min && max
      ? `Dados disponíveis de ${formatDateBR(min)} a ${formatDateBR(max)}`
      : 'Não encontrei datas válidas no arquivo.';
  }

  $('#btn-generate').addEventListener('click', async () => {
    const reportError = $('#report-error');
    reportError.hidden = true;
    const startISO = $('#date-start').value;
    const endISO = $('#date-end').value;
    if (!startISO || !endISO) {
      reportError.textContent = 'Selecione a data inicial e a data final.';
      reportError.hidden = false;
      return;
    }
    if (startISO > endISO) {
      reportError.textContent = 'A data inicial não pode ser depois da data final.';
      reportError.hidden = false;
      return;
    }
    const reportType = $('#report-type').value;
    const filter = { type: reportType };
    if (reportType === 'cadastrador') filter.value = $('#report-cadastrador').value;
    if (reportType === 'unidade') filter.value = $('#report-unidade').value;
    if ((reportType === 'cadastrador' || reportType === 'unidade') && !filter.value) {
      reportError.textContent = 'Selecione um ' + (reportType === 'cadastrador' ? 'cadastrador' : 'unidade') + '.';
      reportError.hidden = false;
      return;
    }
    showLoading('Calculando o relatório…');
    await new Promise(r => setTimeout(r, 30));
    try {
      const crasMap = currentCrasMap();
      const cadastradorMap = currentCadastradorMap();
      const report = computeReport(startISO, endISO, crasMap, filter, cadastradorMap);
      state.lastReport = report;
      renderReport(report);
      $('#step-5').hidden = false;
      $('#step-5').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      reportError.textContent = 'Erro ao gerar o relatório: ' + err.message;
      reportError.hidden = false;
    } finally {
      hideLoading();
    }
  });

  /* ------------------------------------------------------------------ *
   * Cálculo do relatório
   * ------------------------------------------------------------------ */
  function computeReport(startISO, endISO, crasMap, filter = { type: 'geral' }, cadastradorMap = state.cadastradorCanonicalByRaw) {
    const { fields, categoryCols } = state;
    let invalidDate = 0, outOfRange = 0, emptyCPF = 0, unexpectedServiceValues = 0;
    const inRangeAll = [];

    state.rows.forEach(row => {
      if (!row.__iso) { invalidDate++; return; }
      if (row.__iso < startISO || row.__iso > endISO) { outOfRange++; return; }
      inRangeAll.push(row);
    });

    // filtro adicional do tipo de relatório (por cadastrador ou por unidade)
    let inRange = inRangeAll;
    if (filter.type === 'cadastrador') {
      inRange = inRangeAll.filter(row => {
        const raw = (row[fields.cadastrador] || '').trim();
        const canon = cadastradorMap.get(raw) || raw;
        return canon === filter.value;
      });
    } else if (filter.type === 'unidade') {
      inRange = inRangeAll.filter(row => {
        const rawCras = (row[fields.cras] || '').trim();
        const crasFinal = crasMap.get(rawCras) || rawCras || 'NÃO INFORMADO';
        return crasFinal === filter.value;
      });
    }

    const cpfSet = new Set();
    const catTotals = {};
    categoryCols.forEach(c => (catTotals[c.key] = 0));
    const crasStats = new Map(); // nome final -> {cpfSet, atendimentos, cats:{}}

    inRange.forEach(row => {
      const cpfDigits = digitsOnly(row[fields.cpf] || '');
      if (!cpfDigits) emptyCPF++;
      const cpfKey = cpfDigits || ('__semcpf_' + row.__rowId);
      cpfSet.add(cpfKey);

      const rawCras = (row[fields.cras] || '').trim();
      const crasFinal = crasMap.get(rawCras) || rawCras || 'NÃO INFORMADO';

      if (!crasStats.has(crasFinal)) crasStats.set(crasFinal, { cpfSet: new Set(), atendimentos: 0, cats: {} });
      const cs = crasStats.get(crasFinal);
      cs.atendimentos++;
      cs.cpfSet.add(cpfKey);

      categoryCols.forEach(c => {
        const v = (row[c.header] || '').trim();
        if (!v) return;
        if (v.toUpperCase() === 'SIM') {
          catTotals[c.key]++;
          cs.cats[c.key] = (cs.cats[c.key] || 0) + 1;
        } else {
          unexpectedServiceValues++;
        }
      });
    });

    const rowsOrdered = inRange.slice().sort((a, b) => {
      if (a.__iso !== b.__iso) return a.__iso < b.__iso ? -1 : 1;
      const ca = crasMap.get((a[fields.cras] || '').trim()) || '';
      const cb = crasMap.get((b[fields.cras] || '').trim()) || '';
      return ca.localeCompare(cb, 'pt-BR');
    });

    return {
      startISO, endISO,
      totalCPFs: cpfSet.size,
      totalAtendimentos: inRange.length,
      invalidDate, outOfRange, emptyCPF, unexpectedServiceValues,
      catTotals, crasStats, rowsOrdered,
      crasMap,
      filter,
    };
  }

  // Texto amigável do filtro aplicado, para título de tela, PDF, XLSX e nome de arquivo.
  function reportTypeLabel(filter) {
    if (filter.type === 'cadastrador') return `Cadastrador: ${filter.value}`;
    if (filter.type === 'unidade') return `Unidade: ${filter.value}`;
    return 'Geral (todas as unidades)';
  }
  function reportTypeSlug(filter) {
    if (filter.type === 'cadastrador') return `cadastrador-${slug(filter.value)}`;
    if (filter.type === 'unidade') return `unidade-${slug(filter.value)}`;
    return 'geral';
  }

  /* ------------------------------------------------------------------ *
   * Passo 4 — renderização em tela
   * ------------------------------------------------------------------ */
  function renderReport(r) {
    $('#report-title').textContent = `Resumo do período — ${reportTypeLabel(r.filter)}`;
    $('#report-period').textContent = `${formatDateBR(r.startISO)} a ${formatDateBR(r.endISO)} · gerado em ${todayBR()}`;
    $('#stat-cpfs').textContent = r.totalCPFs.toLocaleString('pt-BR');
    $('#stat-atendimentos').textContent = r.totalAtendimentos.toLocaleString('pt-BR');
    $('#stat-unidades').textContent = r.crasStats.size.toLocaleString('pt-BR');

    // tabela categorias
    const catTable = $('#table-categorias');
    const catRows = state.categoryCols.map(c => [c.label, r.catTotals[c.key] || 0]);
    catTable.innerHTML = buildTableHTML(
      ['Categoria de serviço', 'Atendimentos'],
      catRows,
      [false, true]
    );

    // tabela por CRAS
    const crasNames = [...r.crasStats.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const crasHead = ['Unidade (CRAS)', 'CPFs distintos', 'Atendimentos', ...state.categoryCols.map(c => c.label)];
    const crasRows = crasNames.map(name => {
      const cs = r.crasStats.get(name);
      return [name, cs.cpfSet.size, cs.atendimentos, ...state.categoryCols.map(c => cs.cats[c.key] || 0)];
    });
    const totalRow = [
      'TOTAL', r.totalCPFs, r.totalAtendimentos,
      ...state.categoryCols.map(c => r.catTotals[c.key] || 0),
    ];
    $('#table-cras').innerHTML = buildTableHTML(
      crasHead, crasRows, crasHead.map((_, i) => i > 0), totalRow
    );

    // avisos de qualidade de dado
    const warnings = [];
    if (r.invalidDate) warnings.push(`${r.invalidDate.toLocaleString('pt-BR')} registro(s) com data ilegível, fora do arquivo original — não entraram no relatório.`);
    if (r.emptyCPF) warnings.push(`${r.emptyCPF.toLocaleString('pt-BR')} registro(s) sem CPF preenchido — cada um foi contado como um beneficiário à parte, para não misturar pessoas diferentes.`);
    if (r.unexpectedServiceValues) warnings.push(`${r.unexpectedServiceValues.toLocaleString('pt-BR')} marcação(ões) de serviço com valor inesperado (diferente de "Sim") — não entraram na contagem por categoria.`);
    const warnBox = $('#report-warnings');
    if (warnings.length) {
      warnBox.hidden = false;
      warnBox.innerHTML = '<strong>Observações sobre os dados:</strong><ul>' + warnings.map(w => `<li>${w}</li>`).join('') + '</ul>';
    } else {
      warnBox.hidden = true;
    }
  }

  function buildTableHTML(headers, rows, numericCols = [], totalRow = null) {
    let html = '<thead><tr>' + headers.map((h, i) => `<th class="${numericCols[i] ? 'num' : ''}">${h}</th>`).join('') + '</tr></thead><tbody>';
    rows.forEach(row => {
      html += '<tr>' + row.map((v, i) => `<td class="${numericCols[i] ? 'num' : ''}">${typeof v === 'number' ? v.toLocaleString('pt-BR') : v}</td>`).join('') + '</tr>';
    });
    if (totalRow) {
      html += '<tr class="total-row">' + totalRow.map((v, i) => `<td class="${numericCols[i] ? 'num' : ''}">${typeof v === 'number' ? v.toLocaleString('pt-BR') : v}</td>`).join('') + '</tr>';
    }
    html += '</tbody>';
    return html;
  }

  /* ------------------------------------------------------------------ *
   * Exportação — XLSX
   * ------------------------------------------------------------------ */
  $('#btn-xlsx').addEventListener('click', () => {
    if (!state.lastReport) return;
    showLoading('Montando a planilha…');
    setTimeout(() => {
      try {
        exportXLSX(state.lastReport);
      } finally {
        hideLoading();
      }
    }, 20);
  });

  function exportXLSX(r) {
    const wb = XLSX.utils.book_new();

    // --- Resumo ---
    const resumoAOA = [
      ['Relatório de Atendimentos do Cadastro Único'],
      ['Tipo de relatório', reportTypeLabel(r.filter)],
      ['Período', `${formatDateBR(r.startISO)} a ${formatDateBR(r.endISO)}`],
      ['Gerado em', todayBR()],
      [],
      ['Beneficiários atendidos (CPFs distintos)', r.totalCPFs],
      ['Registros de atendimento', r.totalAtendimentos],
      ['Unidades com atendimento no período', r.crasStats.size],
      [],
      ['Categoria de serviço', 'Atendimentos'],
      ...state.categoryCols.map(c => [c.label, r.catTotals[c.key] || 0]),
    ];
    const wsResumo = XLSX.utils.aoa_to_sheet(resumoAOA);
    wsResumo['!cols'] = [{ wch: 42 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    // --- Por CRAS ---
    const crasNames = [...r.crasStats.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const crasHead = ['Unidade (CRAS)', 'CPFs distintos', 'Atendimentos', ...state.categoryCols.map(c => c.label)];
    const crasAOA = [crasHead];
    crasNames.forEach(name => {
      const cs = r.crasStats.get(name);
      crasAOA.push([name, cs.cpfSet.size, cs.atendimentos, ...state.categoryCols.map(c => cs.cats[c.key] || 0)]);
    });
    crasAOA.push(['TOTAL', r.totalCPFs, r.totalAtendimentos, ...state.categoryCols.map(c => r.catTotals[c.key] || 0)]);
    const wsCras = XLSX.utils.aoa_to_sheet(crasAOA);
    wsCras['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 14 }, ...state.categoryCols.map(() => ({ wch: 14 }))];
    XLSX.utils.book_append_sheet(wb, wsCras, 'Por CRAS');

    // --- Dados detalhados ---
    const { fields } = state;
    const detHead = ['Data de Atendimento', 'Unidade (CRAS)', 'Nome do Cadastrador', 'CPF do Beneficiário', 'Bairro do usuário', ...state.categoryCols.map(c => c.label)];
    const detAOA = [detHead];
    r.rowsOrdered.forEach(row => {
      const rawCras = (row[fields.cras] || '').trim();
      const crasFinal = r.crasMap.get(rawCras) || rawCras || 'NÃO INFORMADO';
      detAOA.push([
        formatDateBR(row.__iso),
        crasFinal,
        (row[fields.cadastrador] || '').trim(),
        (row[fields.cpf] || '').trim(),
        (row[fields.bairro] || '').trim(),
        ...state.categoryCols.map(c => ((row[c.header] || '').trim().toUpperCase() === 'SIM' ? 'Sim' : '')),
      ]);
    });
    const wsDet = XLSX.utils.aoa_to_sheet(detAOA);
    wsDet['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 22 }, ...state.categoryCols.map(() => ({ wch: 12 }))];
    XLSX.utils.book_append_sheet(wb, wsDet, 'Dados detalhados');

    // --- Notas / metodologia ---
    const notasAOA = [
      ['Metodologia'],
      ['"Beneficiários atendidos" conta CPFs distintos no período (uma mesma pessoa atendida mais de uma vez conta uma única vez).'],
      ['"Atendimentos" e os totais por categoria contam registros (linhas) — um mesmo atendimento pode ter mais de um serviço marcado, então a soma das categorias pode passar do total de atendimentos.'],
      ['Registros sem CPF preenchido foram contados individualmente como um beneficiário à parte, para não misturar pessoas diferentes sob um mesmo CPF em branco.'],
      [],
      ['Agrupamento de unidades (CRAS) usado neste relatório'],
      ['Valor original no arquivo', 'Unidade final considerada'],
      ...[...state.crasCanonicalByRaw.keys()].sort().map(raw => {
        const input = document.querySelector(`#cras-table input[data-raw="${cssEscape(raw)}"]`);
        const final = input ? input.value.trim() : state.crasCanonicalByRaw.get(raw);
        return [raw, final || raw];
      }),
    ];
    const wsNotas = XLSX.utils.aoa_to_sheet(notasAOA);
    wsNotas['!cols'] = [{ wch: 45 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsNotas, 'Notas');

    XLSX.writeFile(wb, `relatorio-atendimentos-${reportTypeSlug(r.filter)}-${r.startISO}_a_${r.endISO}.xlsx`);
  }

  function cssEscape(s) {
    return s.replace(/["\\]/g, '\\$&');
  }

  /* ------------------------------------------------------------------ *
   * Exportação — PDF
   * ------------------------------------------------------------------ */
  $('#btn-pdf').addEventListener('click', () => {
    if (!state.lastReport) return;
    showLoading('Montando o PDF…');
    setTimeout(() => {
      try {
        exportPDF(state.lastReport);
      } finally {
        hideLoading();
      }
    }, 20);
  });

  function exportPDF(r) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
    const navy = [27, 58, 92];
    const mustard = [185, 131, 42];
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;

    // cabeçalho
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageWidth, 72, 'F');
    doc.setFillColor(...mustard);
    doc.rect(0, 72, pageWidth, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Relatório de Atendimentos do Cadastro Único', margin, 32);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(200, 211, 219);
    doc.text('Prefeitura de Goiânia · Proteção Social Básica · CRAS e Centros de Convivência', margin, 48);
    doc.text(`Relatório: ${reportTypeLabel(r.filter)}   ·   Período: ${formatDateBR(r.startISO)} a ${formatDateBR(r.endISO)}   ·   Gerado em ${todayBR()}`, margin, 62);

    let y = 100;
    doc.setTextColor(35, 40, 43);

    // números principais
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Resumo do período', margin, y);
    y += 18;

    const headline = [
      ['Beneficiários atendidos (CPFs distintos)', r.totalCPFs.toLocaleString('pt-BR')],
      ['Registros de atendimento', r.totalAtendimentos.toLocaleString('pt-BR')],
      ['Unidades com atendimento no período', r.crasStats.size.toLocaleString('pt-BR')],
    ];
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      body: headline,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 3 },
      columnStyles: { 1: { fontStyle: 'bold', halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 20;

    // por categoria
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Por categoria de serviço', margin, y);
    y += 6;
    doc.autoTable({
      startY: y + 6,
      margin: { left: margin, right: margin },
      head: [['Categoria de serviço', 'Atendimentos']],
      body: state.categoryCols.map(c => [c.label, (r.catTotals[c.key] || 0).toLocaleString('pt-BR')]),
      headStyles: { fillColor: navy, fontSize: 9.5 },
      styles: { fontSize: 9.5, cellPadding: 4 },
      columnStyles: { 1: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 24;

    // por CRAS
    if (y > doc.internal.pageSize.getHeight() - 150) { doc.addPage(); y = 50; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Por unidade (CRAS)', margin, y);
    y += 6;

    const crasNames = [...r.crasStats.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const crasHead = ['Unidade (CRAS)', 'CPFs distintos', 'Atendimentos', ...state.categoryCols.map(c => c.label)];
    const crasBody = crasNames.map(name => {
      const cs = r.crasStats.get(name);
      return [name, cs.cpfSet.size.toLocaleString('pt-BR'), cs.atendimentos.toLocaleString('pt-BR'),
        ...state.categoryCols.map(c => (cs.cats[c.key] || 0).toLocaleString('pt-BR'))];
    });
    crasBody.push(['TOTAL', r.totalCPFs.toLocaleString('pt-BR'), r.totalAtendimentos.toLocaleString('pt-BR'),
      ...state.categoryCols.map(c => (r.catTotals[c.key] || 0).toLocaleString('pt-BR'))]);
    const crasColumnStyles = {};
    crasHead.forEach((_, i) => { if (i > 0) crasColumnStyles[i] = { halign: 'right' }; });

    doc.autoTable({
      startY: y + 6,
      margin: { left: margin, right: margin },
      head: [crasHead],
      body: crasBody,
      headStyles: { fillColor: navy, fontSize: 8.5 },
      styles: { fontSize: 8.5, cellPadding: 4 },
      columnStyles: crasColumnStyles,
      didParseCell: (data) => {
        if (data.row.index === crasBody.length - 1 && data.section === 'body') {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [234, 241, 236];
        }
      },
    });

    // observações
    const warnings = [];
    if (r.invalidDate) warnings.push(`${r.invalidDate} registro(s) com data ilegível não entraram no relatório.`);
    if (r.emptyCPF) warnings.push(`${r.emptyCPF} registro(s) sem CPF preenchido, contados individualmente.`);
    if (r.unexpectedServiceValues) warnings.push(`${r.unexpectedServiceValues} marcação(ões) de serviço com valor inesperado, não contadas por categoria.`);
    if (warnings.length) {
      let yy = doc.lastAutoTable.finalY + 18;
      if (yy > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); yy = 50; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text('Observações sobre os dados', margin, yy);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      let ly = yy + 14;
      warnings.forEach(w => {
        const lines = doc.splitTextToSize('• ' + w, pageWidth - margin * 2);
        doc.text(lines, margin, ly);
        ly += lines.length * 11;
      });
    }

    // rodapé com paginação
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
      doc.text('Contagem de categorias soma marcações; um mesmo atendimento pode ter mais de um serviço marcado.', margin, doc.internal.pageSize.getHeight() - 20);
    }

    doc.save(`relatorio-atendimentos-${reportTypeSlug(r.filter)}-${r.startISO}_a_${r.endISO}.pdf`);
  }

  /* ------------------------------------------------------------------ *
   * Reiniciar
   * ------------------------------------------------------------------ */
  $('#btn-restart').addEventListener('click', () => {
    state.rows = [];
    state.lastReport = null;
    fileInput.value = '';
    $('#dropzone-sub').textContent = '.zip ou .csv';
    fileStatus.hidden = true;
    $('#step-2').hidden = true;
    $('#step-3').hidden = true;
    $('#step-4').hidden = true;
    $('#step-5').hidden = true;
    $('#step-1').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

})();
