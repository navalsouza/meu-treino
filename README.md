# Meu Treino de Hipertrofia 2.0

Aplicativo pessoal de musculação no formato PWA. Pode ser publicado no GitHub Pages como site estático.

## Publicar

1. Abra **Settings > Pages** no repositório GitHub.
2. Configure **Deploy from a branch**, branch `main` e pasta `/(root)`.
3. Acesse `https://navalsouza.github.io/meu-treino/`.
4. Instale pelo menu do Chrome no Android.

## Google Drive

Para ativar a sincronização, configure uma credencial OAuth 2.0 do tipo **Aplicativo da Web** no Google Cloud, com a origem JavaScript autorizada `https://navalsouza.github.io` e a Google Drive API ativada. Cole o *Client ID* na seção de sincronização do app.

O repositório contém **apenas código e ícones de demonstração**. Não envie backups, registros pessoais nem credenciais para este repositório público.

O programa usa `localStorage`/`IndexedDB` para armazenamento local e a API Google Drive opcionalmente para sincronizar dados de treino e mídias.