/* ==========================================================================
   Página de login — só cuida do login com a conta Google. A verificação de
   quem está autorizado (lista de e-mails) acontece sempre no Apps Script,
   do lado do servidor, quando a página do relatório busca os dados. Aqui
   apenas guardamos o token e mandamos o usuário para relatorio.html.
   ========================================================================== */

(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const SESSION_KEY = 'cadunico_id_token';

  const loginError = $('#login-error');
  const loginChecking = $('#login-checking');

  // Mensagem de erro vinda de um redirecionamento (ex.: conta não autorizada,
  // ou sessão expirada) feito pela página do relatório.
  const params = new URLSearchParams(window.location.search);
  const erro = params.get('erro');
  if (erro) {
    loginError.textContent = erro;
    loginError.hidden = false;
  }

  // Se já existe uma sessão salva nesta aba, tenta ir direto para o
  // relatório — é lá que a validade do token é realmente conferida.
  if (!erro && sessionStorage.getItem(SESSION_KEY)) {
    loginChecking.hidden = false;
    window.location.href = 'relatorio.html';
    return;
  }

  function handleCredentialResponse(response) {
    sessionStorage.setItem(SESSION_KEY, response.credential);
    window.location.href = 'relatorio.html';
  }

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
    }).catch(function () {
      loginError.textContent = 'Não foi possível carregar o login do Google. Verifique sua conexão e recarregue a página.';
      loginError.hidden = false;
    });
  }
})();
