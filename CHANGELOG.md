# Changelog

## 0.1.1 - 2026-03-29

- adicionado `.gitignore`, `CHANGELOG.md` e `LICENSE`
- ajustado o manifesto para submissão `unlisted/self-distributed` na AMO
- restaurada a permissão `tabGroups`, necessária para a API de grupos de abas no Firefox
- corrigido o salvamento para atualizar workspaces existentes com o mesmo nome e a mesma cor
- limitado o popup para não expandir com títulos longos de abas
- adicionado botão dedicado para atualizar manualmente a lista sincronizada no popup
- adicionado status visível do `storage.sync` no popup e confirmação simples após salvar
- adicionados estados visuais de hover/focus nos botões
- trocado o formato de persistência para múltiplas chaves no `storage.sync`, com migração do formato antigo
- adicionado espelhamento em `storage.local` como cache/backup da instalação atual
- adicionado botão `Limpar sync` com confirmação para remover todos os grupos sincronizados e cache local
- adicionado indicador pequeno de carregamento durante operações de sincronização/atualização
- documentadas no README as limitações de persistência em modo `Load Temporary Add-on`

## 0.1.0 - 2026-03-24

- versão inicial do MVP
