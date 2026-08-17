# Relatório de Atendimentos do Cadastro Único

Ferramenta web para gerar o relatório de atendimentos dos CRAS/Centros de
Convivência a partir do arquivo exportado pelo Google Forms — **sem
depender de planilha vinculada, sem backend, sem limite de 100.000
respostas**.

Todo o processamento acontece **no navegador de quem está usando**. O
arquivo (inclusive os CPFs) nunca é enviado para nenhum servidor — nem
para o GitHub, nem para nenhum outro lugar. Isso é importante porque o
arquivo contém dado pessoal sensível (CPF).

## O que ela faz

1. **Envio do arquivo** — aceita o `.zip` que o Google gera ao exportar
   respostas do formulário, ou o `.csv` já extraído.
2. **Conferência das unidades (CRAS)** — os nomes das unidades vêm do
   arquivo digitados manualmente pelos atendentes, então têm variação de
   maiúscula/minúscula, espaço e pequenos erros de digitação. A
   ferramenta agrupa essas variações automaticamente (ex.: "CENTRAL",
   "Central ", "CETRAL" → "CENTRAL") e mostra o resultado numa tabela
   editável, para o caso de precisar corrigir algum agrupamento à mão.
   Isso não trava o passo seguinte.
3. **Período** — escolhe a data inicial e final.
4. **Relatório** — mostra na tela e permite baixar:
   - **`.xlsx`** com Resumo, Por CRAS, Por Cadastrador (só no relatório
     geral, e só quem tem 50+ atendimentos no período — ver abaixo),
     Dados detalhados (linha a linha, ordenado por data, com CPF) e
     Notas (metodologia + agrupamento de unidades usado).
   - **`.pdf`** com o resumo geral, por categoria, por unidade e por
     cadastrador (no relatório geral) — pronto para levar à secretária
     ou ao prefeito.

### Como os números são contados

- **Beneficiários atendidos** = quantidade de **CPFs distintos** no
  período (uma pessoa atendida três vezes conta uma vez).
- **Atendimentos** e os totais **por categoria de serviço** = quantidade
  de **registros** (linhas) — um mesmo atendimento pode ter mais de um
  serviço marcado (ex.: Inclusão + Espelho no mesmo atendimento), então a
  soma das categorias pode passar do total de atendimentos. Isso é
  esperado e está anotado no próprio relatório.
- Registros sem CPF preenchido são contados individualmente (não são
  somados a nenhum outro CPF em branco).
- No **relatório geral**, a tabela "Por Cadastrador" mostra só quem tem
  **50 ou mais atendimentos** no período selecionado, em ordem
  decrescente de atendimentos — cadastradores abaixo desse número não
  aparecem nela (o objetivo é destacar quem realmente atende em volume,
  não listar todo mundo).

## Como publicar no GitHub Pages

1. Crie um repositório novo (pode ser privado, se preferir manter o
   código fora de olhares alheios — o GitHub Pages funciona igual em
   repositório privado, dentro dos planos que oferecem isso; num plano
   sem essa opção, use um repositório público, o que não é problema
   porque nenhum dado do CRAS fica no código, só a ferramenta).
2. Suba os arquivos deste projeto (`index.html`, `login.js`,
   `relatorio.html`, `app.js`, `style.css`, `config.js`) para a raiz do
   repositório (ou para uma pasta `docs/`, como preferir).
3. No repositório, vá em **Settings → Pages**.
4. Em **Source**, selecione a branch (geralmente `main`) e a pasta
   (`/root` ou `/docs`, conforme onde você colocou os arquivos).
5. Salve. Em alguns minutos o GitHub mostra o endereço público, algo como
   `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

Não precisa de build, servidor, banco de dados ou variável de ambiente —
é HTML/CSS/JS puro, carregando três bibliotecas por CDN (leitura de zip,
leitura de csv, geração de xlsx e geração de pdf).

## Limitações a ter em mente

- O navegador processa tudo na memória do computador de quem usa. Com um
  arquivo grande (testado com ~112 mil linhas / ~15 MB, funciona bem),
  prefira navegadores atualizados (Chrome, Edge, Firefox) em vez de
  navegadores de celulares mais antigos.
- O agrupamento automático de unidades é uma sugestão baseada em
  similaridade de texto — sempre vale bater o olho na tabela do passo 2
  antes de gerar o relatório final, principalmente se surgir uma unidade
  nova que a ferramenta nunca viu.
- Como o arquivo de origem agora é o export direto do Google Forms, não
  existe mais o limite de 100.000 respostas que atingiu a planilha
  vinculada antiga — o Forms continua coletando normalmente, só deixa de
  alimentar automaticamente uma planilha.

## Estrutura dos arquivos

```
index.html      → tela de login (conta Google), nada mais
login.js        → lógica do login; ao logar, guarda o token e manda
                   para relatorio.html
relatorio.html  → a ferramenta em si — passos 1 a 4 do relatório
app.js          → toda a lógica do relatório: confere a sessão,
                   busca/lê o arquivo, agrupamento de unidades e de
                   cadastradores, cálculo do relatório, exportação
                   xlsx/pdf
style.css       → identidade visual (compartilhada pelas duas páginas)
config.js       → Client ID do Google e URL do Apps Script
```

O login e o relatório ficam em páginas separadas: `index.html` só cuida do
login; assim que a conta Google é confirmada no navegador, a pessoa é
levada para `relatorio.html`, que então busca os dados e só então confirma
(no servidor) se a conta está realmente autorizada. Enquanto isso não é
confirmado, a página do relatório fica atrás de uma tela de carregamento —
não existe mais aquele instante em que o relatório aparece e, alguns
segundos depois, volta para o login.
