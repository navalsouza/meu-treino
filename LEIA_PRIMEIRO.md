# Meu Treino 2.0 — instalação e Google Drive

## O que está pronto

- Aplicativo web progressivo (PWA) com ícones, manifesto e service worker para funcionar offline depois da primeira abertura pelo endereço publicado.
- Visual Modo Foco, ciclos de treino A → B → D → E → C, exercícios/cargas/repetições, cronômetro, fotos, vídeos, infográficos e arquivos JSON de backup, preservados da versão anterior.
- Integração opcional com seu Google Drive: `estado-meu-treino.json` para a ficha e arquivos `midia-*.bin` para fotos, infográficos e vídeos. A pasta **Meu Treino - Dados do Aplicativo** é criada no seu Drive ao conectar; não é uma Planilha.
- Acesso Google via OAuth 2.0 com escopo `drive.file` (somente arquivos do próprio app). O app não armazena senha nem token de acesso permanente.
- Envio/recuperação manual do Drive e opção de envio automático das alterações de séries quando a conta já está conectada. **O app precisa estar aberto** e com internet para enviar; não há sincronização em segundo plano com o app fechado.

## Publicação em HTTPS — obrigatória para Google/instalação PWA

O HTML aberto como `content://` ou `file://` no Android NÃO é suficiente para esta integração.

Exemplo com GitHub Pages:

1. Crie um repositório **sem dados pessoais ou backups**, apenas com os arquivos desta pasta (`index.html`, `drive-sync.js`, `sw.js`, `manifest.webmanifest`, `icons/`).
2. Em *Settings → Pages*, selecione **Deploy from a branch**, `main` e pasta `/(root)`.
3. Aguarde o endereço HTTPS informado pelo GitHub, por exemplo `https://USUARIO.github.io/NOME-REPO/`. (O endereço real depende da sua conta.)
4. No Android, abra o URL no Chrome. Menu ⋮ → **Adicionar à tela inicial** / **Instalar aplicativo** (texto pode variar).

## Autorizar Google Drive

1. No Google Cloud Console, crie/selecione um projeto e **ative Google Drive API**.
2. Em **Google Auth Platform** configure *Branding*, *Audience* e *Data Access*. Se o app ficar em modo teste, cadastre sua própria conta como usuário de teste.
3. Em *Clients*, crie uma credencial **OAuth Client ID → Aplicativo da Web**.
4. Em **Origens JavaScript autorizadas**, adicione **somente a origem HTTPS**, por exemplo `https://USUARIO.github.io`, sem subpasta ou barra final. Se mudar de domínio, atualize a origem.
5. Copie o **Client ID** terminado em `.apps.googleusercontent.com`. Ele não é uma senha; não compartilhe o *Client Secret* (nem o insira no app).
6. No app instalado, abra **⚙ Ajustes → ☁ Sincronização com Google Drive**. Cole o Client ID, toque em **Conectar Google** e autorize o escopo de arquivos do aplicativo.
7. Toque em **Enviar ao Drive** para fazer sua primeira sincronização de dados e mídias. A primeira vez pode demorar porque há imagens/vídeos grandes.

> O botão **Carregar do Drive** substitui a ficha local, após confirmação. Antes de usar, faça **Exportar backup** e confirme o arquivo salvo.

## Migrar o backup de 23/11/2026 sem perder nada

1. Guarde o arquivo original `backup-meu-treino-2026-11-23.json` em local seguro.
2. No novo PWA, abra **⚙ Ajustes → Backup dos dados → Restaurar** e escolha esse JSON.
3. O JSON antigo contém **7 dias**; após restaurar, para usar novamente o ciclo **A → B → D → E → C**, abra **Trocar para a ficha recomendada → Atualizar ficha preservando histórico**. Confira os registros resultantes antes de confirmar que a migração terminou; exercícios diferentes podem não ter correspondência automática.
4. Confira suas imagens anatômicas e cargas. Faça um novo backup JSON e conecte o Drive, então **Enviar ao Drive**.
5. Não exclua os backups nem o HTML antigo até concluir a verificação.

## Segurança e conflitos

- O Google Drive se torna a cópia central de sincronização, mas o aparelho mantém uma cópia offline. Quando dois aparelhos mudam a ficha, a mesma linha não pode ser mesclada automaticamente nesta versão; confirme o estado mais recente antes de sobrescrever.
- Se o Google pedir autorização novamente, toque em **Conectar Google**; tokens são mantidos apenas na memória enquanto a página está aberta.
- O modo automático manda alterações enquanto a sessão Google estiver ativa; ele **não garante** envio com o celular bloqueado nem após fechar o app.
- Nenhuma sincronização ocorre automaticamente antes da conexão Google e do primeiro envio manual.
- O Drive não é um banco SQL; `estado-meu-treino.json` é um documento de estado e cada mídia é armazenada como arquivo binário. Esta arquitetura é adequada para uso individual e não pressupõe concorrência de muitos usuários.

## Arquivos do kit

- `index.html` — aplicativo completo, dados locais e visual Modo Foco.
- `drive-sync.js` — integração Google Drive API + Google Identity Services.
- `sw.js` — service worker para abrir offline.
- `manifest.webmanifest` — registro da instalação como aplicativo.
- `icons/` — ícones de instalação.

## Limites desta versão

Ainda **não houve publicação em um endereço HTTPS**, **não foi criado um OAuth Client ID para você** e **não foi realizada uma sincronização real com sua conta**. Essas etapas exigem sua conta e autorização. Também não foram incluídos um motor de mesclagem multiaparelho de séries ou notificações garantidas com o aplicativo fechado.