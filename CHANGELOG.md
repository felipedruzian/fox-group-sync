# Changelog

## 0.1.4 - 2026-04-03

- removido o uso de `innerHTML` no popup, trocando a renderizacao dinamica por criacao segura de elementos DOM
- ajustado `strict_min_version` para `142.0`, alinhando o manifesto ao suporte de `data_collection_permissions`

## 0.1.3 - 2026-04-02

- removido JavaScript inline do popup para evitar atrito com CSP/review da AMO
- bloqueado o render de favicons remotos no popup; quando a URL nao for segura para pagina da extensao, entra fallback local
- removida a sincronizacao de metadados tecnicos do dispositivo para alinhar o payload real ao consentimento declarado no manifesto

## 0.1.2 - 2026-03-29

- grupos locais com mesmo nome+cor de um grupo sincronizado agora mostram acao de update
- primeira atualizacao de grupo sincronizado mostra confirmacao com diff de abas adicionadas/removidas
- opcao por grupo (nome+cor) para nao perguntar novamente confirmacao de update
- abas de grupos locais e sincronizados agora exibem preview das 3 primeiras com `...` e `title` no hover
- abas restantes podem ser expandidas/recolhidas por seta (`details/summary`) em cada grupo
- abas agora persistem e exibem `title + url`, com prioridade para titulo e fallback de URL para abas nao carregadas
- tooltip das abas mostra titulo e URL em duas linhas quando disponivel
- suporte a favicon (quando disponivel) na listagem de abas de grupos locais/sincronizados
- origem dos grupos sincronizados agora mostra o dispositivo de upload (browser + plataforma + id curto), quando disponivel
- adicionado botao `Limpar sync` com confirmacao para remover todos os grupos sincronizados e cache local
- adicionado indicador pequeno de carregamento durante operacoes de sincronizacao/atualizacao
- melhoria de hover/focus e estado disabled nos botoes do popup

## 0.1.1 - 2026-03-29

- adicionado `.gitignore`, `CHANGELOG.md` e `LICENSE`
- ajustado o manifesto para submissao `unlisted/self-distributed` na AMO
- restaurada a permissao `tabGroups`, necessaria para a API de grupos de abas no Firefox
- corrigido o salvamento para atualizar workspaces existentes com o mesmo nome e a mesma cor
- limitado o popup para nao expandir com titulos longos de abas
- adicionado botao dedicado para atualizar manualmente a lista sincronizada no popup
- adicionado status visivel do `storage.sync` no popup e confirmacao simples apos salvar
- adicionados estados visuais de hover/focus nos botoes
- trocado o formato de persistencia para multiplas chaves no `storage.sync`, com migracao do formato antigo
- adicionado espelhamento em `storage.local` como cache/backup da instalacao atual
- documentadas no README as limitacoes de persistencia em modo `Load Temporary Add-on`

## 0.1.0 - 2026-03-24

- versao inicial do MVP
