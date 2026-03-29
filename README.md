# Fox Group Sync

Projeto pessoal e vibecodado de extensão para Firefox Desktop.

O objetivo é salvar grupos de abas nativos, sincronizar os snapshots entre dispositivos via conta Mozilla e restaurar esses grupos em outro Firefox desktop.

## Escopo deste MVP

Compatível com **Firefox Desktop (Windows/Linux)**.

Este repositório foi preparado para o caso de uso pessoal pedido: sincronizar grupos entre instalações desktop do Firefox sem backend próprio.

## Requisitos

- Firefox **141+**
- mesma conta Mozilla conectada nos dispositivos
- em `Configurações > Sincronização`, a opção **Add-ons** deve estar habilitada

## Comportamento atual

- Ao salvar um grupo, a extensão usa **nome + cor** como chave lógica.
- Se já existir um workspace sincronizado com o mesmo nome e a mesma cor, o snapshot é **atualizado** em vez de criar outro.
- Ao abrir um workspace salvo em outro dispositivo e depois salvar novamente, o registro sincronizado correspondente também é atualizado.

## Limitações importantes

- O Firefox **não sincroniza grupos nativos** por conta própria; a sincronização aqui é feita pela extensão, via `storage.sync`.
- O `groupId` do Firefox **não é estável** entre reinícios/restaurações; por isso a extensão salva um snapshot lógico (nome/cor/URLs), não o ID nativo.
- Este MVP foi desenhado para desktop.
- URLs internas/restritas podem não ser restauráveis. Neste caso elas são ignoradas.
- `storage.sync` tem limite de tamanho. Muitos grupos grandes podem estourar a cota.

## Estrutura

- `manifest.json`
- `background.js`
- `popup.html`
- `popup.js`
- `popup.css`
- `icons/icon.svg`

## Como testar durante o desenvolvimento

1. Abra `about:debugging#/runtime/this-firefox`
2. Clique em **Load Temporary Add-on**
3. Selecione qualquer arquivo dentro desta pasta, por exemplo `manifest.json`
4. A extensão ficará carregada até reiniciar o Firefox

Observação importante para testes:

- no modo temporário, remover/descarregar a extensão pode apagar dados da própria extensão em `storage.local` e `storage.sync`;
- para validar sincronização entre dispositivos, prefira manter a extensão carregada e usar `Sync Now` nos dois Firefox;
- para validar reinstalação de forma realista, use o `.xpi` assinado (unlisted), não só o temporário.

## Assinatura na AMO

Para Firefox release/beta, o add-on precisa ser **assinado pela Mozilla**.

Este repositório já está preparado para submissão `unlisted/self-distributed` porque:

- possui `browser_specific_settings.gecko.id`;
- define `strict_min_version`;
- declara `data_collection_permissions`, exigido para novas extensões submetidas à AMO;
- não usa código remoto.

Fluxo recomendado:

1. compacte o conteúdo da pasta em `.zip` ou `.xpi`, com o `manifest.json` na raiz do pacote;
2. envie para assinatura em **On your own / unlisted** no AMO;
3. baixe o `.xpi` assinado;
4. instale o arquivo assinado no Firefox normal.

## Privacidade e sincronização

- A extensão sincroniza as URLs salvas dos grupos via `storage.sync`.
- Por isso, o manifesto declara transmissão de **`browsingActivity`** e **`searchTerms`** no fluxo de consentimento da Mozilla.
- Nenhum backend próprio é usado.
