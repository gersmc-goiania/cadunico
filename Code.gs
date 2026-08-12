/* ==========================================================================
   Backend do Relatório de Atendimentos do Cadastro Único.

   O que este script faz:
   1. Recebe um pedido do site (POST) contendo um "idToken" do Google.
   2. Confirma com o próprio Google que esse token é autêntico e pega o
      e-mail da conta que fez login.
   3. Só entrega os dados da planilha se esse e-mail estiver na lista
      ALLOWED_EMAILS abaixo. Qualquer outra conta Google recebe um erro
      de "não autorizado" — mesmo que tenha conseguido fazer login.
   4. Devolve as linhas da aba de respostas como texto CSV, no mesmo
      formato que o site já sabia ler a partir do export manual.

   Nada aqui expõe a planilha publicamente: o link do Web App pode ser
   visto por qualquer um, mas sem um token válido de um e-mail autorizado
   ele não recebe nenhum dado.
   ========================================================================== */

// ---- CONFIGURAÇÃO — edite estes quatro valores ----

// ID da planilha (está no meio da URL: .../d/ESTE_TRECHO_AQUI/edit)
var SPREADSHEET_ID = 'COLOQUE_AQUI_O_ID_DA_PLANILHA';

// Nome exato da aba que recebe as respostas do formulário.
var SHEET_NAME = 'Respostas ao formulário 1';

// Client ID OAuth criado no Google Cloud Console — o MESMO valor que vai
// em config.js no site. É o que garante que só tokens gerados pelo botão
// de login deste site específico são aceitos aqui.
var GOOGLE_CLIENT_ID = 'COLOQUE_AQUI_SEU_CLIENT_ID.apps.googleusercontent.com';

// E-mails do Gmail pessoal de quem pode acessar. Tudo minúsculo.
var ALLOWED_EMAILS = [
  'gestor1@gmail.com',
  'gestor2@gmail.com',
];

// ---- fim da configuração ----

function doPost(e) {
  var result;
  try {
    var body = JSON.parse(e.postData.contents);
    var email = verifyGoogleIdToken(body.idToken);

    if (!email) {
      result = { error: 'Sessão expirada ou inválida.' };
    } else if (ALLOWED_EMAILS.indexOf(email.toLowerCase()) === -1) {
      result = { error: 'Não autorizado. A conta ' + email + ' não está na lista de acesso.' };
      logAccessAttempt_(email, false);
    } else {
      result = { csv: getSheetAsCsv_(), fetchedAt: new Date().toISOString() };
      logAccessAttempt_(email, true);
    }
  } catch (err) {
    result = { error: 'Erro no servidor: ' + err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Confere a assinatura do token direto com o Google e retorna o e-mail
// verificado, ou null se o token for inválido, expirado, ou não tiver
// sido emitido para o Client ID deste site.
function verifyGoogleIdToken(idToken) {
  if (!idToken) return null;
  var resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) return null;
  var data = JSON.parse(resp.getContentText());
  if (data.aud !== GOOGLE_CLIENT_ID) return null;
  if (data.email_verified !== 'true' && data.email_verified !== true) return null;
  return data.email;
}

function getSheetAsCsv_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Aba "' + SHEET_NAME + '" não encontrada na planilha.');
  var values = sheet.getDataRange().getValues();
  var tz = ss.getSpreadsheetTimeZone();
  return values.map(function (row) {
    return row.map(function (cell) { return csvEscapeCell_(cell, tz); }).join(',');
  }).join('\n');
}

function csvEscapeCell_(cell, tz) {
  var s;
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    // Mesmo formato do carimbo de data/hora do Forms, para o site reconhecer.
    s = Utilities.formatDate(cell, tz, 'yyyy/MM/dd HH:mm:ss');
  } else {
    s = cell === null || cell === undefined ? '' : String(cell);
  }
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Registro simples de quem acessou, numa aba própria da mesma planilha
// (criada automaticamente na primeira vez). Ajuda a auditar o acesso.
function logAccessAttempt_(email, authorized) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var log = ss.getSheetByName('_log_acessos') || ss.insertSheet('_log_acessos');
    if (log.getLastRow() === 0) log.appendRow(['Quando', 'E-mail', 'Autorizado']);
    log.appendRow([new Date(), email, authorized]);
  } catch (err) {
    // não deixa uma falha de log quebrar a resposta ao usuário
  }
}
