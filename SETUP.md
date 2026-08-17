# Configurando o login e a busca automática da planilha

Isso é feito uma vez só. Depois disso, o site funciona sozinho.

## 1. Anote o ID da planilha e o nome da aba

Abra a planilha que recebe as respostas do novo formulário. O ID é o trecho
da URL entre `/d/` e `/edit`:

```
https://docs.google.com/spreadsheets/d/ESTE_TRECHO_É_O_ID/edit
```

Anote também o nome exato da aba com as respostas (geralmente
"Respostas ao formulário 1").

## 2. Crie o Client ID do Google (login)

1. Acesse **console.cloud.google.com** com a conta Google que vai administrar
   isso (pode ser a mesma conta pessoal de um dos gestores).
2. Crie um projeto novo (nome sugerido: "Relatorio CadUnico").
3. Vá em **APIs e Serviços → Tela de consentimento OAuth**.
   - Tipo de usuário: **Externo**.
   - Preencha nome do app, e-mail de suporte e e-mail de contato.
   - Na etapa "Usuários de teste" (test users), **adicione os e-mails do Gmail
     de todos os gestores que vão usar o site**. Enquanto o app estiver em
     modo "Teste" (não precisa publicar), só esses e-mails conseguem logar —
     isso já é uma camada extra de proteção, além da lista no Apps Script.
4. Vá em **APIs e Serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
   - Tipo de aplicativo: **Aplicativo da Web**.
   - Em **Origens JavaScript autorizadas**, adicione a URL do seu GitHub Pages, por exemplo:
     `https://SEUUSUARIO.github.io`
   - Não precisa preencher "URIs de redirecionamento".
5. Copie o **Client ID** gerado (termina em `.apps.googleusercontent.com`).

## 3. Publique o Apps Script

1. Na própria planilha, vá em **Extensões → Apps Script**.
2. Apague o conteúdo do arquivo `Código.gs` e cole o conteúdo do arquivo
   **Code.gs** deste pacote.
3. Preencha as quatro configurações no topo do arquivo:
   - `SPREADSHEET_ID` (passo 1)
   - `SHEET_NAME` (passo 1)
   - `GOOGLE_CLIENT_ID` (passo 2)
   - `ALLOWED_EMAILS`: a lista de e-mails do Gmail pessoal de cada gestor
     autorizado (esta é a lista que realmente controla quem vê os dados —
     mantenha-a atualizada quando alguém entrar ou sair da equipe).
4. Clique em **Implantar → Nova implantação**.
   - Tipo: **App da Web**.
   - Executar como: **Eu (sua conta)**.
   - Quem pode acessar: **Qualquer pessoa**.
     (Isso não expõe os dados — o próprio script confere o token e a lista
     de e-mails antes de responder qualquer coisa. Ver comentário no topo do Code.gs.)
5. Autorize as permissões pedidas (acesso à própria planilha).
6. Copie a **URL do app da Web** gerada (termina em `/exec`).

## 4. Preencha o config.js do site

Abra `config.js` e cole os dois valores:

```js
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: 'algo.apps.googleusercontent.com',   // passo 2
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/.../exec', // passo 3
};
```

Suba os arquivos (`index.html`, `login.js`, `relatorio.html`, `app.js`,
`config.js`, `style.css`) no GitHub Pages como já faziam. `index.html` é a
tela de login; `relatorio.html` é a ferramenta em si — o usuário só chega
lá depois de logar.

## 5. Teste

Abra o site, faça login com uma conta autorizada, clique em
**"Buscar dados da planilha agora"** e confirme que os dados aparecem.
Teste também com uma conta *não* autorizada — deve aparecer a mensagem de
acesso negado, sem carregar nenhum dado.

## Manutenção

- **Adicionar/remover um gestor:** edite `ALLOWED_EMAILS` no Apps Script
  (Extensões → Apps Script na planilha) e, enquanto o app OAuth estiver em
  modo de teste, também a lista de "Usuários de teste" na tela de
  consentimento. Não precisa reimplantar nem tocar no site.
- **Ver quem acessou:** uma aba `_log_acessos` é criada automaticamente na
  planilha, registrando cada tentativa de busca (autorizada ou não).
- **Se mudar de planilha:** atualize `SPREADSHEET_ID` no Apps Script.
